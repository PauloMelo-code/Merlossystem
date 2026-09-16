import type { Job } from "bullmq";
import { naoImplementado } from "@/lib/erros";

/**
 * COSTURA — dono: M6 (05-plano-construcao.md §5).
 *
 * Fila `campanhas`, job `processar-lote`, UM lote por campanha de cada vez.
 *
 * A reserva do lote é `reservarDestinatarios()` (`mutacoes.ts`): `FOR UPDATE
 * SKIP LOCKED` para dois workers não pegarem a mesma cliente, e `reservado_em`
 * é o lease que devolve a linha à fila se o worker morrer no meio.
 *
 * O envio propriamente dito NÃO acontece aqui: o lote enfileira
 * `mensagens-saida/enviar-mensagem` por destinatário, através da costura
 * `src/lib/conversas/saida.ts` (M1). É isso que faz a campanha respeitar o
 * mesmo ritmo por conta do atendimento — uma campanha não pode furar a fila
 * de quem está conversando.
 *
 * Ao fim do lote, publica `campanha-progresso` e reenfileira o próximo lote
 * enquanto houver `pendente`.
 */

export type DadosLote = {
  lojaId: string;
  campanhaId: string;
  /** Tamanho do lote. O ritmo por conta é de quem envia, não de quem reserva. */
  tamanho: number;
};

export async function processarLote(job: Job<DadosLote>): Promise<void> {
  throw naoImplementado(`processarLote [${job.name} #${job.id}] (fila campanhas, pacote M6)`);
}
