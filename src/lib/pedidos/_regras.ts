import { deCentavos, multiplicar, paraCentavos, somar } from "@/lib/formato";
import { STATUS_PEDIDO_SEM_RESERVA } from "@/lib/db/schema/_enums/pedidos";

/**
 * Regras PURAS de pedido (01-dados-dominio.md §6.2–§6.4). Sem banco.
 */

export const FUSO_DA_LOJA = "America/Sao_Paulo";

const FORMATO_ANO_MES = new Intl.DateTimeFormat("en-US", {
  timeZone: FUSO_DA_LOJA,
  year: "2-digit",
  month: "2-digit",
});

/**
 * `AAMM` no fuso da loja, NUNCA no do container: em UTC, a venda das 21h do
 * último dia do mês caía no mês seguinte (02/O-09).
 */
export function anoMesDaVenda(instante: Date): string {
  const partes = FORMATO_ANO_MES.formatToParts(instante);
  const ano = partes.find((p) => p.type === "year")?.value ?? "";
  const mes = partes.find((p) => p.type === "month")?.value ?? "";
  return `${ano}${mes}`;
}

/** `MS{AAMM}-{SIGLA}-{NNNN}` — ex.: `MS2609-CEN-0042`. */
export function numeroDoPedido(anoMes: string, sigla: string, sequencia: number): string {
  return `MS${anoMes}-${sigla}-${String(sequencia).padStart(4, "0")}`;
}

export type LinhaDeValor = { precoUnitario: string; quantidade: number };

/**
 * Totais do pedido a partir do preço DO SERVIDOR. Em centavos inteiros, para
 * `total = subtotal + frete - desconto` bater com o CHECK do banco.
 */
export function calcularTotais(
  linhas: readonly LinhaDeValor[],
  frete: string,
  desconto: string,
): { itens: string[]; subtotal: string; total: string } {
  const itens = linhas.map((l) => multiplicar(l.precoUnitario, l.quantidade));
  const subtotal = itens.length > 0 ? somar(...itens) : "0.00";
  const total = deCentavos(paraCentavos(subtotal) + paraCentavos(frete) - paraCentavos(desconto));
  return { itens, subtotal, total };
}

export function descontoCabe(subtotal: string, desconto: string): boolean {
  return paraCentavos(desconto) <= paraCentavos(subtotal);
}

const SEM_RESERVA = new Set<string>(STATUS_PEDIDO_SEM_RESERVA);

/** Pedido cancelado ou devolvido é terminal: não muda de status nem entra no Masc. */
export function pedidoEncerrado(status: string): boolean {
  return SEM_RESERVA.has(status);
}

