import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { colunasAuditoria } from "../_compartilhado";
import { checkLista } from "../_enums";
import { CATEGORIAS_RESPOSTA } from "../_enums/catalogo";
import { lojas } from "../lojas";

/**
 * `respostas_rapidas` (01-dados-dominio.md §5.2). COM trava de colisão.
 *
 * O único é PARCIAL: excluir `/frete` e recriar dava 500 no antigo, porque o
 * único era total e a linha excluída continuava ocupando o atalho (03/7.3.1).
 * `media_ids[]` não existe mais.
 */
export const respostas_rapidas = pgTable(
  "respostas_rapidas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loja_id: uuid("loja_id")
      .notNull()
      .references(() => lojas.id, { onDelete: "restrict", onUpdate: "restrict" }),
    titulo: text("titulo").notNull(),
    conteudo: text("conteudo").notNull(),
    categoria: text("categoria"),
    atalho: text("atalho"),
    ativa: boolean("ativa").notNull().default(true),
    ...colunasAuditoria,
  },
  (t) => [
    checkLista("respostas_rapidas_categoria_lista", t.categoria, CATEGORIAS_RESPOSTA),
    check("respostas_rapidas_atalho_formato", sql`${t.atalho} ~ '^/[a-z0-9-]{1,30}$'`),
    uniqueIndex("uq_respostas_rapidas_atalho")
      .on(t.loja_id, t.atalho)
      .where(sql`atalho is not null and is_deleted = false`),
    index("ix_respostas_rapidas_loja").on(t.loja_id, t.is_deleted),
  ],
);
