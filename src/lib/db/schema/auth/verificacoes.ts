import { index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { instante } from "../_compartilhado";

/**
 * `usuarios_verificacoes` — BA `verification`.
 *
 * compliance:framework — justificativa (01-dados.md §4.3, ADR 0008): a
 * biblioteca apaga a verificação consumida por dentro, sem opção de soft
 * delete. O `identificador` é guardado com hash (`storeIdentifier: "hashed"`) e
 * o `valor` NUNCA é espelhado na trilha.
 */
export const usuarios_verificacoes = pgTable(
  "usuarios_verificacoes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identificador: text("identificador").notNull(),
    valor: text("valor").notNull(),
    expira_em: instante("expira_em").notNull(),
    created_at: instante("created_at").notNull().defaultNow(),
    updated_at: instante("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("ix_usuarios_verificacoes_identificador").on(t.identificador),
    index("ix_usuarios_verificacoes_expira").on(t.expira_em),
  ],
);
