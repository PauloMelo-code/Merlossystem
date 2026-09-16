import type { Job } from "bullmq";
import { env } from "@/lib/env";
import { naoImplementado } from "@/lib/erros";

/** COSTURA — dono: R2-A (pós-venda). Desligado por padrão: nada roda sem CSAT_ATIVO. */
export async function dispararPesquisas(job: Job): Promise<void> {
  if (!env.CSAT_ATIVO) return;
  throw naoImplementado(`dispararPesquisas [#${job.id}] (fila pos-venda, pacote R2-A)`);
}
