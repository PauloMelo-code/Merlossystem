import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { instante } from "./_compartilhado";
import { checkLista } from "./_enums";
import { ATOR_TIPOS } from "./_enums/auth";
import { ACOES_AUDITADAS } from "./_enums/auditoria";

/** Só os campos que mudaram. Campo de `CAMPOS_PII` grava `"(alterado)"`. */
export type DiffAuditado = Record<string, string | number | boolean | null>;

export type DetalhesAuditoria = {
  motivo?: string;
  protocolo?: string;
  quantidade?: number;
  origem?: string;
};

/**
 * `auditoria_eventos` — trilha única de negócio. Substitui `activity_logs`,
 * `deal_events` e `order_events`.
 *
 * compliance:append-only — justificativa (01-dados.md §7.2 e §7.3): é a linha
 * do tempo do pedido, do negócio e da conversa, e a prova do que cada pessoa
 * fez. Só `criado_em`; `REVOKE UPDATE, DELETE, TRUNCATE` do papel da aplicação
 * e gatilho `trilha_imutavel()` na migração 0004.
 *
 * SEM FK NENHUMA (ADR 0012), pelo mesmo motivo de `auth_eventos`.
 *
 * `antes`/`depois` NÃO guardam PII: para campo da lista `CAMPOS_PII` o diff
 * grava só o nome do campo (`{ "telefone": "(alterado)" }`). Valor a valor só
 * para campo não-PII (status, preço, papel, etapa).
 */
// compliance:append-only — trilha de negócio: só `criado_em`, mais REVOKE e
// gatilho `trilha_imutavel()` na migração 0004. Log que aceita UPDATE ou
// soft delete não é trilha.
export const auditoria_eventos = pgTable(
  "auditoria_eventos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    criado_em: instante("criado_em").notNull().defaultNow(),
    ator_tipo: text("ator_tipo").notNull(),
    ator_id: uuid("ator_id"),
    /** Nulo = ação de rede (fora de loja). */
    loja_id: uuid("loja_id"),
    acao: text("acao").notNull(),
    entidade: text("entidade").notNull(),
    entidade_id: text("entidade_id"),
    antes: jsonb("antes").$type<DiffAuditado>(),
    depois: jsonb("depois").$type<DiffAuditado>(),
    motivo: text("motivo"),
    ip: text("ip"),
    agente: text("agente"),
    detalhes: jsonb("detalhes").$type<DetalhesAuditoria>().notNull().default({}),
  },
  (t) => [
    checkLista("auditoria_eventos_ator_tipo_lista", t.ator_tipo, ATOR_TIPOS),
    checkLista("auditoria_eventos_acao_lista", t.acao, ACOES_AUDITADAS),
    /** Ator humano sempre identificado; só sistema e integração podem ser anônimos. */
    check(
      "auditoria_eventos_ator_coerente",
      sql`${t.ator_tipo} <> 'usuario' or ${t.ator_id} is not null`,
    ),
    /** Desenha a linha do tempo do pedido e do negócio. */
    index("ix_auditoria_eventos_entidade").on(t.entidade, t.entidade_id, t.criado_em.desc()),
    index("ix_auditoria_eventos_loja").on(t.loja_id, t.criado_em.desc()),
    index("ix_auditoria_eventos_ator").on(t.ator_id, t.criado_em.desc()),
    index("ix_auditoria_eventos_acao").on(t.acao, t.criado_em.desc()),
  ],
);
