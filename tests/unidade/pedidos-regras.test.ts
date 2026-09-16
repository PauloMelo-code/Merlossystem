import { describe, expect, it } from "vitest";
import { anoMesDaVenda, calcularTotais, descontoCabe, numeroDoPedido, pedidoEncerrado } from "@/lib/pedidos/_regras";
import {
  alterarStatusSchema,
  informarRastreioSchema,
  lancarNoMascSchema,
  novoPedidoSchema,
} from "@/lib/validadores/pedidos";

/** Regras puras do pedido (01-dados-dominio.md §6.2–§6.4). */

const UUID = "0b8f5f4e-7c1a-4c55-9d7e-2f3c4b5a6d7e";

describe("ano-mês no fuso da loja", () => {
  it("a venda das 21h do último dia do mês fica no mês dela (02/O-09)", () => {
    // 31/10/2026 21:30 em São Paulo = 01/11/2026 00:30 UTC.
    expect(anoMesDaVenda(new Date("2026-11-01T00:30:00Z"))).toBe("2610");
  });

  it("vira o mês à meia-noite de São Paulo, não à de Greenwich", () => {
    expect(anoMesDaVenda(new Date("2026-11-01T03:00:00Z"))).toBe("2611");
    expect(anoMesDaVenda(new Date("2026-12-31T23:59:00-03:00"))).toBe("2612");
    expect(anoMesDaVenda(new Date("2027-01-01T00:00:00-03:00"))).toBe("2701");
  });

  it("sempre casa com o CHECK numeracao_ano_mes", () => {
    const regex = /^[0-9]{2}(0[1-9]|1[0-2])$/;
    for (let mes = 0; mes < 12; mes += 1) {
      expect(anoMesDaVenda(new Date(Date.UTC(2026, mes, 15)))).toMatch(regex);
    }
  });
});

describe("número do pedido", () => {
  it("MS{AAMM}-{SIGLA}-{NNNN}", () => {
    expect(numeroDoPedido("2609", "CEN", 42)).toBe("MS2609-CEN-0042");
    expect(numeroDoPedido("2609", "CAZ", 12345)).toBe("MS2609-CAZ-12345");
  });
});

describe("totais", () => {
  it("total = subtotal + frete - desconto, em centavos exatos", () => {
    const t = calcularTotais(
      [
        { precoUnitario: "129.90", quantidade: 2 },
        { precoUnitario: "0.10", quantidade: 3 },
      ],
      "15.00",
      "10.20",
    );
    expect(t.itens).toEqual(["259.80", "0.30"]);
    expect(t.subtotal).toBe("260.10");
    expect(t.total).toBe("264.90");
  });

  it("desconto não passa do subtotal", () => {
    expect(descontoCabe("100.00", "100.00")).toBe(true);
    expect(descontoCabe("100.00", "100.01")).toBe(false);
  });

  it("cancelado e devolvido são terminais", () => {
    expect(pedidoEncerrado("cancelado")).toBe(true);
    expect(pedidoEncerrado("devolvido")).toBe(true);
    expect(pedidoEncerrado("enviado")).toBe(false);
  });
});

describe("validadores de pedido", () => {
  it("o cliente NÃO manda preço: campo extra é descartado", () => {
    const r = novoPedidoSchema.parse({
      contatoId: UUID,
      itens: [{ variacaoId: UUID, quantidade: "2", preco: "0.01" }],
      frete: "12,9",
    });
    expect(r.itens[0]).toEqual({ variacaoId: UUID, quantidade: 2 });
    expect(r.frete).toBe("12.90");
    expect(r.desconto).toBe("0.00");
  });

  it("pedido sem item é recusado", () => {
    expect(novoPedidoSchema.safeParse({ contatoId: UUID, itens: [] }).success).toBe(false);
  });

  it("quantidade precisa ser inteira e positiva", () => {
    for (const quantidade of [0, -1, 1.5]) {
      const r = novoPedidoSchema.safeParse({ contatoId: UUID, itens: [{ variacaoId: UUID, quantidade }] });
      expect(r.success).toBe(false);
    }
  });

  it("lançar no Masc exige número da venda e a versão lida", () => {
    const base = { id: UUID, updatedAt: "2026-09-16T12:00:00.000Z" };
    expect(lancarNoMascSchema.safeParse({ ...base, mascVendaId: "" }).success).toBe(false);
    expect(lancarNoMascSchema.safeParse({ ...base, mascVendaId: "12 34" }).success).toBe(false);
    expect(lancarNoMascSchema.safeParse({ id: UUID, mascVendaId: "1234" }).success).toBe(false);
    expect(lancarNoMascSchema.parse({ ...base, mascVendaId: " 1234/A " }).mascVendaId).toBe("1234/A");
  });

  it("devolvido e cancelado não são status escolhíveis", () => {
    const base = { id: UUID, updatedAt: new Date() };
    expect(alterarStatusSchema.safeParse({ ...base, status: "devolvido" }).success).toBe(false);
    expect(alterarStatusSchema.safeParse({ ...base, status: "cancelado" }).success).toBe(false);
    expect(alterarStatusSchema.safeParse({ ...base, status: "enviado" }).success).toBe(true);
  });

  it("link de rastreio só https (CHECK pedidos_rastreio_url)", () => {
    const base = { id: UUID, updatedAt: new Date(), rastreioCodigo: "BR123456" };
    expect(informarRastreioSchema.safeParse({ ...base, rastreioUrl: "http://x.com" }).success).toBe(false);
    expect(informarRastreioSchema.safeParse({ ...base, rastreioUrl: "https://x.com/r" }).success).toBe(true);
    expect(informarRastreioSchema.parse({ ...base, rastreioUrl: "" }).rastreioUrl).toBeUndefined();
  });
});
