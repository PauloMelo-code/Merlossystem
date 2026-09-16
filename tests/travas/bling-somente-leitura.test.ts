import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * T26 — o cliente Bling e SOMENTE LEITURA (ADR 0015, 03-arquitetura.md §12.1).
 *
 * O Bling e o sistema de estoque e de nota da rede. Escrever nele daqui
 * significaria que um defeito neste repositorio vira divergencia fiscal la —
 * e a correcao nao e nossa.
 *
 * A regra: nenhum `PUT`, `PATCH` ou `DELETE`, e no maximo DOIS `POST`. Os dois
 * `POST` permitidos sao os do OAuth (trocar o codigo por token e renovar o
 * token); os dois sao autenticacao, nao gravacao de dado de negocio.
 *
 * O cliente nasce no pacote M4. Enquanto ele nao existe, esta trava confere
 * apenas que ninguem escreveu um cliente Bling em outro lugar — e passa a
 * cobrar os verbos no instante em que a pasta aparecer.
 */

const RAIZ = process.cwd();
const PASTA_DO_CLIENTE = "src/lib/integracoes/bling";
const MAXIMO_DE_POST = 2;

function varrer(pasta: string): string[] {
  const absoluto = join(RAIZ, pasta);
  if (!existsSync(absoluto)) return [];
  return readdirSync(absoluto, { withFileTypes: true }).flatMap((e) => {
    const relativo = `${pasta}/${e.name}`;
    if (e.isDirectory()) return varrer(relativo);
    return /\.ts$/.test(e.name) ? [relativo] : [];
  });
}

function semComentarios(texto: string): string {
  return texto
    .split(/\r?\n/)
    .filter((linha) => !/^\s*(\/\/|\*|\/\*)/.test(linha))
    .join("\n");
}

const arquivos = varrer(PASTA_DO_CLIENTE).map((caminho) => ({
  caminho,
  texto: semComentarios(readFileSync(join(RAIZ, caminho), "utf8")),
}));

const VERBOS_PROIBIDOS = /["'`](PUT|PATCH|DELETE)["'`]|metodo:\s*["'`](PUT|PATCH|DELETE)["'`]/;

describe("T26 cliente Bling somente leitura", () => {
  it("o cliente mora em um lugar so", () => {
    // Um segundo cliente, escrito por qualquer pacote, escapa desta trava.
    const forasteiros: string[] = [];
    for (const raiz of ["src/lib", "src/app", "src/server"]) {
      const pilha = [raiz];
      while (pilha.length) {
        const atual = pilha.pop()!;
        const absoluto = join(RAIZ, atual);
        if (!existsSync(absoluto)) continue;
        for (const e of readdirSync(absoluto, { withFileTypes: true })) {
          const relativo = `${atual}/${e.name}`;
          if (e.isDirectory()) {
            pilha.push(relativo);
            continue;
          }
          if (!/\.ts$/.test(e.name)) continue;
          if (relativo.startsWith(PASTA_DO_CLIENTE)) continue;
          const texto = semComentarios(readFileSync(join(RAIZ, relativo), "utf8"));
          if (/api\.bling\.com\.br/.test(texto)) forasteiros.push(relativo);
        }
      }
    }
    // `buscarExterno.ts` guarda o host na allowlist; e o unico lugar legitimo
    // fora da pasta do cliente.
    expect(forasteiros.filter((f) => !f.endsWith("rede/buscarExterno.ts"))).toEqual([]);
  });

  it.each(arquivos.map((a) => a.caminho))("%s nao usa PUT, PATCH nem DELETE", (caminho) => {
    const texto = arquivos.find((a) => a.caminho === caminho)!.texto;
    expect(VERBOS_PROIBIDOS.test(texto), `${caminho} escreve no Bling`).toBe(false);
  });

  it("no maximo dois POST no cliente inteiro (os dois do OAuth)", () => {
    const total = arquivos.reduce(
      (soma, a) => soma + [...a.texto.matchAll(/["'`]POST["'`]/g)].length,
      0,
    );
    expect(total).toBeLessThanOrEqual(MAXIMO_DE_POST);
  });

  it("quando a pasta existir, ela tem os quatro arquivos previstos", () => {
    if (arquivos.length === 0) return; // pacote M4 ainda nao entregou
    const nomes = arquivos.map((a) => a.caminho.split("/").pop());
    for (const esperado of ["config.ts", "cliente.ts", "leitura.ts", "cache.ts"]) {
      expect(nomes, esperado).toContain(esperado);
    }
  });
});
