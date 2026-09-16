import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { usuarios } from "../auth/usuarios";
import { colunasAuditoria, instante } from "../_compartilhado";
import { checkLista } from "../_enums";
import {
  GATILHOS_AGENDAMENTO,
  STATUS_AGENDAMENTO,
  TIPOS_CONTEUDO_AGENDAMENTO,
} from "../_enums/conversas";
import { contatos } from "../contatos";
import { lojas } from "../lojas";
import { lojas_integracoes, lojas_integracoes_templates, type VariavelTemplate } from "../integracoes";
import { lojas_midias } from "../midias";
import { conversas } from "./conversas";
import { conversas_mensagens } from "./mensagens";

/**
 * `conversas_agendamentos` — mensagens agendadas (01-dados-dominio.md §2.5).
 *
 * Agendamento PROMOCIONAL (gatilhos `promocao`, `reativacao`, `abandono`)
 * respeita opt-out; `manual`, `follow_up`, `pos_venda` e `aniversario`, não —
 * opt-out é de marketing (§7.2).
 */
export const conversas_agendamentos = pgTable(
  "conversas_agendamentos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loja_id: uuid("loja_id")
      .notNull()
      .references(() => lojas.id, { onDelete: "restrict", onUpdate: "restrict" }),
    contato_id: uuid("contato_id")
      .notNull()
      .references(() => contatos.id, { onDelete: "restrict", onUpdate: "restrict" }),
    conversa_id: uuid("conversa_id").references(() => conversas.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    integracao_id: uuid("integracao_id")
      .notNull()
      .references(() => lojas_integracoes.id, { onDelete: "restrict", onUpdate: "restrict" }),
    conteudo: text("conteudo"),
    tipo_conteudo: text("tipo_conteudo").notNull(),
    template_id: uuid("template_id").references(() => lojas_integracoes_templates.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    variaveis: jsonb("variaveis").$type<VariavelTemplate[]>().notNull().default([]),
    midia_id: uuid("midia_id").references(() => lojas_midias.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    agendada_para: instante("agendada_para").notNull(),
    gatilho: text("gatilho").notNull(),
    status: text("status").notNull().default("agendada"),
    enviada_em: instante("enviada_em"),
    mensagem_id: uuid("mensagem_id").references(() => conversas_mensagens.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    erro: text("erro"),
    cancelada_por: uuid("cancelada_por").references(() => usuarios.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    ...colunasAuditoria,
  },
  (t) => [
    checkLista(
      "conversas_agendamentos_tipo_lista",
      t.tipo_conteudo,
      TIPOS_CONTEUDO_AGENDAMENTO,
    ),
    checkLista("conversas_agendamentos_gatilho_lista", t.gatilho, GATILHOS_AGENDAMENTO),
    checkLista("conversas_agendamentos_status_lista", t.status, STATUS_AGENDAMENTO),
    check(
      "conversas_agendamentos_template",
      sql`${t.tipo_conteudo} <> 'template' or ${t.template_id} is not null`,
    ),
    index("ix_conversas_agendamentos_fila")
      .on(t.status, t.agendada_para)
      .where(sql`status = 'agendada'`),
    index("ix_conversas_agendamentos_loja").on(t.loja_id, t.is_deleted),
  ],
);
