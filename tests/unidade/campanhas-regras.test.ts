import { describe, expect, it } from "vitest";
import {
  conferirVariaveis,
  contarVariaveis,
  renderizarCorpo,
  resolverVariaveis,
} from "@/lib/conteudo/variaveis";
import { codificarCursor, decodificarCursor, montarPagina } from "@/lib/campanhas/cursor";
import {
  chaveDoEnvio,
  conteudoDoProvedor,
  PODE_EXCLUIR,
  podeSair,
  RITMO_POR_SEGUNDO,
} from "@/lib/campanhas/regras";
import { assertJobIdPart } from "@/lib/fila/idempotencia";
import { agendamentoSchema, campanhaSchema, segmentoSchema } from "@/lib/validadores/campanhas";
import { modeloSchema, respostaSchema } from "@/lib/validadores/conteudo";

/** Regras puras do pacote M6: variáveis, cursor, ritmo e forma das entradas. */

const ID = "7d3f0c1e-2b4a-4c5d-8e9f-0a1b2c3d4e5f";

describe("variáveis de modelo", () => {
  it("conta variáveis distintas numeradas de 1 em diante", () => {
    expect(contarVariaveis("Olá")).toBe(0);
    expect(contarVariaveis("Oi {{1}}, {{ 2 }} e de novo {{1}}")).toBe(2);
  });

  it("recusa numeração com buraco (a Meta recusa)", () => {
    expect(contarVariaveis("{{1}} {{3}}")).toBeNull();
    expect(contarVariaveis("{{2}}")).toBeNull();
  });

  it("modelo com 2 e campanha com 1 é recusada; com 2 passa", () => {
    expect(conferirVariaveis([{ indice: 1, valor: "a" }], 2)).toMatch(/pede 2 variáveis/);
    expect(conferirVariaveis([{ indice: 1, valor: "a" }], 0)).toMatch(/não tem variáveis/);
    expect(
      conferirVariaveis(
        [
          { indice: 2, valor: "b" },
          { indice: 1, valor: "a" },
        ],
        2,
      ),
    ).toBeNull();
  });

  it("recusa índice repetido e valor vazio", () => {
    expect(
      conferirVariaveis(
        [
          { indice: 1, valor: "a" },
          { indice: 1, valor: "b" },
        ],
        2,
      ),
    ).toMatch(/numeradas/);
    expect(conferirVariaveis([{ indice: 1, valor: "  " }], 1)).toMatch(/Preencha/);
  });

  it("{nome_contato} vira o primeiro nome, ou 'cliente'", () => {
    const vars = [{ indice: 1, valor: "{nome_contato}" }];
    expect(resolverVariaveis(vars, "Maria Silva")).toEqual([{ indice: 1, valor: "Maria" }]);
    expect(resolverVariaveis(vars, null)).toEqual([{ indice: 1, valor: "cliente" }]);
  });

  it("renderiza o corpo trocando cada {{n}}", () => {
    expect(
      renderizarCorpo("Oi {{1}}, cupom {{2}}", [
        { indice: 1, valor: "Ana" },
        { indice: 2, valor: "FRIO10" },
      ]),
    ).toBe("Oi Ana, cupom FRIO10");
  });
});

describe("ritmo e transições", () => {
  it("1 msg/s no uazapi e 10 msg/s no oficial", () => {
    expect(RITMO_POR_SEGUNDO).toEqual({ uazapi: 1, whatsapp_oficial: 10 });
  });

  it("oficial dispara por modelo; uazapi por texto", () => {
    expect(conteudoDoProvedor("whatsapp_oficial")).toBe("modelo");
    expect(conteudoDoProvedor("uazapi")).toBe("texto");
  });

  it("campanha enviando não é excluída", () => {
    expect(podeSair("enviando", PODE_EXCLUIR)).toBe(false);
    expect(podeSair("pausada", PODE_EXCLUIR)).toBe(true);
  });

  it("a chave de idempotência muda por tentativa e serve de jobId", () => {
    const a = chaveDoEnvio(ID, ID, 1);
    expect(a).not.toBe(chaveDoEnvio(ID, ID, 2));
    expect(assertJobIdPart(a)).toBe(a);
  });
});

