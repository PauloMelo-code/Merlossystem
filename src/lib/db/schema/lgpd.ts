import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { usuarios } from "./auth/usuarios";
import { colunasAuditoria, instante } from "./_compartilhado";
import { checkLista } from "./_enums";
import {
  GATILHOS_PESQUISA,
  ORIGENS_CONSENTIMENTO,
  TIPOS_CONSENTIMENTO,
  TIPOS_LGPD,
} from "./_enums/auditoria";
import { contatos } from "./contatos";
import { conversas } from "./conversas/conversas";
import { conversas_mensagens } from "./conversas/mensagens";
import { lojas } from "./lojas";
import { pedidos } from "./pedidos/pedidos";

/**
 * `consentimentos` — o histórico de opt-in e opt-out (01-dados-dominio.md §7.2).
 *
 * compliance:append-only — justificativa: é a prova do que a titular aceitou e
 * quando. Só `criado_em`, `REVOKE UPDATE, DELETE, TRUNCATE` e gatilho
 * `trilha_imutavel()`, instalados na própria migração 0015.
 *
 * SEM FK NENHUMA (ADR 0012): precisa sobreviver à anonimização LGPD.
 *
 * `contatos.opt_out` é ESPELHO desta tabela, escrito só por
 * `registrarConsentimento()` na mesma transação. O filtro de campanha lê a
 * VERDADE (a última linha por contato), não o espelho; o espelho serve para
 * listar e exibir. `ip` vem do servidor, nunca do corpo (02/L-08).
 */
// compliance:append-only — prova do que a titular aceitou e quando: só
// `criado_em`, mais REVOKE e gatilho `trilha_imutavel()` na migração 0015.
export const consentimentos = pgTable(
  "consentimentos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    criado_em: instante("criado_em").notNull().defaultNow(),
    loja_id: uuid("loja_id").notNull(),
    contato_id: uuid("contato_id").notNull(),
    tipo: text("tipo").notNull(),
    concedido: boolean("concedido").notNull(),
    origem: text("origem").notNull(),
    canal: text("canal"),
    mensagem_id: uuid("mensagem_id"),
    /** Prova O QUE a pessoa aceitou. */
    termo_versao: text("termo_versao").notNull(),
    ip: text("ip"),
    registrado_por: uuid("registrado_por"),
  },
  (t) => [
    checkLista("consentimentos_tipo_lista", t.tipo, TIPOS_CONSENTIMENTO),
    checkLista("consentimentos_origem_lista", t.origem, ORIGENS_CONSENTIMENTO),
    index("ix_consentimentos_contato").on(t.contato_id, t.criado_em.desc()),
    index("ix_consentimentos_loja").on(t.loja_id, t.tipo, t.criado_em.desc()),
  ],
);

/** Resultado da execução da solicitação (01-dados.md §10). */
export type ResultadoLgpd = {
  tabelas: Record<string, number>;
  objetos_removidos: number;
  concluido_em: string;
};

/**
 * `lgpd_solicitacoes` — a prova do atendimento ao titular (§7.3).
 *
 * `correcao` fica no CHECK: é direito do art. 18, III. O fluxo mínimo registra
 * a solicitação e o protocolo; a correção sai pela edição normal do contato, e
 * `resultado` guarda quais campos mudaram. Escopo é POR LOJA (DN-05).
 */
export const lgpd_solicitacoes = pgTable(
  "lgpd_solicitacoes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loja_id: uuid("loja_id")
      .notNull()
      .references(() => lojas.id, { onDelete: "restrict", onUpdate: "restrict" }),
    contato_id: uuid("contato_id")
      .notNull()
      .references(() => contatos.id, { onDelete: "restrict", onUpdate: "restrict" }),
    tipo: text("tipo").notNull(),
    protocolo: text("protocolo").notNull(),
    motivo: text("motivo"),
    solicitado_em: instante("solicitado_em").notNull(),
    executado_por: uuid("executado_por").references(() => usuarios.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    executado_em: instante("executado_em"),
    resultado: jsonb("resultado").$type<ResultadoLgpd>(),
    ...colunasAuditoria,
  },
  (t) => [
    checkLista("lgpd_solicitacoes_tipo_lista", t.tipo, TIPOS_LGPD),
    uniqueIndex("uq_lgpd_solicitacoes_protocolo")
      .on(t.loja_id, t.protocolo)
      .where(sql`is_deleted = false`),
    index("ix_lgpd_solicitacoes_contato").on(t.contato_id),
    index("ix_lgpd_solicitacoes_loja").on(t.loja_id, t.is_deleted),
  ],
);

/**
 * `pesquisas_satisfacao` — CSAT (§7.1). FORA DO R1: tabela criada, sem tela.
 *
 * `mensagem_id` é a prova de que a pesquisa foi ENVIADA. `comentario` é campo
 * livre com PII e entra na anonimização.
 */
export const pesquisas_satisfacao = pgTable(
  "pesquisas_satisfacao",
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
    pedido_id: uuid("pedido_id").references(() => pedidos.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    nota: integer("nota"),
    comentario: text("comentario"),
    gatilho: text("gatilho").notNull(),
    mensagem_id: uuid("mensagem_id").references(() => conversas_mensagens.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    enviada_em: instante("enviada_em"),
    respondida_em: instante("respondida_em"),
    ...colunasAuditoria,
  },
  (t) => [
    checkLista("pesquisas_satisfacao_gatilho_lista", t.gatilho, GATILHOS_PESQUISA),
    check("pesquisas_satisfacao_nota", sql`${t.nota} between 1 and 5`),
    uniqueIndex("uq_pesquisas_satisfacao_pedido")
      .on(t.pedido_id, t.gatilho)
      .where(sql`pedido_id is not null and is_deleted = false`),
    index("ix_pesquisas_satisfacao_contato").on(t.contato_id),
    index("ix_pesquisas_satisfacao_loja").on(t.loja_id, t.is_deleted),
  ],
);
