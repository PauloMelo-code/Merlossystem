#!/usr/bin/env node
// @ts-check
/**
 * docs-check.mjs — Detector de drift entre codigo e documentacao.
 *
 * Sem dependencias (Node puro). Cross-platform (Windows/Linux/Mac).
 * Reusa os extratores de `project-map.mjs` (fonte unica de verdade — DRY).
 *
 * Uso:
 *   node scripts/docs-check.mjs            # relatorio markdown no stdout
 *   node scripts/docs-check.mjs --json     # relatorio machine-readable (JSON)
 *   node scripts/docs-check.mjs --strict   # exit 1 se houver qualquer gap (CI/hook)
 *
 * O que detecta:
 *   1. STALE REF  — caminho de arquivo citado nos docs que nao existe no disco
 *                   (so valida quando a pasta-raiz do caminho existe; assim um
 *                    template sem `src/` nao gera falso-positivo em exemplos).
 *   2. SEM COBERTURA — tabela/rota/server-action no codigo (src/) sem nenhuma
 *                   mencao em qualquer doc.
 *
 * Filosofia: o determinismo (provar o drift) e do script; o julgamento e a
 * escrita dos docs sao do agente (skill `repo-docs-sync`). Este script NAO
 * escreve nada — so audita e reporta.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, extname, relative } from "node:path";
import {
  collect,
  findTables,
  findActions,
  findRoutes,
  findComponents,
} from "./project-map.mjs";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const asJson = args.includes("--json");
const strict = args.includes("--strict");

const rel = (f) => relative(ROOT, f).replace(/\\/g, "/");

// ---------------------------------------------------------------------------
// 1. Inventario de codigo (somente src/ — onde mora o app desta base)
// ---------------------------------------------------------------------------

const SRC = join(ROOT, "src");
const hasSrc = existsSync(SRC);
const codeFiles = hasSrc ? collect(SRC, []) : [];
const tables = hasSrc ? findTables(codeFiles) : [];
const routes = hasSrc ? findRoutes(codeFiles) : [];
const actions = hasSrc ? findActions(codeFiles) : [];
const components = hasSrc ? findComponents(codeFiles) : [];
const actionFns = actions.flatMap((a) => a.fns.map((fn) => ({ fn, file: a.file })));

// ---------------------------------------------------------------------------
// 2. Coleta de documentacao
// ---------------------------------------------------------------------------

const DOC_IGNORE = new Set([
  "node_modules", ".next", ".git", "dist", "build", "coverage",
  ".turbo", "out", ".vercel",
]);

/** @param {string} dir @param {string[]} acc @returns {string[]} */
function collectDocs(dir, acc) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (DOC_IGNORE.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) collectDocs(full, acc);
    // PROJECT_MAP.md e gerado a partir do proprio codigo. Se entrasse no corpus,
    // toda rota/tabela apareceria "documentada" e a cobertura mediria sempre zero.
    else if (extname(e.name).toLowerCase() === ".md" && e.name !== "PROJECT_MAP.md") {
      acc.push(full);
    }
  }
  return acc;
}

/** @type {string[]} */
const docFiles = [];
for (const f of ["CLAUDE.md", "AGENTS.md", "Agente.md", "README.md"]) {
  const p = join(ROOT, f);
  if (existsSync(p)) docFiles.push(p);
}
if (existsSync(join(ROOT, "docs"))) collectDocs(join(ROOT, "docs"), docFiles);
if (existsSync(join(ROOT, ".github"))) collectDocs(join(ROOT, ".github"), docFiles);

const docBlobs = docFiles.map((f) => ({ file: rel(f), text: readFileSync(f, "utf8") }));
const allDocText = docBlobs.map((d) => d.text).join("\n");

// ---------------------------------------------------------------------------
// 3. Checks
// ---------------------------------------------------------------------------

/** @type {{staleRefs:{ref:string,doc:string}[], missingCoverage:{tipo:string,nome:string,file?:string}[], summary:Record<string,unknown>}} */
const gaps = { staleRefs: [], missingCoverage: [], summary: {} };

// 3a. Refs de arquivo citadas nos docs que nao existem no disco.
//     So valida se a pasta-raiz do caminho existe (evita falso-positivo de
//     exemplos ilustrativos como `src/lib/foo.ts` num template sem src/).
const pathRe = /(?:src|scripts|config|tests|app|lib|\.claude|\.github|docs)\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/g;

