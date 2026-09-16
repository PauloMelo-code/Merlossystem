import { sql } from "drizzle-orm";
import { index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { colunasAuditoria } from "../_compartilhado";
import { lojas } from "../lojas";

/**
 * `produtos_categorias` (01-dados-dominio.md §4.1).
 *
 * Virou tabela porque a categoria era texto livre no banco e lista fechada na
 * UI, e o filtro "Todas" mandava `all` e zerava a lista (03/3.4.3).
 */
export const produtos_categorias = pgTable(
  "produtos_categorias",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loja_id: uuid("loja_id")
      .notNull()
      .references(() => lojas.id, { onDelete: "restrict", onUpdate: "restrict" }),
    nome: text("nome").notNull(),
    slug: text("slug").notNull(),
    ...colunasAuditoria,
  },
  (t) => [
    uniqueIndex("uq_produtos_categorias_slug")
      .on(t.loja_id, t.slug)
      .where(sql`is_deleted = false`),
    index("ix_produtos_categorias_loja").on(t.loja_id, t.is_deleted),
  ],
);
