import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * T25 — soft delete (02-seguranca.md §20; 01-dados.md §4.3; ADR 0013).
 *
 * Duas regras, e as duas sao absolutas:
 *
 *   1. NENHUM delete fisico de linha existe no sistema. Nem em `src/`, nem em
 *      `tests/`, nem em `scripts/`. A unica exclusao fisica e de ARQUIVO no
 *      MinIO, feita pelo job `manutencao/limpar-midia`.
 *   2. Consulta de dominio filtra `is_deleted = false`. A lista branca tem UMA
 *      entrada, e ela e nomeada aqui com o motivo.
 *
 * Esta trava e irma de `tests/travas/mutacoes.test.ts`, que cobre `.insert(` e
 * `.update(` fora de `mutacoes.ts`. Separadas de proposito: a mensagem de falha
 * de "voce fez um delete fisico" tem de ser inconfundivel.
 */

const RAIZ = process.cwd();
const PASTAS = ["src", "tests", "scripts"];

/**
 * Arquivos que CITAM o padrao proibido como definicao da regra, mais os DOIS
 * que preparam o banco de TESTE.
 *
 * `TRUNCATE` e `DROP SCHEMA` no preparo do banco de teste sao permitidos e
 * estao escritos (03-arquitetura.md secao 17 e secao 20): eles rodam com
 * `DATABASE_URL_MIGRACAO`, num banco cujo nome tem de conter "test", em host
 * local e fora de producao — tres guardas conferidas antes de qualquer comando.
 * O que esta trava impede e delete de LINHA no codigo da aplicacao.
 */
const ISENTOS = new Set([
  "tests/travas/soft-delete.test.ts",
  "tests/travas/mutacoes.test.ts",
  "scripts/check-compliance.mjs",
  "tests/check-compliance.test.mjs",
  "scripts/db-teste.mjs",
  "tests/seguranca/_apoio.ts",
]);

/**
 * LISTA BRANCA DE SOFT DELETE — uma entrada so (02-seguranca.md §15, RN-M06).
 *
 * A rota de midia serve o binario de uma linha soft-deletada QUANDO ela ainda e
 * referenciada por uma mensagem: apagar da galeria nao pode furar o historico
 * da conversa. Vai com `EXCECAO-SEG` no arquivo.
 */
const LISTA_BRANCA_DE_SOFT_DELETE = ["src/app/api/midias/[id]/route.ts"];

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
      if (e.name === "migrations" || e.name === "node_modules" || e.name === "drizzle") return [];
      return varrer(relativo);
    }
    return /\.(ts|tsx|mjs)$/.test(e.name) ? [relativo] : [];
  });
}

const arquivos = varrer("src")
  .concat(PASTAS.slice(1).flatMap(varrer))
  .map((caminho) => ({ caminho, texto: readFileSync(join(RAIZ, caminho), "utf8") }));

/** Comentario que cita o padrao nao e uso do padrao. */
function linhasDeCodigo(texto: string) {
  return texto
    .split(/\r?\n/)
    .map((linha, i) => ({ n: i + 1, texto: linha }))
    .filter(({ texto: l }) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    });
}

const DELETE_FISICO =
  /\b(db|tx|sp|banco)\s*\.\s*delete\s*\(|\.deleteMany\s*\(|\bDELETE\s+FROM\b|\bTRUNCATE\s+TABLE\b/i;

describe("T25 nenhum delete fisico", () => {
  it("varre um repositorio de verdade (piso minimo)", () => {
    expect(arquivos.length).toBeGreaterThanOrEqual(80);
  });

  it("nao existe delete fisico de linha em src, tests nem scripts", () => {
    const achados = arquivos
      .filter((a) => !ISENTOS.has(a.caminho))
      .flatMap((a) =>
        linhasDeCodigo(a.texto)
          .filter((l) => DELETE_FISICO.test(l.texto))
          .map((l) => `${a.caminho}:${l.n} ${l.texto.trim()}`),
      );
    expect(achados).toEqual([]);
  });

  it("os helpers de exclusao logica existem e sao a unica porta", () => {
    const mutacoes = readFileSync(join(RAIZ, "src/lib/db/mutacoes/base.ts"), "utf8");
    expect(mutacoes).toContain("export async function excluirLogico");
    const consultas = readFileSync(join(RAIZ, "src/lib/db/consultas.ts"), "utf8");
    expect(consultas).toMatch(/export const marcaDeExclusao/);
    expect(consultas).toMatch(/export const vivos/);
  });
});

describe("T25 a trilha nunca e alvo de exclusao", () => {
  const TRILHAS = ["auth_eventos", "auditoria_eventos", "consentimentos", "usuarios_senhas_historico"];

  it("nenhum arquivo combina nome de trilha com exclusao", () => {
    const achados = arquivos
      .filter((a) => !ISENTOS.has(a.caminho))
      .flatMap((a) =>
        linhasDeCodigo(a.texto)
          .filter((l) => TRILHAS.some((t) => l.texto.includes(t)) && /\bdelete\b/i.test(l.texto))
          .map((l) => `${a.caminho}:${l.n}`),
      );
    expect(achados).toEqual([]);
  });

  it("excluirLogico nao aceita tabela de trilha (elas nao tem is_deleted)", () => {
    // A barreira real e o TIPO: `TabelaDominio` exige `is_deleted`, `deleted_at`
    // e `modified_by`, e nenhuma trilha tem essas colunas. Este caso existe para
    // o dia em que alguem for tentado a acrescenta-las.
    const mutacoes = readFileSync(join(RAIZ, "src/lib/db/mutacoes/base.ts"), "utf8");
    expect(mutacoes).toMatch(/is_deleted:\s*PgColumn/);
    expect(mutacoes).toMatch(/deleted_at:\s*PgColumn/);
  });
});

describe("T25 a lista branca de soft delete tem uma entrada so", () => {
  it("a lista nao cresce sem alguem decidir", () => {
    expect(LISTA_BRANCA_DE_SOFT_DELETE).toHaveLength(1);
    expect(LISTA_BRANCA_DE_SOFT_DELETE[0]).toBe("src/app/api/midias/[id]/route.ts");
  });

  it("a entrada da lista, quando existir, traz a EXCECAO-SEG escrita", () => {
    // A rota e do pacote M3. Enquanto ela nao existe, nada a conferir; no
    // instante em que nascer, ela tem de trazer a excecao nomeada.
    for (const caminho of LISTA_BRANCA_DE_SOFT_DELETE) {
      const arquivo = arquivos.find((a) => a.caminho === caminho);
      if (!arquivo) continue;
      expect(arquivo.texto, caminho).toContain("EXCECAO-SEG");
    }
  });
});
