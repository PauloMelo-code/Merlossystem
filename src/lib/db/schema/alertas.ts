import { sql } from "drizzle-orm";
import { index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { usuarios } from "./auth/usuarios";
import { colunasAuditoria, instante } from "./_compartilhado";
import { checkLista } from "./_enums";
import { SEVERIDADES, TIPOS_ALERTA } from "./_enums/plataforma";
import { contatos } from "./contatos";
import { conversas } from "./conversas/conversas";
import { lojas } from "./lojas";
import { negocios } from "./negocios";
import { pedidos } from "./pedidos/pedidos";

/**
 * `alertas` (01-dados.md §6.6). COM trava de colisão: duas pessoas reconhecem
 * ao mesmo tempo.
 *
 * QUEM ESCREVE `resolvido_em` É O GERADOR, NUNCA A PESSOA. O job
 * `gerar-alertas` reavalia a condição de cada alerta aberto e carimba
 * `resolvido_em` quando ela deixa de valer; a pessoa só RECONHECE. É isso que
 * mantém a dedupe honesta e conserta 04/F05 — alerta reconhecido que volta.
 *
 * Sem tabela de configuração de SLA nesta entrega: o SLA por canal é constante
 * no código (5/15/30/60 min) e `/configuracoes/sla` não existe no R1.
 */
export const alertas = pgTable(
  "alertas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loja_id: uuid("loja_id")
      .notNull()
      .references(() => lojas.id, { onDelete: "restrict", onUpdate: "restrict" }),
    tipo: text("tipo").notNull(),
    severidade: text("severidade").notNull(),
    mensagem: text("mensagem").notNull(),
    conversa_id: uuid("conversa_id").references(() => conversas.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    contato_id: uuid("contato_id").references(() => contatos.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    pedido_id: uuid("pedido_id").references(() => pedidos.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    negocio_id: uuid("negocio_id").references(() => negocios.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    chave_deduplicacao: text("chave_deduplicacao").notNull(),
    reconhecido_por: uuid("reconhecido_por").references(() => usuarios.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    reconhecido_em: instante("reconhecido_em"),
    resolvido_em: instante("resolvido_em"),
    ...colunasAuditoria,
  },
  (t) => [
    checkLista("alertas_tipo_lista", t.tipo, TIPOS_ALERTA),
    checkLista("alertas_severidade_lista", t.severidade, SEVERIDADES),
    uniqueIndex("uq_alertas_deduplicacao")
      .on(t.loja_id, t.chave_deduplicacao)
      .where(sql`resolvido_em is null and is_deleted = false`),
    index("ix_alertas_painel").on(t.loja_id, t.reconhecido_em, t.created_at.desc()),
    index("ix_alertas_tipo").on(t.loja_id, t.tipo),
    index("ix_alertas_loja").on(t.loja_id, t.is_deleted),
  ],
);
