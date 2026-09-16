import type { Job } from "bullmq";
import { processarLoteDeCampanha, type DadosLote } from "@/lib/campanhas/lote";
import { logComContexto } from "@/lib/logger";

/**
 * Fila `campanhas`, job `processar-lote` (05-plano-construcao.md §5, dono M6).
 *
 * A regra mora em `src/lib/campanhas/lote.ts`: reserva com `FOR UPDATE SKIP
 * LOCKED` + lease, registro na conversa da cliente pela costura
 * `src/lib/conversas/saida.ts` (M1) e ritmo por conta no encadeamento.
 */

export type { DadosLote };

export async function processarLote(job: Job<DadosLote>): Promise<void> {
  const log = logComContexto({
    requisicaoId: job.id ?? "sem-id",
    origem: "worker",
    lojaId: job.data.lojaId,
  });
  const resultado = await processarLoteDeCampanha(job.data);
  log.info({ campanhaId: job.data.campanhaId, ...resultado }, "lote de campanha processado");
}
