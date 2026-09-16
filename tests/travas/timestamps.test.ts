import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Trava T19 e R-02 (01-dados.md §4.1 e §15).
 *
 * Duas coisas que quebram EM SILÊNCIO:
 *   - `timestamp` sem `precision: 3` grava microssegundo, o `Date` do JS tem
 *     milissegundo, e `eq(updated_at, original)` nunca mais bate: a trava de
 *     colisão para de existir sem ninguém perceber;
 *   - `$onUpdate` em `updated_at` dispara no UPDATE de contador e envelhece o
 *     carimbo a cada mensagem que chega: toda edição legítima passa a
 *     responder "Registro alterado por outro usuário".
 */

const SCHEMA = join(process.cwd(), "src", "lib", "db", "schema");

function arquivosTs(pasta: string): string[] {
  return readdirSync(pasta, { withFileTypes: true }).flatMap((e) => {
    const caminho = join(pasta, e.name);
    if (e.isDirectory()) return arquivosTs(caminho);
    return e.isFile() && e.name.endsWith(".ts") ? [caminho] : [];
  });
}

const arquivos = arquivosTs(SCHEMA).map((caminho) => ({
  caminho: caminho.replace(/\\/g, "/"),
  texto: readFileSync(caminho, "utf8"),
}));

/** Linhas que não são comentário: o texto explica os padrões que proíbe. */
const linhasDeCodigo = (texto: string) =>
  texto.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));

describe("timestamps do schema", () => {
  it("varre um schema de verdade (piso mínimo)", () => {
    expect(arquivos.length).toBeGreaterThanOrEqual(30);
  });

  it("só `_compartilhado.ts` chama `timestamp(` direto", () => {
    const fora = arquivos.filter(
      (a) => /\btimestamp\s*\(/.test(a.texto) && !a.caminho.endsWith("_compartilhado.ts"),
    );
    expect(fora.map((a) => a.caminho)).toEqual([]);
  });

  it("`instante()` tem precisão 3 e fuso", () => {
    const base = arquivos.find((a) => a.caminho.endsWith("_compartilhado.ts"));
    expect(base).toBeDefined();
    expect(base!.texto).toContain("precision: 3");
    expect(base!.texto).toContain("withTimezone: true");
    expect(base!.texto).toContain('mode: "date"');
  });

  it("nenhuma coluna usa `$onUpdate`", () => {
    // Fora de comentário: `_compartilhado.ts` cita `$onUpdate` no texto que
    // explica por que ele não está lá.
    const achados = arquivos.filter((a) =>
      linhasDeCodigo(a.texto).some((l) => l.includes("$onUpdate")),
    );
    expect(achados.map((a) => a.caminho)).toEqual([]);
  });

  it("nenhuma FK usa cascade", () => {
    const achados = arquivos.filter((a) => /onDelete:\s*["']cascade["']/i.test(a.texto));
    expect(achados.map((a) => a.caminho)).toEqual([]);
  });

  it("todo pgTable tem 2º argumento objeto literal e 3º array", () => {
    // A forma callback no 2º argumento escapa do auditor inteiro.
    for (const a of arquivos) {
      for (const m of a.texto.matchAll(/pgTable\s*\(\s*"[^"]+"\s*,\s*(.)/g)) {
        expect(`${a.caminho}: ${m[1]}`).toBe(`${a.caminho}: {`);
      }
      for (const m of a.texto.matchAll(/\(t\)\s*=>\s*(.)/g)) {
        expect(`${a.caminho}: ${m[1]}`).toBe(`${a.caminho}: [`);
      }
    }
  });

  it("toda tabela de domínio espalha `...colunasAuditoria` sem alias", () => {
    const semMarcador = arquivos.filter(
      (a) =>
        /pgTable\s*\(/.test(a.texto) &&
        !a.texto.includes("...colunasAuditoria") &&
        !a.texto.includes("compliance:append-only") &&
        !a.texto.includes("compliance:framework"),
    );
    expect(semMarcador.map((a) => a.caminho)).toEqual([]);
  });
});
