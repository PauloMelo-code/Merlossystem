import { bigint, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { instante } from "../_compartilhado";
import { usuarios } from "./usuarios";

/**
 * `usuarios_totp` — BA `twoFactor`.
 *
 * compliance:framework — justificativa (01-dados.md §4.3, ADR 0008): remover o
 * fator é delete físico feito pela biblioteca; `fator_removido` em
 * `auth_eventos` é a prova. `backup_codes` fica sempre `'[]'` (G4): código de
 * recuperação é caminho paralelo de entrada e o desenho de segurança o proíbe.
 */
export const usuarios_totp = pgTable(
  "usuarios_totp",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    usuario_id: uuid("usuario_id")
      .notNull()
      .references(() => usuarios.id, { onDelete: "restrict", onUpdate: "restrict" }),
    /** Cifrado pelo Better Auth antes de chegar aqui. */
    secret: text("secret").notNull(),
    backup_codes: text("backup_codes").notNull().default("[]"),
    /** Anti-replay do TOTP: o passo já usado não entra de novo (no banco, G9). */
    ultimo_passo_totp: bigint("ultimo_passo_totp", { mode: "number" }),
    created_at: instante("created_at").notNull().defaultNow(),
  },
  (t) => [index("ix_usuarios_totp_usuario").on(t.usuario_id)],
);
