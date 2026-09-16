import type { Job } from "bullmq";
import { avisarConversa, enviarDaFila, type DadosDoEnvio } from "@/lib/conversas";
import { logger } from "@/lib/logger";

/**
 * Fila `mensagens-saida`, jobs `enviar-mensagem` e `reenviar`, concorrência 4
 * (03-arquitetura.md §8).
 *
 * RITMO POR CONTA (§8.4): aplicado em `conversas/envio.ts` com `consumir()` —
 * 1 msg/s por conta uazapi e 10 msg/s por conta oficial.
 *
 * `reenviar` só age sobre mensagem que `reivindicarReenvio()` já devolveu a
 * `pendente`: é a única transição que sai de `falhou`, e é claim atômico. O
 * trabalho é o mesmo do envio; o nome separado é o que aparece no painel da fila.
 *
 * Erro classificado (§8.2): permanente vira `falhou` na hora, sem retentar; o
 * transitório sobe e a fila retenta. Na última tentativa, vira `falhou` também.
 */

export type DadosEnvio = DadosDoEnvio;

async function executar(job: Job<DadosEnvio>): Promise<void> {
  const tentativas = job.opts.attempts ?? 1;
  const ultima = job.attemptsMade + 1 >= tentativas;
  const { desfecho, conversaId } = await enviarDaFila(job.data, ultima);
  if (desfecho !== "ignorada" && conversaId) {
    avisarConversa(job.data.lojaId, "mensagem-atualizada", { conversaId, mensagemId: job.data.mensagemId });
  }
  logger.info({ job: job.name, mensagemId: job.data.mensagemId, desfecho }, "envio processado");
}

export async function enviarMensagem(job: Job<DadosEnvio>): Promise<void> {
  await executar(job);
}

export async function reenviar(job: Job<DadosEnvio>): Promise<void> {
  await executar(job);
}
