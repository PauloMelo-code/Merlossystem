import { index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { colunasAuditoria, instante } from "../_compartilhado";
import { usuarios } from "./usuarios";

/**
 * `usuarios_contas` — BA `account` (01-dados.md §5.2).
 *
 * `provedor_id` é sempre `'credential'`: `accountLinking.enabled: false` e não
 * há login social. As colunas de token são exigidas pelo schema do Better Auth
 * mesmo assim, e ficam nulas.
 *
 * Tem as 5 colunas de auditoria e nunca é apagada, como `usuarios`.
 */
export const usuarios_contas = pgTable(
  "usuarios_contas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    usuario_id: uuid("usuario_id")
      .notNull()
      .references(() => usuarios.id, { onDelete: "restrict", onUpdate: "restrict" }),
    conta_id: text("conta_id").notNull(),
    provedor_id: text("provedor_id").notNull(),
    /** Argon2id. Nunca sai deste banco para log, DTO ou trilha. */
    senha_hash: text("senha_hash"),
    access_token: text("access_token"),
    refresh_token: text("refresh_token"),
    id_token: text("id_token"),
    access_token_expira_em: instante("access_token_expira_em"),
    refresh_token_expira_em: instante("refresh_token_expira_em"),
    escopo: text("escopo"),
    ...colunasAuditoria,
  },
  (t) => [
    /** TOTAL, pelo mesmo motivo de `usuarios`: a linha nunca é soft-deletada. */
    uniqueIndex("uq_usuarios_contas_provedor").on(t.provedor_id, t.conta_id),
    index("ix_usuarios_contas_usuario").on(t.usuario_id),
  ],
);
