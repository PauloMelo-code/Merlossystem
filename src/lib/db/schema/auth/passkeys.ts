import { boolean, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { instante } from "../_compartilhado";
import { usuarios } from "./usuarios";

/**
 * `usuarios_passkeys` — plugin `passkey`.
 *
 * compliance:framework — justificativa (01-dados.md §4.3, ADR 0008): remover a
 * passkey é delete físico feito pela biblioteca, sem opção de soft delete.
 * `passkey_removida` em `auth_eventos` guarda o ciclo de vida. `credential_id`
 * é texto porque o valor é do autenticador, não nosso.
 */
export const usuarios_passkeys = pgTable(
  "usuarios_passkeys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    usuario_id: uuid("usuario_id")
      .notNull()
      .references(() => usuarios.id, { onDelete: "restrict", onUpdate: "restrict" }),
    nome: text("nome"),
    chave_publica: text("chave_publica").notNull(),
    credential_id: text("credential_id").notNull(),
    contador: integer("contador").notNull().default(0),
    tipo_dispositivo: text("tipo_dispositivo"),
    backed_up: boolean("backed_up"),
    transportes: text("transportes"),
    aaguid: text("aaguid"),
    created_at: instante("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_usuarios_passkeys_credencial").on(t.credential_id),
    index("ix_usuarios_passkeys_usuario").on(t.usuario_id),
  ],
);
