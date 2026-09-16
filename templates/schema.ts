// TEMPLATE — copie para `src/lib/db/schema/<dominio>/<tabela>.ts` e ajuste.
// Depois: acrescente a linha de reexport em `src/lib/db/schema/index.ts`
// (ordem alfabetica, o comentario "nao reordenar" e literal), rode
// `npm run db:generate`, LEIA o SQL gerado e so entao `npm run db:migrate`.
//
// O auditor (`npm run compliance`) reconhece este formato. Fora dele, reprova:
//   - `pgTable("nome", { objeto literal }, (t) => [array])`;
//   - as quatro colunas de auditoria espalhadas como `...colunasAuditoria`,
//     SEM alias;
//   - FK com `onDelete: "restrict"` e `onUpdate: "restrict"`.

import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { colunasAuditoria, dinheiro, instante } from "../_compartilhado";
import { checkLista } from "../_enums";
import { lojas } from "../lojas";

/**
 * `<tabela>` — uma frase dizendo o que esta linha representa no negocio.
 *
 * Nome HIERARQUICO: a tabela filha comeca com o nome do pai
 * (`contratos_lancamentos`, nunca `lancamentos`).
 *
 * Se for trilha append-only, o marcador `compliance:append-only` vem aqui, com
 * a justificativa escrita ao lado E o `REVOKE` mais o gatilho na migracao. Se
 * for tabela administrada por dentro pela biblioteca de autenticacao, o
 * marcador e `compliance:framework`. Marcador sem a barreira no banco e
 * mentira gravada no marcador.
 */
export const exemplo = pgTable(
  "exemplo",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Escopo de loja: obrigatorio em tudo que pertence a uma loja.
    loja_id: uuid("loja_id")
      .notNull()
      .references(() => lojas.id, { onDelete: "restrict", onUpdate: "restrict" }),

    nome: text("nome").notNull(),

    /** Lista fechada: `text` mais CHECK gerado da constante (ADR 0010). */
    status: text("status").notNull().default("rascunho"),

    /** Dinheiro e `numeric(12,2)` em modo string. A aritmetica e em centavos. */
    valor: dinheiro("valor").notNull().default("0"),

    /** Instante e `timestamptz(3)`. Nunca `timestamp` sem precisao. */
    concluido_em: instante("concluido_em"),

    // As cinco colunas da casa. Espalhe SEM alias, nesta forma literal.
    ...colunasAuditoria,
  },
  (t) => [
    checkLista("exemplo_status_lista", t.status, ["rascunho", "ativo", "concluido"] as const),

    // Predicado de indice parcial SO com template `sql` cru e literais.
    // `eq(t.is_deleted, false)` gera parametro posicional e o indice nasce
    // invalido (ADR 0009).
    uniqueIndex("uq_exemplo_nome")
      .on(t.loja_id, sql`lower(${t.nome})`)
      .where(sql`is_deleted = false`),

    index("ix_exemplo_loja").on(t.loja_id, t.is_deleted),

    // Indice unico `(id, loja_id)`: e o que permite a FK COMPOSTA de quem
    // referencia esta tabela e nao deixa o filho trocar de loja (ADR 0022).
    uniqueIndex("uq_exemplo_id_loja").on(t.id, t.loja_id),

    check("exemplo_valor_nao_negativo", sql`${t.valor} >= 0`),
  ],
);

export type Exemplo = typeof exemplo.$inferSelect;
