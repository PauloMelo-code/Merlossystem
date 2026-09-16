import type { Job } from "bullmq";
import { naoImplementado } from "@/lib/erros";

/**
 * COSTURA — dono: R2-C (inteligência).
 * Fila `ia`: `varrer-ia` (agendado, 1/min) e `classificar-conversa`.
 * Fila `midia`: `transcrever-audio` (sob demanda). Nenhuma chamada a provedor
 * dentro de transação; nenhum conteúdo em log.
 */
export type DadosClassificacao = { lojaId: string; conversaId: string; ate: string };
export type DadosTranscricao = { lojaId: string; mensagemMidiaId: string; usuarioId: string };

/** Enquanto a costura não é preenchida, a varredura não faz nada (a IA nasce desligada). */
export async function varrerIa(): Promise<void> {}
export async function classificarConversa(job: Job<DadosClassificacao>): Promise<void> {
  throw naoImplementado(`classificarConversa [#${job.id}] (fila ia, pacote R2-C)`);
}
export async function transcreverAudio(job: Job<DadosTranscricao>): Promise<void> {
  throw naoImplementado(`transcreverAudio [#${job.id}] (fila midia, pacote R2-C)`);
}
