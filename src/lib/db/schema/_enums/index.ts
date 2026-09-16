import { sql } from "drizzle-orm";
import { check, type PgColumn } from "drizzle-orm/pg-core";

/**
 * Listas fechadas: `text` + `CHECK`, nunca `pgEnum` (01-dados.md §4.4, ADR 0010).
 *
 * A mesma constante alimenta o `CHECK` do banco, o `z.enum()` do validador e o
 * rótulo da UI (`src/lib/ui/tons.ts` importa os valores daqui, nunca redigita).
 */

export * from "./auditoria";
export * from "./auth";
export * from "./catalogo";
export * from "./conversas";
export * from "./inteligencia";
export * from "./pedidos";
export * from "./plataforma";

/**
 * Referência REAL de coluna: renomear a coluna quebra no build, não na migração.
 *
 * Os valores entram como SQL cru (`sql.raw`), não como parâmetro: o drizzle-kit
 * serializa o `CHECK` com `escapeParam`, e uma lista passada como parâmetro
 * sairia na migração como `in $1`, que não aplica. É o mesmo motivo do
 * predicado literal no índice único parcial (01-dados.md §4.6). A lista vem de
 * constante TS, nunca de entrada do usuário.
 */
export const emLista = (coluna: PgColumn, valores: readonly string[]) =>
  sql`${coluna} in (${sql.raw(listaSql(valores))})`;

/** `['a','b']` -> `'a', 'b'`. Para o CHECK que mistura lista e outra condição. */
export const listaSql = (valores: readonly string[]) =>
  valores.map((v) => `'${v}'`).join(", ");

/**
 * Registro `nome da constraint -> constante TS`. É o que permite a
 * `tests/integracao/enums-check.test.ts` comparar, constraint a constraint, a
 * lista gravada no banco com a lista do código sem redigitar nenhum par. Lista
 * fechada só é segura quando as duas pontas vêm da mesma constante.
 *
 * ATENÇÃO: o 3º argumento do `pgTable` é um callback que o Drizzle executa
 * SOB DEMANDA (o drizzle-kit o executa ao gerar a migração; o ORM, em consulta
 * normal, não). Quem precisa do registro completo chama `getTableConfig()` de
 * cada tabela antes de ler este Map — é o que o teste faz.
 */
export const LISTAS_FECHADAS = new Map<string, readonly string[]>();

/** `check()` de lista fechada que se registra em `LISTAS_FECHADAS`. */
export function checkLista(nome: string, coluna: PgColumn, valores: readonly string[]) {
  LISTAS_FECHADAS.set(nome, valores);
  return check(nome, emLista(coluna, valores));
}
