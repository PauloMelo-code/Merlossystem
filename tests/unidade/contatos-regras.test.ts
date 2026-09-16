import { describe, expect, it } from "vitest";
import { celulaCsv, codificarCursor, decodificarCursor, escaparLike, montarCsv } from "@/lib/contatos/_regras";
import { normalizarTelefone } from "@/lib/contatos/telefone";
import { optOutDe } from "@/lib/lgpd/regras";
import {
  aplicarFiltro,
  criarContatoSchema,
  filtrosContatosSchema,
} from "@/lib/validadores/contatos";
import { registrarConsentimentoSchema } from "@/lib/validadores/lgpd";

/** Regras puras do pacote M2: telefone, cursor, CSV, filtros e opt-out. */

describe("telefone canônico E.164 só dígitos", () => {
  it.each([
    ["(51) 99999-0000", "5551999990000"],
    ["51 3333-4444", "555133334444"],
    ["051999990000", "5551999990000"],
    ["5551999990000", "5551999990000"],
    ["+55 (51) 99999-0000", "5551999990000"],
    ["+1 415 555 2671", "14155552671"],
    ["0044 20 7946 0958", "442079460958"],
  ])("%s -> %s", (entrada, esperado) => {
    expect(normalizarTelefone(entrada)).toBe(esperado);
  });

  it.each(["", "abc", "12345", "+0 11 1234 5678", "9".repeat(16)])("recusa %j", (entrada) => {
    expect(normalizarTelefone(entrada)).toBeNull();
  });
});

describe("cursor da carteira", () => {
  const id = "11111111-1111-4111-8111-111111111111";

  it("vai e volta, inclusive com instante nulo", () => {
    const t = "2026-09-16T12:00:00.123Z";
    expect(decodificarCursor(codificarCursor({ t, id }))).toEqual({ t, id });
    expect(decodificarCursor(codificarCursor({ t: null, id }))).toEqual({ t: null, id });
  });

  it("cursor adulterado vira primeira página, nunca erro nem SQL", () => {
    for (const lixo of ["", "@@@", Buffer.from("[]").toString("base64url"),
      Buffer.from(JSON.stringify({ t: "ontem", id })).toString("base64url"),
      Buffer.from(JSON.stringify({ t: null, id: "1; drop table x" })).toString("base64url")]) {
      expect(decodificarCursor(lixo)).toBeNull();
    }
    expect(decodificarCursor(undefined)).toBeNull();
  });
});

describe("busca e CSV", () => {
  it("escapa curinga do LIKE", () => {
    expect(escaparLike("100%_a\\b")).toBe("100\\%\\_a\\\\b");
  });

  it("neutraliza fórmula e dobra aspas", () => {
    expect(celulaCsv("=SOMA(A1)")).toBe(`"'=SOMA(A1)"`);
    expect(celulaCsv("+55")).toBe(`"'+55"`);
    expect(celulaCsv("@x")).toBe(`"'@x"`);
    expect(celulaCsv('Ana "Bia"')).toBe(`"Ana ""Bia"""`);
    expect(celulaCsv(null)).toBe(`""`);
    expect(celulaCsv(5551999990000)).toBe(`"5551999990000"`);
  });

  it("CSV com BOM, ponto e vírgula e CRLF", () => {
    expect(montarCsv(["a", "b"], [[1, "x;y"]])).toBe(`﻿"a";"b"\r\n"1";"x;y"\r\n`);
  });
});

describe("filtros da URL", () => {
  it('"Todos" APAGA o parâmetro e nunca grava `all`', () => {
    const proximos = aplicarFiltro("optOut=sim&cursor=abc&direcao=proxima&busca=ana", "optOut", null);
    expect(proximos.toString()).toBe("busca=ana");
    expect(proximos.toString()).not.toContain("all");
  });

  it("mudar filtro invalida o cursor", () => {
    expect(aplicarFiltro("cursor=abc", "etiqueta", "x").toString()).toBe("etiqueta=x");
  });

  it("valor desconhecido na URL é ignorado, não interpretado", () => {
    expect(filtrosContatosSchema.parse({ optOut: "all", etiqueta: "all", porPagina: "7" })).toEqual({
      porPagina: 50,
    });
    expect(filtrosContatosSchema.parse({ optOut: "nao", porPagina: "25" })).toMatchObject({
      optOut: "nao",
      porPagina: 25,
    });
  });
});

describe("formulário de contato", () => {
  it("normaliza telefone, e-mail e campos vazios", () => {
    const dados = criarContatoSchema.parse({
      nome: " Ana ",
      telefone: "(51) 99999-0000",
      email: "ANA@Exemplo.com",
      observacoes: "",
      loja: "",
    });
    expect(dados).toMatchObject({
      nome: "Ana",
      telefone: "5551999990000",
      email: "ana@exemplo.com",
      observacoes: null,
      endereco: null,
    });
    expect(dados.loja).toBeUndefined();
  });

  it("exige ao menos nome, telefone ou e-mail", () => {
    const r = criarContatoSchema.safeParse({ nome: "", telefone: "" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["nome"]);
  });

  it("endereço é tudo ou nada", () => {
    const meio = criarContatoSchema.safeParse({ nome: "Ana", "endereco.cep": "90000-000" });
    expect(meio.success).toBe(false);
    const inteiro = criarContatoSchema.parse({
      nome: "Ana",
      "endereco.cep": "90000-000",
      "endereco.logradouro": "Rua A",
      "endereco.numero": "10",
      "endereco.bairro": "Centro",
      "endereco.cidade": "Porto Alegre",
      "endereco.uf": "rs",
    });
    expect(inteiro.endereco).toEqual({
      cep: "90000000",
      logradouro: "Rua A",
      numero: "10",
      bairro: "Centro",
      cidade: "Porto Alegre",
      uf: "RS",
    });
  });

  it("telefone inválido diz como corrigir", () => {
    const r = criarContatoSchema.safeParse({ nome: "Ana", telefone: "123" });
    expect(r.error?.issues[0]?.message).toMatch(/DDD/);
  });
});

describe("consentimento", () => {
  it("o IP nunca vem do corpo: o schema descarta o campo", () => {
    const dados = registrarConsentimentoSchema.parse({
      contatoId: "11111111-1111-4111-8111-111111111111",
      tipo: "marketing",
      concedido: "false",
      ip: "1.2.3.4",
    });
    expect(dados).not.toHaveProperty("ip");
    expect(dados.concedido).toBe(false);
  });

  it("opt-out é de marketing: tratamento de dados não mexe no espelho", () => {
    expect(optOutDe("marketing", false)).toBe(true);
    expect(optOutDe("marketing", true)).toBe(false);
    expect(optOutDe("opt_out", true)).toBe(true);
    expect(optOutDe("opt_in", true)).toBe(false);
    expect(optOutDe("tratamento_dados", false)).toBeNull();
  });
});