/**
 * Caminho dentro de bloco de codigo e template, nao link.
 * `// src/lib/db/schema/exemplo.ts` no topo de um ```typescript diz ONDE o
 * arquivo deve nascer — cobrar que ele ja exista transforma todo doc de padrao
 * em drift permanente. Ref em prosa continua sendo cobrada.
 */
const semCodeFence = (texto) => texto.replace(/```[\s\S]*?```/g, "");

const seenRef = new Set();
for (const d of docBlobs) {
  const matches = semCodeFence(d.text).match(pathRe) || [];
  for (const raw of matches) {
    const ref = raw.replace(/[.,)]+$/, ""); // tira pontuacao final colada
    const topDir = ref.split("/")[0];
    const topExists = existsSync(join(ROOT, topDir));
    if (!topExists) continue; // pasta nem existe -> ref ilustrativa, ignora
    const key = ref + "::" + d.file;
    if (seenRef.has(key)) continue;
    seenRef.add(key);
    if (!existsSync(join(ROOT, ref))) {
      gaps.staleRefs.push({ ref, doc: d.file });
    }
  }
}

// 3b. Cobertura: itens do codigo sem mencao em nenhum doc.
const mentioned = (term) => allDocText.includes(term);
if (hasSrc) {
  for (const t of tables) {
    if (!mentioned(t.name)) gaps.missingCoverage.push({ tipo: "tabela", nome: t.name, file: t.file });
  }
  for (const r of routes) {
    if (!mentioned(r.route)) gaps.missingCoverage.push({ tipo: "rota", nome: r.route });
  }
  for (const a of actionFns) {
    if (!mentioned(a.fn)) gaps.missingCoverage.push({ tipo: "action", nome: a.fn, file: a.file });
  }
}

const totalGaps = gaps.staleRefs.length + gaps.missingCoverage.length;

gaps.summary = {
  hasSrc,
  docs: docFiles.length,
  tabelas: tables.length,
  rotas: routes.length,
  actions: actionFns.length,
  componentes: components.length,
  staleRefs: gaps.staleRefs.length,
  semCobertura: gaps.missingCoverage.length,
  totalGaps,
};

// ---------------------------------------------------------------------------
// 4. Saida
// ---------------------------------------------------------------------------

if (asJson) {
  console.log(JSON.stringify(gaps, null, 2));
} else {
  const L = [];
  L.push("# Docs Check — Relatorio de Drift");
  L.push("");
  L.push("> Gerado por `scripts/docs-check.mjs`. Prova o drift; nao escreve docs.");
  L.push("");
  L.push("## Resumo");
  L.push("");
  L.push("| Metrica | Valor |");
  L.push("|---------|-------|");
  L.push(`| Tem src/ | ${hasSrc ? "sim" : "nao (modo template)"} |`);
  L.push(`| Docs analisados | ${docFiles.length} |`);
  L.push(`| Tabelas | ${tables.length} |`);
  L.push(`| Rotas de API | ${routes.length} |`);
  L.push(`| Server Actions | ${actionFns.length} |`);
  L.push(`| Componentes | ${components.length} |`);
  L.push(`| **Refs quebradas** | ${gaps.staleRefs.length} |`);
  L.push(`| **Sem cobertura** | ${gaps.missingCoverage.length} |`);
  L.push("");

  if (gaps.staleRefs.length) {
    L.push("## Refs quebradas (doc cita arquivo que nao existe)");
    L.push("");
    for (const s of gaps.staleRefs) L.push(`- \`${s.ref}\` — citado em \`${s.doc}\``);
    L.push("");
  }

  if (gaps.missingCoverage.length) {
    L.push("## Sem cobertura (codigo existe, nenhum doc menciona)");
    L.push("");
    for (const m of gaps.missingCoverage) {
      L.push(`- **${m.tipo}** \`${m.nome}\`${m.file ? ` — \`${m.file}\`` : ""}`);
    }
    L.push("");
  }

  if (totalGaps === 0) {
    L.push("## Resultado");
    L.push("");
    L.push(hasSrc
      ? "Nenhum gap detectado. Docs alinhados ao codigo."
      : "Sem `src/` (base e template). Nenhuma ref quebrada nos docs.");
    L.push("");
  }

  console.log(L.join("\n"));
}

if (strict && totalGaps > 0) process.exit(1);

export { gaps };
