import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy, config as configDoProxy } from "@/proxy";
import { CABECALHOS_DE_SEGURANCA, CSP_DE_API, cspDePagina } from "@/lib/seguranca/csp";
import { PREFIXOS_SEM_PROXY } from "@/lib/seguranca/rotas-publicas";
import { lerFonte } from "./_fonte";

/**
 * T22 — cabecalhos de borda e CSP (02-seguranca.md §14.1 e §14.2).
 *
 * Config + efeito: a lista fixa sai do `next.config.ts`, a CSP com nonce sai
 * do `src/proxy.ts` executado de verdade.
 */

const ORIGEM = "http://localhost:3005";

function diretivas(csp: string): Map<string, string> {
  return new Map(
    csp
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const espaco = d.indexOf(" ");
        return espaco === -1
          ? ([d, ""] as [string, string])
          : ([d.slice(0, espaco), d.slice(espaco + 1)] as [string, string]);
      }),
  );
}

describe("T22 config: next.config.ts", () => {
  it("tem os cinco cabecalhos de §14.1 para toda resposta", async () => {
    const { default: config } = await import("../../next.config");
    const regras = await config.headers?.();
    const todas = regras?.find((r) => r.source === "/:path*");
    const chaves = (todas?.headers ?? []).map((h) => h.key);
    expect(chaves).toEqual([
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "Referrer-Policy",
      "X-Frame-Options",
      "Permissions-Policy",
    ]);
    const mapa = new Map(CABECALHOS_DE_SEGURANCA.map((h) => [h.key, h.value]));
    expect(mapa.get("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");
    expect(mapa.get("X-Frame-Options")).toBe("DENY");
    expect(mapa.get("Permissions-Policy")).toContain("publickey-credentials-get=(self)");
  });

  it("aplica CSP em enforce nas respostas de /api, sem script algum", async () => {
    const { default: config } = await import("../../next.config");
    const regras = await config.headers?.();
    const api = regras?.find((r) => r.source === "/api/:path*");
    const csp = api?.headers.find((h) => h.key === "Content-Security-Policy")?.value;
    expect(csp).toBe(CSP_DE_API);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(api?.headers.find((h) => h.key === "Cache-Control")?.value).toBe("no-store");
  });

  it("bodySizeLimit de Server Action continua em 1mb (A-16)", async () => {
    const { default: config } = await import("../../next.config");
    expect(config.experimental?.serverActions?.bodySizeLimit).toBe("1mb");
  });
});

describe("T22 efeito: CSP do proxy", () => {
  it("a politica vai em ENFORCE, com nonce por requisicao", () => {
    const resposta = proxy(
      new NextRequest(`${ORIGEM}/entrar`, { headers: { cookie: "" } }),
    );
    const csp = resposta.headers.get("content-security-policy");
    expect(csp).toBeTruthy();
    const d = diretivas(csp ?? "");
    expect(d.get("script-src")).toMatch(/^'self' 'nonce-[A-Za-z0-9+/=]{20,}'$/);
    expect(d.get("default-src")).toBe("'self'");
    expect(d.get("frame-ancestors")).toBe("'none'");
    expect(d.get("base-uri")).toBe("'none'");
    expect(d.get("form-action")).toBe("'self'");
  });

  it("nenhum unsafe-inline em script-src — reprova sem excecao", () => {
    const csp = cspDePagina("abc123");
    expect(diretivas(csp).get("script-src")).not.toContain("unsafe-inline");
  });

  it("img-src nao lista o host publico do MinIO (o bucket e privado, §15)", () => {
    const d = diretivas(cspDePagina("abc123"));
    expect(d.get("img-src")).toBe("'self' data: blob:");
    expect(cspDePagina("abc123")).not.toContain("9002");
  });

  it("o nonce muda a cada requisicao", () => {
    const um = proxy(new NextRequest(`${ORIGEM}/entrar`));
    const dois = proxy(new NextRequest(`${ORIGEM}/entrar`));
    expect(um.headers.get("content-security-policy")).not.toBe(
      dois.headers.get("content-security-policy"),
    );
  });

  it("Report-Only roda em paralelo, so para endurecer", () => {
    const resposta = proxy(new NextRequest(`${ORIGEM}/entrar`));
    const relato = resposta.headers.get("content-security-policy-report-only");
    expect(relato).toContain("strict-dynamic");
    expect(diretivas(relato ?? "").get("style-src")).toBe("'self'");
    expect(relato).toContain("report-uri /api/csp");
  });

  it("toda resposta do proxy e no-store", () => {
    expect(proxy(new NextRequest(`${ORIGEM}/entrar`)).headers.get("cache-control")).toBe(
      "no-store",
    );
  });
});

describe("T22 efeito: o proxy redireciona, mas nao decide acesso", () => {
  it("sem cookie de sessao, area privada cai em /entrar com ?volta relativo", () => {
    const resposta = proxy(new NextRequest(`${ORIGEM}/conversas?aba=abertas`));
    expect(resposta.status).toBe(307);
    const destino = new URL(resposta.headers.get("location") ?? "");
    expect(destino.pathname).toBe("/entrar");
    expect(destino.searchParams.get("volta")).toBe("/conversas?aba=abertas");
  });

  it("com cookie de sessao, deixa passar — quem decide e o portao", () => {
    const req = new NextRequest(`${ORIGEM}/conversas`, {
      headers: { cookie: "merlo.session_token=qualquer-coisa" },
    });
    expect(proxy(req).status).toBe(200);
  });

  it("area publica passa sem cookie", () => {
    expect(proxy(new NextRequest(`${ORIGEM}/esqueci-a-senha`)).status).toBe(200);
  });
});

describe("T22 fonte: o matcher nao cobre rota de maquina", () => {
  // O Next casa o matcher contra o caminho INTEIRO; sem as ancoras, o teste
  // mediria outra coisa.
  const padrao = new RegExp(`^${(configDoProxy.matcher as string[])[0] as string}$`);

  it.each([...PREFIXOS_SEM_PROXY])("%s fica fora do proxy", (prefixo) => {
    expect(padrao.test(`${prefixo}/qualquer`)).toBe(false);
  });

  it("pagina do app continua coberta", () => {
    expect(padrao.test("/conversas")).toBe(true);
  });

  it("a lista de prefixos do manifesto e a mesma do matcher", () => {
    const fonte = lerFonte("src/proxy.ts");
    for (const prefixo of PREFIXOS_SEM_PROXY) {
      expect(fonte).toContain(prefixo.replace(/^\//, ""));
    }
  });
});
