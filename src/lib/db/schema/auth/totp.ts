import { bigint, boolean, index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { instante } from "../_compartilhado";
import { usuarios } from "./usuarios";

/**
 * TRÊS COLUNAS FORA DE 01-dados.md §5.5 — `verificado`, `falhas_verificacao` e
 * `bloqueado_ate` são os campos `verified`, `failedVerificationCount` e
 * `lockedUntil` que o `schema` do plugin `twoFactor` INSTALADO declara. O
 * validador do adaptador Drizzle cobra coluna a coluna no boot (campo
 * `required: false` também entra no `missing-column`): sem eles, TODO
 * `/api/auth/**` cai (G27) e o `accountLockout` de 02-seguranca.md §4.2 não
 * teria onde gravar. Caminho seguido: o da "Regra de conflito" de §4.1 —
 * acrescentar coluna, nunca renomear nem criar um segundo de-para. Evidência em
 * docs/seguranca/conferencia-ba-1.7.5.md §3; ADR pendente em F9.
 */

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
    /** BA `verified`: o fator só conta depois de confirmado com um código. */
    verificado: boolean("verificado").notNull().default(true),
    /** BA `failedVerificationCount`: contador do `accountLockout` do plugin. */
    falhas_verificacao: integer("falhas_verificacao").notNull().default(0),
    /** BA `lockedUntil`: bloqueio do 2º fator, distinto do bloqueio de senha. */
    bloqueado_ate: instante("bloqueado_ate"),
    created_at: instante("created_at").notNull().defaultNow(),
  },
  (t) => [index("ix_usuarios_totp_usuario").on(t.usuario_id)],
);
