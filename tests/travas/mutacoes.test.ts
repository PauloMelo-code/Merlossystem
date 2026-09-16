import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableColumns, getTableName, isTable } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CONTADORES, ESTADOS_DE_SISTEMA } from "@/lib/db/listas-fechadas";
import * as schema from "@/lib/db/schema";

/**
 * Trava das mutações (01-dados.md §4.7, 03-arquitetura.md §6.4).
 *
 * `src/lib/db/mutacoes.ts` é o ÚNICO arquivo com `.insert(` e `.update(` sobre
 * tabela de domínio, e nenhum delete físico existe em lugar nenhum — nem em
 * teste, nem em script (T25).
 */

const RAIZ = process.cwd();
const MUTACOES = "src/lib/db/mutacoes.ts";
/** A extensão reexportada por mutacoes.ts: ON CONFLICT e lotes da LGPD. */
const MUTACOES_SISTEMA = "src/lib/db/mutacoes-sistema.ts";
const PASTAS = ["src", "tests", "scripts"];

/** Este arquivo cita os padrões proibidos como DEFINIÇÃO da regra. */
const ISENTOS = new Set([MUTACOES, MUTACOES_SISTEMA, "tests/travas/mutacoes.test.ts"]);

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
  });

  it("`.insert(` e `.update(` só existem em mutacoes.ts", () => {
    const achados = arquivos
      .filter((a) => !ISENTOS.has(a.caminho))
      .flatMap((a) =>
        linhasDeCodigo(a.texto)
          .filter((l) => /\b(db|tx|sp)\s*\.\s*(insert|update)\s*\(/.test(l.texto))
          .map((l) => `${a.caminho}:${l.n}`),
      );
    expect(achados).toEqual([]);
  });

  it("nenhum delete físico em lugar nenhum (T25)", () => {
    const achados = arquivos
      .filter((a) => !ISENTOS.has(a.caminho))
      .flatMap((a) =>
        linhasDeCodigo(a.texto)
          .filter((l) =>
            /\bdb\.delete\s*\(|\btx\.delete\s*\(|\.deleteMany\s*\(|\bDELETE\s+FROM\b/i.test(l.texto),
          )
          .map((l) => `${a.caminho}:${l.n}`),
      );
    expect(achados).toEqual([]);
  });

  it("mutacoes.ts exporta os helpers nomeados em 03-arquitetura.md §6.4", () => {
    const texto = readFileSync(join(RAIZ, MUTACOES), "utf8");
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
    ]) {
      expect(texto).toContain(`export async function ${nome}`);
    }
  });

  it("mutacoes-sistema.ts tem os helpers de sistema e é reexportado por mutacoes.ts", () => {
    const extensao = readFileSync(join(RAIZ, MUTACOES_SISTEMA), "utf8");
    const principal = readFileSync(join(RAIZ, MUTACOES), "utf8");
    const nomes = ["registrarEventoDeIngestao", "abrirAlerta", "inserirDestinatariosEmLote", "anonimizarTitular"];
    for (const nome of nomes) {
      expect(extensao).toContain(`export async function ${nome}`);
      expect(principal).toContain(nome);
    }
    // Sem import de valor de mutacoes.ts: a reexportação não pode virar ciclo.
    expect(extensao).not.toMatch(/^import \{[^}]*\} from "\.\/mutacoes";/m);
  });

  it("atualizarComTrava e excluirLogico passam por travaDeColisao e condicaoDeLoja", () => {
    const texto = readFileSync(join(RAIZ, MUTACOES), "utf8");
    expect([...texto.matchAll(/travaDeColisao\(tabela/g)]).toHaveLength(2);
    expect([...texto.matchAll(/condicaoDeLoja\(tabela/g)].length).toBeGreaterThanOrEqual(4);
  });

  it("atualizarContador não escreve updated_at nem modified_by", () => {
    const texto = readFileSync(join(RAIZ, MUTACOES), "utf8");
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
    expect(colunasPorTabela.size).toBe(48);
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
