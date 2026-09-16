#!/usr/bin/env node
// @ts-check
/**
 * project-map.mjs — Gera um mapa do projeto para a IA se orientar rapido.
 *
 * Sem dependencias (Node puro). Cross-platform.
 *
 * Uso:
 *   node scripts/project-map.mjs            # imprime markdown no stdout
 *   node scripts/project-map.mjs --out docs/PROJECT_MAP.md
 *
 * O mapa inclui:
 *   - Arvore de pastas (ate profundidade 3, ignorando build/deps)
 *   - Tabelas Drizzle e suas colunas
 *   - Server Actions (arquivos 'use server' + funcoes exportadas)
 *   - Rotas de API (app/**\/route.ts + metodos HTTP)
 *   - Componentes (.tsx em components/)
 *   - Contagens-resumo
 *
 * Objetivo: substituir "investigacao infinita" por um resumo barato. A IA le o
 * mapa primeiro e so abre os arquivos relevantes — economiza contexto.
 */

import { readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, extname, relative, basename } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const MAX_DEPTH = 3;
const IGNORE = new Set([
  "node_modules", ".next", ".git", "dist", "build", "coverage",
  ".turbo", "out", ".vercel",
]);

// ---------------------------------------------------------------------------
// Arvore de pastas
// ---------------------------------------------------------------------------

