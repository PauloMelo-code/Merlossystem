import type { Job } from "bullmq";
import { avisarConversa, marcarEventoComoFalho, processarEventoDeCanal } from "@/lib/conversas";
import { logger } from "@/lib/logger";
import { agendarDownload } from "@/lib/midias/ingestao";

/**
 * Fila `mensagens-entrada`, job `processar-evento`, concorrência 8
 * (03-arquitetura.md §8.1 e §11).
 *
 *   1. lê a linha já persistida em `lojas_integracoes_eventos` pela borda;
 *   2. conta → loja → contato → conversa → mensagem, numa transação;
 *   3. depois do commit: download dos anexos (`midia/baixar-de-url`, M3) e o
 *      tempo real (`mensagem-nova` / `mensagem-atualizada`);
 *   4. `registrarProcessamentoEvento()` roda DENTRO da transação: o mesmo
 *      UPDATE grava `processado_em` e troca o corpo pela projeção mascarada.
 *
 * Idempotente por construção: reprocessar bate nos únicos
 * `(provedor, evento_externo_id)` e `(loja_id, externo_id)`. Na última
 * tentativa o evento vira `falhou` — o corpo cru fica, é a prova.
 */

export type DadosProcessarEvento = {
  /** `lojas_integracoes_eventos.id` — nunca o corpo do webhook. */
  eventoId: string;
  provedor: string;
  /** Opcional: a borda já resolveu a conta (lote agrupado por conta). */
  integracaoId?: string;
};

export async function processarEvento(job: Job<DadosProcessarEvento>): Promise<void> {
  const { eventoId, integracaoId } = job.data;
  let resultado;
  try {
    resultado = await processarEventoDeCanal({ eventoId, integracaoId });
  } catch (erro) {
    const tentativas = job.opts.attempts ?? 1;
    if (job.attemptsMade + 1 >= tentativas) {
      await marcarEventoComoFalho(eventoId, erro instanceof Error ? erro.message : String(erro)).catch(
        (falha: unknown) => logger.error({ eventoId, erro: String(falha) }, "não marcou o evento como falho"),
      );
    }
    throw erro;
  }

  const { lojaId, provedor } = resultado;
  if (!lojaId) return;
  for (const anexoId of resultado.anexosParaBaixar) {
    await agendarDownload({ lojaId, anexoId, provedor: provedor ?? job.data.provedor });
  }
  for (const m of resultado.novas) avisarConversa(lojaId, "mensagem-nova", m);
  for (const m of resultado.atualizadas) avisarConversa(lojaId, "mensagem-atualizada", m);
  logger.info(
    { eventoId, lojaId, novas: resultado.novas.length, status: resultado.atualizadas.length },
    "evento de canal processado",
  );
}
