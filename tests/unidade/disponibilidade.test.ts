import { describe, expect, it } from "vitest";
import {
  disponivelDe,
  itemReserva,
  leituraAntiga,
  precoDoBling,
  reservadoDe,
  tamanhoDoRotulo,
  tamanhosDaGrade,
  tipoGradeDe,
  type ItemReservavel,
} from "@/lib/catalogo/_regras";

/**
 * Disponibilidade (01-dados-dominio.md §4.2, aceite do pacote M4):
 *
 *   disponível = saldo do depósito − reservado, casado por SKU, nunca negativo.
 *   reservado  = itens de pedido com masc_status = 'pendente' e status fora de
 *                ('cancelado', 'devolvido'); item sem SKU não desconta.
 */

const item = (parcial: Partial<ItemReservavel>): ItemReservavel => ({
  sku: "VEST-P",
  quantidade: 1,
  status: "confirmado",
  mascStatus: "pendente",
  ...parcial,
});

describe("reserva", () => {
  it("pedido pendente no Masc reserva", () => {
    expect(itemReserva(item({}))).toBe(true);
    expect(reservadoDe([item({ quantidade: 2 }), item({ quantidade: 3 })], "VEST-P")).toBe(5);
  });

  it.each(["cancelado", "devolvido"])("pedido %s NÃO reserva", (status) => {
    expect(itemReserva(item({ status }))).toBe(false);
    expect(reservadoDe([item({ status, quantidade: 4 })], "VEST-P")).toBe(0);
  });

  it.each(["lancado", "dispensado"])("pedido %s no Masc NÃO reserva (o Masc já baixou)", (mascStatus) => {
    expect(reservadoDe([item({ mascStatus, quantidade: 4 })], "VEST-P")).toBe(0);
  });

  it("item sem SKU não desconta de nada", () => {
    expect(itemReserva(item({ sku: null }))).toBe(false);
    expect(reservadoDe([item({ sku: null, quantidade: 9 })], "VEST-P")).toBe(0);
  });

  it("casa por SKU: outro SKU não desconta", () => {
    expect(reservadoDe([item({ sku: "VEST-M", quantidade: 2 })], "VEST-P")).toBe(0);
  });
});

describe("disponível", () => {
  it("é saldo menos reservado", () => {
    expect(disponivelDe(10, 3)).toBe(7);
  });

  it("nunca é negativo", () => {
    expect(disponivelDe(2, 5)).toBe(0);
    expect(disponivelDe(-3, 0)).toBe(0);
  });

  it("saldo desconhecido continua desconhecido (null, nunca zero)", () => {
    expect(disponivelDe(null, 0)).toBeNull();
    expect(disponivelDe(null, 4)).toBeNull();
    expect(disponivelDe(Number.NaN, 0)).toBeNull();
  });

  it("saldo fracionado do Bling arredonda para baixo", () => {
    expect(disponivelDe(2.9, 0)).toBe(2);
  });

  it("leitura ausente ou velha é antiga", () => {
    const agora = new Date("2026-09-16T12:00:00Z");
    expect(leituraAntiga(null, agora)).toBe(true);
    expect(leituraAntiga(new Date("2026-09-16T11:59:00Z"), agora)).toBe(false);
    expect(leituraAntiga(new Date("2026-09-16T11:50:00Z"), agora)).toBe(true);
  });
});

describe("grade e leitura do Bling", () => {
  it("ambos = slim seguido de plus, nesta ordem", () => {
    expect(tamanhosDaGrade("ambos")).toEqual(["PP", "P", "M", "G", "GG", "46", "48", "50", "52", "54", "56", "58"]);
    expect(tamanhosDaGrade("slim")).toEqual(["PP", "P", "M", "G", "GG"]);
    expect(tamanhosDaGrade("plussize")).toEqual(["46", "48", "50", "52", "54", "56", "58"]);
  });

  it.each([
    ["Tamanho:P;Cor:Azul", "P"],
    ["TAMANHO: gg", "GG"],
    ["Cor:Preto;Tamanho:48", "48"],
    ["M", "M"],
    ["Cor:Azul", null],
    ["Tamanho:XG", null],
    ["", null],
  ])("tamanhoDoRotulo(%j) = %j", (rotulo, esperado) => {
    expect(tamanhoDoRotulo(rotulo)).toBe(esperado);
  });

  it("tipo da grade sai dos tamanhos encontrados", () => {
    expect(tipoGradeDe(["P", "M"])).toBe("slim");
    expect(tipoGradeDe(["46", "58"])).toBe("plussize");
    expect(tipoGradeDe(["P", "46"])).toBe("ambos");
    expect(tipoGradeDe([])).toBe("ambos");
  });

  it("preço do Bling vira a string de dinheiro", () => {
    expect(precoDoBling(129.9)).toBe("129.90");
    expect(precoDoBling(0.1 + 0.2)).toBe("0.30");
    expect(precoDoBling(0)).toBe("0.00");
  });
});
