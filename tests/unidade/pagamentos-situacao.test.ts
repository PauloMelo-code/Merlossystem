import { describe, expect, it } from "vitest";
import { paraCentavos } from "@/lib/formato";
import {
  baseDeEstorno,
  origemDoPagamento,
  statusPagamentoDoPedido,
  tetoDeEstorno,
  type FatosDePagamento,
} from "@/lib/pagamentos/situacao";

/** T-PG-23: regra única do estado de pagamento e do teto de estorno (ADR 0037). */
const f = (parcial: Partial<FatosDePagamento>): FatosDePagamento => ({
  totalCentavos: 10_000,
  mascLancado: false,
  aprovadoCentavos: 0,
  estornadoNoProvedorCentavos: 0,
  estornoRegistradoCentavos: 0,
  ...parcial,
});

describe("situação de pagamento do pedido", () => {
  it("sem provedor e sem Masc: origem nenhuma, teto 0, status intacto", () => {
    const fatos = f({});
    expect(origemDoPagamento(fatos)).toBe("nenhuma");
    expect(tetoDeEstorno(fatos)).toBe(0);
    expect(statusPagamentoDoPedido("pendente", fatos)).toBe("pendente");
  });

  it("sem provedor e Masc lançado: origem masc, teto = total, pendente intacto com estorno total", () => {
    const fatos = f({ mascLancado: true });
    expect(origemDoPagamento(fatos)).toBe("masc");
    expect(tetoDeEstorno(fatos)).toBe(10_000);
    const cobre = f({ mascLancado: true, estornoRegistradoCentavos: 10_000 });
    expect(statusPagamentoDoPedido("pendente", cobre)).toBe("pendente");
  });

  it("aprovado leva a pago", () => {
    expect(statusPagamentoDoPedido("pendente", f({ aprovadoCentavos: 10_000 }))).toBe("pago");
  });

  it("pago e estornado no provedor sem outro aprovado: estornado, teto = min(total, recebido)", () => {
    const fatos = f({ estornadoNoProvedorCentavos: 10_000 });
    expect(statusPagamentoDoPedido("pago", fatos)).toBe("estornado");
    expect(tetoDeEstorno(fatos)).toBe(10_000);
  });

  it("duas aprovações: base = total; estorno de uma mantém pago", () => {
    expect(baseDeEstorno(f({ aprovadoCentavos: 20_000 }))).toBe(10_000);
    const umaEstornada = f({ aprovadoCentavos: 10_000, estornadoNoProvedorCentavos: 10_000 });
    expect(statusPagamentoDoPedido("pago", umaEstornada)).toBe("pago");
  });

  it("registrado igual à base leva a estornado; parcial mantém pago", () => {
    const total = f({ aprovadoCentavos: 10_000, estornoRegistradoCentavos: 10_000 });
    const parcial = f({ aprovadoCentavos: 10_000, estornoRegistradoCentavos: 4_000 });
    expect(statusPagamentoDoPedido("pago", total)).toBe("estornado");
    expect(statusPagamentoDoPedido("pago", parcial)).toBe("pago");
  });

  it("estornado nunca muda; cancelado sem fatos continua cancelado", () => {
    expect(statusPagamentoDoPedido("estornado", f({ aprovadoCentavos: 10_000 }))).toBe("estornado");
    expect(statusPagamentoDoPedido("cancelado", f({}))).toBe("cancelado");
  });

  it("total menor que o recebido: base = total; teto nunca negativo", () => {
    expect(baseDeEstorno(f({ totalCentavos: 5_000, aprovadoCentavos: 8_000 }))).toBe(5_000);
    expect(tetoDeEstorno(f({ aprovadoCentavos: 10_000, estornoRegistradoCentavos: 15_000 }))).toBe(0);
  });

  it("somas em centavos não perdem precisão (0,10 + 0,20)", () => {
    const fatos = f({ totalCentavos: 30, aprovadoCentavos: paraCentavos("0.10") + paraCentavos("0.20") });
    expect(baseDeEstorno(fatos)).toBe(30);
  });
});
