import type { Job } from "bullmq";
import { naoImplementado } from "@/lib/erros";

/**
 * COSTURA — dono: M1 (05-plano-construcao.md §5).
 *
 * Fila `mensagens-entrada`, job `processar-evento`, concorrência 8.
 *
 * O que este processador tem de fazer (03-arquitetura.md §8.1 e §11):
 *   1. ler a linha já persistida em `lojas_integracoes_eventos` pelo webhook —
 *      o handler grava o evento cru e devolve 200 na hora; o trabalho é daqui;
 *   2. resolver conta → loja → contato (`upsertContatoPorCanal`) → conversa →
 *      mensagem, tudo numa transação;
 *   3. enfileirar `midia/baixar-de-url` para cada anexo;
 *   4. publicar `mensagem-nova` no canal da loja (`tempo-real/publicar.ts`);
 *   5. `registrarProcessamentoEvento()` — no MESMO `UPDATE` grava
 *      `processado_em` e SUBSTITUI `corpo` pela projeção mascarada.
 *
 * Idempotente por construção: reprocessar bate nos únicos
 * `(provedor, evento_externo_id)` e `(loja_id, externo_id)`.
 */

export type DadosProcessarEvento = {
  /** `lojas_integracoes_eventos.id` — nunca o corpo do webhook. */
  eventoId: string;
  provedor: string;
};

export async function processarEvento(job: Job<DadosProcessarEvento>): Promise<void> {
  throw naoImplementado(`processarEvento [${job.name} #${job.id}] (fila mensagens-entrada, pacote M1)`);
}
