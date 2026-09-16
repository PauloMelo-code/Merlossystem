import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NAVEGACAO } from "@/lib/navegacao";
import { PREFIXOS_SEM_PROXY, ROTAS_PUBLICAS } from "@/lib/seguranca/rotas-publicas";
import { arquivosDe, lerFonte } from "./_fonte";

/**
 * T2 — inventario de rotas (02-seguranca.md §20; 01-dados.md §13.2).
 *
 * Trava de FONTE. O que ela impede: uma rota nascer sem ninguem saber. Rota que
 * so existe no disco e a que ninguem revisa, ninguem documenta e ninguem
 * lembra de proteger.
 *
 * AS DUAS DIRECOES: "rota existe em `src/app` implica linha em
 * `docs/seguranca/caminhos-de-acesso.md`" e, desde a integracao da onda 2,
 * "linha `entregue` no doc implica rota no disco" — sem estado `pacote Mx`.
 * O R2 usa `pacote R2-x` para rota decidida e ainda sem arquivo.
 */

const DOC = "docs/seguranca/caminhos-de-acesso.md";
const doc = lerFonte(DOC);

/** `src/app/(app)/conversas/[id]/page.tsx` -> `/conversas/[id]`. */
function rotaDoArquivo(caminho: string): string | null {
  const m = /^src\/app\/(.*)\/(page|route)\.tsx?$/.exec(caminho);
  if (!m) return null;
  const segmentos = (m[1] ?? "")
    .split("/")
    .filter((s) => s !== "" && !(s.startsWith("(") && s.endsWith(")")));
  return `/${segmentos.join("/")}`;
}

const rotasNoDisco = arquivosDe("src/app", [".ts", ".tsx"])
  .map(rotaDoArquivo)
  .filter((r): r is string => r !== null);

describe("T2 toda rota do disco esta documentada", () => {
  it("varre um app de verdade (piso minimo)", () => {
    // Nasce com as 6 publicas, /perfil, /perfil/seguranca e os handlers da
    // fundacao. Abaixo disso a varredura quebrou e estaria passando vazia.
    expect(rotasNoDisco.length).toBeGreaterThanOrEqual(10);
  });

  it("cada rota aparece em docs/seguranca/caminhos-de-acesso.md", () => {
    const faltando = rotasNoDisco.filter((rota) => !doc.includes(rota));
    expect(faltando).toEqual([]);
  });

  it("nenhuma rota publica tem segmento [token] (T27)", () => {
    const comToken = rotasNoDisco.filter((r) => /\[token\]/i.test(r));
    expect(comToken).toEqual([]);
  });
});

describe("T2 direcao estrita: o documento nao promete rota que nao existe", () => {
  /** Primeira coluna das tabelas: `| \`/caminho\` ... | ... | estado |`. */
  const linhas = doc
    .split(/\r?\n/)
    .filter((l) => /^\| `\//.test(l))
    .map((l) => ({ caminho: /^\| `([^`]+)`/.exec(l)![1]!, estado: l.split("|").at(-2)!.trim() }));

  it("toda linha de rota esta entregue ou decidida para um pacote do R2", () => {
    expect(linhas.length).toBeGreaterThanOrEqual(40);
    const invalidas = linhas.filter((l) => l.estado !== "entregue" && !/^pacote R2-[A-E]$/.test(l.estado));
    expect(invalidas.map((l) => `${l.caminho}: ${l.estado}`)).toEqual([]);
  });

  it("toda linha entregue tem arquivo em src/app", () => {
    const naRaiz = existsSync("src/app/page.tsx") ? ["/"] : [];
    const ausentes = linhas
      .filter((l) => l.estado === "entregue")
      .map((l) => l.caminho)
      .filter((c) => !rotasNoDisco.includes(c) && !naRaiz.includes(c));
    expect(ausentes).toEqual([]);
  });
});

describe("T2 o manifesto publico e o documento nao divergem", () => {
  it("todo item de ROTAS_PUBLICAS tem linha no documento", () => {
    const faltando = ROTAS_PUBLICAS.filter((r) => !doc.includes(r.caminho));
    expect(faltando.map((r) => r.caminho)).toEqual([]);
  });

  it("todo item de ROTAS_PUBLICAS declara por que pode existir sem sessao", () => {
    const semMotivo = ROTAS_PUBLICAS.filter((r) => r.motivo.trim().length < 20);
    expect(semMotivo.map((r) => r.caminho)).toEqual([]);
  });

  it("rota publica que ja esta no disco existe mesmo como arquivo", () => {
    // A rota publica de um pacote da onda 2 ainda nao tem arquivo, e isso e
    // esperado: o manifesto nasce completo de proposito. O que NAO pode e o
    // manifesto apontar para um arquivo que existe com outro nome.
    const entregues = ROTAS_PUBLICAS.filter((r) => r.dono === "fundacao");
    const ausentes = entregues.filter((r) => {
      const base = `src/app${r.caminho}`;
      return !existsSync(`${base}/route.ts`) && !existsSync(`${base}/page.tsx`);
    });
    expect(ausentes.map((r) => r.caminho)).toEqual([]);
  });
});

describe("T2 o matcher do proxy e a lista de prefixos sao a mesma coisa", () => {
  it("cada prefixo sem proxy aparece no matcher de src/proxy.ts", () => {
    const proxy = lerFonte("src/proxy.ts");
    const faltando = PREFIXOS_SEM_PROXY.filter((p) => !proxy.includes(p.replace(/^\//, "")));
    expect(faltando).toEqual([]);
  });
});

describe("T2 a navegacao so aponta para rota da arvore canonica", () => {
  it("todo item entregue do catalogo tem linha no documento de caminhos", () => {
    const faltando = NAVEGACAO.filter((i) => i.fase === "entregue" && !doc.includes(i.rota));
    expect(faltando.map((i) => i.rota)).toEqual([]);
  });

  it("item futura NAO tem page.tsx", () => {
    // Item futuro nao pode ter rota: tela que promete o que o codigo nao faz e
    // o defeito U8. Hoje nenhum item e futuro; a trava vale para o proximo.
    const futuros = NAVEGACAO.filter((i) => i.fase === "futura");
    const comRota = futuros.filter((i) => rotasNoDisco.includes(i.rota));
    expect(comRota.map((i) => i.rota)).toEqual([]);
  });
});
