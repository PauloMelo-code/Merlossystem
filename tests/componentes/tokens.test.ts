import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A trava que segura o design system (04-ui.md §2.2, item "Teste que trava o
 * sistema"). Três provas:
 *
 *   1. toda variável de cor de `:root` existe em `.dark` E tem `--color-*` no
 *      `@theme` — token que só existe no claro é a receita do escuro quebrado;
 *   2. os pares de §2.3 continuam em AA (texto/fundo >= 4,5:1, borda de campo e
 *      foco >= 3:1), calculados a partir do PRÓPRIO arquivo, sem redigitar hex;
 *   3. nenhum hex, `rgb(`, `oklch(`, classe de paleta crua ou valor arbitrário
 *      em `src/**\/*.tsx` — exceções: `src/components/ui/**` (código de
 *      terceiro que a regra da casa proíbe editar) e `env(safe-area-inset-*)`.
 *
 * Foi exatamente a ausência desta trava que produziu, no sistema antigo, dois
 * sistemas de cor, o escuro cheio de `!important` e o texto de 10 px.
 */

const RAIZ = process.cwd();
const CSS = readFileSync(join(RAIZ, "src/app/globals.css"), "utf8");

function bloco(seletor: string): Map<string, string> {
  const achado = new RegExp(`${seletor}\\s*\\{([\\s\\S]*?)\\n\\}`, "m").exec(CSS);
  if (!achado?.[1]) throw new Error(`bloco ${seletor} nao encontrado em globals.css`);
  const mapa = new Map<string, string>();
  for (const par of achado[1].matchAll(/--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})\s*;/g)) {
    mapa.set(par[1]!, par[2]!);
  }
  return mapa;
}

const CLARO = bloco(":root");
const ESCURO = bloco("\\.dark");
const TEMA = bloco("@theme inline");

/** `--color-X: var(--X)` — o `@theme inline` não guarda hex, guarda a ponte. */
const PONTES = new Set(
  [...CSS.matchAll(/--color-([a-z0-9-]+):\s*var\(--([a-z0-9-]+)\)/g)].map((m) => m[2]!),
);

function canal(valor: number): number {
  const s = valor / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminancia(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * canal((n >> 16) & 255) + 0.7152 * canal((n >> 8) & 255) + 0.0722 * canal(n & 255)
  );
}

