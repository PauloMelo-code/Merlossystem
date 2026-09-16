import { describe, expect, it } from "vitest";
import {
  ALTERADO,
  detalhesParaTela,
  diffParaTela,
  rotuloDaAcao,
} from "@/lib/auditoria/apresentacao";
import { codificarCursor, decodificarCursor, montarPagina } from "@/lib/auditoria/cursor";
import { ACOES_AUDITADAS } from "@/lib/db/schema/_enums/auditoria";
import {
  diaDe,
  filtrosQualidadeSchema,
  filtrosTrilhaSchema,
  inicioDoDia,
  periodoPadrao,
} from "@/lib/validadores/auditoria";

describe("diff na tela", () => {
  it("mascara todo campo de CAMPOS_PII e omite segredo", () => {
    const linhas = diffParaTela(
      "contatos",
      { nome: "Ana", status: "novo", endereco: { rua: "X" } },
      { nome: "Ana Maria", status: "cliente", senha_hash: "abc", endereco: { rua: "Y" } },
    );
    expect(linhas).toEqual([
      { campo: "endereco", antes: ALTERADO, depois: ALTERADO },
      { campo: "nome", antes: ALTERADO, depois: ALTERADO },
      { campo: "status", antes: "novo", depois: "cliente" },
    ]);
  });

  it("objeto em campo não-PII também não aparece inteiro", () => {
    expect(diffParaTela("pedidos", null, { itens: [{ sku: "A" }] })).toEqual([
      { campo: "itens", antes: undefined, depois: ALTERADO },
    ]);
  });

  it("detalhes perdem chave de segredo", () => {
    expect(detalhesParaTela({ quantidade: 3, apikey: "x", Authorization: "y" })).toEqual({ quantidade: 3 });
  });

  it("toda ação auditada ganha rótulo com sujeito", () => {
    for (const acao of ACOES_AUDITADAS) {
      expect(rotuloDaAcao(acao)).toMatch(/^[A-ZÁÉÍÓÚÇ][^_]*: /);
    }
    expect(rotuloDaAcao("pedido_voltou_fila_masc")).toBe("Pedido: voltou para a fila no Masc");
  });
});

describe("cursor", () => {
  it("vai e volta, e cursor adulterado vira primeira página", () => {
    const em = new Date("2026-09-01T12:00:00.123Z");
    const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
    expect(decodificarCursor(codificarCursor(em, id))).toEqual({ em, id });
    expect(decodificarCursor("lixo")).toBeNull();
    expect(decodificarCursor(Buffer.from("2026|'; drop").toString("base64url"))).toBeNull();
    expect(decodificarCursor(null)).toBeNull();
  });

  it("montarPagina devolve sempre do mais novo ao mais velho", () => {
    const item = (n: number) => ({ em: new Date(n * 1000), id: `0f8fad5b-d9cb-469f-a165-7086772895${String(n).padStart(2, "0")}` });
    const ida = montarPagina([item(9), item(8), item(7)], 2, "proxima", false, (x) => x);
    expect(ida.itens.map((x) => x.em.getTime())).toEqual([9000, 8000]);
    expect(ida.cursorAnterior).toBeNull();
    expect(ida.cursorProximo).not.toBeNull();
    const volta = montarPagina([item(3), item(4)], 2, "anterior", true, (x) => x);
    expect(volta.itens.map((x) => x.em.getTime())).toEqual([4000, 3000]);
    expect(volta.cursorAnterior).toBeNull();
  });
});

describe("período (dia de São Paulo)", () => {
  it("meia-noite de SP e data impossível recusada", () => {
    expect(inicioDoDia("2026-09-01")?.toISOString()).toBe("2026-09-01T03:00:00.000Z");
    expect(inicioDoDia("2026-02-31")).toBeNull();
    expect(inicioDoDia("01/09/2026")).toBeNull();
    expect(diaDe(new Date("2026-09-02T02:59:00Z"))).toBe("2026-09-01");
  });

  it("padrão de 30 dias termina hoje, com fim exclusivo", () => {
    const p = periodoPadrao(30, new Date("2026-09-16T15:00:00Z"));
    expect(p.deTexto).toBe("2026-08-18");
    expect(p.ateTexto).toBe("2026-09-16");
    expect(p.ate.toISOString()).toBe("2026-09-17T03:00:00.000Z");
  });

  it("invertido e maior que um ano são recusados; lixo vira padrão", () => {
    expect(filtrosQualidadeSchema.safeParse({ de: "2026-09-10", ate: "2026-09-01" }).success).toBe(false);
    expect(filtrosQualidadeSchema.safeParse({ de: "2024-01-01", ate: "2026-01-01" }).success).toBe(false);
    const lixo = filtrosQualidadeSchema.parse({ de: "ontem", ate: "hoje" });
    expect(lixo.periodo.deTexto).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("filtro da trilha descarta valor fora da lista em vez de derrubar a tela", () => {
    const f = filtrosTrilhaSchema.parse({ acao: "apagar_tudo", pessoa: "x", porPagina: "7", direcao: "?" });
    expect(f).toMatchObject({ acao: undefined, pessoa: undefined, porPagina: 50, direcao: "proxima" });
    expect(f.periodo).toEqual({ de: undefined, ate: undefined });
  });
});
