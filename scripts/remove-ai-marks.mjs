#!/usr/bin/env node
// @ts-check
/**
 * remove-ai-marks.mjs — Remove marcas invisiveis que modelos de IA deixam no texto.
 *
 * Sem dependencias (Node puro). Cross-platform (Windows/Mac/Linux).
 *
 * Uso:
 *   node scripts/remove-ai-marks.mjs <arquivo...>        # so reporta
 *   node scripts/remove-ai-marks.mjs --write <arquivo...> # corrige no lugar
 *   node scripts/remove-ai-marks.mjs --check <arquivo...> # exit 1 se achar (CI)
 *   node scripts/remove-ai-marks.mjs --dir docs           # varre uma pasta
 *   cat texto.md | node scripts/remove-ai-marks.mjs -     # stdin -> stdout
 *   node scripts/remove-ai-marks.mjs --selftest           # roda os testes
 *
 * Flags extras:
 *   --tipografia  tambem normaliza aspas curvas, reticencias e travessao
 *                 (NAO e marca invisivel — e escolha de estilo; fora do padrao)
 *
 * O que remove por padrao:
 *   - Zero-width: ZWSP, ZWNJ, ZWJ, word joiner, BOM, soft hyphen
 *   - Tags block (U+E0000-U+E007F): o canal preferido de marca d'agua oculta
 *   - Variation selectors (U+FE00-U+FE0F, U+E0100-U+E01EF) fora de emoji
 *   - Controles bidi (LRM/RLM, embeddings, overrides, isolates)
 *   - Espacos exoticos (NBSP, thin, narrow, hair...) -> espaco comum
 *
 * O que NAO remove:
 *   - ZWJ/ZWNJ entre emoji (sequencias tipo 👨‍👩‍👧 quebram sem ele)
 *   - Variation selector logo depois de emoji (VS16 faz o emoji renderizar)
 *   - Acentos, cedilha, ç, ~ — texto PT-BR fica intacto
 */

import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, extname, relative, basename } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();

// ---------------------------------------------------------------------------
// Catalogo de marcas
// ---------------------------------------------------------------------------

/** Invisiveis que somem sem deixar rastro. */
const INVISIVEIS = [
  { re: /​/g, nome: "zero-width space" },
  { re: /⁠/g, nome: "word joiner" },
  { re: /﻿/g, nome: "BOM / zero-width no-break space" },
  { re: /­/g, nome: "soft hyphen" },
  { re: /᠎/g, nome: "mongolian vowel separator" },
  { re: /[‎‏]/g, nome: "marca de direcao (LRM/RLM)" },
  { re: /[‪-‮]/g, nome: "embedding/override bidi" },
  { re: /[⁦-⁩]/g, nome: "isolate bidi" },
  // Tags block: caracteres que copiam ASCII de forma invisivel. E o meio
  // classico de esconder texto dentro de texto — nunca ha uso legitimo em doc.
  { re: /[\u{E0000}-\u{E007F}]/gu, nome: "tag character (marca d'agua)" },
];

/** Espacos que parecem espaco mas nao sao — viram espaco comum. */
const ESPACOS = {
  re: /[  -   　]/g,
  nome: "espaco fora do padrao",
  troca: " ",
};

/** Opcional (--tipografia): visivel, entao mexer aqui muda o texto de verdade. */
const TIPOGRAFIA = [
  { re: /[‘’‛]/g, nome: "aspa simples curva", troca: "'" },
  { re: /[“”‟]/g, nome: "aspa dupla curva", troca: '"' },
  { re: /…/g, nome: "reticencias em 1 caractere", troca: "..." },
  { re: /—/g, nome: "travessao (em dash)", troca: "--" },
  { re: /–/g, nome: "meia-risca (en dash)", troca: "-" },
];

const EMOJI = /\p{Extended_Pictographic}/u;

// ---------------------------------------------------------------------------
// Limpeza
// ---------------------------------------------------------------------------

/**
 * Remove ZWJ/ZWNJ e variation selectors SO quando nao fazem parte de emoji.
 * `👨‍👩` e familia; `pala‍vra` e marca escondida.
 * @param {string} texto
 * @returns {{texto:string, removidos:number}}
 */
function limparJuntores(texto) {
  const chars = [...texto];
  const saida = [];
  let removidos = 0;

  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const ehJuntor = c === "‌" || c === "‍";
    const ehVariation =
      (c >= "︀" && c <= "️") ||
      (c.codePointAt(0) ?? 0) >= 0xe0100 && (c.codePointAt(0) ?? 0) <= 0xe01ef;

    if (!ehJuntor && !ehVariation) {
      saida.push(c);
      continue;
    }

    const anterior = chars[i - 1] ?? "";
    const proximo = chars[i + 1] ?? "";

    // Juntor so vale entre dois emoji; variation selector, logo apos um emoji.
    const legitimo = ehJuntor
      ? EMOJI.test(anterior) && EMOJI.test(proximo)
      : EMOJI.test(anterior);

    if (legitimo) saida.push(c);
    else removidos++;
  }

  return { texto: saida.join(""), removidos };
}

