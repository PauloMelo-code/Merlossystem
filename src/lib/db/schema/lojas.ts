import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { colunasAuditoria } from "./_compartilhado";

/**
 * `lojas` — a unidade de escopo do sistema inteiro (01-dados.md §6.1).
 *
 * Sem coluna `ativo`: duplicava `is_deleted`. Onde a segurança diz "loja existe
 * e está ativa", leia-se `is_deleted = false`.
 */
export const lojas = pgTable(
  "lojas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nome: text("nome").notNull(),
    slug: text("slug").notNull(),
    /** 3 letras, CADASTRADA — nunca derivada do nome (corrige 06/D-19). */
    sigla: text("sigla").notNull(),
    bling_deposito_id: text("bling_deposito_id"),
    ...colunasAuditoria,
  },
  (t) => [
    check("lojas_sigla_formato", sql`${t.sigla} ~ '^[A-Z]{3}$'`),
    uniqueIndex("uq_lojas_slug")
      .on(sql`lower(${t.slug})`)
      .where(sql`is_deleted = false`),
    uniqueIndex("uq_lojas_sigla")
      .on(t.sigla)
      .where(sql`is_deleted = false`),
  ],
);

/**
 * `lojas_etiquetas` — catálogo de etiquetas por loja (01-dados.md §6.2).
 *
 * Substitui `contacts.tags text[]`, `media_files.tags text[]` e
 * `knowledge_articles.tags text[]`: etiqueta decide audiência de campanha e com
 * `text[]` não havia normalização nem FK.
 */
export const lojas_etiquetas = pgTable(
  "lojas_etiquetas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loja_id: uuid("loja_id")
      .notNull()
      .references(() => lojas.id, { onDelete: "restrict", onUpdate: "restrict" }),
    nome: text("nome").notNull(),
    slug: text("slug").notNull(),
    cor: text("cor"),
    ...colunasAuditoria,
  },
  (t) => [
    check("lojas_etiquetas_cor_formato", sql`${t.cor} ~ '^#[0-9a-f]{6}$'`),
    uniqueIndex("uq_lojas_etiquetas_slug")
      .on(t.loja_id, t.slug)
      .where(sql`is_deleted = false`),
    index("ix_lojas_etiquetas_loja").on(t.loja_id, t.is_deleted),
  ],
);
