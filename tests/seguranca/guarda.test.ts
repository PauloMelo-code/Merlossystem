import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as base from "@/lib/actions/_base";

/**
 * T1 — todo export de arquivo `"use server"` passa por `acao()` ou
 * `acaoPublica()` (02-seguranca.md §3.2 e §3.3).
 *
 * Server Action é um POST para a rota onde é usada e NÃO passa por layout
 * (N1/N5): `layout.tsx` chamar o portão não cobre action nenhuma.
 *
 * A trava resolve o embrulho por IDENTIDADE DE FUNÇÃO, não por nome: um
 * `executarAcao` local que não faz nada passaria numa busca de texto.
 */

const RAIZ = process.cwd();

/**
 * Piso mínimo de arquivos `"use server"`. SUBIR este número junto com cada tela
 * é o que impede a trava de virar decorativa quando alguém apaga a pasta de
 * actions.
 *
 * Valor real depois da onda 2: 19 arquivos (os 3 da fundação — casca de
 * `(app)`, área pública e `actions/seguranca.ts` — mais os dos oito pacotes).
 */
const PISO_DE_ACTIONS = 19;

function varrer(pasta: string): string[] {
  let entradas;
  try {
    entradas = readdirSync(join(RAIZ, pasta), { withFileTypes: true });
  } catch {
    return [];
  }
  return entradas.flatMap((e) => {
    const caminho = `${pasta}/${e.name}`;
    if (e.isDirectory()) return e.name === "node_modules" ? [] : varrer(caminho);
    return /\.tsx?$/.test(e.name) ? [caminho] : [];
  });
}

const arquivos = varrer("src").map((caminho) => ({
  caminho,
  texto: readFileSync(join(RAIZ, caminho), "utf8"),
}));

const usoServidor = arquivos.filter((a) => /^\s*["']use server["'];/m.test(a.texto));

/** `export async function nome(` e `export const nome = acao(...)`. */
function exportsDe(texto: string): { nome: string; linha: string }[] {
  const achados: { nome: string; linha: string }[] = [];
  for (const m of texto.matchAll(/^export\s+async\s+function\s+(\w+)/gm)) {
    achados.push({ nome: m[1]!, linha: m[0] });
  }
  for (const m of texto.matchAll(/^export\s+const\s+(\w+)\s*=\s*(\w+)\(/gm)) {
    achados.push({ nome: m[1]!, linha: m[0] });
  }
  return achados;
}

describe("portão nas Server Actions", () => {
  it("os dois embrulhos existem e são funções distintas", () => {
    // Resolução por identidade: `acao` e `acaoPublica` são os objetos que as
    // actions têm de usar, não nomes parecidos.
    expect(typeof base.acao).toBe("function");
    expect(typeof base.acaoPublica).toBe("function");
    expect(typeof base.executarAcao).toBe("function");
    expect(typeof base.executarAcaoPublica).toBe("function");
    expect(base.acao).not.toBe(base.acaoPublica);
  });

  it("varre um repositório de verdade (piso mínimo)", () => {
    expect(arquivos.length).toBeGreaterThanOrEqual(30);
    expect(usoServidor.length).toBeGreaterThanOrEqual(PISO_DE_ACTIONS);
  });

  it.each(usoServidor.map((a) => a.caminho))(
    "%s: todo export passa por acao() ou acaoPublica()",
    (caminho) => {
      const arquivo = usoServidor.find((a) => a.caminho === caminho)!;
      const embrulhos = /\b(executarAcao|executarAcaoPublica|acao|acaoPublica)\s*\(/;
      for (const exportado of exportsDe(arquivo.texto)) {
        const corpo = arquivo.texto.slice(arquivo.texto.indexOf(exportado.linha));
        const ateOProximo = corpo.slice(0, corpo.indexOf("\nexport ", 1) + 1 || corpo.length);
        expect(embrulhos.test(ateOProximo), `${caminho}:${exportado.nome}`).toBe(true);
      }
    },
  );

  it("`_base.ts` confere origem e teto por IP fora de exigirSessao (§3.2)", () => {
    const texto = readFileSync(join(RAIZ, "src/lib/actions/_base.ts"), "utf8");
    // `conferirOrigem` e `limitarPorIp` moram em `src/lib/seguranca/`, nunca
    // dentro de `exigirSessao()` como única casa.
    expect(texto).toContain('from "@/lib/seguranca/origem"');
    expect(texto).toContain('from "@/lib/seguranca/limite"');
    expect(texto).toContain("conferirOrigem(cabecalhos)");
    expect(texto).toContain("limitarPorIp(");
  });

  it("`executarAcao` abre transação por `emTransacao`, sem importar `db`", () => {
    const texto = readFileSync(join(RAIZ, "src/lib/actions/_base.ts"), "utf8");
    expect(texto).toContain("emTransacao(");
    // A regra de camada de 03-arquitetura.md §4.1: action não importa `db`.
    expect(texto).not.toMatch(/from "@\/lib\/db\/client"/);
  });
});
