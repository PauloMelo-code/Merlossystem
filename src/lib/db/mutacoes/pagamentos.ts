import { and, eq } from "drizzle-orm";
import { vivos } from "../consultas";
import type { StatusPagamento } from "../schema/_enums/pedidos";
import { pagamentos } from "../schema/pedidos/pagamentos";
import type { ContextoDeGravacao } from "../sistema";
import { diffAuditado, registrarAuditoria, type Transacao } from "./base";

export type AcaoDePagamento =
  | "pagamento_confirmado"
  | "pagamento_estornado"
  | "pagamento_cancelado"
  | "pagamento_status_alterado";

/**
 * Transição de `pagamentos.status` como CLAIM (R2-B, ADR 0042): trava a linha e
 * só muda se o status atual estiver em `de`; senão devolve `false` (outra
 * transição venceu). ÚNICA escrita de status de pagamento. O chamador já
 * travou o pedido. `ctx` de gravação: a confirmação chega por webhook/worker.
 */
export async function transicionarPagamento(
  tx: Transacao,
  alvo: {
    id: string;
    lojaId: string;
    de: readonly StatusPagamento[];
    para: StatusPagamento;
    pagoEm?: Date;
    estornadoEm?: Date;
  },
  ctx: ContextoDeGravacao,
  acao: AcaoDePagamento,
  motivo?: string,
): Promise<boolean> {
  const onde = and(eq(pagamentos.id, alvo.id), eq(pagamentos.loja_id, alvo.lojaId), vivos(pagamentos));
  const [atual] = await tx.select({ status: pagamentos.status }).from(pagamentos).where(onde).for("update");
  if (!atual || !(alvo.de as readonly string[]).includes(atual.status)) return false;
  const depois: Record<string, unknown> = { status: alvo.para };
  if (alvo.pagoEm) depois.pago_em = alvo.pagoEm;
  if (alvo.estornadoEm) depois.estornado_em = alvo.estornadoEm;
  await tx
    .update(pagamentos)
    .set({ ...depois, updated_at: new Date(), modified_by: ctx.autorId })
    .where(onde);
  await registrarAuditoria(
    tx,
    ctx,
    acao,
    "pagamentos",
    alvo.id,
    diffAuditado("pagamentos", { status: atual.status }, depois),
    motivo,
  );
  return true;
}
