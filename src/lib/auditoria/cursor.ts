import { asc, desc, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/**
 * Paginação por cursor `(instante, id)` (04-ui.md U5 e §8.1). Módulo PURO na
 * parte de codificação; as duas funções de SQL só montam fragmento.
 *
 * Usado pelas três abas de `/auditoria` e por `/alertas`: todas ordenam do mais
 * novo para o mais velho e casam com um índice `(…, instante DESC)` que existe.
 *
 * `instante` tem precisão 3 no banco e no `Date` do JS: a comparação de tupla é
 * exata, sem linha repetida nem pulada na virada de página.
 */

export type Direcao = "anterior" | "proxima";

export type Pagina<T> = {
  itens: T[];
  cursorAnterior: string | null;
  cursorProximo: string | null;
};

export type Cursor = { em: Date; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function codificarCursor(em: Date, id: string): string {
  return Buffer.from(`${em.toISOString()}|${id}`, "utf8").toString("base64url");
}

/** Cursor adulterado vira `null` (primeira página), nunca erro de SQL. */
export function decodificarCursor(valor: string | null | undefined): Cursor | null {
  if (!valor || valor.length > 200) return null;
  let texto: string;
  try {
    texto = Buffer.from(valor, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const [iso, id] = texto.split("|");
  if (!iso || !id || !UUID.test(id)) return null;
  const em = new Date(iso);
  if (Number.isNaN(em.getTime())) return null;
  return { em, id };
}

/** `(instante, id) < cursor` na ida; `>` na volta. */
export function condicaoDoCursor(
  colEm: PgColumn,
  colId: PgColumn,
  cursor: Cursor | null,
  direcao: Direcao,
): SQL | undefined {
  if (!cursor) return undefined;
  const operador = direcao === "anterior" ? sql.raw(">") : sql.raw("<");
  return sql`(${colEm}, ${colId}) ${operador} (${cursor.em.toISOString()}::timestamptz, ${cursor.id}::uuid)`;
}

export function ordemDoCursor(colEm: PgColumn, colId: PgColumn, direcao: Direcao): SQL[] {
  return direcao === "anterior" ? [asc(colEm), asc(colId)] : [desc(colEm), desc(colId)];
}

/**
 * Recebe `limite + 1` linhas na ordem da consulta e devolve a página sempre do
 * mais novo para o mais velho, com os dois cursores.
 */
export function montarPagina<T>(
  linhas: T[],
  limite: number,
  direcao: Direcao,
  veioComCursor: boolean,
  chave: (item: T) => Cursor,
): Pagina<T> {
  const temMais = linhas.length > limite;
  const recorte = linhas.slice(0, limite);
  const itens = direcao === "anterior" ? recorte.reverse() : recorte;
  const primeiro = itens[0];
  const ultimo = itens[itens.length - 1];
  const cursorDe = (item: T | undefined) => {
    if (!item) return null;
    const c = chave(item);
    return codificarCursor(c.em, c.id);
  };

  if (direcao === "anterior") {
    return {
      itens,
      cursorAnterior: temMais ? cursorDe(primeiro) : null,
      cursorProximo: cursorDe(ultimo),
    };
  }
  return {
    itens,
    cursorAnterior: veioComCursor ? cursorDe(primeiro) : null,
    cursorProximo: temMais ? cursorDe(ultimo) : null,
  };
}
