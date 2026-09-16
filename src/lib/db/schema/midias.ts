import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { usuarios } from "./auth/usuarios";
import { colunasAuditoria } from "./_compartilhado";
import { checkLista } from "./_enums";
import { ORIGENS_MIDIA, PASTAS_MIDIA, TIPOS_ARQUIVO_MIDIA } from "./_enums/catalogo";
import { lojas, lojas_etiquetas } from "./lojas";

/**
 * `lojas_midias` — o acervo de mídia da loja (01-dados-dominio.md §3.1).
 *
 * O `id` é gerado ANTES do upload: a `chave_objeto` depende dele
 * (`{loja}/{origem}/{uuid}.{ext}`). Sem `produto_id`: o vínculo é
 * `produtos_midias` — o antigo tinha dois vínculos concorrentes que nunca se
 * falavam. A exclusão é lógica e o binário fica; a leitura serve mídia
 * soft-deletada quando referenciada por mensagem (03/RN-M06).
 */
export const lojas_midias = pgTable(
  "lojas_midias",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loja_id: uuid("loja_id")
      .notNull()
      .references(() => lojas.id, { onDelete: "restrict", onUpdate: "restrict" }),
    nome_original: text("nome_original"),
    chave_objeto: text("chave_objeto").notNull(),
    chave_miniatura: text("chave_miniatura"),
    tipo_arquivo: text("tipo_arquivo").notNull(),
    /** Conferido contra a allowlist E contra os magic bytes, nunca só o header. */
    mime_type: text("mime_type").notNull(),
    tamanho_bytes: integer("tamanho_bytes").notNull(),
    largura: integer("largura"),
    altura: integer("altura"),
    duracao_ms: integer("duracao_ms"),
    hash_sha256: text("hash_sha256"),
    origem: text("origem").notNull(),
    pasta: text("pasta"),
    enviada_por: uuid("enviada_por").references(() => usuarios.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    ...colunasAuditoria,
  },
  (t) => [
    checkLista("lojas_midias_tipo_arquivo_lista", t.tipo_arquivo, TIPOS_ARQUIVO_MIDIA),
    checkLista("lojas_midias_origem_lista", t.origem, ORIGENS_MIDIA),
    checkLista("lojas_midias_pasta_lista", t.pasta, PASTAS_MIDIA),
    check("lojas_midias_tamanho_positivo", sql`${t.tamanho_bytes} > 0`),
    /**
     * Só upload tem pasta. É o que faz a galeria de produtos filtrar por
     * construção e a foto da cliente não cair mais lá (01/D-51).
     */
    check(
      "lojas_midias_pasta_por_origem",
      sql`(${t.origem} = 'upload' and ${t.pasta} is not null)
        or (${t.origem} <> 'upload' and ${t.pasta} is null)`,
    ),
    /** Total: a chave carrega o uuid da linha, nunca colide entre vivas e mortas. */
    uniqueIndex("uq_lojas_midias_chave").on(t.chave_objeto),
    uniqueIndex("uq_lojas_midias_hash")
      .on(t.loja_id, t.hash_sha256)
      .where(sql`hash_sha256 is not null and is_deleted = false`),
    index("ix_lojas_midias_origem").on(t.loja_id, t.origem, t.created_at.desc()),
    index("ix_lojas_midias_tipo").on(t.loja_id, t.tipo_arquivo),
    index("ix_lojas_midias_loja").on(t.loja_id, t.is_deleted),
  ],
);

/**
 * `lojas_midias_etiquetas` — ligação pura (sem trava de colisão): não há duas
 * pessoas editando o mesmo vínculo, e o único parcial resolve a corrida.
 */
export const lojas_midias_etiquetas = pgTable(
  "lojas_midias_etiquetas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loja_id: uuid("loja_id")
      .notNull()
      .references(() => lojas.id, { onDelete: "restrict", onUpdate: "restrict" }),
    midia_id: uuid("midia_id")
      .notNull()
      .references(() => lojas_midias.id, { onDelete: "restrict", onUpdate: "restrict" }),
    etiqueta_id: uuid("etiqueta_id")
      .notNull()
      .references(() => lojas_etiquetas.id, { onDelete: "restrict", onUpdate: "restrict" }),
    ...colunasAuditoria,
  },
  (t) => [
    uniqueIndex("uq_lojas_midias_etiquetas")
      .on(t.midia_id, t.etiqueta_id)
      .where(sql`is_deleted = false`),
    index("ix_lojas_midias_etiquetas_etiqueta").on(t.etiqueta_id),
    index("ix_lojas_midias_etiquetas_loja").on(t.loja_id, t.is_deleted),
  ],
);
