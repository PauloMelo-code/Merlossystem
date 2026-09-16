import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RAIZ, lerFonte } from "./_fonte";

/**
 * T24, segunda metade — a matriz REQ x teste (02-seguranca.md §20).
 *
 * `excecoes.test.ts` cobre o formato `EXCECAO-SEG`. Esta trava cobre a outra
 * metade: REQUISITO DO PORTAO SEM TESTE MAPEADO.
 *
 * O documento `docs/seguranca/matriz-req-teste.md` e uma tabela, e esta trava e
 * o que impede a tabela de virar prosa. Ela reprova quando:
 *
 *   - um grupo de REQ do catalogo (A1..M6) nao aparece em nenhuma linha;
 *   - uma linha marcada `entregue` aponta para arquivo que nao existe;
 *   - a coluna de prova esta vazia.
 *
 * Linha marcada `onda 2` PODE apontar para arquivo que ainda nao existe: e o
 * compromisso escrito do pacote daquela onda. O pacote de INTEGRACAO troca o
 * estado para `entregue` e este mesmo teste passa a cobrar o arquivo.
 */

const DOC = "docs/seguranca/matriz-req-teste.md";
const docCompleto = lerFonte(DOC);

/**
 * So o corpo da matriz. A secao de excecoes abertas tambem e uma tabela com
 * `K3` na primeira coluna, e sem este corte ela entraria como linha de prova.
 */
const doc = docCompleto.slice(0, docCompleto.indexOf("## Excecoes abertas"));

/**
 * O catalogo de `02-seguranca.md` §19, em faixas. Este array e a fonte do
 * teste: acrescentar um REQ ao catalogo sem acrescenta-lo aqui e ao documento
 * reprova, que e exatamente o ponto.
 */
const CATALOGO: Record<string, number> = {
  A: 8,
  B: 10,
  C: 11,
  D: 18,
  E: 14,
  F: 14,
  G: 8,
  H: 12,
  I: 15,
  J: 7,
  K: 8,
  L: 9,
  M: 6,
};

type Linha = { reqs: string; prova: string; estado: string };

/** So as linhas de tabela com quatro colunas: `| REQ | o que | prova | estado |`. */
function linhasDaMatriz(): Linha[] {
  return doc
    .split(/\r?\n/)
    .filter((l) => l.startsWith("|") && !l.includes("---") && !l.startsWith("| REQ |"))
    .map((l) => l.split("|").map((c) => c.trim()))
    .filter((c) => c.length >= 6)
    .map((c) => ({ reqs: c[1] ?? "", prova: c[3] ?? "", estado: c[4] ?? "" }))
    .filter((l) => /^[A-M]\d/.test(l.reqs));
}

const linhas = linhasDaMatriz();

/** `D14-D18` e `L1-L3, L5-L9` viram a lista de ids que cobrem. */
function expandir(reqs: string): string[] {
  const ids: string[] = [];
  for (const pedaco of reqs.split(",").map((p) => p.trim())) {
    const faixa = /^([A-M])(\d+)-(?:[A-M])?(\d+)$/.exec(pedaco);
    if (faixa) {
      const letra = faixa[1] as string;
      for (let n = Number(faixa[2]); n <= Number(faixa[3]); n++) ids.push(`${letra}${n}`);
      continue;
    }
    const unico = /^([A-M]\d+)$/.exec(pedaco);
    if (unico) ids.push(unico[1] as string);
  }
  return ids;
}

const cobertos = new Set(linhas.flatMap((l) => expandir(l.reqs)));

/** Caminhos citados em crase: `tests/...`, `scripts/...`, `docs/...`, `.github/...`. */
function caminhosDe(celula: string): string[] {
  return [...celula.matchAll(/`([A-Za-z0-9_.][A-Za-z0-9_./[\]-]*\.[A-Za-z]+)`/g)].map(
    (m) => m[1] as string,
  );
}

describe("T24 a matriz cobre o catalogo inteiro", () => {
  it("le uma tabela de verdade (piso minimo)", () => {
    expect(linhas.length).toBeGreaterThanOrEqual(20);
  });

  it.each(Object.entries(CATALOGO))("o grupo %s tem todos os %i requisitos mapeados", (letra, ate) => {
    const faltando: string[] = [];
    for (let n = 1; n <= ate; n++) {
      const id = `${letra}${n}`;
      if (!cobertos.has(id)) faltando.push(id);
    }
    expect(faltando).toEqual([]);
  });

  it("a matriz nao inventa REQ fora do catalogo", () => {
    const sobrando = [...cobertos].filter((id) => {
      const letra = id[0] as string;
      const numero = Number(id.slice(1));
      const teto = CATALOGO[letra];
      return teto === undefined || numero < 1 || numero > teto;
    });
    expect(sobrando).toEqual([]);
  });
});

describe("T24 toda linha aponta para uma prova de verdade", () => {
  it("nenhuma celula de prova esta vazia", () => {
    const vazias = linhas.filter((l) => caminhosDe(l.prova).length === 0);
    expect(vazias.map((l) => l.reqs)).toEqual([]);
  });

  it("linha marcada 'entregue' aponta para arquivo que existe", () => {
    const quebradas: string[] = [];
    for (const linha of linhas) {
      if (!linha.estado.startsWith("entregue")) continue;
      for (const caminho of caminhosDe(linha.prova)) {
        if (!existsSync(join(RAIZ, caminho))) quebradas.push(`${linha.reqs} -> ${caminho}`);
      }
    }
    expect(quebradas).toEqual([]);
  });

  it("todo estado e 'entregue' ou 'onda 2' — nada de terceiro valor", () => {
    const estranhos = linhas.filter((l) => !["entregue", "onda 2"].includes(l.estado));
    expect(estranhos.map((l) => `${l.reqs}: ${l.estado}`)).toEqual([]);
  });
});

describe("T24 as travas fora do catalogo tambem apontam para arquivo existente", () => {
  const extras = doc
    .split(/\r?\n/)
    .filter((l) => l.startsWith("|") && /tests\//.test(l))
    .flatMap((l) => caminhosDe(l))
    .filter((c) => c.startsWith("tests/"));

  it("varre a secao de travas extras", () => {
    expect(extras.length).toBeGreaterThanOrEqual(8);
  });

  it("nenhum arquivo de teste citado como entregue esta faltando", () => {
    const naoEntregues = new Set(
      linhas.filter((l) => l.estado === "onda 2").flatMap((l) => caminhosDe(l.prova)),
    );
    const ausentes = [...new Set(extras)]
      .filter((c) => !naoEntregues.has(c))
      .filter((c) => !existsSync(join(RAIZ, c)));
    expect(ausentes).toEqual([]);
  });
});
