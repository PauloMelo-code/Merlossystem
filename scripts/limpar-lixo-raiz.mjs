#!/usr/bin/env node
// @ts-check
/**
 * limpar-lixo-raiz.mjs — Remove arquivos-lixo da raiz do repositorio.
 *
 * O problema: no PowerShell, comando inline com parentese, aspas ou `>` faz o
 * shell interpretar um pedaco do codigo como REDIRECIONAMENTO e criar um arquivo
 * com o nome daquele fragmento. Rodar `node -e "...x.map(y => y.id)..."` deixa na
 * raiz um arquivo chamado `y.id)` de 0 byte. Em meses isso vira centena de
 * arquivos, poluindo `git status`, autocomplete e qualquer glob.
 *
 * Este script NAO APAGA: move para uma pasta de quarentena com INVENTARIO.txt
 * registrando a origem de cada arquivo. Conferir e apagar e decisao sua.
 *
 * Uso:
 *   node scripts/limpar-lixo-raiz.mjs                  # dry-run no repo atual
 *   node scripts/limpar-lixo-raiz.mjs --aplicar        # move para a quarentena
 *   node scripts/limpar-lixo-raiz.mjs <repo> [repo...] # varre outros repos
 *   node scripts/limpar-lixo-raiz.mjs --quarentena <dir>
 *   node scripts/limpar-lixo-raiz.mjs --json
 *   node scripts/limpar-lixo-raiz.mjs --help
 *
 * Exit code: 0 sempre no dry-run; 1 se alguma movimentacao falhar.
 *
 * Salvaguardas (nesta ordem):
 *   1. so a RAIZ do repo, so arquivo regular (nunca pasta, nunca recursivo)
 *   2. NUNCA toca arquivo rastreado pelo git — a leitura usa `git ls-files -z`,
 *      porque sem `-z` o git escapa nome nao-ASCII em octal e a comparacao falha
 *   3. lista MANTER para nome legitimo que casa com o padrao (ex.: "planilha (1).xlsx")
 *   4. move, nao apaga
 *
 * Prevencao: em vez de `node -e "..."` com parentese e aspas, escreva um .mjs em
 * scripts/ e rode `node scripts/o-arquivo.mjs`.
 */

import { readdirSync, statSync, existsSync, mkdirSync, renameSync, writeFileSync, appendFileSync } from "node:fs";
import { join, extname, basename, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

/* ---------------------------------------------------------------- criterios */

/** Caracteres que praticamente nunca aparecem em nome de arquivo de projeto e
 *  sao a assinatura do redirecionamento quebrado. */
const SUSPEITO = /[(){}[\]'"`$!|<>;+,=*?&^~@#%]|^\d+$|^[\s.,+\-]+$/;

/** Extensoes de arquivo que realmente existe num projeto. */
const EXT_OK = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".yml", ".yaml",
  ".html", ".css", ".scss", ".sql", ".sh", ".py", ".txt", ".svg", ".png", ".jpg",
  ".jpeg", ".ico", ".webp", ".lock", ".toml", ".env", ".sample", ".example",
  ".prisma", ".editorconfig", ".docx", ".pdf", ".xlsx", ".csv", ".zip", ".skill",
  ".log", ".tsbuildinfo",
]);

/** Nomes sem extensao que sao legitimos na raiz. */
const NOMES_OK = new Set([
  "Dockerfile", "Makefile", "LICENSE", "README", "CHANGELOG", "Procfile",
  ".gitignore", ".dockerignore", ".gitattributes", ".npmrc", ".nvmrc", ".env",
  ".editorconfig", ".prettierrc", ".eslintrc",
]);

/** Arquivos que legitimamente podem ter 0 byte. */
const VAZIO_OK = new Set([
  ".gitkeep", ".keep", ".gitignore", ".npmignore", ".dockerignore", ".env",
  ".env.local", ".nojekyll", "py.typed", "__init__.py", ".gitattributes",
  ".watchmanconfig", ".eslintcache", ".babelrc", ".prettierignore", ".eslintignore",
]);

/** Nome legitimo que casa com SUSPEITO (ex.: copia baixada com "(1)" no nome).
 *  Acrescente aqui em vez de afrouxar o SUSPEITO. */
const MANTER = [
  /\(\d+\)\.(xlsx|xls|csv|pdf|docx|zip|skill|png|jpg|jpeg)$/i,  // "arquivo (1).xlsx"
];

