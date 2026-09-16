import { describe, expect, it } from "vitest";
import { arquivosDe, lerFonte, linhasCom, semComentarios } from "./_fonte";

/**
 * T17 — segredos, ambiente e comparacao (02-seguranca.md §18, §20).
 *
 * Trava de FONTE: nada aqui executa. O que ela protege e o que so aparece em
 * producao — `process.env.X || "literal"` que finge default seguro, segredo
 * comparado com `===` (vaza pelo tempo) e `.env.example` incompleto, que faz o
 * deploy quebrar depois do build.
 */

const FONTES = [
  ...arquivosDe("src", [".ts", ".tsx"]),
  ...arquivosDe("scripts", [".ts", ".mjs"]),
];

/**
 * Os arquivos que rodam FORA do processo da aplicacao, mais o proprio `env.ts`.
 * `medir-kdf.mjs` so imprime `UV_THREADPOOL_SIZE`, que e ajuste de runtime do
 * Node, nao configuracao do sistema. `fumaca-seguranca.mjs` roda no runner do
 * deploy, contra o sistema ja no ar: importar `env.ts` o obrigaria a ter o
 * ambiente inteiro do app, e receber a URL do banco por `argv` a colocaria na
 * lista de processos da maquina.
 */
const PODEM_LER_ENV = [
  "src/lib/env.ts",
  "src/lib/db/migrate.ts",
  "scripts/db-backup.mjs",
  "scripts/db-teste.mjs",
  "scripts/verificar-schema.mjs",
  "scripts/medir-kdf.mjs",
  "scripts/fumaca-seguranca.mjs",
];

function chavesDoEsquema(): string[] {
  const env = lerFonte("src/lib/env.ts");
  const corpo = env.slice(env.indexOf("const esquema"), env.indexOf("const analise"));
  return [...corpo.matchAll(/^\s{4}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1] as string).sort();
}

function chavesDoExemplo(): string[] {
  return [...lerFonte(".env.example").matchAll(/^([A-Z][A-Z0-9_]*)=/gm)]
    .map((m) => m[1] as string)
    .sort();
}

describe("T17 process.env mora em env.ts", () => {
  it("nenhum outro arquivo de src ou scripts le process.env", () => {
    const achados = FONTES.filter(
      (f) => !PODEM_LER_ENV.includes(f) && /process\.env\.[A-Z]/.test(lerFonte(f)),
    );
    expect(achados).toEqual([]);
  });

  it("nenhum default literal escondido em process.env.X || \"...\"", () => {
    const problemas: string[] = [];
    for (const f of FONTES) {
      // `medir-kdf.mjs` so imprime um knob do runtime do Node; nao configura
      // nada da aplicacao, e por isso nao entra na regra.
      if (f === "scripts/medir-kdf.mjs") continue;
      const linhas = linhasCom(semComentarios(lerFonte(f)), /process\.env\.[A-Z_]+\s*(\|\||\?\?)\s*["'`]/);
      for (const linha of linhas) problemas.push(`${f} ${linha}`);
    }
    expect(problemas).toEqual([]);
  });
});

describe("T17 segredo nunca comparado com === ou !==", () => {
  it("nenhuma comparacao direta de SECRET, TOKEN, KEY ou SEGREDO", () => {
    // `!== undefined` e checagem de PRESENCA, nao de valor: nao vaza nada pelo
    // tempo, e e como `env.ts` cobra segredo configurado pela metade.
    const padrao =
      /((SECRET|TOKEN|SEGREDO|_KEY)\w*\s*(===|!==)(?!\s*undefined)|(===|!==)\s*\w*(SECRET|TOKEN|SEGREDO|_KEY))/;
    const problemas: string[] = [];
    for (const f of FONTES) {
      for (const linha of linhasCom(semComentarios(lerFonte(f)), padrao)) {
        problemas.push(`${f} ${linha}`);
      }
    }
    expect(problemas).toEqual([]);
  });

  it("a comparacao em tempo constante existe e e a unica porta", () => {
    expect(lerFonte("src/lib/seguranca/assinaturas.ts")).toMatch(/timingSafeEqual\(/);
    // Uma implementacao so: quem precisa comparar segredo importa daqui.
    const outros = FONTES.filter(
      (f) => f !== "src/lib/seguranca/assinaturas.ts" && /timingSafeEqual\(/.test(lerFonte(f)),
    );
    expect(outros).toEqual([]);
  });
});

describe("T17 .env.example e o espelho de env.ts", () => {
  it("toda chave do esquema esta no exemplo", () => {
    const faltando = chavesDoEsquema().filter((c) => !chavesDoExemplo().includes(c));
    expect(faltando).toEqual([]);
  });

  it("o exemplo nao inventa chave que o esquema nao valida", () => {
    const sobrando = chavesDoExemplo().filter((c) => !chavesDoEsquema().includes(c));
    expect(sobrando).toEqual([]);
  });

  it("PROXIES_CONFIAVEIS nao esta no exemplo: e constante versionada (§7.3)", () => {
    expect(chavesDoExemplo()).not.toContain("PROXIES_CONFIAVEIS");
  });
});

describe("T17 nenhuma senha literal em script, doc ou instrucao de agente", () => {
  const ARQUIVOS = [
    ...arquivosDe("scripts", [".ts", ".mjs"]),
    ...arquivosDe("docs", [".md"]),
    "README.md",
    "CLAUDE.md",
    "AGENTS.md",
  ];

  it("nada no formato senha = \"...\" com valor de verdade", () => {
    const padrao = /(senha|password|passwd|pwd)\s*[:=]\s*["'][^"']{8,}["']/i;
    const problemas: string[] = [];
    for (const f of ARQUIVOS) {
      for (const linha of linhasCom(lerFonte(f), padrao)) problemas.push(`${f} ${linha}`);
    }
    expect(problemas).toEqual([]);
  });
});
