import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { usuarios } from "./auth/usuarios";
import { colunasAuditoria, dinheiro, instante } from "./_compartilhado";
import { checkLista, listaSql } from "./_enums";
import {
  METODOS_ESTORNO,
  MOTIVOS_DEVOLUCAO,
  STATUS_DEVOLUCAO,
  STATUS_DEVOLUCAO_RESOLVIDOS,
  TIPOS_DEVOLUCAO,
} from "./_enums/pedidos";
import { contatos } from "./contatos";
import { conversas } from "./conversas/conversas";
import { lojas } from "./lojas";
import { lojas_midias } from "./midias";
import { pagamentos } from "./pedidos/pagamentos";
import { pedidos } from "./pedidos/pedidos";
import { pedidos_itens } from "./pedidos/itens";

/**
 * `pedidos_devolucoes` (01-dados-dominio.md §6.6). COM trava de colisão.
 * FORA DO R1: tabelas criadas, sem tela.
 *
 * `valor_estorno <= pedidos.total` é regra de APLICAÇÃO com teste — CHECK não
 * cruza tabela (corrige 02/T-01). As quatro consequências da devolução
 * concluída (status do pedido, saída da reserva, contadores do contato, alerta
 * de estorno no Masc) rodam na mesma transação.
 */
export const pedidos_devolucoes = pgTable(
  "pedidos_devolucoes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loja_id: uuid("loja_id")
      .notNull()
      .references(() => lojas.id, { onDelete: "restrict", onUpdate: "restrict" }),
    pedido_id: uuid("pedido_id")
      .notNull()
      .references(() => pedidos.id, { onDelete: "restrict", onUpdate: "restrict" }),
    contato_id: uuid("contato_id")
      .notNull()
      .references(() => contatos.id, { onDelete: "restrict", onUpdate: "restrict" }),
    conversa_id: uuid("conversa_id").references(() => conversas.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    tipo: text("tipo").notNull(),
    motivo: text("motivo").notNull(),
    motivo_detalhe: text("motivo_detalhe"),
    status: text("status").notNull().default("solicitada"),
    rastreio_codigo: text("rastreio_codigo"),
    valor_estorno: dinheiro("valor_estorno"),
    metodo_estorno: text("metodo_estorno"),
    pagamento_id: uuid("pagamento_id").references(() => pagamentos.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    resolvido_por: uuid("resolvido_por").references(() => usuarios.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    resolvido_em: instante("resolvido_em"),
    ...colunasAuditoria,
  },
  (t) => [
    checkLista("pedidos_devolucoes_tipo_lista", t.tipo, TIPOS_DEVOLUCAO),
    checkLista("pedidos_devolucoes_motivo_lista", t.motivo, MOTIVOS_DEVOLUCAO),
    checkLista("pedidos_devolucoes_status_lista", t.status, STATUS_DEVOLUCAO),
    checkLista("pedidos_devolucoes_metodo_lista", t.metodo_estorno, METODOS_ESTORNO),
    check("pedidos_devolucoes_estorno_positivo", sql`${t.valor_estorno} >= 0`),
    check(
      "pedidos_devolucoes_resolucao",
      sql`${t.status} not in (${sql.raw(listaSql(STATUS_DEVOLUCAO_RESOLVIDOS))})
        or (${t.resolvido_por} is not null and ${t.resolvido_em} is not null)`,
    ),
    index("ix_pedidos_devolucoes_pedido").on(t.pedido_id),
    index("ix_pedidos_devolucoes_status").on(t.loja_id, t.status),
    index("ix_pedidos_devolucoes_loja").on(t.loja_id, t.is_deleted),
  ],
);

/** Ligação pura. Regra de aplicação: a soma por item não passa da quantidade do pedido. */
export const pedidos_devolucoes_itens = pgTable(
  "pedidos_devolucoes_itens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loja_id: uuid("loja_id")
      .notNull()
      .references(() => lojas.id, { onDelete: "restrict", onUpdate: "restrict" }),
    devolucao_id: uuid("devolucao_id")
      .notNull()
      .references(() => pedidos_devolucoes.id, { onDelete: "restrict", onUpdate: "restrict" }),
    pedido_item_id: uuid("pedido_item_id")
      .notNull()
      .references(() => pedidos_itens.id, { onDelete: "restrict", onUpdate: "restrict" }),
    quantidade: integer("quantidade").notNull(),
    ...colunasAuditoria,
  },
  (t) => [
    check("pedidos_devolucoes_itens_quantidade", sql`${t.quantidade} > 0`),
    uniqueIndex("uq_pedidos_devolucoes_itens")
      .on(t.devolucao_id, t.pedido_item_id)
      .where(sql`is_deleted = false`),
    index("ix_pedidos_devolucoes_itens_loja").on(t.loja_id, t.is_deleted),
  ],
);

/** Ligação pura — as fotos do defeito. */
export const pedidos_devolucoes_midias = pgTable(
  "pedidos_devolucoes_midias",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loja_id: uuid("loja_id")
      .notNull()
      .references(() => lojas.id, { onDelete: "restrict", onUpdate: "restrict" }),
    devolucao_id: uuid("devolucao_id")
      .notNull()
      .references(() => pedidos_devolucoes.id, { onDelete: "restrict", onUpdate: "restrict" }),
    midia_id: uuid("midia_id")
      .notNull()
      .references(() => lojas_midias.id, { onDelete: "restrict", onUpdate: "restrict" }),
    ...colunasAuditoria,
  },
  (t) => [
    uniqueIndex("uq_pedidos_devolucoes_midias")
      .on(t.devolucao_id, t.midia_id)
      .where(sql`is_deleted = false`),
    index("ix_pedidos_devolucoes_midias_loja").on(t.loja_id, t.is_deleted),
  ],
);
