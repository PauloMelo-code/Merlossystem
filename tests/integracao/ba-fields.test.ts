import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTableColumns, getTableName, isTable } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { CAMPOS_BA } from "@/lib/db/schema/_ba-fields";

/**
 * Trava T4 (01-dados.md §5.10).
 *
 * O Better Auth 1.7 valida o schema no BOOT: um nome de coluna divergente
 * derruba TODO `/api/auth/**` em produção (07/G27). Aqui a divergência aparece
 * no CI — conferida contra o schema TS E contra o banco de verdade, porque as
 * duas coisas podem discordar entre si.
 */

const url = process.env.DATABASE_URL_TESTE;
let colunasNoBanco: Map<string, Set<string>>;
let c: Client;

beforeAll(async () => {
  if (!url) {
    throw new Error(
      "DATABASE_URL_TESTE não está definida. Rode `node scripts/db-teste.mjs` e passe a URL.",
    );
  }
  c = new Client({ connectionString: url });
  await c.connect();
  const { rows } = await c.query<{ table_name: string; column_name: string }>(
    "select table_name, column_name from information_schema.columns where table_schema = 'public'",
  );
  colunasNoBanco = new Map();
  for (const r of rows) {
    if (!colunasNoBanco.has(r.table_name)) colunasNoBanco.set(r.table_name, new Set());
    colunasNoBanco.get(r.table_name)!.add(r.column_name);
  }
});

afterAll(async () => {
  await c?.end();
});

/** Nome da tabela -> colunas declaradas no schema TS. */
const colunasNoCodigo = new Map<string, Set<string>>();
for (const valor of Object.values(schema)) {
  if (!isTable(valor)) continue;
  colunasNoCodigo.set(getTableName(valor), new Set(Object.keys(getTableColumns(valor))));
}

const modelos = Object.entries(CAMPOS_BA);

describe("de-para do Better Auth", () => {
  it("cobre os seis modelos que o BA usa", () => {
    expect(modelos.map(([nome]) => nome).sort()).toEqual([
      "account",
      "passkey",
      "session",
      "twoFactor",
      "user",
      "verification",
    ]);
  });

  it.each(modelos)("%s aponta para tabela que existe", (_nome, modelo) => {
    expect(colunasNoCodigo.has(modelo.modelName)).toBe(true);
    expect(colunasNoBanco.has(modelo.modelName)).toBe(true);
  });

  it("todo valor do de-para é uma coluna existente, no código e no banco", () => {
    const faltando: string[] = [];
    for (const [, modelo] of modelos) {
      const campos: Record<string, string> = "fields" in modelo ? modelo.fields : {};
      for (const [chaveBa, coluna] of Object.entries(campos)) {
        if (!colunasNoCodigo.get(modelo.modelName)?.has(coluna)) {
          faltando.push(`${modelo.modelName}.${coluna} (${chaveBa}) não existe no schema TS`);
        }
        if (!colunasNoBanco.get(modelo.modelName)?.has(coluna)) {
          faltando.push(`${modelo.modelName}.${coluna} (${chaveBa}) não existe no banco`);
        }
      }
    }
    expect(faltando).toEqual([]);
  });

  it("as quatro tabelas de framework não têm as colunas da casa", () => {
    // `is_deleted = false` numa linha que a biblioteca vai apagar é mentira
    // gravada no banco (ADR 0008). A prova do ciclo de vida é `auth_eventos`.
    for (const tabela of [
      "usuarios_sessoes",
      "usuarios_verificacoes",
      "usuarios_totp",
      "usuarios_passkeys",
    ]) {
      expect(colunasNoBanco.get(tabela)?.has("is_deleted"), tabela).toBe(false);
    }
  });

  it("usuarios e usuarios_contas TÊM as cinco colunas da casa", () => {
    for (const tabela of ["usuarios", "usuarios_contas"]) {
      for (const coluna of ["created_at", "updated_at", "deleted_at", "is_deleted", "modified_by"]) {
        expect(colunasNoBanco.get(tabela)?.has(coluna), `${tabela}.${coluna}`).toBe(true);
      }
    }
  });
});
