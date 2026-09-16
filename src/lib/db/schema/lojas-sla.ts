import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { colunasAuditoria } from "./_compartilhado";
import { checkLista } from "./_enums";
import { PRIORIDADES } from "./_enums/conversas";
import { PROVEDORES_DE_CONVERSA } from "./_enums/plataforma";
import { lojas } from "./lojas";

/**
 * `lojas_sla` — prazo de resposta por loja (ADR 0060).
 *
 * Uma linha = UMA regra: por canal (`provedor`) OU por prioridade. Sem linha =
 * padrão do código (canal) / sem prazo próprio (prioridade). "Voltar ao
 * padrão" é exclusão lógica. COM trava de colisão (dois administradores).
 * Quem lê é `src/lib/sla/prazo.ts` — a única fonte do prazo.
 */
export const lojas_sla = pgTable(
  "lojas_sla",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loja_id: uuid("loja_id")
      .notNull()
      .references(() => lojas.id, { onDelete: "restrict", onUpdate: "restrict" }),
    provedor: text("provedor"),
    prioridade: text("prioridade"),
    minutos: integer("minutos").notNull(),
    ...colunasAuditoria,
  },
  (t) => [
    checkLista("lojas_sla_provedor_lista", t.provedor, PROVEDORES_DE_CONVERSA),
    checkLista("lojas_sla_prioridade_lista", t.prioridade, PRIORIDADES),
    check("lojas_sla_um_alvo", sql`num_nonnulls(${t.provedor}, ${t.prioridade}) = 1`),
    check("lojas_sla_minutos_faixa", sql`${t.minutos} between 1 and 1440`),
    uniqueIndex("uq_lojas_sla_provedor")
      .on(t.loja_id, t.provedor)
      .where(sql`provedor is not null and is_deleted = false`),
    uniqueIndex("uq_lojas_sla_prioridade")
      .on(t.loja_id, t.prioridade)
      .where(sql`prioridade is not null and is_deleted = false`),
    index("ix_lojas_sla_loja").on(t.loja_id, t.is_deleted),
  ],
);