/**
 * @param {string} texto
 * @param {{tipografia?:boolean}} [opcoes]
 * @returns {{texto:string, achados:{nome:string,qtd:number}[]}}
 */
export function limpar(texto, opcoes = {}) {
  /** @type {{nome:string,qtd:number}[]} */
  const achados = [];
  let saida = texto;

  for (const marca of INVISIVEIS) {
    const qtd = (saida.match(marca.re) || []).length;
    if (qtd > 0) {
      achados.push({ nome: marca.nome, qtd });
      saida = saida.replace(marca.re, "");
    }
  }

  const juntores = limparJuntores(saida);
  if (juntores.removidos > 0) {
    achados.push({ nome: "zero-width joiner fora de emoji", qtd: juntores.removidos });
    saida = juntores.texto;
  }

  const espacos = (saida.match(ESPACOS.re) || []).length;
  if (espacos > 0) {
    achados.push({ nome: ESPACOS.nome, qtd: espacos });
    saida = saida.replace(ESPACOS.re, ESPACOS.troca);
  }

  if (opcoes.tipografia) {
    for (const marca of TIPOGRAFIA) {
      const qtd = (saida.match(marca.re) || []).length;
      if (qtd > 0) {
        achados.push({ nome: marca.nome, qtd });
        saida = saida.replace(marca.re, marca.troca);
      }
    }
  }

  return { texto: saida, achados };
}

/** Linha e coluna da primeira ocorrencia, para o relatorio apontar onde. */
function primeiraOcorrencia(texto) {
  const todas = [...INVISIVEIS.map((m) => m.re), ESPACOS.re, /[‌‍]/g];
  let melhor = -1;
  for (const re of todas) {
    const copia = new RegExp(re.source, re.flags);
    const m = copia.exec(texto);
    if (m && (melhor === -1 || m.index < melhor)) melhor = m.index;
  }
  if (melhor === -1) return null;
  const antes = texto.slice(0, melhor);
  return { linha: antes.split("\n").length, coluna: melhor - antes.lastIndexOf("\n") };
}

// ---------------------------------------------------------------------------
// Coleta de arquivos
// ---------------------------------------------------------------------------

const IGNORAR = new Set([
  "node_modules", ".next", ".git", "dist", "build", "coverage",
  ".turbo", "out", ".vercel",
]);

/**
 * Este arquivo contem as marcas como DEFINICAO das regras (nos regex e nos
 * testes). Rodar `--write` nele apagaria os proprios padroes e quebraria a
 * ferramenta em silencio. Mesma protecao que check-compliance.mjs usa.
 */
const NUNCA_ANALISAR = new Set(["remove-ai-marks.mjs"]);

const EXT_TEXTO = new Set([
  ".md", ".txt", ".mdx", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".yml", ".yaml", ".css", ".html", ".sql", ".csv",
]);

function varrer(dir, acc = []) {
  let entradas;
  try {
    entradas = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entradas) {
    if (IGNORAR.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) varrer(full, acc);
    else if (EXT_TEXTO.has(extname(e.name)) && !NUNCA_ANALISAR.has(e.name)) acc.push(full);
  }
  return acc;
}

// ---------------------------------------------------------------------------
// Selftest — sem framework, roda com --selftest
// ---------------------------------------------------------------------------

