import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { usuarios } from "../auth/usuarios";
import { colunasAuditoria, instante } from "../_compartilhado";
import { checkLista, listaSql } from "../_enums";
import { PRIORIDADES, STATUS_CONVERSA, STATUS_CONVERSA_ABERTOS } from "../_enums/conversas";
import { contatos } from "../contatos";
import { lojas } from "../lojas";
import { lojas_integracoes } from "../integracoes";

/**
 * `conversas` (01-dados-dominio.md §2.2).
 *
 * `integracao_id` é NOT NULL: a conversa responde pela conta em que entrou.
 * Sem isso o sistema respondia pelo número do `.env` (01/D-04, ADR 0016).
 * Sem coluna `canal`: o canal vem de `lojas_integracoes.provedor` por join —
 * coluna duplicada é coluna que diverge.
 */
export const conversas = pgTable(
  "conversas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loja_id: uuid("loja_id")
      .notNull()
      .references(() => lojas.id, { onDelete: "restrict", onUpdate: "restrict" }),
    contato_id: uuid("contato_id")
      .notNull()
      .references(() => contatos.id, { onDelete: "restrict", onUpdate: "restrict" }),
    integracao_id: uuid("integracao_id")
      .notNull()
      .references(() => lojas_integracoes.id, { onDelete: "restrict", onUpdate: "restrict" }),
    status: text("status").notNull().default("aberta"),
    prioridade: text("prioridade").notNull().default("media"),
    responsavel_id: uuid("responsavel_id").references(() => usuarios.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    /** contador/cache */
    ultima_mensagem_em: instante("ultima_mensagem_em"),
    /** contador/cache, 100 caracteres */
    ultima_mensagem_previa: text("ultima_mensagem_previa"),
    /**
     * contador/cache — instante da última mensagem DE ENTRADA; é a fonte da
     * janela de 24 h que a UI usa para bloquear o composer. Sem ela, descobrir
     * a última entrada exigiria varrer `conversas_mensagens` a cada render.
     */
    ultima_entrada_em: instante("ultima_entrada_em"),
    /** contador/cache */
    nao_lidas: integer("nao_lidas").notNull().default(0),
    /** contador/cache — o SLA de verdade (01/R-21) */
    primeira_resposta_em: instante("primeira_resposta_em"),
    /** contador/cache */
    sla_estourado_em: instante("sla_estourado_em"),
    resolvida_em: instante("resolvida_em"),
    resolvida_por: uuid("resolvida_por").references(() => usuarios.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    ...colunasAuditoria,
  },
  (t) => [
    checkLista("conversas_status_lista", t.status, STATUS_CONVERSA),
    checkLista("conversas_prioridade_lista", t.prioridade, PRIORIDADES),
    check("conversas_nao_lidas_positivo", sql`${t.nao_lidas} >= 0`),
    /** Uma conversa aberta por par (contato, conta de entrada). */
    uniqueIndex("uq_conversas_aberta")
      .on(t.contato_id, t.integracao_id)
      .where(
        sql.raw(
          `status in (${listaSql(STATUS_CONVERSA_ABERTOS)}) and is_deleted = false`,
        ),
      ),
    index("ix_conversas_lista").on(t.loja_id, t.status, t.ultima_mensagem_em.desc()),
    index("ix_conversas_integracao").on(t.integracao_id, t.status),
    index("ix_conversas_responsavel").on(t.responsavel_id, t.status),
    index("ix_conversas_contato").on(t.contato_id, t.created_at.desc()),
    index("ix_conversas_loja").on(t.loja_id, t.is_deleted),
  ],
);
