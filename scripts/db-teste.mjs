#!/usr/bin/env node
// @ts-check
/**
 * db-teste.mjs — recria o SCHEMA do banco de teste e aplica as migrações.
 *
 * NÃO DROPA BANCO (regra absoluta da casa). Ele recria o schema dentro de um
 * banco de teste, com três guardas que abortam ANTES de qualquer comando
 * (03-arquitetura.md §17, ADR 0023):
 *   1. o host tem de ser local;
 *   2. o nome do banco tem de conter "test";
 *   3. NODE_ENV não pode ser "production".
 *
 * Um banco por pacote (05-plano §3.3): `--sufixo m1` usa `merlostore_test_m1`.
 * Sem sufixo, `merlostore_test` (fundação e integração).
 *
 * Lê `DATABASE_URL_MIGRACAO` direto de `process.env`: é uma das três exceções
 * escritas da trava T17, junto de `src/lib/db/migrate.ts` e `db-backup.mjs`.
 *
 * Uso: `node scripts/db-teste.mjs [--sufixo m1]`
 */

import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const HOSTS_LOCAIS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

function sufixoDosArgumentos() {
  const i = process.argv.indexOf("--sufixo");
  if (i === -1) return "";
  const valor = process.argv[i + 1];
  if (!valor || !/^[a-z0-9]{1,8}$/.test(valor)) {
    console.error('--sufixo aceita de 1 a 8 caracteres [a-z0-9], por exemplo "m1".');
    process.exit(1);
  }
  return `_${valor}`;
}

function abortar(motivo) {
  console.error(`db-teste abortado: ${motivo}`);
  process.exit(1);
}

async function principal() {
  const base = process.env.DATABASE_URL_MIGRACAO;
  if (!base) abortar("DATABASE_URL_MIGRACAO não está definida");

  const url = new URL(base);
  const banco = `merlostore_test${sufixoDosArgumentos()}`;

  // --- as três guardas, antes de qualquer comando --------------------------
  if (!HOSTS_LOCAIS.has(url.hostname)) abortar(`host "${url.hostname}" não é local`);
  if (!banco.includes("test")) abortar(`nome de banco "${banco}" não contém "test"`);
  if (process.env.NODE_ENV === "production") abortar("NODE_ENV = production");

  // --- cria o banco se ainda não existir (nunca dropa) ---------------------
  const manutencao = new URL(url.toString());
  manutencao.pathname = "/postgres";
  const admin = new Client({ connectionString: manutencao.toString() });
  await admin.connect();
  try {
    const { rows } = await admin.query("select 1 from pg_database where datname = $1", [banco]);
    if (rows.length === 0) {
      await admin.query(`create database "${banco}"`);
      console.log(`banco ${banco} criado.`);
    }
  } finally {
    await admin.end();
  }

  // --- recria o schema -----------------------------------------------------
  const alvo = new URL(url.toString());
  alvo.pathname = `/${banco}`;
  const c = new Client({ connectionString: alvo.toString() });
  await c.connect();
  try {
    // O schema `drizzle` guarda o diário de migrações. Sem recriá-lo junto, o
    // migrator acharia que já aplicou tudo e devolveria um banco vazio.
    await c.query("drop schema if exists drizzle cascade");
    await c.query("drop schema if exists public cascade");
    await c.query("create schema public");
    console.log(`schema de ${banco} recriado.`);
  } finally {
    await c.end();
  }

  // --- aplica as migrações -------------------------------------------------
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: alvo.toString(), max: 1 });
  try {
    await migrate(drizzle(pool), {
      migrationsFolder: "./src/lib/db/migrations",
      migrationsSchema: "drizzle",
    });
    console.log(`migrações aplicadas em ${banco}.`);
  } finally {
    await pool.end();
  }
}

principal().catch((e) => {
  console.error(e);
  process.exit(1);
});
