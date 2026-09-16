import { describe, expect, it } from "vitest";
import {
  dataHora,
  dataPuraFormatada,
  deCentavos,
  horaDaLista,
  moeda,
  multiplicar,
  paraCentavos,
  somar,
  telefone,
} from "@/lib/formato";

describe("dinheiro", () => {
  it("vai e volta sem perder centavo", () => {
    expect(paraCentavos("1234.56")).toBe(123456);
    expect(paraCentavos("1234.5")).toBe(123450);
    expect(paraCentavos("1234")).toBe(123400);
    expect(deCentavos(123456)).toBe("1234.56");
    expect(deCentavos(5)).toBe("0.05");
    expect(deCentavos(-250)).toBe("-2.50");
  });

  it("soma exato onde o float erra", () => {
    // 0.1 + 0.2 em ponto flutuante daria 0.30000000000000004
    expect(somar("0.10", "0.20")).toBe("0.30");
    expect(somar("1234.56", "0.44")).toBe("1235.00");
    expect(multiplicar("19.90", 3)).toBe("59.70");
  });

  it("recusa valor fora do formato da fronteira", () => {
    expect(() => paraCentavos("1.234,56")).toThrow();
    expect(() => paraCentavos("1234.567")).toThrow();
    expect(() => paraCentavos("-1.00")).toThrow();
    expect(() => multiplicar("19.90", 1.5)).toThrow();
  });

  it("formata agrupando milhar", () => {
    expect(moeda("1234.56")).toBe("R$ 1.234,56");
    expect(moeda("0.05")).toBe("R$ 0,05");
    expect(moeda("9999999999.99")).toBe("R$ 9.999.999.999,99");
  });
});

describe("telefone", () => {
  it("formata o E.164 brasileiro de 8 e de 9 digitos", () => {
    expect(telefone("5551999990000")).toBe("(51) 99999-0000");
    expect(telefone("555133334444")).toBe("(51) 3333-4444");
  });

  it("nao quebra numero de fora do padrao", () => {
    expect(telefone("12025550100")).toBe("+12025550100");
    expect(telefone("")).toBe("");
  });
});

describe("data e hora", () => {
  // Brasil sem horario de verao desde 2019: America/Sao_Paulo e UTC-3 fixo.
  const meioDia = new Date("2026-09-12T15:00:00Z"); // 12:00 em Sao Paulo

  it("le no fuso do negocio, nao no do processo", () => {
    expect(dataHora(meioDia)).toBe("12/09/2026 12:00");
  });

  it("nao desloca a data pura", () => {
    expect(dataPuraFormatada("2026-09-12")).toBe("12/09/2026");
  });

  it("carimbo da lista: hoje, ontem, dia da semana, data", () => {
    expect(horaDaLista(new Date("2026-09-12T17:32:00Z"), meioDia)).toBe("14:32");
    expect(horaDaLista(new Date("2026-09-11T15:00:00Z"), meioDia)).toBe("Ontem");
    expect(horaDaLista(new Date("2026-09-09T15:00:00Z"), meioDia)).toMatch(/^\p{L}{3}$/u);
    expect(horaDaLista(new Date("2026-08-30T15:00:00Z"), meioDia)).toBe("30/08");
  });

  it("vira o dia pelo fuso de Sao Paulo, nao pelo UTC", () => {
    // 20:30 e 22:00 do dia 12 em Sao Paulo; em UTC ja sao dias diferentes.
    const vinteETrinta = new Date("2026-09-12T23:30:00Z");
    const vinteEDuas = new Date("2026-09-13T01:00:00Z");
    expect(horaDaLista(vinteETrinta, vinteEDuas)).toBe("20:30");
  });
});
