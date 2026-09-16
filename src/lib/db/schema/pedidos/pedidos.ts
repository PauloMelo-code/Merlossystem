import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { usuarios } from "../auth/usuarios";
import { colunasAuditoria, dinheiro, instante } from "../_compartilhado";
import { checkLista, listaSql } from "../_enums";
import {
  FORMAS_PAGAMENTO,
  MASC_STATUS,
  STATUS_PAGAMENTO_PEDIDO,
  STATUS_PEDIDO,
  STATUS_PEDIDO_SEM_RESERVA,
} from "../_enums/pedidos";
import { contatos, type Endereco } from "../contatos";
import { conversas } from "../conversas/conversas";
import { lojas } from "../lojas";
import { negocios } from "../negocios";

/**
 * `pedidos` (01-dados-dominio.md §6.3).
 *
 * `numero` no formato `MS{AAMM}-{SIGLA}-{NNNN}`, com a sigla CADASTRADA em
 * `lojas.sigla`. Voltar o Masc para `pendente` PRESERVA `masc_venda_id`,
 * `masc_lancado_em` e `masc_lancado_por` (06/INV-96).
 */
export const pedidos = pgTable(
  "pedidos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loja_id: uuid("loja_id")
      .notNull()
      .references(() => lojas.id, { onDelete: "restrict", onUpdate: "restrict" }),
    contato_id: uuid("contato_id")
      .notNull()
      .references(() => contatos.id, { onDelete: "restrict", onUpdate: "restrict" }),
    negocio_id: uuid("negocio_id").references(() => negocios.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    conversa_id: uuid("conversa_id").references(() => conversas.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    numero: text("numero").notNull(),
    status: text("status").notNull().default("confirmado"),
    pagamento_status: text("pagamento_status").notNull().default("pendente"),
    subtotal: dinheiro("subtotal").notNull().default("0"),
    frete: dinheiro("frete").notNull().default("0"),
    desconto: dinheiro("desconto").notNull().default("0"),
    total: dinheiro("total").notNull().default("0"),
    forma_pagamento: text("forma_pagamento"),
    entrega_metodo: text("entrega_metodo"),
    rastreio_codigo: text("rastreio_codigo"),
    rastreio_url: text("rastreio_url"),
    endereco_entrega: jsonb("endereco_entrega").$type<Endereco>(),
    observacoes: text("observacoes"),
    masc_status: text("masc_status").notNull().default("pendente"),
    masc_venda_id: text("masc_venda_id"),
    masc_lancado_em: instante("masc_lancado_em"),
    masc_lancado_por: uuid("masc_lancado_por").references(() => usuarios.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    masc_observacao: text("masc_observacao"),
    cancelado_em: instante("cancelado_em"),
    cancelado_motivo: text("cancelado_motivo"),
    criado_por: uuid("criado_por")
      .notNull()
      .references(() => usuarios.id, { onDelete: "restrict", onUpdate: "restrict" }),
    ...colunasAuditoria,
  },
  (t) => [
    checkLista("pedidos_status_lista", t.status, STATUS_PEDIDO),
    checkLista("pedidos_pagamento_status_lista", t.pagamento_status, STATUS_PAGAMENTO_PEDIDO),
    checkLista("pedidos_forma_pagamento_lista", t.forma_pagamento, FORMAS_PAGAMENTO),
    checkLista("pedidos_masc_status_lista", t.masc_status, MASC_STATUS),
    check("pedidos_subtotal_positivo", sql`${t.subtotal} >= 0`),
    check("pedidos_frete_positivo", sql`${t.frete} >= 0`),
    check("pedidos_desconto_positivo", sql`${t.desconto} >= 0`),
    check("pedidos_total_positivo", sql`${t.total} >= 0`),
    check(
      "pedidos_total_coerente",
      sql`${t.total} = ${t.subtotal} + ${t.frete} - ${t.desconto}`,
    ),
    check("pedidos_desconto_ate_subtotal", sql`${t.desconto} <= ${t.subtotal}`),
    check("pedidos_rastreio_url", sql`${t.rastreio_url} ~ '^https://'`),
    check(
      "pedidos_masc_lancado",
      sql`${t.masc_status} <> 'lancado'
        or (${t.masc_venda_id} is not null and ${t.masc_lancado_em} is not null)`,
    ),
    check(
      "pedidos_masc_dispensado",
      sql`${t.masc_status} <> 'dispensado' or ${t.masc_observacao} is not null`,
    ),
    uniqueIndex("uq_pedidos_numero")
      .on(t.loja_id, t.numero)
      .where(sql`is_deleted = false`),
    /** Um `masc_venda_id` por loja: o antigo repetia o mesmo em dois pedidos (02/O-02). */
    uniqueIndex("uq_pedidos_masc_venda")
      .on(t.loja_id, t.masc_venda_id)
      .where(sql`masc_venda_id is not null and is_deleted = false`),
    /**
     * Fila do "falta lançar". O filtro de `status` é o que impede pedido
     * cancelado de continuar reservando estoque e poluindo a fila (02/O-06), e
     * é o mesmo filtro da fórmula do reservado.
     */
    index("ix_pedidos_fila_masc")
      .on(t.loja_id, t.masc_status)
      .where(
        sql.raw(
          `masc_status = 'pendente' and status not in (${listaSql(STATUS_PEDIDO_SEM_RESERVA)})`,
        ),
      ),
    index("ix_pedidos_lista").on(t.loja_id, t.created_at.desc()),
    index("ix_pedidos_contato").on(t.contato_id),
    index("ix_pedidos_negocio").on(t.negocio_id),
    index("ix_pedidos_loja").on(t.loja_id, t.is_deleted),
  ],
);
