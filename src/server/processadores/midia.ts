import type { Job } from "bullmq";
import { naoImplementado } from "@/lib/erros";

/**
 * COSTURA — dono: M3 (05-plano-construcao.md §5).
 *
 * Fila `midia`, jobs `baixar-de-url` e `gerar-miniatura`, concorrência 4.
 *
 * `baixar-de-url` é o único consumidor de `lojas_midias.url_externa`: a URL
 * chega do provedor e SÓ pode ser buscada por `rede/buscarExterno.ts` (a trava
 * de SSRF reprova `fetch(` com URL não literal fora dele). Baixado o binário,
 * a coluna é limpa (`baixada = true`) e ela NUNCA entra em DTO (ADR 0009, R-09).
 *
 * `gerar-miniatura` usa `sharp`. Objeto ausente no MinIO é SUCESSO, não erro:
 * o job é idempotente e a mídia pode ter sido anonimizada por LGPD no meio.
 */

export type DadosMidia = {
  lojaId: string;
  midiaId: string;
};

export async function baixarDeUrl(job: Job<DadosMidia>): Promise<void> {
  throw naoImplementado(`baixarDeUrl [${job.name} #${job.id}] (fila midia, pacote M3)`);
}

export async function gerarMiniatura(job: Job<DadosMidia>): Promise<void> {
  throw naoImplementado(`gerarMiniatura [${job.name} #${job.id}] (fila midia, pacote M3)`);
}
