import { sql } from "drizzle-orm";
import { index, integer, pgTable, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { colunasAuditoria } from "../_compartilhado";
import { lojas } from "../lojas";
import { lojas_midias } from "../midias";
import { produtos } from "./produtos";

/**
 * `produtos_midias` — ligação pura (sem trava de colisão).
 *
 * A "1ª foto" (`ordem = 0`) vai ao chat como MÍDIA, com URL assinada de 600 s
 * gerada no envio, nunca como link: o bucket é privado e o link quebrava para
 * a cliente (03/3.4.9).
 */
export const produtos_midias = pgTable(
  "produtos_midias",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loja_id: uuid("loja_id")
      .notNull()
      .references(() => lojas.id, { onDelete: "restrict", onUpdate: "restrict" }),
    produto_id: uuid("produto_id")
      .notNull()
      .references(() => produtos.id, { onDelete: "restrict", onUpdate: "restrict" }),
    midia_id: uuid("midia_id")
      .notNull()
      .references(() => lojas_midias.id, { onDelete: "restrict", onUpdate: "restrict" }),
    ordem: integer("ordem").notNull().default(0),
    ...colunasAuditoria,
  },
  (t) => [
    uniqueIndex("uq_produtos_midias")
      .on(t.produto_id, t.midia_id)
      .where(sql`is_deleted = false`),
    index("ix_produtos_midias_ordem").on(t.produto_id, t.ordem),
    index("ix_produtos_midias_loja").on(t.loja_id, t.is_deleted),
  ],
);
