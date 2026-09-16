import { index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { instante } from "../_compartilhado";
import { usuarios } from "./usuarios";

/**
 * `usuarios_senhas_historico` — as senhas antigas, para a política de reuso.
 *
 * compliance:append-only — justificativa (01-dados.md §5.8): um histórico que
 * pode ser alterado ou "soft deletado" não prova nada. Só `criado_em`, nenhuma
 * outra coluna de auditoria, e `REVOKE UPDATE, DELETE, TRUNCATE` do papel da
 * aplicação na migração 0004.
 *
 * A tabela NÃO é podada: podar exigiria `DELETE`, que é proibido. Uma linha de
 * ~100 bytes por troca de senha é crescimento aceitável e escrito. A política
 * compara contra as 5 mais recentes (`ORDER BY criado_em DESC LIMIT 5`), com
 * leitura fail-closed.
 */
export const usuarios_senhas_historico = pgTable(
  "usuarios_senhas_historico",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    usuario_id: uuid("usuario_id")
      .notNull()
      .references(() => usuarios.id, { onDelete: "restrict", onUpdate: "restrict" }),
    senha_hash: text("senha_hash").notNull(),
    criado_em: instante("criado_em").notNull().defaultNow(),
  },
  (t) => [index("ix_usuarios_senhas_historico_usuario").on(t.usuario_id, t.criado_em.desc())],
);