/* -------------------------------------------------------------------- args */

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(
    [
      "limpar-lixo-raiz.mjs — move arquivos-lixo da raiz do repo para quarentena",
      "",
      "  node scripts/limpar-lixo-raiz.mjs                  dry-run no repo atual",
      "  node scripts/limpar-lixo-raiz.mjs --aplicar        move de verdade",
      "  node scripts/limpar-lixo-raiz.mjs <repo> [repo...] varre outros repos",
      "  node scripts/limpar-lixo-raiz.mjs --quarentena <dir>",
      "  node scripts/limpar-lixo-raiz.mjs --json",
      "",
      "Nunca toca arquivo rastreado pelo git. Move, nao apaga.",
    ].join("\n"),
  );
  process.exit(0);
}

const aplicar = args.includes("--aplicar");
const json = args.includes("--json");
const iQ = args.indexOf("--quarentena");
const quarentenaBase = resolve(iQ >= 0 ? args[iQ + 1] : join(process.cwd(), ".lixo-quarentena"));
// resolve para absoluto: o inventario registra a origem real, e a comparacao
// "a quarentena esta dentro do repo?" so funciona com caminho absoluto.
const repos = args
  .filter((a, i) => !a.startsWith("--") && !(iQ >= 0 && i === iQ + 1))
  .map((r) => resolve(r));
if (repos.length === 0) repos.push(process.cwd());

/* ----------------------------------------------------------------- helpers */

/** Nomes rastreados pelo git na raiz. `null` se nao for repo git. */
function rastreados(repo) {
  try {
    // -z e obrigatorio: sem ele o git devolve nome nao-ASCII escapado em octal
    // ("N\342\224O"), que nao casa com o nome vindo do readdir — e ai um arquivo
    // VERSIONADO passa pelo filtro. Ja aconteceu.
    const buf = execFileSync("git", ["-C", repo, "ls-files", "-z"], {
      encoding: "buffer",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 60_000,
    });
    const nomes = buf.toString("utf8").split("\0").filter(Boolean);
    return new Set(nomes.map((n) => n.split("/")[0]));
  } catch {
    return null;
  }
}

function nomePlausivel(nome) {
  if (NOMES_OK.has(nome)) return true;
  if (MANTER.some((re) => re.test(nome))) return true;
  const ext = extname(nome).toLowerCase();
  const raiz = nome.slice(0, nome.length - ext.length);
  return EXT_OK.has(ext) && raiz.length > 0 && !SUSPEITO.test(raiz);
}

/** É lixo? Dois caminhos independentes:
 *   a) nome com caractere impossivel  -> lixo em qualquer tamanho
 *   b) 0 byte com nome nao-plausivel  -> lixo (pega `CREDITO`, `e.status`, `FILA`)
 */
function classificar(nome, tamanho) {
  if (VAZIO_OK.has(nome)) return null;
  if (nomePlausivel(nome)) return null;
  if (SUSPEITO.test(nome)) return "nome-quebrado";
  if (tamanho === 0) return "vazio";
  return null;
}

/** Nome utilizavel na quarentena a partir de um nome quebrado.
 *
 * O sufixo com hash do nome ORIGINAL nao e enfeite: nomes-lixo diferentes
 * ("'", "(d", "{,") colapsam todos para "_" depois de trocar caractere
 * invalido, e um sobrescreveria o outro em silencio. Com o hash, dois nomes
 * distintos nunca geram o mesmo destino.
 */
function nomeSeguro(nome) {
  const limpo = [...nome]
    .map((c) => (/[a-zA-Z0-9._\- ]/.test(c) ? c : "_"))
    .join("")
    .slice(0, 80)
    .replace(/[. ]+$/, "");                 // Windows engole ponto/espaco no fim
  const hash = createHash("sha1").update(nome, "utf8").digest("hex").slice(0, 8);
  return `${limpo || "sem_nome"}~${hash}`;
}

/* -------------------------------------------------------------------- varre */

const achados = [];
for (const repo of repos) {
  if (!existsSync(repo)) {
    console.error(`repo nao encontrado: ${repo}`);
    continue;
  }
  const tracked = rastreados(repo);
  for (const nome of readdirSync(repo).sort()) {
    const p = join(repo, nome);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    if (tracked && tracked.has(nome)) continue;   // versionado: nunca tocar
    const motivo = classificar(nome, st.size);
    if (motivo) achados.push({ repo, nome, tamanho: st.size, motivo });
  }
}

