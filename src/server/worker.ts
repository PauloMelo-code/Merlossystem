import { Worker, type Job } from "bullmq";
import { redisDaFila, fecharConexoes } from "@/lib/fila/conexao";
import { registrarAgendamentos } from "@/lib/fila/agendamentos";
import { FILAS, NOMES_DE_FILA, fecharFilas, filaDlq, type NomeDeFila } from "@/lib/fila/filas";
import { logger } from "@/lib/logger";
import { enviarAgendada } from "./processadores/agendamentos";
import { processarLote } from "./processadores/campanhas";
import { emailSeguranca } from "./processadores/emails";
import {
  conferirSessaoUazapi,
  renovarToken,
  sincronizarBling,
  sincronizarTemplates,
} from "./processadores/integracoes";
import {
  expirarConvites,
  gerarAlertas,
  limparMidia,
  reconciliacao,
  retencaoEventos,
  resumoDiario,
} from "./processadores/manutencao";
import { processarEvento } from "./processadores/mensagens-entrada";
import { enviarMensagem, reenviar } from "./processadores/mensagens-saida";
import { baixarDeUrl, gerarMiniatura } from "./processadores/midia";
import { classificarConversa, transcreverAudio, varrerIa } from "./processadores/inteligencia";
import {
  cancelarNoProvedor,
  conciliarCobrancas,
  expirarCobrancas,
  processarNotificacao,
} from "./processadores/pagamentos";
import { dispararPesquisas } from "./processadores/pos-venda";

/**
 * Worker em PROCESSO SEPARADO (03-arquitetura.md §8.3).
 *
 * Não expõe porta HTTP, loga com o mesmo pino do app e roda como segundo alvo
 * da mesma imagem (Dockerfile, alvo `worker`). O worker é publicado JUNTO com o
 * app — senão o sistema sobe sem ninguém para processar a fila, e o sintoma é
 * "a mensagem chegou no WhatsApp e não apareceu na tela".
 *
 * `--conditions=react-server`: os processadores alcançam `db/client.ts`, que
 * importa `server-only`. Fora do runtime do Next, esse pacote LANÇA no import.
 * A condição faz o Node resolver o `empty.js` que o próprio pacote publica.
 * Está no script `worker` e no `CMD` do Dockerfile; sem ela o worker não sobe.
 */

type Processador = (job: Job) => Promise<void>;

/** Job → função. As chaves são conferidas contra `FILAS` no boot. */
const PROCESSADORES: Record<NomeDeFila, Record<string, Processador>> = {
  "mensagens-entrada": { "processar-evento": processarEvento as Processador },
  "mensagens-saida": {
    "enviar-mensagem": enviarMensagem as Processador,
    reenviar: reenviar as Processador,
  },
  midia: {
    "baixar-de-url": baixarDeUrl as Processador,
    "gerar-miniatura": gerarMiniatura as Processador,
    "transcrever-audio": transcreverAudio as Processador,
  },
  campanhas: { "processar-lote": processarLote as Processador },
  agendamentos: { "enviar-agendada": enviarAgendada as Processador },
  integracoes: {
    "sincronizar-bling": sincronizarBling as Processador,
    "sincronizar-templates": sincronizarTemplates as Processador,
    "renovar-token": renovarToken as Processador,
    "conferir-sessao-uazapi": conferirSessaoUazapi as Processador,
  },
  manutencao: {
    "gerar-alertas": gerarAlertas as Processador,
    "retencao-eventos": retencaoEventos as Processador,
    "limpar-midia": limparMidia as Processador,
    "expirar-convites": expirarConvites as Processador,
    reconciliacao: reconciliacao as Processador,
    "resumo-diario": resumoDiario as Processador,
  },
  "pos-venda": { "disparar-pesquisas": dispararPesquisas as Processador },
  pagamentos: {
    "processar-notificacao": processarNotificacao as Processador,
    "cancelar-no-provedor": cancelarNoProvedor as Processador,
    "expirar-cobrancas": expirarCobrancas as Processador,
    "conciliar-cobrancas": conciliarCobrancas as Processador,
  },
  ia: {
    "varrer-ia": varrerIa as Processador,
    "classificar-conversa": classificarConversa as Processador,
  },
  emails: { "email-seguranca": emailSeguranca as Processador },
};

