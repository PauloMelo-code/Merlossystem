import type { Job } from "bullmq";
import { enviarAgendamento, type DadosAgendada } from "@/lib/agendamentos/envio";
import { logComContexto } from "@/lib/logger";

/**
 * Fila `agendamentos`, job `enviar-agendada` (05-plano-construcao.md §5, dono M6).
 *
 * Fecha o defeito do antigo em que `scheduled_for` era gravado e ninguém
 * observava (ADR 0007). O agendamento é POR LINHA, com `delay` calculado no
 * enfileiramento; a regra mora em `src/lib/agendamentos/envio.ts`.
 */

export type { DadosAgendada };

export async function enviarAgendada(job: Job<DadosAgendada>): Promise<void> {
  const log = logComContexto({
    requisicaoId: job.id ?? "sem-id",
    origem: "worker",
    lojaId: job.data.lojaId,
  });
  const desfecho = await enviarAgendamento(job.data);
  log.info({ agendamentoId: job.data.agendamentoId, desfecho }, "mensagem agendada processada");
}