/* ------------------------------------------------------------------ saida */

if (json) {
  console.log(JSON.stringify({ aplicar, total: achados.length, achados }, null, 2));
} else {
  const porRepo = new Map();
  for (const a of achados) {
    if (!porRepo.has(a.repo)) porRepo.set(a.repo, []);
    porRepo.get(a.repo).push(a);
  }
  for (const [repo, itens] of porRepo) {
    const vazios = itens.filter((i) => i.tamanho === 0).length;
    console.log(`\n### ${basename(repo)}  (${itens.length} — ${vazios} de 0 byte)`);
    for (const i of itens.filter((x) => x.tamanho > 0)) {
      console.log(`    [${String(i.tamanho).padStart(7)} B] ${JSON.stringify(i.nome)}`);
    }
    const nomesVazios = itens.filter((x) => x.tamanho === 0).map((x) => JSON.stringify(x.nome));
    if (nomesVazios.length) {
      console.log(`    [0 B x${nomesVazios.length}] ${nomesVazios.slice(0, 8).join("  ")}${nomesVazios.length > 8 ? "  ..." : ""}`);
    }
  }
  console.log(`\n${"=".repeat(64)}`);
  console.log(`${achados.length} arquivo(s) de lixo em ${porRepo.size} repo(s)`);
}

if (achados.length === 0) process.exit(0);

if (!aplicar) {
  if (!json) console.log("\nDRY-RUN — nada foi movido. Rode com --aplicar para mover para a quarentena.");
  process.exit(0);
}

/* ----------------------------------------------------------------- aplicar */

mkdirSync(quarentenaBase, { recursive: true });
const inventario = join(quarentenaBase, "INVENTARIO.txt");
if (!existsSync(inventario)) {
  writeFileSync(
    inventario,
    "Quarentena de arquivos-lixo da raiz dos repositorios.\nOrigem de cada arquivo, para reverter se preciso.\n\n",
    "utf8",
  );
}

let movidos = 0;
let falhas = 0;
const linhas = [`--- ${new Date().toISOString()} ---`];
for (const { repo, nome, tamanho, motivo } of achados) {
  const destinoDir = join(quarentenaBase, basename(repo));
  mkdirSync(destinoDir, { recursive: true });
  // com o hash no nome, colisao so acontece se o MESMO arquivo for movido duas
  // vezes; o laco fica como rede de seguranca.
  let destino = join(destinoDir, nomeSeguro(nome));
  let n = 1;
  while (existsSync(destino)) destino = join(destinoDir, `${nomeSeguro(nome)}-${n++}`);
  try {
    renameSync(join(repo, nome), destino);
    linhas.push(`${repo}\t${JSON.stringify(nome)}\t${tamanho} B\t${motivo}\t-> ${destino}`);
    movidos++;
  } catch (err) {
    linhas.push(`FALHA\t${repo}\t${JSON.stringify(nome)}\t${err.message}`);
    falhas++;
  }
}
appendFileSync(inventario, linhas.join("\n") + "\n", "utf8");

console.log(`\nmovidos: ${movidos} | falhas: ${falhas}`);
console.log(`quarentena: ${quarentenaBase}`);
console.log("Confira e apague quando quiser — o INVENTARIO.txt tem a origem de cada arquivo.");

// A quarentena dentro do repo suja o `git status`. Avisa, mas nao mexe no
// .gitignore de ninguem — isso e decisao de quem mantem o repo.
const nomeQ = basename(quarentenaBase);
for (const repo of new Set(achados.map((a) => a.repo))) {
  const gi = join(repo, ".gitignore");
  if (!quarentenaBase.startsWith(repo) || !existsSync(gi)) continue;
  try {
    const { readFileSync } = await import("node:fs");
    if (!readFileSync(gi, "utf8").split(/\r?\n/).some((l) => l.trim() === nomeQ || l.trim() === `${nomeQ}/`)) {
      console.log(`\nDica: acrescente "${nomeQ}/" ao .gitignore de ${basename(repo)} para nao sujar o git status.`);
    }
  } catch { /* .gitignore ilegivel: sem dica, sem drama */ }
}

process.exit(falhas > 0 ? 1 : 0);
