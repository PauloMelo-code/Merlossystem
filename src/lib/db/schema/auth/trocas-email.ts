import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { colunasAuditoria, instante } from "../_compartilhado";
import { usuarios } from "./usuarios";

/**
 * `usuarios_trocas_email` — troca de e-mail em duas mãos (01-dados.md §5.9).
 *
 * Só admin inicia; o próprio usuário confirma (07/REQ-E12). É esta tabela que
 * responde "existe troca em andamento?" — `usuarios.email_pendente` não existe.
 */
export const usuarios_trocas_email = pgTable(
  "usuarios_trocas_email",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    usuario_id: uuid("usuario_id")
      .notNull()
      .references(() => usuarios.id, { onDelete: "restrict", onUpdate: "restrict" }),
    email_novo: text("email_novo").notNull(),
    codigo_hash: text("codigo_hash").notNull(),
    expira_em: instante("expira_em").notNull(),
    tentativas: integer("tentativas").notNull().default(0),
    confirmado_em: instante("confirmado_em"),
    cancelado_em: instante("cancelado_em"),
    cancelado_motivo: text("cancelado_motivo"),
    solicitado_por: uuid("solicitado_por")
      .notNull()
      .references(() => usuarios.id, { onDelete: "restrict", onUpdate: "restrict" }),
    motivo: text("motivo").notNull(),
    ...colunasAuditoria,
  },
  (t) => [
    /** Uma troca aberta por usuário. */
    uniqueIndex("uq_usuarios_trocas_email_aberta")
      .on(t.usuario_id)
      .where(sql`confirmado_em is null and cancelado_em is null and is_deleted = false`),
    index("ix_usuarios_trocas_email_usuario").on(t.usuario_id, t.created_at.desc()),
  ],
);
