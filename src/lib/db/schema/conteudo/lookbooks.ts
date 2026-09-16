import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { colunasAuditoria } from "../_compartilhado";
import { produtos } from "../catalogo/produtos";
import { lojas } from "../lojas";
import { lojas_midias } from "../midias";

/**
 * `lookbooks` e as duas ligações (01-dados-dominio.md §5.1).
 *
 * Os três arrays sem FK do antigo (`cover_media_id`, `media_ids`,
 * `product_ids`) permitiam referência cruzada entre lojas e ids mortos.
 * FORA DO R1: tabelas criadas, sem tela e sem rota.
 */
export const lookbooks = pgTable(
  "lookbooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loja_id: uuid("loja_id")
      .notNull()
      .references(() => lojas.id, { onDelete: "restrict", onUpdate: "restrict" }),
    nome: text("nome").notNull(),
    descricao: text("descricao"),
    capa_midia_id: uuid("capa_midia_id").references(() => lojas_midias.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    ...colunasAuditoria,
  },
  (t) => [index("ix_lookbooks_loja").on(t.loja_id, t.is_deleted)],
);

/** Ligação pura. */
export const lookbooks_midias = pgTable(
  "lookbooks_midias",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loja_id: uuid("loja_id")
      .notNull()
      .references(() => lojas.id, { onDelete: "restrict", onUpdate: "restrict" }),
    lookbook_id: uuid("lookbook_id")
      .notNull()
      .references(() => lookbooks.id, { onDelete: "restrict", onUpdate: "restrict" }),
    midia_id: uuid("midia_id")
      .notNull()
      .references(() => lojas_midias.id, { onDelete: "restrict", onUpdate: "restrict" }),
    ordem: integer("ordem").notNull().default(0),
    ...colunasAuditoria,
  },
  (t) => [
    uniqueIndex("uq_lookbooks_midias")
      .on(t.lookbook_id, t.midia_id)
      .where(sql`is_deleted = false`),
    index("ix_lookbooks_midias_ordem").on(t.lookbook_id, t.ordem),
    index("ix_lookbooks_midias_loja").on(t.loja_id, t.is_deleted),
  ],
);

/** Ligação pura. */
export const lookbooks_produtos = pgTable(
  "lookbooks_produtos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loja_id: uuid("loja_id")
      .notNull()
      .references(() => lojas.id, { onDelete: "restrict", onUpdate: "restrict" }),
    lookbook_id: uuid("lookbook_id")
      .notNull()
      .references(() => lookbooks.id, { onDelete: "restrict", onUpdate: "restrict" }),
    produto_id: uuid("produto_id")
      .notNull()
      .references(() => produtos.id, { onDelete: "restrict", onUpdate: "restrict" }),
    ordem: integer("ordem").notNull().default(0),
    ...colunasAuditoria,
  },
  (t) => [
    uniqueIndex("uq_lookbooks_produtos")
      .on(t.lookbook_id, t.produto_id)
      .where(sql`is_deleted = false`),
    index("ix_lookbooks_produtos_ordem").on(t.lookbook_id, t.ordem),
    index("ix_lookbooks_produtos_loja").on(t.loja_id, t.is_deleted),
  ],
);
