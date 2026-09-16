import { and, count, eq } from "drizzle-orm";
import { vivos } from "@/lib/db/consultas";
import type { Transacao } from "@/lib/db/mutacoes";
import { pagamentos } from "@/lib/db/schema/pedidos/pagamentos";
import type { ContextoDeGravacao } from "@/lib/db/sistema";
import { naoImplementado } from "@/lib/erros";

/**
 * COSTURA — dono: R2-B; consumida por M4 (`cancelarPedido`) e pelo gerador de
 * alertas de M8 (via `src/lib/alertas/fontes-r2.ts`). Até o R2-B preencher,
 * não existe cobrança no banco: o caminho sem cobrança é o comportamento certo,
 * e qualquer cobrança pendente faz a costura falhar alto.
 */
export async function cancelarCobrancasDoPedido(
  tx: Transacao,
  pedidoId: string,
  ctx: ContextoDeGravacao,
): Promise<void> {
  const [linha] = await tx
    .select({ n: count() })
    .from(pagamentos)
    .where(and(eq(pagamentos.pedido_id, pedidoId), eq(pagamentos.status, "pendente"), vivos(pagamentos)));
  if ((linha?.n ?? 0) > 0) {
    throw naoImplementado(`cancelarCobrancasDoPedido [${pedidoId}, origem ${ctx.origem}] (pacote R2-B)`);
  }
}

/** Forma estrutural de `CandidatoDeAlerta` (fontes-r2.ts), sem importar `@/lib/alertas`. */
export type CandidatoDeAlertaDePagamento = {
  tipo: "pagamento_pendente" | "pagamento_conferir";
  severidade: "media" | "alta";
  mensagem: string;
  /** Sempre começa com `pagamento-`. */
  chaveDeduplicacao: string;
  pedidoId: string | null;
  contatoId: string | null;
  conversaId: null;
  negocioId: null;
};

/** Sem cobrança, sem alerta. */
export async function candidatosDeAlertaDePagamento(
  _tx: Transacao,
  _lojaId: string,
  _agora: Date,
): Promise<CandidatoDeAlertaDePagamento[]> {
  return [];
}