describe("cursor", () => {
  it("ida e volta; lixo vira primeira página", () => {
    const em = new Date("2026-09-16T10:00:00.123Z");
    expect(decodificarCursor(codificarCursor(em, ID))).toEqual({ em, id: ID });
    expect(decodificarCursor("x_y")).toBeNull();
    expect(decodificarCursor("123_'; drop")).toBeNull();
  });

  it("monta a página e liga os botões certos", () => {
    const linhas = [1, 2, 3].map((n) => ({ id: ID, criadoEm: new Date(n) }));
    const primeira = montarPagina([...linhas], 2, "proxima", false);
    expect(primeira.itens).toHaveLength(2);
    expect(primeira.cursorAnterior).toBeNull();
    expect(primeira.cursorProximo).not.toBeNull();
    const voltando = montarPagina([...linhas].slice(0, 2), 2, "anterior", true);
    expect(voltando.itens.map((i) => i.criadoEm.getTime())).toEqual([2, 1]);
    expect(voltando.cursorAnterior).toBeNull();
    expect(voltando.cursorProximo).not.toBeNull();
  });
});

describe("forma das entradas", () => {
  const base = { nome: "Inverno", integracao_id: ID, segmento: {} };

  it("campanha exige modelo OU texto, nunca os dois nem nenhum", () => {
    expect(campanhaSchema.safeParse({ ...base, conteudo_texto: "Oi" }).success).toBe(true);
    expect(campanhaSchema.safeParse({ ...base, template_id: ID }).success).toBe(true);
    expect(campanhaSchema.safeParse(base).success).toBe(false);
    expect(campanhaSchema.safeParse({ ...base, template_id: ID, conteudo_texto: "Oi" }).success).toBe(false);
  });

  it("campanha sem conta de saída é recusada", () => {
    expect(campanhaSchema.safeParse({ nome: "X", conteudo_texto: "Oi" }).success).toBe(false);
  });

  it("segmento valida dinheiro e tamanho", () => {
    expect(segmentoSchema.safeParse({ gasto_minimo: "150.00", tamanho: "slim" }).success).toBe(true);
    expect(segmentoSchema.safeParse({ gasto_minimo: "150,00" }).success).toBe(false);
    expect(segmentoSchema.safeParse({ tamanho: "gg" }).success).toBe(false);
  });

  it("agendamento: horário no passado e mídia são recusados", () => {
    const ok = {
      contato_id: ID,
      integracao_id: ID,
      tipo_conteudo: "texto",
      conteudo: "Oi",
      agendada_para: new Date(Date.now() + 3_600_000).toISOString(),
      gatilho: "manual",
    };
    expect(agendamentoSchema.safeParse(ok).success).toBe(true);
    expect(agendamentoSchema.safeParse({ ...ok, agendada_para: "2020-01-01T00:00" }).success).toBe(false);
    expect(agendamentoSchema.safeParse({ ...ok, tipo_conteudo: "midia" }).success).toBe(false);
    expect(agendamentoSchema.safeParse({ ...ok, tipo_conteudo: "template" }).success).toBe(false);
  });

  it("atalho segue o CHECK do banco", () => {
    const r = { titulo: "Frete", categoria: "frete", conteudo: "Grátis acima de 300" };
    expect(respostaSchema.safeParse({ ...r, atalho: "/Frete" }).success).toBe(true);
    expect(respostaSchema.safeParse({ ...r, atalho: "frete" }).success).toBe(false);
    expect(respostaSchema.safeParse({ ...r, atalho: "" }).data?.atalho).toBeNull();
  });

  it("modelo: nome no padrão da Meta e variáveis sem buraco", () => {
    const m = { integracao_id: ID, nome: "promo_inverno", categoria: "marketing", corpo: "Oi {{1}}" };
    expect(modeloSchema.safeParse(m).success).toBe(true);
    expect(modeloSchema.safeParse({ ...m, nome: "Promo Inverno" }).success).toBe(false);
    expect(modeloSchema.safeParse({ ...m, corpo: "Oi {{2}}" }).success).toBe(false);
  });
});
