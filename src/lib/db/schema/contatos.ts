import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { colunasAuditoria, dataPura, dinheiro, instante } from "./_compartilhado";
import { checkLista } from "./_enums";
import { TIPOS_GRADE } from "./_enums/catalogo";
import { ORIGENS_ETIQUETA } from "./_enums/conversas";
import { lojas, lojas_etiquetas } from "./lojas";

/** Endereço tipado (01-dados.md §10). Vale para `contatos` e para `pedidos`. */
export type Endereco = {
  cep: string;
  logradouro: string;
  numero: string;
  complemento?: string;
  bairro: string;
  cidade: string;
  uf: string;
};

/**
 * `contatos` — a carteira, isolada POR LOJA (01-dados-dominio.md §2.1, DN-05).
 *
 * A mesma pessoa nas duas lojas são dois contatos. O telefone é E.164 só
 * dígitos (`5551999990000`).
 */
export const contatos = pgTable(
  "contatos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loja_id: uuid("loja_id")
      .notNull()
      .references(() => lojas.id, { onDelete: "restrict", onUpdate: "restrict" }),
    nome: text("nome"),
    telefone: text("telefone"),
    email: text("email"),
    /** Id do remetente em cada canal. */
    whatsapp_id: text("whatsapp_id"),
    instagram_id: text("instagram_id"),
    facebook_id: text("facebook_id"),
    tiktok_id: text("tiktok_id"),
    avatar_url: text("avatar_url"),
    tamanho_preferido: text("tamanho_preferido"),
    observacoes: text("observacoes"),
    aniversario: dataPura("aniversario"),
    endereco: jsonb("endereco").$type<Endereco>(),
    /** contador/cache */
    ultimo_contato_em: instante("ultimo_contato_em"),
    /** contador/cache — o filtro "dias desde a compra" usava `last_contact_at` (02/C-04). */
    ultima_compra_em: instante("ultima_compra_em"),
    /** Espelho da última linha de `consentimentos`; só `registrarConsentimento()` escreve. */
    opt_out: boolean("opt_out").notNull().default(false),
    opt_out_em: instante("opt_out_em"),
    /** contador/cache */
    pedidos_contagem: integer("pedidos_contagem").notNull().default(0),
    /** contador/cache */
    pedidos_valor_total: dinheiro("pedidos_valor_total").notNull().default("0"),
    anonimizado_em: instante("anonimizado_em"),
    ...colunasAuditoria,
  },
  (t) => [
    checkLista("contatos_tamanho_preferido_lista", t.tamanho_preferido, TIPOS_GRADE),
    check("contatos_telefone_e164", sql`${t.telefone} ~ '^[1-9][0-9]{9,14}$'`),
    check(
      "contatos_email_formato",
      sql`${t.email} ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'`,
    ),
    check(
      "contatos_opt_out_coerente",
      sql`${t.opt_out} = false or ${t.opt_out_em} is not null`,
    ),
    uniqueIndex("uq_contatos_telefone")
      .on(t.loja_id, t.telefone)
      .where(sql`telefone is not null and is_deleted = false`),
    uniqueIndex("uq_contatos_whatsapp")
      .on(t.loja_id, t.whatsapp_id)
      .where(sql`whatsapp_id is not null and is_deleted = false`),
    uniqueIndex("uq_contatos_instagram")
      .on(t.loja_id, t.instagram_id)
      .where(sql`instagram_id is not null and is_deleted = false`),
    uniqueIndex("uq_contatos_facebook")
      .on(t.loja_id, t.facebook_id)
      .where(sql`facebook_id is not null and is_deleted = false`),
    uniqueIndex("uq_contatos_tiktok")
      .on(t.loja_id, t.tiktok_id)
      .where(sql`tiktok_id is not null and is_deleted = false`),
    index("ix_contatos_ultimo_contato").on(t.loja_id, t.ultimo_contato_em.desc()),
    index("ix_contatos_opt_out").on(t.loja_id, t.opt_out),
    index("ix_contatos_loja").on(t.loja_id, t.is_deleted),
  ],
);

/** `contatos_etiquetas` — ligação pura, sem trava de colisão. */
export const contatos_etiquetas = pgTable(
  "contatos_etiquetas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loja_id: uuid("loja_id")
      .notNull()
      .references(() => lojas.id, { onDelete: "restrict", onUpdate: "restrict" }),
    contato_id: uuid("contato_id")
      .notNull()
      .references(() => contatos.id, { onDelete: "restrict", onUpdate: "restrict" }),
    etiqueta_id: uuid("etiqueta_id")
      .notNull()
      .references(() => lojas_etiquetas.id, { onDelete: "restrict", onUpdate: "restrict" }),
    origem: text("origem").notNull().default("manual"),
    ...colunasAuditoria,
  },
  (t) => [
    checkLista("contatos_etiquetas_origem_lista", t.origem, ORIGENS_ETIQUETA),
    uniqueIndex("uq_contatos_etiquetas")
      .on(t.contato_id, t.etiqueta_id)
      .where(sql`is_deleted = false`),
    /** Segmentação de campanha entra por aqui. */
    index("ix_contatos_etiquetas_etiqueta").on(t.etiqueta_id),
    index("ix_contatos_etiquetas_loja").on(t.loja_id, t.is_deleted),
  ],
);
