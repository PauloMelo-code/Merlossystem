import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableColumns, getTableName, isTable } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CONTADORES, ESTADOS_DE_SISTEMA } from "@/lib/db/listas-fechadas";
import * as schema from "@/lib/db/schema";

/**
 * Trava das mutações (01-dados.md §4.7, 03-arquitetura.md §6.4).
 *
 * `src/lib/db/mutacoes.ts` é o reexportador ÚNICO; a implementação mora em
 * `src/lib/db/mutacoes/`, a ÚNICA pasta com `.insert(` e `.update(` sobre
 * tabela de domínio. Nenhum delete físico existe em lugar nenhum — nem em
 * teste, nem em script (T25).
 */

const RAIZ = process.cwd();
const MUTACOES = "src/lib/db/mutacoes.ts";
/** A implementação: todo arquivo desta pasta é reexportado por mutacoes.ts. */
const MUTACOES_DIR = "src/lib/db/mutacoes/";
const BASE = `${MUTACOES_DIR}base.ts`;
const SISTEMA = `${MUTACOES_DIR}sistema.ts`;
const PASTAS = ["src", "tests", "scripts"];

/** Este arquivo cita os padrões proibidos como DEFINIÇÃO da regra. */
const ISENTOS_FIXOS = new Set([MUTACOES, "tests/travas/mutacoes.test.ts"]);
const isento = (caminho: string) => ISENTOS_FIXOS.has(caminho) || caminho.startsWith(MUTACOES_DIR);

