import { Queue, type JobsOptions } from "bullmq";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { DadosEmailSeguranca } from "@/lib/auth/emails";
import { redisDaFila } from "./conexao";

/**
 * Catálogo ÚNICO das filas e dos jobs (03-arquitetura.md §8.1).
 *
 * Nome de fila e nome de job são string em toda API do BullMQ. Aqui eles viram
 * tipo: `enfileirar("midia", "gerar-miniatura", …)` compila, e
 * `enfileirar("midia", "gerar-miniature", …)` não. Sem isto, um erro de digitação
 * cria uma fila nova, vazia, que ninguém consome — e a mensagem some sem erro.
 *
 * DIVERGÊNCIA RESOLVIDA: a tabela de `03 §8.1` cita um job `limpeza-auth` em
 * `manutencao`. Ele NÃO existe: `02-seguranca.md §21` e o S-09 dizem, com todas
 * as letras, que nenhum job de auth apaga linha, e a costura de
 * `05-plano-construcao.md §5` lista as seis funções de `manutencao.ts` sem ele.
 * A biblioteca é quem apaga a linha de sessão, dentro dela mesma.
 */

/** `1 por campanha` de §8.1 é ritmo por CHAVE, aplicado no processador. */
export const FILAS = {
  "mensagens-entrada": { jobs: ["processar-evento"], concorrencia: 8 },
  "mensagens-saida": { jobs: ["enviar-mensagem", "reenviar"], concorrencia: 4 },
  midia: { jobs: ["baixar-de-url", "gerar-miniatura", "transcrever-audio"], concorrencia: 4 },
  campanhas: { jobs: ["processar-lote"], concorrencia: 1 },
  agendamentos: { jobs: ["enviar-agendada"], concorrencia: 2 },
  integracoes: {
    jobs: ["sincronizar-bling", "sincronizar-templates", "renovar-token", "conferir-sessao-uazapi"],
    concorrencia: 2,
  },
  manutencao: {
    jobs: [
      "gerar-alertas",
      "retencao-eventos",
      "limpar-midia",
      "expirar-convites",
      "reconciliacao",
      "resumo-diario",
    ],
    concorrencia: 1,
  },
  /** Pós-venda (R2-A): pesquisa de satisfação. */
  "pos-venda": { jobs: ["disparar-pesquisas"], concorrencia: 1 },
  /** Cobrança (R2-B): notificação, cancelamento no provedor, expiração e conciliação. */
  pagamentos: {
    jobs: ["processar-notificacao", "cancelar-no-provedor", "expirar-cobrancas", "conciliar-cobrancas"],
    concorrencia: 2,
  },
  /** IA (R2-C): varredura de 1 min e classificação. Concorrência baixa: cada job é custo. */
  ia: { jobs: ["varrer-ia", "classificar-conversa"], concorrencia: 2 },
  emails: { jobs: ["email-seguranca"], concorrencia: 2 },
} as const satisfies Record<string, { jobs: readonly string[]; concorrencia: number }>;

export type NomeDeFila = keyof typeof FILAS;
export type JobDaFila<F extends NomeDeFila> = (typeof FILAS)[F]["jobs"][number];

export const NOMES_DE_FILA = Object.keys(FILAS) as NomeDeFila[];

/** Carga de `manutencao` (dono M8). Os agendados vão sem carga. */
export type DadosManutencao = {
  /** Nulo = varre a rede inteira. Presente = só aquela loja. */
  lojaId?: string;
  /** Só em `limpar-midia` vindo da anonimização LGPD. */
  solicitacaoId?: string;
  midiaIds?: readonly string[];
};

/** Cargas tipadas na fundação; o resto é do pacote dono. */
type CargaPorFila = { emails: DadosEmailSeguranca; manutencao: DadosManutencao };
export type Carga<F extends NomeDeFila> = F extends keyof CargaPorFila
  ? CargaPorFila[F]
  : Record<string, unknown>;

/**
 * FIFO com UMA prioridade por fila (§8.2): prioridade mista reordena a fila e a
 * ordem de chegada da conversa deixa de ser a ordem de entrega.
 *
 * `removeOnFail: false` é obrigatório: o job morto é a prova de que alguém ficou
 * sem resposta, e ele ainda precisa ser lido para ir à DLQ.
 */
export const OPCOES_PADRAO: JobsOptions = {
  attempts: env.FILA_TENTATIVAS,
  backoff: { type: "exponential", delay: 2_000 },
  removeOnComplete: 1_000,
  removeOnFail: false,
};

const global_ = globalThis as unknown as { _filas?: Map<string, Queue> };
const registro = (global_._filas ??= new Map<string, Queue>());

function abrir(nome: string, prefixo?: string): Queue {
  const chave = prefixo ? `${prefixo}:${nome}` : nome;
  const existente = registro.get(chave);
  if (existente) return existente;
  const nova = new Queue(nome, {
    connection: redisDaFila(),
    defaultJobOptions: OPCOES_PADRAO,
    ...(prefixo === undefined ? {} : { prefix: prefixo }),
  });
  registro.set(chave, nova);
  return nova;
}

export function fila<F extends NomeDeFila>(nome: F): Queue<Carga<F>> {
  return abrir(nome) as Queue<Carga<F>>;
}

/**
 * Onde o job vai quando esgota as tentativas (§8.2): as chaves ficam em
 * `bull:<fila>:dlq:*`. É fila de verdade, sem worker — alguém olha, corrige a
 * causa e reenfileira.
 *
 * O namespace vem do PREFIXO, não do nome: o BullMQ 6 recusa nome de fila com
 * `:` (`queue-base.js`, "Queue name cannot contain :"). Pelo prefixo o
 * resultado no Redis é o mesmo `<fila>:dlq` que a §8.2 pede.
 */
export function filaDlq(nome: NomeDeFila): Queue {
  return abrir("dlq", `bull:${nome}`);
}

/**
 * Porta única de entrada. Devolve o id do job, ou `null` quando o Redis está
 * fora — quem enfileira decide se isso é fatal. Nunca lança: uma mensagem que
 * não entra na fila não pode derrubar a resposta de quem está atendendo.
 */
export async function enfileirar<F extends NomeDeFila>(
  nome: F,
  job: JobDaFila<F>,
  dados: Carga<F>,
  opcoes: JobsOptions = {},
): Promise<string | null> {
  try {
    // A conferência de tipo já aconteceu na assinatura desta função. O
    // `Queue` cru evita que o `ExtractNameType` do BullMQ tente inferir o nome
    // do job a partir de uma carga ainda genérica.
    const criado = await (abrir(nome) as Queue).add(job, dados, opcoes);
    return criado.id ?? null;
  } catch (erro) {
    logger.error({ fila: nome, job, erro: String(erro) }, "falha ao enfileirar");
    return null;
  }
}

/** Fecha as filas abertas por este processo (desligamento do worker). */
export async function fecharFilas(): Promise<void> {
  const abertas = [...registro.values()];
  registro.clear();
  await Promise.allSettled(abertas.map((q) => q.close()));
}
