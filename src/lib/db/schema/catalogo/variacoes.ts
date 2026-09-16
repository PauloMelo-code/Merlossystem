import { sql } from "drizzle-orm";
import { index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { colunasAuditoria } from "../_compartilhado";
import { lojas } from "../lojas";
import { produtos } from "./produtos";

/**
 * `produtos_variacoes` — a reserva de estoque é POR TAMANHO (02/O-08).
 *
 * Sem SKU por variação, o cálculo de disponibilidade degrada para o nível do
 * produto — comportamento de hoje, sem migração futura (01-dados.md §11, #2).
 */
export const produtos_variacoes = pgTable(
  "produtos_variacoes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loja_id: uuid("loja_id")
      .notNull()
      .references(() => lojas.id, { onDelete: "restrict", onUpdate: "restrict" }),
    produto_id: uuid("produto_id")
      .notNull()
      .references(() => produtos.id, { onDelete: "restrict", onUpdate: "restrict" }),
    tamanho: text("tamanho").notNull(),
    sku: text("sku"),
    bling_produto_id: text("bling_produto_id"),
    ...colunasAuditoria,
  },
  (t) => [
    uniqueIndex("uq_produtos_variacoes_tamanho")
      .on(t.produto_id, t.tamanho)
      .where(sql`is_deleted = false`),
    uniqueIndex("uq_produtos_variacoes_sku")
      .on(t.loja_id, t.sku)
      .where(sql`sku is not null and is_deleted = false`),
    index("ix_produtos_variacoes_loja").on(t.loja_id, t.is_deleted),
  ],
);
