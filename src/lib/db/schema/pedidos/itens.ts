import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { colunasAuditoria, dinheiro } from "../_compartilhado";
import { produtos } from "../catalogo/produtos";
import { produtos_variacoes } from "../catalogo/variacoes";
import { lojas } from "../lojas";
import { pedidos } from "./pedidos";

/**
 * `pedidos_itens` (01-dados-dominio.md §6.4).
 *
 * `orders.items` era JSON livre e o preço vinha do cliente (02/O-01). Aqui o
 * preço e o nome vêm do catálogo NO SERVIDOR, e o snapshot (`sku`, `nome`,
 * `preco_unitario`) serve para o histórico não mudar quando o preço mudar.
 * FK para `produtos` é RESTRICT: produto de pedido não some.
 */
export const pedidos_itens = pgTable(
  "pedidos_itens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loja_id: uuid("loja_id")
      .notNull()
      .references(() => lojas.id, { onDelete: "restrict", onUpdate: "restrict" }),
    pedido_id: uuid("pedido_id")
      .notNull()
      .references(() => pedidos.id, { onDelete: "restrict", onUpdate: "restrict" }),
    produto_id: uuid("produto_id")
      .notNull()
      .references(() => produtos.id, { onDelete: "restrict", onUpdate: "restrict" }),
    variacao_id: uuid("variacao_id").references(() => produtos_variacoes.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    sku: text("sku"),
    nome: text("nome").notNull(),
    tamanho: text("tamanho").notNull(),
    quantidade: integer("quantidade").notNull(),
    preco_unitario: dinheiro("preco_unitario").notNull(),
    total_item: dinheiro("total_item").notNull(),
    ...colunasAuditoria,
  },
  (t) => [
    check("pedidos_itens_quantidade", sql`${t.quantidade} > 0`),
    check("pedidos_itens_preco_positivo", sql`${t.preco_unitario} >= 0`),
    check("pedidos_itens_total_positivo", sql`${t.total_item} >= 0`),
    check(
      "pedidos_itens_total_coerente",
      sql`${t.total_item} = ${t.preco_unitario} * ${t.quantidade}`,
    ),
    index("ix_pedidos_itens_pedido").on(t.pedido_id),
    index("ix_pedidos_itens_produto").on(t.produto_id),
    index("ix_pedidos_itens_variacao").on(t.variacao_id),
    index("ix_pedidos_itens_loja").on(t.loja_id, t.is_deleted),
  ],
);
