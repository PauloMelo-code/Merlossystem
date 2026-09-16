import type { Contexto } from "@/lib/auth/guard";
import {
  atualizarComTrava,
  atualizarContador,
  atualizarEstado,
  inserirAuditado,
  type Transacao,
} from "@/lib/db/mutacoes";
import { conversas } from "@/lib/db/schema/conversas/conversas";
import { conversas_mensagens, type MetadadosMensagem } from "@/lib/db/schema/conversas/mensagens";
import { lojas_integracoes_eventos } from "@/lib/db/schema/integracoes";
import { ErroDeColisao } from "@/lib/erros";
import { previa as textoDaPrevia } from "@/lib/canais/normalizacao";
import { conversaDoPar, ultimaEncerradaDoPar } from "./_consultas-canal";
import { ACAO } from "./_sistema";
import { prefixoDaPrevia } from "./regras";

/**
 * Pontas de ESCRITA que a entrada (webhook) e a saída (tela, campanha) dividem.
 * Uma regra de mesclagem de conversa só — duas implementações abririam uma
 * segunda conversa com a mesma cliente (costura `saida.ts`).
 *
 * Tudo aqui roda dentro da transação de quem chama. Operação que pode violar
 * índice único roda em SAVEPOINT (`tx.transaction`): no Postgres, um erro
 * aborta a transação inteira e a mensagem da cliente se perderia junto.
 */

export const TETO_CONTEUDO = 8000;

