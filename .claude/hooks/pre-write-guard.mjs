#!/usr/bin/env node
// @ts-check
/**
 * pre-write-guard.mjs — Hook PreToolUse (Write|Edit|MultiEdit).
 *
 * BLOQUEIA (exit 2) a gravacao de codigo que viola as regras absolutas do
 * projeto, ANTES de o arquivo ser escrito. Hooks impoem regras a 100% — o
 * markdown so ~70%, e o CI so depois do push.
 *
 * Regras bloqueadas:
 *   - Prisma          (o projeto usa Drizzle; nao ha mais legado — ADR 0002 foi
 *                      substituido pela reconstrucao, entao BLOQUEIA de verdade)
 *   - SQLite          (PostgreSQL em todos os ambientes, inclusive teste)
 *   - Texto cru       (escape unicode literal e mojibake em texto acentuado)
 *   - Delete fisico   (db/tx/drizzle.delete, deleteMany, DELETE FROM)
 *   - Editar .env     (inclui .env.local — secrets ficam fora do git)
 *
 * Fail-open: qualquer erro interno -> exit 0 (nunca trava o fluxo do dev).
 * Para desativar temporariamente, remova o bloco PreToolUse de .claude/settings.json.
 */

import { basename, extname, resolve } from "node:path";

const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".sql"]);

/** Pastas cujo conteudo nao e codigo de producao deste projeto. */
const SKIP_PATH = /(^|[\\/])(node_modules|templates|docs)[\\/]/;

/**
 * `.claude/` guarda os proprios hooks e as skills, que trazem os padroes
 * proibidos como DEFINICAO de regra — auditar a si mesmo daria bloqueio eterno.
 * Mas `.claude/worktrees/` guarda CODIGO DO PROJETO: se o skip casasse `.claude`
 * em qualquer ponto do caminho (como fazia a versao da base), trabalhar dentro
 * de um worktree desligaria os dois hooks em silencio. La as regras valem.
 */
const CLAUDE_INTERNO = /(^|[\\/])\.claude[\\/](?!worktrees[\\/])/;

/** Arquivos de ambiente: nunca editados por agente. O template e `.env.example`. */
const ENV_PROIBIDOS = new Set([".env", ".env.local", ".env.production", ".env.prod"]);

const RULES = [
  {
    id: "prisma",
    re: /@prisma\/client|new\s+PrismaClient|from\s+["']prisma["']|require\(["']@prisma\/client["']\)/,
    msg: "Prisma detectado. Este projeto usa Drizzle ORM (src/lib/db/schema/).",
  },
  {
    id: "sqlite",
    re: /better-sqlite3|drizzle-orm\/better-sqlite3|from\s+["']sqlite3?["']|:memory:/,
    msg: "SQLite detectado. Este projeto usa PostgreSQL em todos os ambientes.",
  },
  {
    id: "texto-cru",
    // Dois defeitos de encoding com a mesma consequencia: texto errado na tela.
    //   1. Escape literal: `Automações` chegou a ser renderizado
    //      exatamente assim. Fora de uma string, `\u` nao e interpretado.
    //   2. Mojibake: o editor le o arquivo UTF-8 como cp1252 e regrava; um
    //      acento vira dois caracteres (`Ã` + outro).
    // Os arquivos sao UTF-8. Escreva o caractere acentuado direto.
    re: /\\u00[89a-fA-F][0-9a-fA-F]|[ÃÂ][-¿]|â€[¦]/,
    msg: "Texto acentuado quebrado (escape unicode literal ou mojibake). Escreva o caractere acentuado direto: os arquivos sao UTF-8.",
  },
  {
    id: "delete-fisico",
    // `tx.delete(`, `drizzle….delete(` e `DELETE FROM` sao os caminhos que
    // escapavam da versao da base: delete dentro de transacao e SQL cru.
    // Vale tambem em `tests/` e `scripts/` — a limpeza de banco de teste e por
    // transacao com rollback e por TRUNCATE no globalSetup (03-arquitetura §20).
    re: /\bdb\.delete\s*\(|\btx\.delete\s*\(|\.deleteMany\s*\(|\bdrizzle[\w.]*\.delete\s*\(|\bDELETE\s+FROM\b/i,
    msg: "Delete fisico detectado. Use soft delete: is_deleted=true, deleted_at=now() (excluirLogico em src/lib/db/mutacoes.ts, implementacao em src/lib/db/mutacoes/).",
  },
];

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve("");
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(""));
  });
}

function isComment(line) {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

function introducedText(tool, input) {
  if (!input) return "";
  if (tool === "Write") return String(input.content ?? "");
  if (tool === "Edit") return String(input.new_string ?? "");
  if (tool === "MultiEdit" && Array.isArray(input.edits)) {
    return input.edits.map((e) => String(e?.new_string ?? "")).join("\n");
  }
  return "";
}

function block(reason) {
  process.stderr.write(
    `[guard] Gravacao bloqueada pelas regras do MerlostoreChat:\n${reason}\n` +
    `Corrija e tente novamente. (regras em CLAUDE.md / AGENTS.md)\n`
  );
  process.exit(2);
}

async function main() {
  const raw = (await readStdin()).replace(/^﻿/, ""); // strip BOM
  if (!raw.trim()) process.exit(0);

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0); // fail-open
  }

  const tool = payload.tool_name;
  const input = payload.tool_input || {};
  const filePath = String(input.file_path || "");
  if (!filePath) process.exit(0);

  // So governa arquivos DENTRO deste projeto. Edicoes em outros projetos
  // (ex.: outro repo com stack diferente) nao sao bloqueadas por estas regras.
  const projectDir = process.env.CLAUDE_PROJECT_DIR;
  if (projectDir) {
    const root = resolve(projectDir).toLowerCase();
    const target = resolve(filePath).toLowerCase();
    if (!target.startsWith(root)) process.exit(0);
  }

  const base = basename(filePath);

  // Protecao dos arquivos de ambiente — vale para qualquer extensao.
  if (ENV_PROIBIDOS.has(base)) {
    block(
      `Nao edite "${base}" diretamente (contem secrets, fica fora do git).\n` +
      `Use ".env.example", que e gerado a partir de src/lib/env.ts.`
    );
  }

  const ext = extname(filePath);
  if (!CODE_EXT.has(ext)) process.exit(0);        // .md e outros: liberado
  if (SKIP_PATH.test(filePath)) process.exit(0);  // node_modules/templates/docs
  if (CLAUDE_INTERNO.test(filePath)) process.exit(0); // hooks e skills, nao worktrees

  const text = introducedText(tool, input);
  if (!text) process.exit(0);

  const lines = text.split("\n");
  for (const rule of RULES) {
    for (let i = 0; i < lines.length; i++) {
      // Comentario nao dispara, exceto `texto-cru`: mojibake em comentario e
      // mojibake no arquivo, e contamina o proximo que copiar a linha.
      if (isComment(lines[i]) && rule.id !== "texto-cru") continue;
      if (rule.re.test(lines[i])) {
        block(`  [${rule.id}] L~${i + 1}: ${rule.msg}`);
      }
    }
  }

  process.exit(0);
}

main().catch(() => process.exit(0)); // fail-open
