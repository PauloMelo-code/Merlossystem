import type { Job } from "bullmq";
import { naoImplementado } from "@/lib/erros";

/**
 * COSTURA — dono: R2-B. Fila `pagamentos`. Rede sempre fora de transação;
 * transação trava pedidos antes de pagamentos (R2-PG-14).
 *
 * Os dois jobs AGENDADOS nascem no-op (C14): lançar a cada 5 min mandaria um
 * job por ciclo para a DLQ até o pacote fechar. Os dois SOB DEMANDA lançam: só
 * o pacote R2-B os enfileira.
 */
export type DadosNotificacao = { eventoId: string };
export type DadosCancelamento = { pagamentoId: string; lojaId: string };
export type DadosConciliacao = { lojaId?: string };

export async function processarNotificacao(job: Job<DadosNotificacao>): Promise<void> {
  throw naoImplementado(`processarNotificacao [#${job.id}] (fila pagamentos, pacote R2-B)`);
}
export async function cancelarNoProvedor(job: Job<DadosCancelamento>): Promise<void> {
  throw naoImplementado(`cancelarNoProvedor [#${job.id}] (fila pagamentos, pacote R2-B)`);
}
/** Enquanto a costura não é preenchida, não há cobrança para expirar. */
export async function expirarCobrancas(): Promise<void> {}
/** Enquanto a costura não é preenchida, não há cobrança para conciliar. */
export async function conciliarCobrancas(): Promise<void> {}