/**
 * Fila com job declarado em §8.1 e sem função é fila que engole trabalho em
 * silêncio. Conferir no boot custa microssegundos e falha na hora de subir, não
 * de madrugada.
 */
export function conferirCobertura(): void {
  const faltando: string[] = [];
  for (const nome of NOMES_DE_FILA) {
    const declarados: readonly string[] = FILAS[nome].jobs;
    const implementados = Object.keys(PROCESSADORES[nome]);
    for (const job of declarados) {
      if (!implementados.includes(job)) faltando.push(`${nome}/${job}`);
    }
    for (const job of implementados) {
      if (!declarados.includes(job)) faltando.push(`${nome}/${job} (não declarado em FILAS)`);
    }
  }
  if (faltando.length > 0) {
    throw new Error(`worker sem processador para: ${faltando.join(", ")}`);
  }
}

/**
 * Esgotadas as tentativas, o job vai para `<fila>:dlq` (§8.2). Job morto é
 * cliente sem resposta: fica registrado, fica visível e não some.
 *
 * ponytail: o alerta de DOMÍNIO (linha em `alertas`) é de M8 — aqui sai log
 * `fatal`, que é o que o worker tem sem depender de módulo de outro pacote.
 */
async function paraDlq(nome: NomeDeFila, job: Job | undefined, erro: Error): Promise<void> {
  if (!job) return;
  const tentativas = job.opts.attempts ?? 1;
  if (job.attemptsMade < tentativas) {
    logger.warn(
      { fila: nome, job: job.name, id: job.id, tentativa: job.attemptsMade, erro: erro.message },
      "job falhou, vai retentar",
    );
    return;
  }
  logger.fatal(
    { fila: nome, job: job.name, id: job.id, erro: erro.message },
    "job morto: foi para a DLQ",
  );
  try {
    await filaDlq(nome).add(job.name, job.data, {
      attempts: 1,
      removeOnComplete: false,
      removeOnFail: false,
    });
  } catch (falha) {
    logger.fatal({ fila: nome, erro: String(falha) }, "falha ao gravar na DLQ");
  }
}

function criarWorker(nome: NomeDeFila): Worker {
  const mapa = PROCESSADORES[nome];
  const worker = new Worker(
    nome,
    async (job: Job) => {
      const processador = mapa[job.name];
      if (!processador) throw new Error(`job desconhecido na fila ${nome}: ${job.name}`);
      await processador(job);
    },
    { connection: redisDaFila(), concurrency: FILAS[nome].concorrencia },
  );
  worker.on("failed", (job, erro) => void paraDlq(nome, job, erro));
  worker.on("error", (erro) => logger.error({ fila: nome, erro: erro.message }, "erro no worker"));
  return worker;
}

async function principal(): Promise<void> {
  conferirCobertura();

  const workers = NOMES_DE_FILA.map(criarWorker);
  logger.info({ filas: NOMES_DE_FILA, total: workers.length }, "worker no ar");

  await registrarAgendamentos();

  /**
   * `SIGTERM` → `worker.close()` espera o job corrente terminar, depois as
   * filas e as conexões. Sem `process.exit` seco: matar o processo no meio de um
   * envio deixa a cliente sem a mensagem e a linha em `pendente` para sempre.
   */
  let desligando = false;
  const desligar = async (sinal: string) => {
    if (desligando) return;
    desligando = true;
    logger.info({ sinal }, "desligando: esperando os jobs em andamento");
    await Promise.allSettled(workers.map((w) => w.close()));
    await fecharFilas();
    await fecharConexoes();
    logger.info({ sinal }, "worker desligado");
  };

  for (const sinal of ["SIGTERM", "SIGINT"] as const) {
    process.on(sinal, () => void desligar(sinal));
  }
}

void principal().catch((erro: unknown) => {
  logger.fatal({ erro: String(erro) }, "worker não subiu");
  process.exitCode = 1;
});
