import { and, eq, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { EscopoLoja } from "@/lib/auth/loja";

/**
 * Helpers de LEITURA (01-dados.md §3, 03-arquitetura.md §6.3).
 *
 * Os nomes são os que `scripts/check-compliance.mjs` já reconhece como filtro
 * de soft delete (`HELPERS_SOFT_DELETE`): `vivos`, `vivosE`, `travaDeColisao`,
 * `marcaDeExclusao`. Nome novo exige editar o auditor E o teste dele no mesmo
 * commit — por isso `ativosPorLoja()` não existe.
 *
 * Toda consulta de tabela com `loja_id` tem esta forma:
 *
 *   db.select(projecao).from(conversas).where(
 *     vivosE(conversas, condicaoDeLoja(conversas, ctx.escopo), eq(conversas.status, "aberta")))
 */

/** O mínimo que cada helper exige da tabela. */
export type TabelaViva = { is_deleted: PgColumn };
export type TabelaComTrava = TabelaViva & { id: PgColumn; updated_at: PgColumn };
export type TabelaDeLoja = { loja_id: PgColumn };

export const vivos = (t: TabelaViva): SQL => eq(t.is_deleted, false);

export const vivosE = (t: TabelaViva, ...condicoes: (SQL | undefined)[]): SQL | undefined =>
  and(vivos(t), ...condicoes);

/**
 * Optimistic locking: `updated_at` tem precisão 3 (milissegundo, igual ao
 * `Date` do JS) justamente para esta igualdade bater. Zero linhas atualizadas =
 * alguém gravou entre a leitura e a escrita.
 */
export const travaDeColisao = (
  t: TabelaComTrava,
  id: string,
  updatedAtOriginal: Date,
): SQL | undefined => and(eq(t.id, id), eq(t.updated_at, updatedAtOriginal), vivos(t));

/** O `set` de todo soft delete. Nenhum `DELETE` existe no sistema. */
export const marcaDeExclusao = (usuarioId: string) => ({
  is_deleted: true,
  deleted_at: new Date(),
  updated_at: new Date(),
  modified_by: usuarioId,
});

/**
 * Usado por TODA consulta de tabela com `loja_id`.
 *
 * `nenhuma` devolve SQL falso — fail-closed. Devolver `undefined` ali faria a
 * cláusula sumir do `where` e a pessoa sem loja veria a rede inteira.
 */
export const condicaoDeLoja = (t: TabelaDeLoja, escopo: EscopoLoja): SQL | undefined =>
  escopo.tipo === "todas"
    ? undefined
    : escopo.tipo === "uma"
      ? eq(t.loja_id, escopo.lojaId)
      : sql`false`;
