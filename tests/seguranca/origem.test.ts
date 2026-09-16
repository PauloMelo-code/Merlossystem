import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { arquivosDe, lerFonte, semComentarios, RAIZ } from "./_fonte";

/**
 * T21 — origem, CSRF e IP canonico (02-seguranca.md §7.3 e §14.3).
 *
 * Metade fonte, metade efeito: as regras de "uma implementacao so" nao tem
 * como ser provadas em runtime, e o 403 de origem forjada nao tem como ser
 * provado lendo o fonte.
 */

const FONTES = arquivosDe("src", [".ts", ".tsx"]);

/**
 * `next/headers` so existe dentro de uma requisicao do Next. Trocado aqui, a
 * action publica de verdade roda no Vitest — e o 403 vira efeito, nao leitura
 * de fonte. O `vi.mock` fica no topo porque o Vitest o iça para antes de tudo.
 */
const cabecalhos = { atual: new Headers() };

vi.mock("next/headers", () => ({
  headers: async () => cabecalhos.atual,
  cookies: async () => ({ get: () => undefined }),
}));

describe("T21 fonte: uma implementacao so", () => {
  it("x-forwarded-for aparece apenas em src/lib/seguranca/ip.ts", () => {
    const achados = FONTES.filter((f) => /x-forwarded-for/i.test(semComentarios(lerFonte(f))));
    expect(achados).toEqual(["src/lib/seguranca/ip.ts"]);
  });

  it("PROXIES_CONFIAVEIS e constante versionada, nunca variavel de ambiente", () => {
    const ip = lerFonte("src/lib/seguranca/ip.ts");
    expect(ip).toMatch(/export const PROXIES_CONFIAVEIS = \[/);
    const env = lerFonte("src/lib/env.ts");
    // Citada no comentario que explica a decisao, nunca como chave do esquema.
    expect(env).not.toMatch(/PROXIES_CONFIAVEIS:\s/);
  });

  it("nenhuma origem sai do request: so env.APP_URL, em origem.ts", () => {
    const proibidos = /x-forwarded-host|nextUrl\.host|headers\(\)\.get\("host"\)/i;
    const achados = FONTES.filter((f) => proibidos.test(semComentarios(lerFonte(f))));
    expect(achados).toEqual([]);
    expect(lerFonte("src/lib/seguranca/origem.ts")).toMatch(/new URL\(env\.APP_URL\)\.origin/);
  });

  it("os dois embrulhos de action conferem a origem antes de qualquer trabalho", () => {
    const base = lerFonte("src/lib/actions/_base.ts");
    expect(base).toMatch(/conferirOrigem\(cabecalhos\);/);
    // Em acaoPublica, conferirOrigem vem ANTES do limitador.
    const publica = base.slice(base.indexOf("executarAcaoPublica"));
    expect(publica.indexOf("conferirOrigem")).toBeLessThan(publica.indexOf("limitarPorIp"));
  });

  it("o proxy nao importa db nem auth (A5, N1)", () => {
    const proxy = lerFonte("src/proxy.ts");
    expect(proxy).not.toMatch(/from "@\/lib\/(db|auth)/);
    expect(readFileSync(`${RAIZ}/src/proxy.ts`, "utf8")).not.toMatch(/better-auth/);
  });
});

describe("T21 efeito: conferirOrigem", () => {
  it("recusa origem forjada", async () => {
    const { conferirOrigem } = await import("@/lib/seguranca/origem");
    const h = new Headers({ origin: "https://evil.example" });
    expect(() => conferirOrigem(h)).toThrowError(/origem/i);
  });

  it("recusa origem AUSENTE (o Next so avisa; Origin: null ja burlou — N2)", async () => {
    const { conferirOrigem } = await import("@/lib/seguranca/origem");
    expect(() => conferirOrigem(new Headers())).toThrowError(/origem/i);
    expect(() => conferirOrigem(new Headers({ origin: "null" }))).toThrowError(/origem/i);
  });

  it("aceita a origem esperada e o same-origin do Sec-Fetch-Site", async () => {
    const { conferirOrigem, origemEsperada } = await import("@/lib/seguranca/origem");
    expect(() => conferirOrigem(new Headers({ origin: origemEsperada() }))).not.toThrow();
    expect(() =>
      conferirOrigem(new Headers({ "sec-fetch-site": "same-origin" })),
    ).not.toThrow();
  });

  it("a recusa e 403", async () => {
    const { ErroDePermissao } = await import("@/lib/erros");
    expect(new ErroDePermissao().status).toBe(403);
  });

  it("destinoSeguro derruba destino externo em / (CVE-2025-53535, INV-40)", async () => {
    const { destinoSeguro } = await import("@/lib/seguranca/origem");
    expect(destinoSeguro("https://evil.example")).toBe("/");
    expect(destinoSeguro("//evil.example")).toBe("/");
    expect(destinoSeguro("/\\evil.example")).toBe("/");
    expect(destinoSeguro("/conversas")).toBe("/conversas");
  });
});

/**
 * A action publica de verdade, com `next/headers` trocado: e a unica forma de
 * rodar `executarAcaoPublica` fora de uma requisicao do Next.
 */
describe("T21 efeito: action publica recusa com 403", () => {
  async function chamar(origem: string | null) {
    cabecalhos.atual = origem === null ? new Headers() : new Headers({ origin: origem });
    const { executarAcaoPublica } = await import("@/lib/actions/_base");
    return executarAcaoPublica(
      {
        motivo: "prova de origem",
        limite: { janela: 60, max: 5 },
        entrada: z.strictObject({}),
        executar: async () => "nunca deveria chegar aqui",
      },
      {},
    );
  }

  it("Origin forjada", async () => {
    const r = await chamar("https://evil.example");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codigo).toBe("SEM_PERMISSAO");
  });

  it("Origin ausente", async () => {
    const r = await chamar(null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codigo).toBe("SEM_PERMISSAO");
  });
});
