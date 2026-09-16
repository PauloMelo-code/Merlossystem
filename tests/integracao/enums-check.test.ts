import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isTable } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "@/lib/db/schema";
import { LISTAS_FECHADAS } from "@/lib/db/schema/_enums";

// O 3º argumento do `pgTable` é um CALLBACK: o Drizzle só o executa quando
// alguém pede a configuração da tabela (é o drizzle-kit que faz isso ao gerar a
// migração). `getTableConfig` força essa execução aqui, que é o que preenche
// `LISTAS_FECHADAS` — e, de quebra, prova que as 48 configurações montam.
for (const valor of Object.values(schema)) {
  if (isTable(valor)) getTableConfig(valor);
}

/**
 * Lista fechada só é segura quando as DUAS pontas vêm da mesma constante
 * (01-dados.md §4.4).
 *
 * Este teste lê `pg_constraint` do banco de teste e compara, constraint a
 * constraint, a lista gravada no `CHECK` com a constante TS que a gerou. O
 * registro `LISTAS_FECHADAS` é preenchido pelo próprio `checkLista()` quando o
 * barril do schema carrega: não há um segundo mapa para desatualizar.
 */

const url = process.env.DATABASE_URL_TESTE;
let c: Client;

beforeAll(async () => {
  if (!url) {
    throw new Error(
      "DATABASE_URL_TESTE não está definida. Rode `node scripts/db-teste.mjs` e passe a URL.",
    );
  }
  c = new Client({ connectionString: url });
  await c.connect();
});

afterAll(async () => {
  await c?.end();
});

/** O Postgres normaliza `in (...)` para `= ANY (ARRAY[...])`; os literais ficam. */
function literaisDo(definicao: string): string[] {
  return [...definicao.matchAll(/'([^']*)'(?!')/g)].map((m) => m[1]!);
}

describe("enums: CHECK do banco × constante TS", () => {
  it("o registro foi preenchido pelo carregamento do schema", () => {
    expect(LISTAS_FECHADAS.size).toBeGreaterThanOrEqual(45);
  });

  it("toda constraint `_lista` do banco tem constante correspondente, e o contrário", async () => {
    const { rows } = await c.query<{ conname: string; def: string }>(
      `select conname, pg_get_constraintdef(oid) as def
         from pg_constraint
        where contype = 'c' and connamespace = 'public'::regnamespace
          and conname like '%\\_lista'`,
    );
    const noBanco = new Set(rows.map((r) => r.conname));
    const noCodigo = new Set(LISTAS_FECHADAS.keys());

    expect([...noCodigo].filter((n) => !noBanco.has(n))).toEqual([]);
    expect([...noBanco].filter((n) => !noCodigo.has(n))).toEqual([]);
  });

  it("os valores de cada CHECK são exatamente os da constante", async () => {
    const { rows } = await c.query<{ conname: string; def: string }>(
      `select conname, pg_get_constraintdef(oid) as def
         from pg_constraint
        where contype = 'c' and connamespace = 'public'::regnamespace
          and conname like '%\\_lista'`,
    );
    const divergencias: string[] = [];
    for (const { conname, def } of rows) {
      const esperado = LISTAS_FECHADAS.get(conname);
      if (!esperado) continue;
      const noBanco = literaisDo(def).sort();
      const noCodigo = [...esperado].sort();
      if (JSON.stringify(noBanco) !== JSON.stringify(noCodigo)) {
        divergencias.push(`${conname}: banco=[${noBanco}] codigo=[${noCodigo}]`);
      }
    }
    expect(divergencias).toEqual([]);
  });

  it("o CHECK recusa valor fora da lista", async () => {
    await c.query("begin");
    try {
      await expect(
        c.query(
          `insert into auth_eventos (tipo, resultado) values ('tipo_que_nao_existe', 'sucesso')`,
        ),
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      await c.query("rollback");
    }
  });
});
