import { and, eq, sql } from "drizzle-orm";
import { ErroDeEscopo } from "@/lib/erros";
import { pedidos_numeracao } from "../schema/pedidos/numeracao";
import type { Transacao } from "./base";

/**
 * Numeração de pedido (01-dados-dominio.md §6.2). O `UPDATE ... RETURNING` é a
 * própria trava; não passa por `vivos()` porque o CHECK
 * `pedidos_numeracao_nunca_excluida` garante que não existe linha morta.
 */
export async function proximoNumeroDePedido(
  tx: Transacao,
  lojaId: string,
  anoMes: string,
): Promise<number> {
  await tx.insert(pedidos_numeracao).values({ loja_id: lojaId, ano_mes: anoMes }).onConflictDoNothing();
  const [linha] = await tx
    .update(pedidos_numeracao)
    .set({ ultimo_numero: sql`${pedidos_numeracao.ultimo_numero} + 1`, updated_at: new Date() })
    .where(and(eq(pedidos_numeracao.loja_id, lojaId), eq(pedidos_numeracao.ano_mes, anoMes)))
    .returning({ numero: pedidos_numeracao.ultimo_numero });
  if (!linha) throw new ErroDeEscopo();
  return linha.numero;
}
