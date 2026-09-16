import { and, asc, desc, eq, gt, lt, or, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/**
 * Cursor `(created_at, id)` das listas de produtos e pedidos (04-ui.md §8.1).
 * Opaco para a tela: base64url de `iso|uuid`. Cursor ilegível é ignorado (volta
 * à primeira página), nunca vira erro 500.
 */

export type Direcao = "anterior" | "proxima";
export type Pagina<T> = { itens: T[]; cursorAnterior: string | null; cursorProximo: string | null };
type Chave = { criadoEm: Date; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function codificarCursor(chave: Chave): string {
  return Buffer.from(`${chave.criadoEm.toISOString()}|${chave.id}`, "utf8").toString("base64url");
}

export function decodificarCursor(cursor: string | undefined | null): Chave | null {
  if (!cursor) return null;
  const [iso, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  const criadoEm = new Date(iso ?? "");
  if (!id || !UUID.test(id) || Number.isNaN(criadoEm.getTime())) return null;
  return { criadoEm, id };
}

/** `where` e `orderBy` da fatia pedida. */
export function fatia(
  colunas: { criadoEm: PgColumn; id: PgColumn },
  chave: Chave | null,
  direcao: Direcao,
): { onde: SQL | undefined; ordem: SQL[] } {
  const paraTras = direcao === "anterior" && chave !== null;
  const comparar = paraTras ? gt : lt;
  const onde = chave
    ? or(
        comparar(colunas.criadoEm, chave.criadoEm),
        and(eq(colunas.criadoEm, chave.criadoEm), comparar(colunas.id, chave.id)),
      )
    : undefined;
  const ordem = paraTras
    ? [asc(colunas.criadoEm), asc(colunas.id)]
    : [desc(colunas.criadoEm), desc(colunas.id)];
  return { onde, ordem };
}

/** Recebe `porPagina + 1` linhas e monta a página com os dois cursores. */
export function montarPagina<T extends Chave>(
  linhas: T[],
  porPagina: number,
  chave: Chave | null,
  direcao: Direcao,
): Pagina<T> {
  const temMais = linhas.length > porPagina;
  const recorte = linhas.slice(0, porPagina);
  const paraTras = direcao === "anterior" && chave !== null;
  const itens = paraTras ? recorte.reverse() : recorte;
  const primeiro = itens[0];
  const ultimo = itens[itens.length - 1];
  if (paraTras) {
    return {
      itens,
      cursorAnterior: temMais && primeiro ? codificarCursor(primeiro) : null,
      cursorProximo: ultimo ? codificarCursor(ultimo) : null,
    };
  }
  return {
    itens,
    cursorAnterior: chave && primeiro ? codificarCursor(primeiro) : null,
    cursorProximo: temMais && ultimo ? codificarCursor(ultimo) : null,
  };
}
