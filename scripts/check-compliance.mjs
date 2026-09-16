#!/usr/bin/env node
// @ts-check
/**
 * check-compliance.mjs — Auditor de conformidade do MerlostoreChat.
 *
 * Fork da Estrutura Base com as quatro diferencas decididas em `01-dados.md §4.3`,
 * `04-ui.md §3.1` e `03-arquitetura.md §2 (A-19)`, todas provadas por
 * `tests/check-compliance.test.mjs`:
 *   1. marcador `compliance:framework` para as 4 tabelas do Better Auth;
 *   2. excecao de caminho `src/components/ui/` SO na regra `arquivo-grande`;
 *   3. delete fisico tambem pega `tx.delete(` e `DELETE FROM`;
 *   4. regex de segredo cobre `sk-ant-`, `sk-proj-` e chave privada PKCS#8.
 *
 * Escaneia o codigo-fonte procurando violacoes das regras absolutas do projeto.
 * Sem dependencias externas (Node puro). Cross-platform (Windows/Mac/Linux).
 *
 * Uso:
 *   node scripts/check-compliance.mjs                # escaneia src/ (ou cwd)
 *   node scripts/check-compliance.mjs --file <path>  # escaneia um arquivo
 *   node scripts/check-compliance.mjs --json         # saida JSON (CI/IA)
 *   node scripts/check-compliance.mjs --quiet        # so erros (esconde avisos)
 *   node scripts/check-compliance.mjs --help
 *
 * Exit code: 1 se houver ERROS, 0 caso contrario (avisos nao falham).
 *
 * Regras checadas:
 *   [ERRO]  Prisma            — projeto usa Drizzle ORM, nunca Prisma
 *   [ERRO]  SQLite            — projeto usa PostgreSQL, nunca SQLite
 *   [ERRO]  Delete fisico     — db/tx.delete(), deleteMany(), DELETE FROM
 *   [ERRO]  DROP destrutivo   — DROP TABLE/DATABASE em .sql
 *   [ERRO]  Arquivo > 500 lin — quebrar em modulos menores
 *   [ERRO]  Tabela sem auditoria — pgTable faltando created_at/updated_at/deleted_at/is_deleted
 *   [ERRO]  Segredo hardcoded — chaves de API, tokens, private keys
 *   [AVISO] Query sem filtro  — .from() sem mencionar is_deleted no arquivo
 *   [AVISO] CASCADE em FK      — onDelete: 'cascade' (preferir restrict)
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, extname, relative, basename, resolve } from "node:path";

const ROOT = process.cwd();
const MAX_LINES = 500;

/**
 * Excecao de caminho do limite de linhas (04-ui.md §3.1, ADR 0024).
 * `src/components/ui/` e codigo de terceiro vendorizado pelo CLI do shadcn, que
 * a regra da casa proibe editar: exigir que caiba em 499 linhas seria exigir que
 * se edite. Vale SO para `arquivo-grande` — prisma, sqlite, delete fisico e
 * segredo continuam valendo la dentro.
 */
const ISENTOS_DE_TAMANHO = ["src/components/ui/"];

const IGNORE_DIRS = new Set([
  "node_modules", ".next", ".git", "dist", "build", "coverage",
  ".turbo", "out", ".vercel", "templates", // templates contem padroes-ouro, nao escanear
  "migrations", "drizzle", // SQL gerado por drizzle-kit — nao se aplica limite de 500 linhas
]);

const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const SQL_EXT = new Set([".sql"]);

// Os proprios scripts de auditoria contem os padroes proibidos como DEFINICAO
// de regra (ex.: o regex que detecta Prisma). Nunca auto-sinalizar.
const SKIP_FILES = new Set([
  "check-compliance.mjs", "project-map.mjs",
  "pre-write-guard.mjs", "post-write-check.mjs", // hooks: mesmos padroes como regra
]);

// ---------------------------------------------------------------------------
// Regras baseadas em regex (linha a linha)
// ---------------------------------------------------------------------------

