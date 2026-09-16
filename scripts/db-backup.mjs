#!/usr/bin/env node
// @ts-check
/**
 * db-backup.mjs — `pg_dump` com o papel `merlo_migracao`.
 *
 * Backup ANTES de todo deploy em PRD, e a falha do backup ABORTA o deploy
 * (05-plano §9). O bucket do MinIO é copiado junto, fora deste script.
 *
 * A credencial NÃO entra em `argv`: vai por `PGPASSWORD`, e o nome do arquivo
 * leva só data e hora. Segredo em linha de comando aparece em `ps`, no log do
 * runner de CI e no histórico do shell.
 *
 * Lê `DATABASE_URL_MIGRACAO` direto de `process.env`: uma das três exceções
 * escritas da trava T17.
 *
 * Uso: `node scripts/db-backup.mjs [--dir <pasta>]`
 */

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function pastaDosArgumentos() {
  const i = process.argv.indexOf("--dir");
  const valor = i === -1 ? undefined : process.argv[i + 1];
  return valor ?? join(homedir(), "Documents", "DB_backups");
}

/** `backup_DD_MM_YYYY_HH_MM.sql` (CLAUDE.md, política de backup). */
function nomeDoArquivo(agora) {
  const p = (n) => String(n).padStart(2, "0");
  return `backup_${p(agora.getDate())}_${p(agora.getMonth() + 1)}_${agora.getFullYear()}_${p(
    agora.getHours(),
  )}_${p(agora.getMinutes())}.sql`;
}

const base = process.env.DATABASE_URL_MIGRACAO;
if (!base) {
  console.error("DATABASE_URL_MIGRACAO não está definida.");
  process.exit(1);
}

const url = new URL(base);
const pasta = pastaDosArgumentos();
mkdirSync(pasta, { recursive: true });
const destino = join(pasta, nomeDoArquivo(new Date()));

const argumentos = [
  "--host",
  url.hostname,
  "--port",
  url.port || "5432",
  "--username",
  decodeURIComponent(url.username),
  "--dbname",
  url.pathname.replace(/^\//, ""),
  // --no-owner e --no-acl: portabilidade entre ambientes, permissões são de
  // cada ambiente. --clean e --if-exists: restore limpo, sem erro no DROP.
  "--no-owner",
  "--no-acl",
  "--clean",
  "--if-exists",
  "--file",
  destino,
];

const filho = spawn("pg_dump", argumentos, {
  env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) },
  stdio: "inherit",
});

filho.on("error", (e) => {
  console.error(`pg_dump não pôde ser executado: ${e.message}`);
  process.exit(1);
});

filho.on("exit", (codigo) => {
  if (codigo !== 0) {
    console.error(`pg_dump terminou com código ${codigo}. Backup NÃO foi gerado.`);
    process.exit(codigo ?? 1);
  }
  console.log(`Backup gravado em ${destino}`);
});
