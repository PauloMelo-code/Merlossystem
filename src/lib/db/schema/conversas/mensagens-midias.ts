import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { colunasAuditoria } from "../_compartilhado";
import { checkLista } from "../_enums";
import { STATUS_TRANSCRICAO, TIPOS_ARQUIVO_MENSAGEM } from "../_enums/conversas";
import { lojas } from "../lojas";
import { lojas_midias } from "../midias";
import { conversas_mensagens } from "./mensagens";

/**
 * `conversas_mensagens_midias` — ligação pura (01-dados-dominio.md §2.4).
 *
 * `url_externa` é COLUNA DE TRABALHO do job `baixar-de-url`, não endereço de
 * leitura: o job preenche `midia_id`, marca `baixada = true` e LIMPA
 * `url_externa` no mesmo UPDATE. A URL do provedor é pública e contornaria o
 * portão de mídia; se o download falhar, a UI mostra "mídia indisponível" —
 * nunca o link. `url_externa` em DTO reprova na trava.
 * A leitura é sempre `GET /api/midias/[id]` (`?miniatura=1`).
 */
export const conversas_mensagens_midias = pgTable(
  "conversas_mensagens_midias",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loja_id: uuid("loja_id")
      .notNull()
      .references(() => lojas.id, { onDelete: "restrict", onUpdate: "restrict" }),
    mensagem_id: uuid("mensagem_id")
      .notNull()
      .references(() => conversas_mensagens.id, { onDelete: "restrict", onUpdate: "restrict" }),
    midia_id: uuid("midia_id").references(() => lojas_midias.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    url_externa: text("url_externa"),
    externo_id: text("externo_id"),
    tipo_arquivo: text("tipo_arquivo").notNull(),
    mime_type: text("mime_type").notNull(),
    tamanho_bytes: integer("tamanho_bytes"),
    legenda: text("legenda"),
    /** Posição na mensagem (0..N-1). Envio e bolha leem `ORDER BY ordem, id` (ADR 0059). */
    ordem: integer("ordem").notNull().default(0),
    baixada: boolean("baixada").notNull().default(false),
    transcricao: text("transcricao"),
    transcricao_status: text("transcricao_status"),
    ...colunasAuditoria,
  },
  (t) => [
    checkLista(
      "conversas_mensagens_midias_tipo_lista",
      t.tipo_arquivo,
      TIPOS_ARQUIVO_MENSAGEM,
    ),
    checkLista(
      "conversas_mensagens_midias_transcricao_lista",
      t.transcricao_status,
      STATUS_TRANSCRICAO,
    ),
    check(
      "conversas_mensagens_midias_origem",
      sql`${t.midia_id} is not null or ${t.url_externa} is not null`,
    ),
    /** O antigo gravava a base64 inteira quando o upload falhava (01/D-33). */
    check("conversas_mensagens_midias_url", sql`${t.url_externa} ~ '^https?://'`),
    check("conversas_mensagens_midias_ordem_positiva", sql`${t.ordem} >= 0`),
    index("ix_conversas_mensagens_midias_mensagem").on(t.mensagem_id),
    /** Pedido e processamento: a varredura de órfã lê os dois estados (R2, ADR 0049). */
    index("ix_conversas_mensagens_midias_transcricao")
      .on(t.transcricao_status)
      .where(sql`transcricao_status in ('pendente', 'processando')`),
    index("ix_conversas_mensagens_midias_loja").on(t.loja_id, t.is_deleted),
  ],
);
