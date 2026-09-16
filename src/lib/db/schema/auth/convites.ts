import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { colunasAuditoria, instante } from "../_compartilhado";
import { checkLista, listaSql } from "../_enums";
import { PAPEIS_COM_LOJA, PAPEIS_CONVIDAVEIS, PAPEIS_SEM_LOJA } from "../_enums/auth";
import { lojas } from "../lojas";
import { usuarios } from "./usuarios";

/** Papéis de gestão que PODEM ser convidados: `dono` não é convidável. */
const GESTAO_CONVIDAVEL = PAPEIS_SEM_LOJA.filter((p) => p !== "dono");

/**
 * `usuarios_convites` — provisionamento por convite (01-dados.md §5.7).
 *
 * Não existe auto-cadastro: `/sign-up/email` responde 404. O convite é o único
 * caminho que cria identidade.
 */
export const usuarios_convites = pgTable(
  "usuarios_convites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    papel: text("papel").notNull(),
    loja_id: uuid("loja_id").references(() => lojas.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    /** SHA-256 de 32 bytes de CSPRNG. O token em claro só existe no link. */
    token_hash: text("token_hash").notNull(),
    expira_em: instante("expira_em").notNull(),
    usado_em: instante("usado_em"),
    usado_por_usuario_id: uuid("usado_por_usuario_id").references(() => usuarios.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    /** Nulo SÓ quando `bootstrap = true` (a semeadura não tem quem a convide). */
    criado_por: uuid("criado_por").references(() => usuarios.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    ciencia_versao: text("ciencia_versao"),
    bootstrap: boolean("bootstrap").notNull().default(false),
    motivo: text("motivo"),
    ...colunasAuditoria,
  },
  (t) => [
    /**
     * CHECK próprio, NÃO é cópia do de `usuarios`: `dono` não é convidável,
     * posse só se transfere (02-seguranca.md §9.2). A barreira é do banco —
     * um INSERT direto com papel `dono` viola o CHECK.
     */
    checkLista("usuarios_convites_papel_lista", t.papel, PAPEIS_CONVIDAVEIS),
    check(
      "usuarios_convites_papel_loja",
      sql`(${t.papel} in (${sql.raw(listaSql(GESTAO_CONVIDAVEL))}) and ${t.loja_id} is null)
        or (${t.papel} in (${sql.raw(listaSql(PAPEIS_COM_LOJA))}) and ${t.loja_id} is not null)`,
    ),
    /** Convite de admin sem ciência registrada não entra. */
    check(
      "usuarios_convites_ciencia_admin",
      sql`${t.papel} <> 'admin' or ${t.ciencia_versao} is not null`,
    ),
    check(
      "usuarios_convites_bootstrap",
      sql`${t.bootstrap} = false
        or (${t.papel} = 'admin' and ${t.loja_id} is null and ${t.criado_por} is null)`,
    ),
    uniqueIndex("uq_usuarios_convites_email_aberto")
      .on(sql`lower(${t.email})`)
      .where(sql`usado_em is null and is_deleted = false`),
    uniqueIndex("uq_usuarios_convites_token")
      .on(t.token_hash)
      .where(sql`is_deleted = false`),
    /** No máximo UM convite de semeadura vivo, em todo o sistema. */
    uniqueIndex("uq_usuarios_convites_bootstrap")
      .on(t.bootstrap)
      .where(sql`bootstrap = true and usado_em is null and is_deleted = false`),
    index("ix_usuarios_convites_loja").on(t.loja_id, t.is_deleted),
  ],
);