function selftest() {
  const casos = [];
  const ok = (nome, real, esperado) => {
    const passou = real === esperado;
    casos.push({ nome, passou, real, esperado });
  };

  ok("zero-width space some", limpar("pa​lavra").texto, "palavra");
  ok("tag character some", limpar("oi\u{E0041}\u{E0042}").texto, "oi");
  ok("soft hyphen some", limpar("in­util").texto, "inutil");
  ok("BOM some", limpar("﻿texto").texto, "texto");
  ok("NBSP vira espaco", limpar("a b").texto, "a b");
  ok("bidi override some", limpar("a‮b").texto, "ab");
  ok("ZWJ escondido some", limpar("pala‍vra").texto, "palavra");
  ok("ZWJ de emoji fica", limpar("👨‍👩").texto, "👨‍👩");
  ok("VS16 depois de emoji fica", limpar("☺️").texto, "☺️");
  ok("VS solto some", limpar("a️b").texto, "ab");
  ok("acento PT-BR intacto", limpar("coração, ação, ãeêç").texto, "coração, ação, ãeêç");
  ok("texto limpo nao muda", limpar("nada aqui").texto, "nada aqui");
  ok("emoji simples intacto", limpar("tudo certo 🎉").texto, "tudo certo 🎉");
  ok("tipografia off por padrao", limpar("“aspas”").texto, "“aspas”");
  ok("tipografia on troca", limpar("“aspas”", { tipografia: true }).texto, '"aspas"');
  ok("travessao so com flag", limpar("a—b", { tipografia: true }).texto, "a--b");

  const r = limpar("a​b​c");
  ok("conta ocorrencias", String(r.achados[0]?.qtd), "2");
  ok("nao acha em texto limpo", String(limpar("limpo").achados.length), "0");

  // O proprio script guarda as marcas como definicao de regra: se ele entrasse
  // na varredura, um --write apagaria os padroes e quebraria a ferramenta.
  ok("nao analisa a si mesmo", String(NUNCA_ANALISAR.has("remove-ai-marks.mjs")), "true");
  ok(
    "varredura pula o proprio arquivo",
    String(varrer(new URL(".", import.meta.url).pathname.replace(/^\//, ""))
      .some((f) => basename(f) === "remove-ai-marks.mjs")),
    "false"
  );

  const falhas = casos.filter((c) => !c.passou);
  for (const c of casos) {
    const marca = c.passou ? "ok  " : "FALHOU";
    console.log(`${marca} ${c.nome}`);
    if (!c.passou) console.log(`      esperado ${JSON.stringify(c.esperado)}, veio ${JSON.stringify(c.real)}`);
  }
  console.log(`\n${casos.length - falhas.length}/${casos.length} passaram`);
  process.exit(falhas.length === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function lerStdin() {
  let dados = "";
  process.stdin.setEncoding("utf8");
  for await (const parte of process.stdin) dados += parte;
  return dados;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--selftest")) return selftest();
  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    console.log(readFileSync(new URL(import.meta.url)).toString().split("\n").slice(2, 34).join("\n").replace(/^ \* ?/gm, ""));
    process.exit(0);
  }

  const escrever = args.includes("--write");
  const checar = args.includes("--check");
  const tipografia = args.includes("--tipografia");

  // stdin -> stdout
  if (args.includes("-")) {
    const entrada = await lerStdin();
    process.stdout.write(limpar(entrada, { tipografia }).texto);
    return;
  }

  /** @type {string[]} */
  let arquivos = [];
  const iDir = args.indexOf("--dir");
  if (iDir !== -1 && args[iDir + 1]) {
    arquivos = varrer(args[iDir + 1]);
  } else {
    arquivos = args.filter((a) => !a.startsWith("--") && existsSync(a));
    arquivos = arquivos.flatMap((a) => (statSync(a).isDirectory() ? varrer(a) : [a]));
    // Vale tambem quando passam o arquivo direto na linha de comando.
    arquivos = arquivos.filter((a) => !NUNCA_ANALISAR.has(basename(a)));
  }

  if (arquivos.length === 0) {
    console.log("Nenhum arquivo para analisar.");
    process.exit(0);
  }

  let comMarca = 0;
  let totalMarcas = 0;

  for (const arquivo of arquivos) {
    let conteudo;
    try {
      conteudo = readFileSync(arquivo, "utf8");
    } catch {
      continue;
    }
    const { texto, achados } = limpar(conteudo, { tipografia });
    if (achados.length === 0) continue;

    comMarca++;
    const qtd = achados.reduce((s, a) => s + a.qtd, 0);
    totalMarcas += qtd;

    const pos = primeiraOcorrencia(conteudo);
    const rel = relative(ROOT, arquivo).replace(/\\/g, "/") || arquivo;
    console.log(`\n${rel}${pos ? `:${pos.linha}:${pos.coluna}` : ""}`);
    for (const a of achados) console.log(`  ${String(a.qtd).padStart(4)}x ${a.nome}`);

    if (escrever) writeFileSync(arquivo, texto, "utf8");
  }

  console.log(`\n${"-".repeat(60)}`);
  if (comMarca === 0) {
    console.log(`OK — ${arquivos.length} arquivo(s), nenhuma marca invisivel.`);
    process.exit(0);
  }
  console.log(
    `${comMarca} de ${arquivos.length} arquivo(s) com marca | ${totalMarcas} ocorrencia(s)` +
      (escrever ? " | CORRIGIDOS" : " | rode com --write para corrigir")
  );
  process.exit(checar ? 1 : 0);
}

const rodandoDireto = import.meta.url === pathToFileURL(process.argv[1] || "").href;
if (rodandoDireto) main();
