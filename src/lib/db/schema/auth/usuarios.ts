import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { colunasAuditoria, instante } from "../_compartilhado";
import { checkLista, listaSql } from "../_enums";
import { PAPEIS, PAPEIS_COM_LOJA, PAPEIS_SEM_LOJA } from "../_enums/auth";
import { lojas } from "../lojas";

/**
 * `usuarios` — BA `user` (01-dados.md §5.1).
 *
 * Tem as 5 colunas de auditoria e NUNCA é apagado: `/delete-user` desligado,
 * plugin `admin` não registrado, desativar é `ativo = false` mais revogação de
 * sessões (06/INV-33).
 *
 * `email_pendente` não existe: "troca de e-mail em andamento" é a existência de
 * linha viva em `usuarios_trocas_email`. Duas fontes divergem no primeiro erro
 * de fluxo.
 */
export const usuarios = pgTable(
  "usuarios",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nome: text("nome").notNull(),
    /** Normalizado `trim().toLowerCase()` na escrita. */
    email: text("email").notNull(),
    email_verificado: boolean("email_verificado").notNull().default(false),
    avatar_url: text("avatar_url"),
    papel: text("papel").notNull().default("viewer"),
    loja_id: uuid("loja_id").references(() => lojas.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    /** Nasce inativo; só vira `true` com o 2º fator configurado (07/REQ-D1). */
    ativo: boolean("ativo").notNull().default(false),
    precisa_trocar_senha: boolean("precisa_trocar_senha").notNull().default(false),
    precisa_configurar_fator: boolean("precisa_configurar_fator").notNull().default(true),
    two_factor_enabled: boolean("two_factor_enabled").notNull().default(false),
    falhas_login: integer("falhas_login").notNull().default(0),
    ultima_falha_em: instante("ultima_falha_em"),
    bloqueado_ate: instante("bloqueado_ate"),
    ultimo_login_em: instante("ultimo_login_em"),
    /** LGPD de colaborador. */
    anonimizado_em: instante("anonimizado_em"),
    ...colunasAuditoria,
  },
  (t) => [
    checkLista("usuarios_papel_lista", t.papel, PAPEIS),
    /** Gestão não tem loja; operação tem (06/INV-14). A barreira é do banco. */
    check(
      "usuarios_papel_loja",
      sql`(${t.papel} in (${sql.raw(listaSql(PAPEIS_SEM_LOJA))}) and ${t.loja_id} is null)
        or (${t.papel} in (${sql.raw(listaSql(PAPEIS_COM_LOJA))}) and ${t.loja_id} is not null)`,
    ),
    check("usuarios_bloqueio_coerente", sql`${t.falhas_login} >= 0`),
    /**
     * Único TOTAL, sem `WHERE is_deleted = false`: exceção escrita à regra 5 de
     * §1. `usuarios` nunca é soft-deletado e o Better Auth busca `user` por
     * e-mail SEM filtrar `is_deleted` — um único parcial deixaria duas linhas
     * com o mesmo e-mail e o `findOne` resolveria para a errada.
     */
    uniqueIndex("uq_usuarios_email").on(sql`lower(${t.email})`),
    index("ix_usuarios_loja_papel").on(t.loja_id, t.papel),
    index("ix_usuarios_ativo").on(t.ativo),
  ],
);