export function violouUnico(erro: unknown): boolean {
  const e = erro as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

/** Roda `fn` num savepoint; violação de único vira `null`, o resto sobe. */
export async function emSavepoint<T>(tx: Transacao, fn: (sp: Transacao) => Promise<T>): Promise<T | null> {
  try {
    return await tx.transaction((sp) => fn(sp));
  } catch (erro) {
    if (violouUnico(erro)) return null;
    throw erro;
  }
}

export type ConversaResolvida = {
  id: string;
  nova: boolean;
  reaberta: boolean;
  ultimaMensagemEm: Date | null;
  primeiraRespostaEm: Date | null;
};

/**
 * Conversa do par (contato, conta) — regra do gateway (01-dados-dominio.md §2.2):
 *   1. aberta/pendente existente → usa;
 *   2. última `resolvida` → REABRE (trilha `conversa_reaberta`); se outra aberta
 *      nasceu no meio-tempo, o único parcial recusa e a existente é usada;
 *   3. `arquivada` não reabre → nasce uma nova;
 *   4. nada → cria.
 */
export async function obterConversa(
  tx: Transacao,
  ctx: Contexto,
  alvo: { lojaId: string; contatoId: string; integracaoId: string; agora: Date },
): Promise<ConversaResolvida> {
  const { lojaId, contatoId, integracaoId, agora } = alvo;
  const aberta = await conversaDoPar(tx, lojaId, contatoId, integracaoId);
  if (aberta) return { ...aberta, nova: false, reaberta: false };

  const encerrada = await ultimaEncerradaDoPar(tx, lojaId, contatoId, integracaoId);
  if (encerrada?.status === "resolvida") {
    try {
      const reaberta = await emSavepoint(tx, (sp) =>
        atualizarComTrava(
          sp,
          conversas,
          {
            id: encerrada.id,
            escopo: { tipo: "uma", lojaId },
            updatedAtOriginal: encerrada.updatedAt,
            dados: { status: "aberta", resolvida_em: null, resolvida_por: null },
          },
          ctx,
          ACAO.conversaReaberta,
        ),
      );
      if (reaberta) {
        return { ...encerrada, nova: false, reaberta: true };
      }
    } catch (erro) {
      if (!(erro instanceof ErroDeColisao)) throw erro;
    }
    const concorrente = await conversaDoPar(tx, lojaId, contatoId, integracaoId);
    if (concorrente) {
      return { ...concorrente, nova: false, reaberta: false };
    }
  }

  const criada = await emSavepoint(tx, (sp) =>
    inserirAuditado(
      sp,
      conversas,
      {
        loja_id: lojaId,
        contato_id: contatoId,
        integracao_id: integracaoId,
        status: "aberta",
        ultima_mensagem_em: agora,
      },
      ctx,
      ACAO.conversaCriada,
    ),
  );
  if (criada) {
    return { id: String(criada.id), nova: true, reaberta: false, ultimaMensagemEm: null, primeiraRespostaEm: null };
  }

  const vencedora = await conversaDoPar(tx, lojaId, contatoId, integracaoId);
  if (!vencedora) throw new Error("conversa do par sumiu entre a colisão e a releitura");
  return { ...vencedora, nova: false, reaberta: false };
}

export type NovaMensagem = {
  lojaId: string;
  conversaId: string;
  direcao: "entrada" | "saida";
  autorTipo: "contato" | "usuario" | "sistema" | "campanha";
  autorUsuarioId: string | null;
  conteudo: string | null;
  tipo: string;
  externoId: string | null;
  statusEntrega: string | null;
  notaInterna: boolean;
  chaveIdempotencia: string | null;
  respondeAId: string | null;
  ocorridaEm: Date;
  metadados: MetadadosMensagem & Record<string, unknown>;
};

/** Insere a mensagem. `null` = já existia (id externo ou chave de idempotência). */
export async function inserirMensagem(tx: Transacao, ctx: Contexto, m: NovaMensagem): Promise<string | null> {
  const conteudo = m.conteudo === null ? null : m.conteudo.slice(0, TETO_CONTEUDO);
  const linha = await emSavepoint(tx, (sp) =>
    inserirAuditado(
      sp,
      conversas_mensagens,
      {
        loja_id: m.lojaId,
        conversa_id: m.conversaId,
        direcao: m.direcao,
        autor_tipo: m.autorTipo,
        autor_usuario_id: m.autorUsuarioId,
        conteudo,
        tipo_conteudo: m.tipo,
        externo_id: m.externoId,
        status_entrega: m.statusEntrega,
        status_atualizado_em: m.statusEntrega === null ? null : m.ocorridaEm,
        nota_interna: m.notaInterna,
        responde_a_id: m.respondeAId,
        chave_idempotencia: m.chaveIdempotencia,
        ocorrida_em: m.ocorridaEm,
        metadados: m.metadados,
      },
      ctx,
      m.notaInterna ? ACAO.notaInterna : m.direcao === "entrada" ? ACAO.mensagemRecebida : ACAO.mensagemEnviada,
    ),
  );
  return linha ? String(linha.id) : null;
}

/**
 * Contadores e cache da conversa — relógio SEPARADO do `updated_at`
 * (`atualizarContador` não o toca). Mensagem atrasada não faz a lista voltar
 * no tempo.
 */
export async function atualizarCacheDaConversa(
  tx: Transacao,
  alvo: { lojaId: string; conversaId: string; ultimaMensagemEm: Date | null },
  m: { direcao: "entrada" | "saida"; tipo: string; conteudo: string | null; notaInterna: boolean; ocorridaEm: Date },
  extras: { primeiraResposta?: boolean } = {},
): Promise<void> {
  const cache: Record<string, number | string | Date | null> = {};
  const maisNova = !alvo.ultimaMensagemEm || m.ocorridaEm >= alvo.ultimaMensagemEm;
  if (maisNova) {
    cache.ultima_mensagem_em = m.ocorridaEm;
    cache.ultima_mensagem_previa = `${prefixoDaPrevia(m.direcao, m.notaInterna)}${textoDaPrevia(m.tipo, m.conteudo)}`.slice(0, 100);
  }
  if (m.direcao === "entrada") {
    cache.nao_lidas = 1;
    if (maisNova) cache.ultima_entrada_em = m.ocorridaEm;
  }
  if (extras.primeiraResposta) cache.primeira_resposta_em = m.ocorridaEm;
  if (Object.keys(cache).length === 0) return;
  await atualizarContador(tx, conversas, { id: alvo.conversaId, escopo: { tipo: "uma", lojaId: alvo.lojaId } }, cache);
}

/**
 * `registrarProcessamentoEvento()` (01-dados.md §6.4), via `atualizarEstado`:
 * no MESMO `UPDATE` grava `processado_em` e SUBSTITUI o corpo cru pela
 * projeção mascarada. A PII do webhook tem prazo curto, não 30 dias.
 *
 * PENDÊNCIA: o plano cita esta função em `mutacoes.ts`, onde ela não existe.
 * Ela nasce aqui, sobre o helper que existe, sem nenhum `.update(` novo.
 */
export async function registrarProcessamentoEvento(
  tx: Transacao,
  eventoId: string,
  resultado: { tipo: "processado" | "descartado" | "falhou"; erro?: string | null; projecao?: unknown },
): Promise<void> {
  const estado: Record<string, unknown> = {
    tipo: resultado.tipo,
    processado_em: new Date(),
    erro: resultado.erro ?? null,
  };
  // O corpo cru sobrevive enquanto serve de prova: só em `falhou`.
  if (resultado.tipo !== "falhou") estado.corpo = resultado.projecao ?? { mascarado: true };
  await atualizarEstado(tx, lojas_integracoes_eventos, { id: eventoId, escopo: { tipo: "todas" } }, estado);
}
