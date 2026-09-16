import type { Job } from "bullmq";
import { naoImplementado } from "@/lib/erros";

/**
 * COSTURA — dono: M1 (05-plano-construcao.md §5).
 *
 * Fila `mensagens-saida`, jobs `enviar-mensagem` e `reenviar`, concorrência 4.
 *
 * RITMO POR CONTA (03-arquitetura.md §8.4): o limitador do BullMQ é por FILA; o
 * teto por número é aplicado AQUI, com `consumir()` de `seguranca/limite.ts` —
 * 1 msg/s por conta uazapi e 10 msg/s por conta oficial, configurável por
 * integração. Sem isto, uma campanha derruba o número da rede em horário de pico.
 *
 * `reenviar` só pode agir sobre mensagem que `reivindicarReenvio()` já
 * reivindicou: é a única transição que sai de `falhou`, e é claim atômico.
 *
 * Erro classificado (§8.2): credencial inválida, contato sem identificador e
 * payload irrecuperável são `permanente` — não retentam. O resto é transitório.
 */

export type DadosEnvio = {
  lojaId: string;
  mensagemId: string;
  integracaoId: string;
};

export async function enviarMensagem(job: Job<DadosEnvio>): Promise<void> {
  throw naoImplementado(`enviarMensagem [${job.name} #${job.id}] (fila mensagens-saida, pacote M1)`);
}

export async function reenviar(job: Job<DadosEnvio>): Promise<void> {
  throw naoImplementado(`reenviar [${job.name} #${job.id}] (fila mensagens-saida, pacote M1)`);
}
