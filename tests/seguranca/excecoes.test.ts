import { describe, expect, it } from "vitest";
import { arquivosDe, lerFonte } from "./_fonte";

/**
 * T24 — excecao de seguranca so vale escrita, com dono e com prazo
 * (02-seguranca.md §20).
 *
 * Formato obrigatorio, quatro partes separadas por barra vertical:
 *   EXCECAO-SEG: <REQ ou regra> | <motivo> | <dono> | ate AAAA-MM-DD
 *
 * Sem prazo, a excecao vira decisao permanente que ninguem tomou. Vencida,
 * reprova o CI — e assim volta para a mesa.
 */

const MARCA = "EXCECAO" + "-SEG:";

const ARQUIVOS = [
  ...arquivosDe("src", [".ts", ".tsx"]),
  ...arquivosDe("scripts", [".ts", ".mjs"]),
];

type Achado = { arquivo: string; texto: string };

function achados(): Achado[] {
  const lista: Achado[] = [];
  for (const arquivo of ARQUIVOS) {
    for (const linha of lerFonte(arquivo).split(/\r?\n/)) {
      const i = linha.indexOf(MARCA);
      if (i !== -1) lista.push({ arquivo, texto: linha.slice(i + MARCA.length).trim() });
    }
  }
  return lista;
}

describe("T24 excecoes de seguranca", () => {
  it("toda excecao tem as quatro partes", () => {
    for (const { arquivo, texto } of achados()) {
      const partes = texto.split("|").map((p) => p.trim());
      expect(partes.length, `${arquivo}: ${texto}`).toBe(4);
      expect(partes[0], `${arquivo}: regra vazia`).not.toBe("");
      expect(partes[1], `${arquivo}: motivo vazio`).not.toBe("");
      expect(partes[2], `${arquivo}: dono vazio`).not.toBe("");
      expect(partes[3], `${arquivo}: prazo`).toMatch(/^ate \d{4}-\d{2}-\d{2}$/);
    }
  });

  it("nenhuma excecao vencida", () => {
    const hoje = new Date().toISOString().slice(0, 10);
    const vencidas = achados()
      .map(({ arquivo, texto }) => ({ arquivo, prazo: texto.split("|")[3]?.trim() ?? "" }))
      .filter(({ prazo }) => prazo.replace("ate ", "") < hoje);
    expect(vencidas).toEqual([]);
  });

  it("a excecao do style-src continua sendo a UNICA da CSP", () => {
    // 'unsafe-inline' em script-src nao tem excecao possivel (§14.2).
    const daCsp = achados().filter(({ arquivo }) => arquivo === "src/lib/seguranca/csp.ts");
    expect(daCsp).toHaveLength(1);
    expect(daCsp[0]?.texto).toContain("style-src");
  });
});