function contraste(frente: string, fundo: string): number {
  const a = luminancia(frente);
  const b = luminancia(fundo);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function cor(tema: Map<string, string>, nome: string): string {
  const valor = tema.get(nome) ?? CLARO.get(nome);
  if (!valor) throw new Error(`token --${nome} nao existe`);
  return valor;
}

/** Texto sobre fundo: AA pede 4,5:1. */
const PARES_DE_TEXTO: readonly [string, string][] = [
  ["foreground", "background"],
  ["card-foreground", "card"],
  ["popover-foreground", "popover"],
  ["muted-foreground", "muted"],
  ["texto-terciario", "background"],
  ["texto-terciario", "card"],
  ["primary-foreground", "primary"],
  ["secondary-foreground", "secondary"],
  ["accent-foreground", "accent"],
  ["marca-texto", "accent"],
  ["sucesso", "sucesso-fundo"],
  ["aviso", "aviso-fundo"],
  ["perigo", "perigo-fundo"],
  ["info", "info-fundo"],
  ["neutro", "neutro-fundo"],
  ["nota-interna-texto", "nota-interna-fundo"],
  ["balao-saida-hora", "balao-saida"],
];

/**
 * Elemento não textual: 3:1. `--border` NÃO entra: ele é decorativo por
 * decisão escrita (§2.2, comentário do `.dark`), e a borda que carrega
 * significado é `--input`.
 */
const PARES_DE_CONTORNO: readonly [string, string][] = [
  ["input", "card"],
  ["input", "background"],
  ["ring", "background"],
  ["ring", "card"],
];

describe("tokens: claro e escuro completos", () => {
  it("toda variável de cor de :root existe em .dark", () => {
    const faltando = [...CLARO.keys()].filter((nome) => !ESCURO.has(nome));
    expect(faltando).toEqual([]);
  });

  it("nenhuma variável de cor nasce só no .dark", () => {
    const sobrando = [...ESCURO.keys()].filter((nome) => !CLARO.has(nome));
    expect(sobrando).toEqual([]);
  });

  it("toda variável de cor tem --color-* no @theme", () => {
    const semPonte = [...CLARO.keys()].filter((nome) => !PONTES.has(nome));
    expect(semPonte).toEqual([]);
  });

  it("o @theme é inline (não guarda hex próprio)", () => {
    expect(TEMA.size).toBe(0);
  });
});

describe("tokens: contraste AA nos dois temas", () => {
  it.each(PARES_DE_TEXTO)("%s sobre %s tem pelo menos 4,5:1", (frente, fundo) => {
    expect(contraste(cor(CLARO, frente), cor(CLARO, fundo))).toBeGreaterThanOrEqual(4.5);
    expect(contraste(cor(ESCURO, frente), cor(ESCURO, fundo))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(PARES_DE_CONTORNO)("%s sobre %s tem pelo menos 3:1", (frente, fundo) => {
    expect(contraste(cor(CLARO, frente), cor(CLARO, fundo))).toBeGreaterThanOrEqual(3);
    expect(contraste(cor(ESCURO, frente), cor(ESCURO, fundo))).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// Varredura de TSX
// ---------------------------------------------------------------------------

/** Exceção ÚNICA de caminho: código de terceiro que a casa proíbe editar. */
const ISENTOS = ["src/components/ui/"];

function varrer(pasta: string): string[] {
  return readdirSync(join(RAIZ, pasta), { withFileTypes: true }).flatMap((entrada) => {
    const caminho = `${pasta}/${entrada.name}`;
    if (entrada.isDirectory()) return varrer(caminho);
    return entrada.name.endsWith(".tsx") ? [caminho] : [];
  });
}

const TSX = varrer("src")
  .filter((caminho) => !ISENTOS.some((isento) => caminho.startsWith(isento)))
  .map((caminho) => ({ caminho, texto: readFileSync(join(RAIZ, caminho), "utf8") }));

/** Comentário explica a regra escrevendo o padrão proibido; não é violação. */
function semComentarios(texto: string): string {
  return texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const HEX = /#[0-9a-fA-F]{3,8}\b/;
const FUNCAO_DE_COR = /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color-mix)\(/;
const PALETA = new RegExp(
  String.raw`\b(?:bg|text|border|ring|fill|stroke|from|via|to|outline|shadow|decoration|divide|accent|caret|placeholder)-` +
    String.raw`(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)` +
    String.raw`(?:-\d{2,3})?\b|` +
    String.raw`\b(?:bg|text|border|ring|fill|stroke|divide|placeholder)-(?:white|black)\b`,
);
/** Tamanho de texto fora dos 7 tokens de §2.5. */
const TAMANHO_CRU = /\btext-(?:xs|sm|base|lg|xl|[2-9]xl)\b/;

/**
 * Valor arbitrário: `p-[13px]`, `text-[10px]`, `w-[232px]`. Exige um prefixo
 * de utilitário colado no `[`, para não confundir com `lista[0]` nem com
 * `Record<string, string>[]` do TypeScript.
 */
const ARBITRARIO = /\b([a-z][a-z0-9]*(?:-[a-z0-9]+)*)-\[([^\]\s]+)\]/g;
/** Variante com seletor não é valor: `data-[state=open]:`, `aria-[...]`. */
const VARIANTES = ["data", "aria", "supports", "has", "not", "in", "nth"];

function arbitrariosDe(texto: string): string[] {
  const achados: string[] = [];
  for (const casado of texto.matchAll(ARBITRARIO)) {
    const prefixo = casado[1] ?? "";
    const conteudo = casado[2] ?? "";
    if (VARIANTES.some((v) => prefixo === v || prefixo.endsWith(`-${v}`))) continue;
    // Exceção escrita em §2.2: a área segura do iPhone não tem token.
    if (conteudo.startsWith("env(safe-area-inset-")) continue;
    achados.push(casado[0]);
  }
  return achados;
}

describe("tokens: TSX só usa utilitário de token", () => {
  it("varre um repositório de verdade", () => {
    expect(TSX.length).toBeGreaterThanOrEqual(20);
  });

  it.each(TSX.map((a) => a.caminho))("%s não tem cor literal", (caminho) => {
    const texto = semComentarios(TSX.find((a) => a.caminho === caminho)!.texto);
    expect(HEX.exec(texto)?.[0] ?? null).toBeNull();
    expect(FUNCAO_DE_COR.exec(texto)?.[0] ?? null).toBeNull();
  });

  it.each(TSX.map((a) => a.caminho))("%s não tem classe de paleta crua", (caminho) => {
    const texto = semComentarios(TSX.find((a) => a.caminho === caminho)!.texto);
    expect(PALETA.exec(texto)?.[0] ?? null).toBeNull();
    expect(TAMANHO_CRU.exec(texto)?.[0] ?? null).toBeNull();
  });

  it.each(TSX.map((a) => a.caminho))("%s não tem valor arbitrário", (caminho) => {
    const texto = semComentarios(TSX.find((a) => a.caminho === caminho)!.texto);
    expect(arbitrariosDe(texto)).toEqual([]);
  });
});