/** @param {string} dir @param {number} depth @param {string} prefix @returns {string[]} */
function tree(dir, depth, prefix) {
  if (depth > MAX_DEPTH) return [];
  /** @type {string[]} */
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true })
      .filter((e) => !IGNORE.has(e.name) && !(e.name.startsWith(".") && e.name !== ".github"))
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(`${prefix}${e.name}/`);
      out.push(...tree(full, depth + 1, prefix + "  "));
    } else {
      out.push(`${prefix}${e.name}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Coleta recursiva de arquivos de codigo
// ---------------------------------------------------------------------------

/** @param {string} dir @param {string[]} acc @returns {string[]} */
export function collect(dir, acc) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (IGNORE.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) collect(full, acc);
    else if ([".ts", ".tsx"].includes(extname(e.name))) acc.push(full);
  }
  return acc;
}

const rel = (f) => relative(ROOT, f).replace(/\\/g, "/");

// ---------------------------------------------------------------------------
// Extratores
// ---------------------------------------------------------------------------

/** @param {string[]} files */
export function findTables(files) {
  /** @type {{name:string,file:string,cols:string[]}[]} */
  const tables = [];
  for (const f of files) {
    const c = readFileSync(f, "utf8");
    const re = /pgTable\s*\(\s*["'`]([^"'`]+)["'`]\s*,\s*\{/g;
    let m;
    while ((m = re.exec(c)) !== null) {
      const name = m[1];
      const openIdx = c.indexOf("{", m.index + m[0].length - 1);
      let depth = 0, endIdx = -1;
      for (let i = openIdx; i < c.length; i++) {
        if (c[i] === "{") depth++;
        else if (c[i] === "}") { depth--; if (depth === 0) { endIdx = i; break; } }
      }
      const body = endIdx === -1 ? "" : c.slice(openIdx, endIdx + 1);
      const cols = [...body.matchAll(/^\s*(\w+)\s*:/gm)].map((x) => x[1]);
      tables.push({ name, file: rel(f), cols });
    }
  }
  return tables;
}

/** @param {string[]} files */
export function findActions(files) {
  /** @type {{file:string,fns:string[]}[]} */
  const actions = [];
  for (const f of files) {
    const c = readFileSync(f, "utf8");
    if (!/^["']use server["']/m.test(c)) continue;
    const fns = [...c.matchAll(/export\s+async\s+function\s+(\w+)/g)].map((x) => x[1]);
    if (fns.length) actions.push({ file: rel(f), fns });
  }
  return actions;
}

/** @param {string[]} files */
export function findRoutes(files) {
  /** @type {{route:string,methods:string[]}[]} */
  const routes = [];
  for (const f of files) {
    if (basename(f) !== "route.ts" && basename(f) !== "route.tsx") continue;
    const c = readFileSync(f, "utf8");
    const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"].filter((mth) =>
      new RegExp(`export\\s+async\\s+function\\s+${mth}\\b`).test(c)
    );
    // deriva rota a partir do caminho app/.../route.ts
    let route = rel(f).replace(/.*?app\//, "/").replace(/\/route\.tsx?$/, "");
    route = route.replace(/\/\((\w+)\)/g, ""); // remove route groups (admin)
    routes.push({ route: route || "/", methods });
  }
  return routes;
}

/** @param {string[]} files */
export function findComponents(files) {
  return files
    .filter((f) => extname(f) === ".tsx" && /[\\/]components[\\/]/.test(f))
    .map((f) => rel(f));
}

// ---------------------------------------------------------------------------
// Montagem do markdown
// ---------------------------------------------------------------------------

function build() {
  const srcDir = join(ROOT, "src");
  const scanRoot = existsSync(srcDir) ? srcDir : ROOT;
  const files = collect(scanRoot, []);

  const tables = findTables(files);
  const actions = findActions(files);
  const routes = findRoutes(files);
  const components = findComponents(files);
  const pages = files.filter((f) => /[\\/]app[\\/].*page\.tsx$/.test(f)).map(rel);

  const L = [];
  L.push(`# Mapa do Projeto`);
  L.push("");
  L.push(`> Gerado por \`scripts/project-map.mjs\`. Leia este resumo antes de explorar arquivos.`);
  L.push("");
  L.push(`## Resumo`);
  L.push("");
  L.push(`| Metrica | Total |`);
  L.push(`|---------|-------|`);
  L.push(`| Arquivos TS/TSX | ${files.length} |`);
  L.push(`| Tabelas (Drizzle) | ${tables.length} |`);
  L.push(`| Server Actions (arquivos) | ${actions.length} |`);
  L.push(`| Rotas de API | ${routes.length} |`);
  L.push(`| Paginas | ${pages.length} |`);
  L.push(`| Componentes | ${components.length} |`);
  L.push("");

  L.push(`## Arvore (profundidade ${MAX_DEPTH})`);
  L.push("");
  L.push("```");
  L.push(...tree(scanRoot, 1, ""));
  L.push("```");
  L.push("");

  if (tables.length) {
    L.push(`## Tabelas (Drizzle)`);
    L.push("");
    for (const t of tables) {
      L.push(`### \`${t.name}\` — ${t.file}`);
      L.push(t.cols.length ? t.cols.map((c) => `\`${c}\``).join(", ") : "_(colunas nao detectadas)_");
      L.push("");
    }
  }

  if (routes.length) {
    L.push(`## Rotas de API`);
    L.push("");
    L.push(`| Rota | Metodos |`);
    L.push(`|------|---------|`);
    for (const r of routes.sort((a, b) => a.route.localeCompare(b.route))) {
      L.push(`| \`${r.route}\` | ${r.methods.join(", ") || "—"} |`);
    }
    L.push("");
  }

  if (actions.length) {
    L.push(`## Server Actions`);
    L.push("");
    for (const a of actions) {
      L.push(`- \`${a.file}\`: ${a.fns.map((fn) => `\`${fn}()\``).join(", ")}`);
    }
    L.push("");
  }

  if (pages.length) {
    L.push(`## Paginas`);
    L.push("");
    for (const p of pages.sort()) L.push(`- \`${p}\``);
    L.push("");
  }

  return L.join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const md = build();
  const outIdx = args.indexOf("--out");
  if (outIdx !== -1 && args[outIdx + 1]) {
    writeFileSync(args[outIdx + 1], md, "utf8");
    console.log(`Mapa escrito em ${args[outIdx + 1]}`);
  } else {
    console.log(md);
  }
}

// So roda main() quando chamado direto (node scripts/project-map.mjs),
// nao quando importado por outro script (ex: docs-check.mjs).
const isDirectRun = import.meta.url === pathToFileURL(process.argv[1] || "").href;
if (isDirectRun) main();
