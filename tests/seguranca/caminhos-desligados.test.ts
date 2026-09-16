import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CAMINHOS_DESLIGADOS, EM_USO, canonizarCaminho } from "@/lib/auth/caminhos";
import { fecharApoio, limparAuth, obter, postar } from "./_apoio";

/**
 * T7 — caminho desligado responde 404 SEM corpo, em QUALQUER das 5 escritas
 * (02-seguranca.md §5.1 e §5.2, G19/REQ-L9, CVE-2025-71399).
 *
 * `disabledPaths` sozinho responde 404 COM corpo "Not Found"; caminho
 * inexistente responde 404 SEM corpo. A diferença de bytes é um oráculo — é
 * por isso que o Route Handler responde antes do BA.
 */

beforeAll(async () => {
  await limparAuth();
});

afterAll(async () => {
  await fecharApoio();
});

/** As 5 escritas de §5.2: barra dupla, %2F, barra final, maiúsculas e `/./`. */
function escritas(caminho: string): string[] {
  const [, primeiro = "", ...resto] = caminho.split("/");
  const cauda = resto.length ? `/${resto.join("/")}` : "";
  return [
    caminho,
    `//${primeiro}${cauda}`,
    caminho.replace(/\//g, (_, i: number) => (i === 0 ? "/" : "%2F")),
    `${caminho}/`,
    `/${primeiro}/.${cauda}`,
    caminho.toUpperCase(),
  ];
}

/** Sem `:param`: o curinga não é um caminho que alguém digita. */
const CONCRETOS = CAMINHOS_DESLIGADOS.filter((c) => !c.includes(":"));

describe("caminhos desligados", () => {
  it("a referência: caminho que NUNCA existiu é 404 sem corpo", async () => {
    const r = await obter("/nao-existe-de-jeito-nenhum");
    expect(r.status).toBe(404);
    expect(r.corpo).toBe("");
  });

  it.each(CONCRETOS)("%s responde 404 sem corpo nas 5 escritas", async (caminho) => {
    for (const escrita of escritas(caminho)) {
      const r = await postar(escrita, {});
      expect(r.status, escrita).toBe(404);
      expect(r.corpo, escrita).toBe("");
      const g = await obter(escrita);
      expect(g.status, escrita).toBe(404);
      expect(g.corpo, escrita).toBe("");
    }
  });

  it("o caminho com parâmetro também cai (reset-password/:token, G15)", async () => {
    const r = await obter("/reset-password/um-token-qualquer");
    expect(r.status).toBe(404);
    expect(r.corpo).toBe("");
  });

  it("canonizar colapsa barra dupla, %2F, caixa, barra final e /./", () => {
    expect(canonizarCaminho("//sign-up//email/")).toBe("/sign-up/email");
    expect(canonizarCaminho("/SIGN-UP/EMAIL")).toBe("/sign-up/email");
    expect(canonizarCaminho("/sign-up/./email")).toBe("/sign-up/email");
    expect(canonizarCaminho("/sign-up%2Femail")).toBe("/sign-up/email");
    expect(canonizarCaminho("/sign-up%252Femail")).toBe("/sign-up/email");
  });

  it("EM_USO e CAMINHOS_DESLIGADOS não se sobrepõem", () => {
    const desligados = new Set<string>(CAMINHOS_DESLIGADOS);
    for (const emUso of EM_USO) expect(desligados.has(emUso), emUso).toBe(false);
  });

  it("um caminho EM USO não é 404 (a trava não pode desligar o que serve)", async () => {
    const r = await obter("/get-session");
    expect(r.status).toBe(200);
  });
});
