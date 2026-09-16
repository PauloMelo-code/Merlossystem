import type { Job } from "bullmq";
import { naoImplementado } from "@/lib/erros";

/**
 * COSTURA — dono: M6 (05-plano-construcao.md §5).
 *
 * Fila `agendamentos`, job `enviar-agendada`, concorrência 2, ritmo por conta.
 *
 * Fecha o defeito do sistema antigo em que `scheduled_for` era gravado e
 * ninguém observava: a mensagem agendada simplesmente não saía (ADR 0007).
 *
 * O agendamento aqui é POR LINHA (`conversas_agendamentos`), com `delay`
 * calculado no enfileiramento — não é `upsertJobScheduler`, que serve para
 * trabalho periódico do sistema, não para um compromisso único com uma cliente.
 *
 * Idempotente: o `jobId` determinístico é o id do agendamento, e a linha só sai
 * de `pendente` dentro da transação do envio.
 */

export type DadosAgendada = {
  lojaId: string;
  agendamentoId: string;
};

export async function enviarAgendada(job: Job<DadosAgendada>): Promise<void> {
  throw naoImplementado(`enviarAgendada [${job.name} #${job.id}] (fila agendamentos, pacote M6)`);
}
