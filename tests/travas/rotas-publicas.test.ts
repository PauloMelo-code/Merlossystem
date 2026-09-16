import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * T27 — token NUNCA em rota, link de e-mail NUNCA com `?token=`
 * (04-ui.md U12 e §4.1; 02-seguranca.md §9.2 item 2, F12/G15).
 *
 * Reprova quando: existe segmento `[token]` (ou `[...token]`) em rota pública;
 * algum link de e-mail é montado com `?token=` ou com o token em caminho; a
 * árvore de `(publico)` sai do mapa canônico.
 *
 * Por que isso é trava e não revisão: token em path vai para o log do Traefik,
 * para o `Referer` e para o histórico do navegador, e é consumido por scanner
 * de e-mail corporativo com um GET. A variante `/reset-password/:token` do
 * Better Auth está desligada pelo mesmo motivo.
 */

const RAIZ = process.cwd();
const PUBLICO = "src/app/(publico)";

/** Mapa canônico de 04-ui.md §4.1. Nem uma rota a mais, nem uma a menos. */
const ROTAS_PUBLICAS = [
  "/entrar",
  "/entrar/verificar",
  "/primeiro-acesso",
  "/esqueci-a-senha",
  "/redefinir-senha",
] as const;

function varrer(pasta: string): string[] {
  const absoluto = join(RAIZ, pasta);
  if (!existsSync(absoluto)) return [];
  return readdirSync(absoluto, { withFileTypes: true }).flatMap((entrada) => {
    const caminho = `${pasta}/${entrada.name}`;
    if (entrada.isDirectory()) return entrada.name === "node_modules" ? [] : varrer(caminho);
    return /\.(ts|tsx)$/.test(entrada.name) ? [caminho] : [];
  });
}

/** `src/app/(publico)/entrar/verificar/page.tsx` -> `/entrar/verificar`. */
function rotaDe(caminho: string): string | null {
  if (!caminho.endsWith("/page.tsx")) return null;
  const miolo = caminho.slice(`${PUBLICO}/`.length, -"/page.tsx".length);
  return `/${miolo}`;
}

const arquivosPublicos = varrer(PUBLICO);
const arquivosDoServidor = varrer("src/lib").concat(varrer("scripts"));

describe("T27 — rotas públicas e token", () => {
  it("varre a área pública de verdade", () => {
    expect(arquivosPublicos.length).toBeGreaterThanOrEqual(10);
  });

  it("nenhuma rota pública tem segmento dinâmico chamado token", () => {
    const suspeitos = arquivosPublicos.filter((caminho) =>
      /\[(\.\.\.)?token\]/i.test(caminho),
    );
    expect(suspeitos).toEqual([]);
  });

  it("nenhuma rota pública tem segmento dinâmico nenhum", () => {
    // A área pública inteira é estática por desenho: qualquer `[x]` aqui é
    // valor de uso único virando caminho.
    const suspeitos = arquivosPublicos.filter((caminho) => /\[[^\]]+\]/.test(caminho));
    expect(suspeitos).toEqual([]);
  });

  it("a árvore de (publico) é exatamente o mapa canônico", () => {
    const encontradas = arquivosPublicos
      .map(rotaDe)
      .filter((rota): rota is string => rota !== null)
      .sort();
    expect(encontradas).toEqual([...ROTAS_PUBLICAS].sort());
  });

  it("todo link com token usa o FRAGMENTO, nunca query nem caminho", () => {
    const proibidos: string[] = [];
    for (const caminho of [...arquivosPublicos, ...arquivosDoServidor]) {
      const texto = readFileSync(join(RAIZ, caminho), "utf8");
      // Somente linhas de código: a explicação da regra escreve o padrão.
      for (const [indice, linha] of texto.split("\n").entries()) {
        const limpa = linha.trim();
        if (limpa.startsWith("//") || limpa.startsWith("*") || limpa.startsWith("/*")) {
          continue;
        }
        if (/[?&]token=/.test(limpa) || /\/reset-password\/\$\{/.test(limpa)) {
          proibidos.push(`${caminho}:${String(indice + 1)}`);
        }
      }
    }
    expect(proibidos).toEqual([]);
  });

  it("`linkComToken` monta o fragmento `#t=` e nada mais", () => {
    const texto = readFileSync(join(RAIZ, "src/lib/auth/tokens.ts"), "utf8");
    expect(texto).toContain("#t=${token}");
    expect(texto).not.toMatch(/\?t(oken)?=\$\{token\}/);
  });

  it("o e-mail de reset do Better Auth ignora a `url` do pacote", () => {
    const texto = readFileSync(join(RAIZ, "src/lib/auth/auth.ts"), "utf8");
    // A `url` que o BA oferece leva o token em path/query (G15).
    expect(texto).toContain("/redefinir-senha#t=${token}");
  });

  it("as telas que leem token o mandam no CORPO, por campo oculto", () => {
    for (const tela of [
      `${PUBLICO}/primeiro-acesso/_components/definir-senha.tsx`,
      `${PUBLICO}/redefinir-senha/_components/nova-senha.tsx`,
    ]) {
      const texto = readFileSync(join(RAIZ, tela), "utf8");
      expect(texto, tela).toContain('type="hidden"');
      expect(texto, tela).toContain('name="token"');
    }
  });

  it("o leitor do fragmento apaga a URL com history.replaceState", () => {
    const texto = readFileSync(join(RAIZ, `${PUBLICO}/_components/fragmento.ts`), "utf8");
    expect(texto).toContain("window.history.replaceState");
  });
});