function varrer(pasta: string): string[] {
  let entradas;
  try {
    entradas = readdirSync(join(RAIZ, pasta), { withFileTypes: true });
  } catch {
    return [];
  }
  return entradas.flatMap((e) => {
    const relativo = `${pasta}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name === "migrations" || e.name === "node_modules") return [];
      return varrer(relativo);
    }
    return /\.(ts|tsx|mjs)$/.test(e.name) ? [relativo] : [];
  });
}

const arquivos = PASTAS.flatMap(varrer).map((caminho) => ({
  caminho,
  texto: readFileSync(join(RAIZ, caminho), "utf8"),
}));

/** Ignora a linha de comentário: o padrão aparece em explicação o tempo todo. */
function linhasDeCodigo(texto: string) {
  return texto
    .split("\n")
    .map((linha, i) => ({ n: i + 1, texto: linha }))
    .filter(({ texto: l }) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    });
}

describe("mutações", () => {
  it("varre um repositório de verdade (piso mínimo)", () => {
    expect(arquivos.length).toBeGreaterThanOrEqual(40);
    expect(arquivos.some((a) => a.caminho === MUTACOES)).toBe(true);
    expect(arquivos.some((a) => a.caminho === BASE)).toBe(true);
  });

  it("mutacoes.ts só reexporta a pasta (sem `.insert(`/`.update(` e sem index.ts)", () => {
    const texto = readFileSync(join(RAIZ, MUTACOES), "utf8");
    expect(linhasDeCodigo(texto).filter((l) => /\.(insert|update)\s*\(/.test(l.texto))).toEqual([]);
    for (const a of arquivos.filter((x) => x.caminho.startsWith(MUTACOES_DIR))) {
      const nome = a.caminho.slice(MUTACOES_DIR.length).replace(/\.ts$/, "");
      expect(nome).not.toBe("index");
      expect(texto, `reexporta ${nome}`).toContain(`export * from "./mutacoes/${nome}";`);
    }
  });

  it("`.insert(` e `.update(` só existem na pasta de mutações", () => {
    const achados = arquivos
      .filter((a) => !isento(a.caminho))
      .flatMap((a) =>
        linhasDeCodigo(a.texto)
          .filter((l) => /\b(db|tx|sp)\s*\.\s*(insert|update)\s*\(/.test(l.texto))
          .map((l) => `${a.caminho}:${l.n}`),
      );
    expect(achados).toEqual([]);
  });

  it("nenhum delete físico em lugar nenhum (T25)", () => {
    const achados = arquivos
      .filter((a) => !isento(a.caminho))
      .flatMap((a) =>
        linhasDeCodigo(a.texto)
          .filter((l) =>
            /\bdb\.delete\s*\(|\btx\.delete\s*\(|\.deleteMany\s*\(|\bDELETE\s+FROM\b/i.test(l.texto),
          )
          .map((l) => `${a.caminho}:${l.n}`),
      );
    expect(achados).toEqual([]);
  });

  it("a pasta de mutações exporta os helpers nomeados em 03-arquitetura.md §6.4", () => {
    const texto = arquivos
      .filter((a) => a.caminho.startsWith(MUTACOES_DIR))
      .map((a) => a.texto)
      .join("\n");
    for (const nome of [
      "emTransacao",
      "inserirAuditado",
      "atualizarComTrava",
      "excluirLogico",
      "atualizarContador",
      "atualizarEstado",
      "proximoNumeroDePedido",
      "upsertContatoPorCanal",
      "avancarStatusDeEntrega",
      "reivindicarReenvio",
      "reservarDestinatarios",
      "registrarProcessamentoEvento",
      "registrarConsentimentoBase",
      // R2 (FR5): pós-venda, pagamento, transcrição e uso de IA.
      "registrarRespostaDePesquisa",
      "registrarComentarioDePesquisa",
      "transicionarPagamento",
      "transicionarTranscricao",
      "registrarUsoDeIa",
    ]) {
      expect(texto).toContain(`export async function ${nome}`);
    }
  });

  it("mutacoes/sistema.ts tem os helpers de sistema e é reexportado por mutacoes.ts", () => {
    const extensao = readFileSync(join(RAIZ, SISTEMA), "utf8");
    const nomes = ["registrarEventoDeIngestao", "abrirAlerta", "inserirDestinatariosEmLote", "anonimizarTitular"];
    for (const nome of nomes) expect(extensao).toContain(`export async function ${nome}`);
    expect(readFileSync(join(RAIZ, MUTACOES), "utf8")).toContain('export * from "./mutacoes/sistema";');
  });

  it("nenhum arquivo da pasta importa valor de ../mutacoes (a reexportação não pode virar ciclo)", () => {
    for (const a of arquivos.filter((x) => x.caminho.startsWith(MUTACOES_DIR))) {
      expect(a.texto, a.caminho).not.toMatch(/^import \{[^}]*\} from "\.\.\/mutacoes";/m);
      expect(a.texto, a.caminho).not.toMatch(/from "@\/lib\/db\/mutacoes"/);
    }
  });

  it("lojas_ia_usos é append-only: nenhum `.update(` sobre ela, e só registrarUsoDeIa grava", () => {
    const achados = arquivos
      .filter((a) => !a.caminho.startsWith("tests/"))
      .flatMap((a) =>
        linhasDeCodigo(a.texto)
          .filter((l) => /\.update\(\s*lojas_ia_usos\b|update\s+lojas_ia_usos\b/i.test(l.texto))
          .map((l) => `${a.caminho}:${l.n}`),
      );
    expect(achados).toEqual([]);
    const gravacoes = arquivos
      .filter((a) => !a.caminho.startsWith("tests/"))
      .filter((a) => /\.insert\(\s*lojas_ia_usos\b|insert\s+into\s+lojas_ia_usos\b/i.test(a.texto))
      .map((a) => a.caminho);
    expect(gravacoes).toEqual([`${MUTACOES_DIR}transcricao.ts`]);
  });

  it("atualizarComTrava e excluirLogico passam por travaDeColisao e condicaoDeLoja", () => {
    const texto = readFileSync(join(RAIZ, BASE), "utf8");
    expect([...texto.matchAll(/travaDeColisao\(tabela/g)]).toHaveLength(2);
    expect([...texto.matchAll(/condicaoDeLoja\(tabela/g)].length).toBeGreaterThanOrEqual(4);
  });

  it("atualizarContador não escreve updated_at nem modified_by", () => {
    const texto = readFileSync(join(RAIZ, BASE), "utf8");
    const corpo = texto.slice(
      texto.indexOf("export async function atualizarContador"),
      texto.indexOf("export async function atualizarEstado"),
    );
    expect(corpo).not.toContain("updated_at");
    expect(corpo).not.toContain("modified_by");
    expect(corpo).not.toContain("registrarAuditoria");
  });
});

/** Nome de tabela -> colunas reais, montado do próprio schema. */
const colunasPorTabela = new Map<string, Set<string>>();
for (const valor of Object.values(schema)) {
  if (!isTable(valor)) continue;
  colunasPorTabela.set(getTableName(valor), new Set(Object.keys(getTableColumns(valor))));
}

describe("listas fechadas de contador e de estado", () => {
  it("o schema foi carregado inteiro", () => {
    expect(colunasPorTabela.size).toBe(50);
  });

  it.each([
    ["CONTADORES", CONTADORES],
    ["ESTADOS_DE_SISTEMA", ESTADOS_DE_SISTEMA],
  ])("%s só cita tabela e coluna que existem", (_nome, mapa) => {
    for (const [tabela, campos] of Object.entries(mapa)) {
      const colunas = colunasPorTabela.get(tabela);
      expect(colunas, `tabela ${tabela}`).toBeDefined();
      for (const campo of campos) {
        expect(colunas!.has(campo), `${tabela}.${campo}`).toBe(true);
      }
    }
  });

  it("nenhuma coluna é contador E estado de sistema ao mesmo tempo", () => {
    for (const [tabela, campos] of Object.entries(CONTADORES)) {
      const estados = ESTADOS_DE_SISTEMA[tabela] ?? [];
      for (const campo of campos) expect(estados).not.toContain(campo);
    }
  });
});
