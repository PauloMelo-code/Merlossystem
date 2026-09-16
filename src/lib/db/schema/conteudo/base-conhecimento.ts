import { sql } from "drizzle-orm";
import { index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { usuarios } from "../auth/usuarios";
import { colunasAuditoria } from "../_compartilhado";
import { checkLista } from "../_enums";
import { CATEGORIAS_ARTIGO } from "../_enums/catalogo";
import { lojas, lojas_etiquetas } from "../lojas";

/**
 * `base_conhecimento_artigos` (01-dados-dominio.md §5.3). COM trava de colisão.
 *
 * `is_public` sai: não tinha semântica nem consumidor. FORA DO R1: tabelas
 * criadas, sem tela.
 */
export const base_conhecimento_artigos = pgTable(
  "base_conhecimento_artigos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loja_id: uuid("loja_id")
      .notNull()
      .references(() => lojas.id, { onDelete: "restrict", onUpdate: "restrict" }),
    titulo: text("titulo").notNull(),
    conteudo: text("conteudo").notNull(),
    categoria: text("categoria"),
    criado_por: uuid("criado_por").references(() => usuarios.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    ...colunasAuditoria,
  },
  (t) => [
    checkLista("base_conhecimento_artigos_categoria_lista", t.categoria, CATEGORIAS_ARTIGO),
    index("ix_base_conhecimento_artigos_loja").on(t.loja_id, t.is_deleted),
  ],
);

/** Ligação pura. */
export const base_conhecimento_artigos_etiquetas = pgTable(
  "base_conhecimento_artigos_etiquetas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loja_id: uuid("loja_id")
      .notNull()
      .references(() => lojas.id, { onDelete: "restrict", onUpdate: "restrict" }),
    artigo_id: uuid("artigo_id")
      .notNull()
      .references(() => base_conhecimento_artigos.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    etiqueta_id: uuid("etiqueta_id")
      .notNull()
      .references(() => lojas_etiquetas.id, { onDelete: "restrict", onUpdate: "restrict" }),
    ...colunasAuditoria,
  },
  (t) => [
    uniqueIndex("uq_base_conhecimento_artigos_etiquetas")
      .on(t.artigo_id, t.etiqueta_id)
      .where(sql`is_deleted = false`),
    index("ix_base_conhecimento_etiquetas_loja").on(t.loja_id, t.is_deleted),
  ],
);
