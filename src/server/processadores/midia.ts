import type { Job } from "bullmq";
import { ErroDeIntegracao } from "@/lib/erros";
import { logComContexto } from "@/lib/logger";
import { baixarAnexo, gerarMiniaturaDaMidia, type DadosDownload } from "@/lib/midias";

/**
 * Fila `midia`, jobs `baixar-de-url` e `gerar-miniatura`, concorrência 4
 * (dono: M3).
 *
 * `baixar-de-url` é o único consumidor de `conversas_mensagens_midias.url_externa`:
 * a URL chega do provedor e SÓ é buscada por `rede/buscarExterno.ts`. Baixado
 * o binário, a coluna é limpa (`baixada = true`) e ela NUNCA entra em DTO.
 * Falhou de vez? A tela mostra "mídia indisponível" — nunca o link.
 *
 * `gerar-miniatura` usa `sharp`. Objeto ausente no MinIO é SUCESSO.
 *
 * Erro PERMANENTE (SSRF recusado, tipo não aceito, link 4xx) não retenta: é
 * registrado e o job termina (padrão de `templates/job.ts`). Transitório sobe
 * e o BullMQ retenta com backoff.
 */

export type DadosMidia = {
  lojaId: string;
  midiaId: string;
};

async function executar(job: Job, lojaId: string, trabalho: () => Promise<string>): Promise<string> {
  const log = logComContexto({ requisicaoId: job.id ?? "sem-id", origem: "worker", lojaId });
  try {
    const resultado = await trabalho();
    log.info({ job: job.name, resultado }, "mídia processada");
    return resultado;
  } catch (erro) {
    if (erro instanceof ErroDeIntegracao && erro.permanente) {
      log.error({ job: job.name, erro: erro.message }, "falha permanente de mídia: não retenta");
      return "recusada";
    }
    throw erro;
  }
}

export async function baixarDeUrl(job: Job<DadosDownload>): Promise<void> {
  await executar(job, job.data.lojaId, () => baixarAnexo(job.data));
}

export async function gerarMiniatura(job: Job<DadosMidia>): Promise<void> {
  await executar(job, job.data.lojaId, () => gerarMiniaturaDaMidia(job.data));
}
