#!/usr/bin/env node
// @ts-check
/**
 * post-write-check.mjs — Hook PostToolUse (Write|Edit|MultiEdit).
 *
 * Depois que o arquivo e gravado, roda o auditor de conformidade SO naquele
 * arquivo. Se houver ERROS, devolve o relatorio para a IA (exit 2) — fechando
 * o loop "editou -> violou -> corrige" automaticamente.
 *
 * Avisos (warnings) nao bloqueiam. Fail-open em qualquer erro interno.
 */

import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".sql"]);
const SKIP_PATH = /(^|[\\/])(node_modules|templates)[\\/]/;

/**
 * `.claude/` guarda hooks e skills (que citam os padroes proibidos como regra),
 * mas `.claude/worktrees/` guarda CODIGO DO PROJETO. Casar `.claude` em qualquer
 * ponto do caminho — como fazia a versao da base — desligaria o auditor em
 * silencio para quem trabalha dentro de um worktree.
 */
const CLAUDE_INTERNO = /(^|[\\/])\.claude[\\/](?!worktrees[\\/])/;

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

async function main() {
  const raw = (await readStdin()).replace(/^﻿/, ""); // strip BOM
  if (!raw.trim()) process.exit(0);

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const input = payload.tool_input || {};
  const filePath = String(input.file_path || "");
  if (!filePath || !existsSync(filePath)) process.exit(0);
  if (!CODE_EXT.has(extname(filePath))) process.exit(0);
  if (SKIP_PATH.test(filePath)) process.exit(0);
  if (CLAUDE_INTERNO.test(filePath)) process.exit(0);

  // So audita arquivos dentro deste projeto.
  if (process.env.CLAUDE_PROJECT_DIR) {
    const root = resolve(process.env.CLAUDE_PROJECT_DIR).toLowerCase();
    if (!resolve(filePath).toLowerCase().startsWith(root)) process.exit(0);
  }

  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const checker = join(projectDir, "scripts", "check-compliance.mjs");
  if (!existsSync(checker)) process.exit(0);

  let stdout = "";
  try {
    stdout = execFileSync(
      process.execPath,
      [checker, "--file", filePath, "--json"],
      { encoding: "utf8" }
    );
  } catch (e) {
    // checker sai com 1 quando ha erros — a saida JSON vem em e.stdout
    stdout = e && e.stdout ? String(e.stdout) : "";
  }
  if (!stdout.trim()) process.exit(0);

  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    process.exit(0);
  }

  const errors = (report.findings || []).filter((f) => f.level === "error");
  if (errors.length === 0) process.exit(0);

  const lines = errors.map((f) => `  L${f.line} [${f.id}] ${f.msg}`);
  process.stderr.write(
    `[compliance] ${errors.length} violacao(oes) em ${filePath}:\n` +
    lines.join("\n") +
    `\nCorrija antes de prosseguir (regras em CLAUDE.md).\n`
  );
  process.exit(2);
}

main().catch(() => process.exit(0)); // fail-open
