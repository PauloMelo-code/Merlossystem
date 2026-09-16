import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { colunasAuditoria, dinheiro, instante } from "../_compartilhado";
import { checkLista } from "../_enums";
import { TIPOS_GRADE } from "../_enums/catalogo";
import { lojas } from "../lojas";
import { produtos_categorias } from "./categorias";

/**
 * `produtos` — catálogo local alimentado pelo Bling, SOMENTE LEITURA
 * (01-dados-dominio.md §4, ADR 0015).
 *
 * Quem alimenta é o job `sincronizar-bling`; não existe cadastro manual e a
 * matriz de permissão só tem `produtos:ler`. `stock jsonb` não existe: não era
 * verdade de estoque e ainda assim alimentava o seletor de produto no chat,
 * contradizendo o painel de venda (03/A6). A disponibilidade NUNCA é
 * persistida — é calculada em `src/lib/catalogo/`.
 */
export const produtos = pgTable(
  "produtos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loja_id: uuid("loja_id")
      .notNull()
      .references(() => lojas.id, { onDelete: "restrict", onUpdate: "restrict" }),
    categoria_id: uuid("categoria_id").references(() => produtos_categorias.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    nome: text("nome").notNull(),
    /** = `codigo` do Bling; o único elo entre os dois catálogos. */
    sku: text("sku"),
    descricao: text("descricao"),
    tipo_grade: text("tipo_grade").notNull().default("ambos"),
    preco: dinheiro("preco").notNull(),
    preco_comparacao: dinheiro("preco_comparacao"),
    /** Exposto só a dono, admin e gerente na camada de leitura. */
    preco_custo: dinheiro("preco_custo"),
    peso_gramas: integer("peso_gramas"),
    destacado: boolean("destacado").notNull().default(false),
    bling_produto_id: text("bling_produto_id"),
    sincronizado_em: instante("sincronizado_em"),
    ...colunasAuditoria,
  },
  (t) => [
    checkLista("produtos_tipo_grade_lista", t.tipo_grade, TIPOS_GRADE),
    check("produtos_preco_positivo", sql`${t.preco} >= 0`),
    check("produtos_preco_custo_positivo", sql`${t.preco_custo} >= 0`),
    check(
      "produtos_preco_comparacao_coerente",
      sql`${t.preco_comparacao} is null or ${t.preco_comparacao} >= ${t.preco}`,
    ),
    /** O mesmo SKU pode existir nas duas lojas. */
    uniqueIndex("uq_produtos_sku")
      .on(t.loja_id, t.sku)
      .where(sql`sku is not null and is_deleted = false`),
    index("ix_produtos_categoria").on(t.loja_id, t.categoria_id),
    index("ix_produtos_destacado").on(t.loja_id, t.destacado),
    index("ix_produtos_loja").on(t.loja_id, t.is_deleted),
  ],
);
