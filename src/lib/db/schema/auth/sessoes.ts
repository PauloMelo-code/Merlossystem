import { index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { instante } from "../_compartilhado";
import { usuarios } from "./usuarios";

/**
 * `usuarios_sessoes` — BA `session`.
 *
 * compliance:framework — justificativa (01-dados.md §4.3, ADR 0008): o Better
 * Auth apaga a sessão FISICAMENTE por dentro e não tem opção de soft delete.
 * Gravar `is_deleted = false` numa linha que a biblioteca vai apagar é mentira
 * no banco. A prova do ciclo de vida fica em `auth_eventos`, escrita ANTES do
 * delete (`databaseHooks.session.delete.before`, armadilha G25).
 */
export const usuarios_sessoes = pgTable(
  "usuarios_sessoes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Valor gerado pela biblioteca: texto, não uuid. */
    token: text("token").notNull(),
    usuario_id: uuid("usuario_id")
      .notNull()
      .references(() => usuarios.id, { onDelete: "restrict", onUpdate: "restrict" }),
    expira_em: instante("expira_em").notNull(),
    ip: text("ip"),
    agente: text("agente"),
    /** Inatividade de 60 min. */
    ultimo_uso_em: instante("ultimo_uso_em"),
    /** Frescor: `exigirSessaoFresca()` compara com `freshAge` (900 s). */
    reautenticada_em: instante("reautenticada_em"),
    created_at: instante("created_at").notNull().defaultNow(),
    updated_at: instante("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_usuarios_sessoes_token").on(t.token),
    index("ix_usuarios_sessoes_usuario").on(t.usuario_id),
    index("ix_usuarios_sessoes_expira").on(t.expira_em),
  ],
);