/** @type {{id:string,level:'error'|'warn',re:RegExp,msg:string,ext?:Set<string>}[]} */
const LINE_RULES = [
  {
    id: "prisma",
    level: "error",
    re: /@prisma\/client|new\s+PrismaClient|from\s+["']prisma["']|require\(["']@prisma\/client["']\)/,
    msg: "Prisma detectado. Este projeto usa Drizzle ORM. Remova o Prisma.",
  },
  {
    id: "sqlite",
    level: "error",
    re: /better-sqlite3|drizzle-orm\/better-sqlite3|from\s+["']sqlite3?["']|:memory:/,
    msg: "SQLite detectado. Este projeto usa PostgreSQL em todos os ambientes.",
  },
  {
    id: "delete-fisico",
    level: "error",
    // `tx.delete(` e `DELETE FROM` entram aqui porque escapavam da versao da
    // base: o delete dentro de uma transacao e o SQL cru sao exatamente os dois
    // caminhos que o codigo novo usaria sem perceber (06/§5.2, trava T25).
    re: /\bdb\.delete\s*\(|\btx\.delete\s*\(|\.deleteMany\s*\(|\bdrizzle[\w.]*\.delete\s*\(|\bDELETE\s+FROM\b/i,
    msg: "Delete fisico detectado. Use soft delete (is_deleted = true).",
  },
  {
    id: "drop-destrutivo",
    level: "error",
    ext: SQL_EXT,
    re: /\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i,
    msg: "DROP destrutivo em SQL. Proibido dropar estruturas de dados.",
  },
  {
    id: "segredo",
    level: "error",
    // Ampliada em relacao a base (06/§5.2): `sk-ant-…` e `sk-proj-…` tem hifen
    // no meio e escapavam de `sk-[A-Za-z0-9]{20,}`; e a chave PKCS#8 comeca com
    // `-----BEGIN PRIVATE KEY-----`, sem o algoritmo que a regex antiga exigia.
    re: /sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN\s+((RSA|EC|DSA|OPENSSH|ENCRYPTED)\s+)?PRIVATE KEY-----|ghp_[A-Za-z0-9]{30,}/,
    msg: "Possivel segredo/credencial hardcoded. Mova para variavel de ambiente.",
  },
  {
    id: "cascade",
    level: "warn",
    re: /onDelete:\s*["']cascade["']/i,
    msg: "CASCADE em FK. Preferir RESTRICT para dados criticos.",
  },
];

// ---------------------------------------------------------------------------
// Coleta de arquivos
// ---------------------------------------------------------------------------

/** @param {string} dir @param {string[]} acc */
function walk(dir, acc) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".github") {
      if (IGNORE_DIRS.has(e.name)) continue;
    }
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (IGNORE_DIRS.has(e.name)) continue;
      walk(full, acc);
    } else if (e.isFile()) {
      if (SKIP_FILES.has(e.name)) continue;
      const ext = extname(e.name);
      if (CODE_EXT.has(ext) || SQL_EXT.has(ext)) acc.push(full);
    }
  }
  return acc;
}

// ---------------------------------------------------------------------------
// Checagem de tabelas Drizzle (pgTable sem colunas de auditoria)
// ---------------------------------------------------------------------------

const AUDIT_COLS = ["created_at", "updated_at", "deleted_at", "is_deleted"];

/**
 * Marcador de excecao para tabela append-only (ex.: a propria trilha de
 * auditoria, especificada em docs/back.md sem updated_at/deleted_at/is_deleted).
 * Um log que pode ser alterado ou "soft deletado" nao e trilha de auditoria.
 *
 * Uso: comentar `compliance:append-only` nas linhas acima do pgTable.
 * So vale com justificativa escrita ao lado — nao e escape hatch generico.
 */
const APPEND_ONLY = "compliance:append-only";

/**
 * Marcador de excecao para tabela que a BIBLIOTECA governa (01-dados.md §4.3,
 * ADR 0008). O Better Auth apaga fisicamente sessao, verificacao, fator e
 * passkey e nao tem opcao de soft delete: `usuarios_sessoes`,
 * `usuarios_verificacoes`, `usuarios_totp` e `usuarios_passkeys` nao recebem as
 * colunas da casa. `is_deleted = false` numa linha que a lib vai apagar e
 * mentira gravada no banco — a prova do ciclo de vida fica em `auth_eventos`.
 *
 * Uso: comentar `compliance:framework` nas linhas acima do pgTable, com a
 * justificativa escrita ao lado. Nao e escape hatch generico: `usuarios` e
 * `usuarios_contas` TEM as 5 colunas e nunca sao apagados.
 */
const FRAMEWORK = "compliance:framework";

/**
 * Devolve o trecho `{ ... }` que comeca em `openIdx`, balanceando as chaves.
 * @param {string} content @param {number} openIdx @returns {string|null}
 */
function corpoDoObjeto(content, openIdx) {
  if (content[openIdx] !== "{") return null;
  let depth = 0;
  for (let i = openIdx; i < content.length; i++) {
    const c = content[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return content.slice(openIdx, i + 1);
    }
  }
  return null;
}

/**
 * Objetos que EMPACOTAM colunas de auditoria para serem espalhados nas tabelas
 * (`...colunasAuditoria`). Mapeia nome do pacote -> colunas que ele fornece.
 *
 * Sem isto, o padrao que a propria base recomenda — um `_shared.ts` com as
 * quatro colunas, espalhado em toda tabela — era acusado como "tabela sem
 * auditoria" em TODAS as tabelas do projeto. Portao que da falso positivo em
 * codigo correto e portao que a equipe aprende a ignorar.
 * @type {Map<string, Set<string>>}
 */
const PACOTES_AUDITORIA = new Map();

/**
 * Pre-passada: acha `const NOME = { ... }` que declare colunas de auditoria.
 * Roda uma vez, sobre o projeto inteiro, antes da analise por arquivo.
 * @param {string[]} files
 */
function coletarPacotesDeAuditoria(files) {
  for (const file of files) {
    if (!CODE_EXT.has(extname(file))) continue;
    let content;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const re = /(?:export\s+)?const\s+(\w+)\s*=\s*\{/g;
    let m;
    while ((m = re.exec(content)) !== null) {
      const nome = m[1];
      const corpo = corpoDoObjeto(content, m.index + m[0].length - 1);
      if (!corpo) continue;
      const fornece = AUDIT_COLS.filter((c) => corpo.includes(c));
      if (fornece.length === 0) continue;
      const acumulado = PACOTES_AUDITORIA.get(nome) ?? new Set();
      for (const c of fornece) acumulado.add(c);
      PACOTES_AUDITORIA.set(nome, acumulado);
    }
  }
}

/**
 * Extrai o corpo {...} de cada pgTable('nome', { ... }) e verifica as colunas.
 * @param {string} content @param {string} file @param {Finding[]} findings
 */
function checkDrizzleTables(content, file, findings) {
  const re = /pgTable\s*\(\s*["'`]([^"'`]+)["'`]\s*,\s*\{/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const tableName = m[1];
    // Janela acima da declaracao: o marcador precisa estar perto da tabela,
    // para nao isentar as demais tabelas de um arquivo com varias.
    const janela = content.slice(Math.max(0, m.index - 600), m.index);
    if (janela.includes(APPEND_ONLY) || janela.includes(FRAMEWORK)) continue;
    const openIdx = content.indexOf("{", m.index + m[0].length - 1);
    if (openIdx === -1) continue;
    const body = corpoDoObjeto(content, openIdx);
    if (!body) continue;

    // Colunas que chegam por spread de um pacote de auditoria (`...colunasAuditoria`).
    // So conta o pacote que REALMENTE declara a coluna: espalhar um objeto
    // qualquer nao isenta a tabela.
    const viaPacote = new Set();
    for (const s of body.matchAll(/\.\.\.(\w+)/g)) {
      for (const col of PACOTES_AUDITORIA.get(s[1]) ?? []) viaPacote.add(col);
    }

    const missing = AUDIT_COLS.filter((col) => !body.includes(col) && !viaPacote.has(col));
    if (missing.length > 0) {
      const line = content.slice(0, m.index).split("\n").length;
      findings.push({
        level: "error",
        id: "tabela-sem-auditoria",
        file,
        line,
        msg: `Tabela "${tableName}" sem colunas de auditoria: ${missing.join(", ")}.`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Checagem heuristica: query select sem filtro is_deleted
// ---------------------------------------------------------------------------

// Helpers que JA aplicam o filtro de soft delete. Um arquivo que usa qualquer
// um deles esta filtrando, mesmo sem escrever "is_deleted" literalmente —
// checar so o literal produzia uma enxurrada de aviso falso, e aviso que
// ninguem le nao protege nada.
// Registre aqui o helper novo que a base adotar. Nome que nao esta nesta lista
// vira aviso falso em todo arquivo que o usa.
const HELPERS_SOFT_DELETE =
  /\b(ativo|ativos|ativoPorId|condicaoTrava|contarAtivos|vivos|vivosE|travaDeColisao|marcaDeExclusao)\s*\(/;

/** @param {string} content @param {string} file @param {Finding[]} findings */
function checkSoftDeleteFilter(content, file, findings) {
  const hasSelect = /\.from\s*\(/.test(content) && /\.select\s*\(/.test(content);
  if (!hasSelect) return;
  // `is_deleted` e o nome da coluna; `isDeleted` e como o Drizzle a expoe em
  // TypeScript. Um `eq(t.isDeleted, false)` escrito a mao filtra igual.
  if (/is_deleted|isDeleted/.test(content)) return; // filtra explicitamente
  if (HELPERS_SOFT_DELETE.test(content)) return; // filtra via helper
  // pega a primeira ocorrencia de .from( para apontar a linha
  const idx = content.search(/\.from\s*\(/);
  const line = content.slice(0, idx).split("\n").length;
  findings.push({
    level: "warn",
    id: "query-sem-filtro",
    file,
    line,
    msg: "Arquivo faz SELECT mas nunca menciona is_deleted. Confirme que filtra deletados.",
  });
}

// ---------------------------------------------------------------------------
// Analise de um arquivo
// ---------------------------------------------------------------------------

/**
 * @typedef {{level:'error'|'warn',id:string,file:string,line:number,msg:string}} Finding
 * @param {string} file @returns {Finding[]}
 */
function analyzeFile(file) {
  /** @type {Finding[]} */
  const findings = [];
  if (SKIP_FILES.has(basename(file))) return findings; // vale tambem no modo --file
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    return findings;
  }
  const ext = extname(file);
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  const lines = content.split("\n");

  // tamanho do arquivo (a unica regra com excecao de caminho — 04-ui.md §3.1)
  const isentoDeTamanho = ISENTOS_DE_TAMANHO.some((p) => rel.startsWith(p));
  if (lines.length > MAX_LINES && !isentoDeTamanho) {
    findings.push({
      level: "error",
      id: "arquivo-grande",
      file: rel,
      line: lines.length,
      msg: `Arquivo com ${lines.length} linhas (limite ${MAX_LINES}). Quebre em modulos.`,
    });
  }

  // regras por linha
  lines.forEach((text, i) => {
    // ignora linhas de comentario obvio para reduzir falso-positivo de exemplos
    const trimmed = text.trim();
    const isComment = trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
    for (const rule of LINE_RULES) {
      if (rule.ext && !rule.ext.has(ext)) continue;
      if (isComment && rule.id !== "segredo") continue; // segredo vale mesmo em comentario
      if (rule.re.test(text)) {
        findings.push({
          level: rule.level,
          id: rule.id,
          file: rel,
          line: i + 1,
          msg: rule.msg,
        });
      }
    }
  });

  // checagens estruturais (so codigo TS/JS)
  if (CODE_EXT.has(ext)) {
    checkDrizzleTables(content, rel, findings);
    checkSoftDeleteFilter(content, rel, findings);
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(readFileSync(new URL(import.meta.url)).toString().split("\n").slice(2, 26).join("\n").replace(/^ \* ?/gm, ""));
    process.exit(0);
  }
  const asJson = args.includes("--json");
  const quiet = args.includes("--quiet");
  const fileFlag = args.indexOf("--file");

  const srcDir = join(ROOT, "src");
  const scanRoot = existsSync(srcDir) ? srcDir : ROOT;
  const todosOsArquivos = walk(scanRoot, []);

  /** @type {string[]} */
  let files = [];
  if (fileFlag !== -1 && args[fileFlag + 1]) {
    const target = resolve(args[fileFlag + 1]);
    if (existsSync(target) && statSync(target).isFile()) files = [target];
  } else {
    files = todosOsArquivos;
  }

  // Pre-passada sempre sobre o projeto INTEIRO, mesmo com --file: o pacote de
  // colunas de auditoria mora em outro arquivo (`_shared.ts`) e sem ele a
  // checagem de um schema isolado acusaria tabela sem auditoria.
  coletarPacotesDeAuditoria(todosOsArquivos);

  /** @type {Finding[]} */
  let findings = [];
  for (const f of files) findings = findings.concat(analyzeFile(f));

  const errors = findings.filter((f) => f.level === "error");
  const warns = findings.filter((f) => f.level === "warn");

  if (asJson) {
    console.log(JSON.stringify({
      ok: errors.length === 0,
      scanned: files.length,
      errors: errors.length,
      warnings: warns.length,
      findings,
    }, null, 2));
    process.exit(errors.length === 0 ? 0 : 1);
  }

  const show = quiet ? errors : findings;
  if (show.length === 0) {
    console.log(`OK — ${files.length} arquivo(s) escaneado(s), nenhuma violacao.`);
    process.exit(0);
  }

  // agrupa por arquivo
  /** @type {Map<string,Finding[]>} */
  const byFile = new Map();
  for (const f of show) {
    const arr = byFile.get(f.file) || [];
    arr.push(f);
    byFile.set(f.file, arr);
  }
  for (const [file, fs] of byFile) {
    console.log(`\n${file}`);
    for (const f of fs.sort((a, b) => a.line - b.line)) {
      const tag = f.level === "error" ? "ERRO " : "AVISO";
      console.log(`  ${tag} L${f.line}  [${f.id}] ${f.msg}`);
    }
  }
  console.log(`\n${"-".repeat(60)}`);
  console.log(`Escaneados: ${files.length} | Erros: ${errors.length} | Avisos: ${warns.length}`);
  process.exit(errors.length === 0 ? 0 : 1);
}

main();
