import { and, eq, sql } from "drizzle-orm";
import { vivos } from "@/lib/db/consultas";
import type { Transacao } from "@/lib/db/mutacoes";
import type { StatusPagamentoPedido } from "@/lib/db/schema/_enums/pedidos";
import { pedidos_devolucoes } from "@/lib/db/schema/devolucoes";
import { pagamentos } from "@/lib/db/schema/pedidos/pagamentos";
import { pedidos } from "@/lib/db/schema/pedidos/pedidos";
import { ErroDeEscopo } from "@/lib/erros";
import { paraCentavos } from "@/lib/formato";

/**
 * Estado de pagamento do pedido e teto de estorno — UM lugar (ADR 0037).
 * Chamado por pagamentos (confirmação, estorno no provedor) e por devoluções
 * (conclusão), sempre com o pedido já travado e na mesma transação do fato.
 * Dono: FUNDAÇÃO. R2-B e R2-A só leem. Mudar esta regra exige ADR.
 */
export type OrigemDoPagamento = "provedor" | "masc" | "nenhuma";

export type FatosDePagamento = {
  totalCentavos: number;
  /** `pedidos.masc_status = 'lancado'`: o único fato de pagamento de balcão. */
  mascLancado: boolean;
  /** Soma dos pagamentos vivos `aprovado`. */
  aprovadoCentavos: number;
  /** Soma dos pagamentos vivos `estornado` (passou pelo provedor e voltou). */
  estornadoNoProvedorCentavos: number;
  /** Soma de `valor_estorno` das devoluções vivas `concluida`. */
  estornoRegistradoCentavos: number;
};

const recebido = (f: FatosDePagamento) => f.aprovadoCentavos + f.estornadoNoProvedorCentavos;

export function origemDoPagamento(f: FatosDePagamento): OrigemDoPagamento {
  if (recebido(f) > 0) return "provedor";
  return f.mascLancado ? "masc" : "nenhuma";
}

export function baseDeEstorno(f: FatosDePagamento): number {
  switch (origemDoPagamento(f)) {
    case "provedor":
      return Math.min(f.totalCentavos, recebido(f));
    case "masc":
      return f.totalCentavos;
    case "nenhuma":
      return 0;
  }
}

/** Quanto ainda pode ser registrado como estorno numa devolução (R2-TR-10). */
export function tetoDeEstorno(f: FatosDePagamento): number {
  return Math.max(0, baseDeEstorno(f) - f.estornoRegistradoCentavos);
}

/**
 * Sem pagamento no provedor, o sistema nunca registrou pagamento: não mexe.
 * `estornado` é final. De `pago` sai quando não resta aprovado ou o registrado
 * cobre a base. De `pendente`/`cancelado` vai a `pago` com aprovado.
 */
export function statusPagamentoDoPedido(
  atual: StatusPagamentoPedido,
  f: FatosDePagamento,
): StatusPagamentoPedido {
  if (recebido(f) === 0 || atual === "estornado") return atual;
  if (atual === "pago") {
    const semAprovado = f.aprovadoCentavos === 0;
    const registradoCobre = f.estornoRegistradoCentavos >= baseDeEstorno(f);
    return semAprovado || registradoCobre ? "estornado" : "pago";
  }
  return f.aprovadoCentavos > 0 ? "pago" : atual;
}

const soma = (valor: unknown) => paraCentavos(String(valor ?? "0"));

export async function lerFatosDePagamento(
  tx: Transacao,
  pedidoId: string,
  lojaId: string,
): Promise<FatosDePagamento> {
  const [linha] = await tx
    .select({
      total: pedidos.total,
      masc: pedidos.masc_status,
      aprovado: sql<string>`coalesce((select sum(p.valor) from ${pagamentos} p
        where p.pedido_id = ${pedidos.id} and p.loja_id = ${pedidos.loja_id}
          and p.status = 'aprovado' and p.is_deleted = false), 0)::text`,
      estornado: sql<string>`coalesce((select sum(p.valor) from ${pagamentos} p
        where p.pedido_id = ${pedidos.id} and p.loja_id = ${pedidos.loja_id}
          and p.status = 'estornado' and p.is_deleted = false), 0)::text`,
      registrado: sql<string>`coalesce((select sum(d.valor_estorno) from ${pedidos_devolucoes} d
        where d.pedido_id = ${pedidos.id} and d.loja_id = ${pedidos.loja_id}
          and d.status = 'concluida' and d.is_deleted = false), 0)::text`,
    })
    .from(pedidos)
    .where(and(eq(pedidos.id, pedidoId), eq(pedidos.loja_id, lojaId), vivos(pedidos)));
  if (!linha) throw new ErroDeEscopo();
  return {
    totalCentavos: soma(linha.total),
    mascLancado: linha.masc === "lancado",
    aprovadoCentavos: soma(linha.aprovado),
    estornadoNoProvedorCentavos: soma(linha.estornado),
    estornoRegistradoCentavos: soma(linha.registrado),
  };
}
