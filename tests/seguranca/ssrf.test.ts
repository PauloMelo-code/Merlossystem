import { afterEach, describe, expect, it, vi } from "vitest";
import { buscarExterno, ehEnderecoInterno, TIMEOUT_MS } from "@/lib/rede/buscarExterno";
import { arquivosDe, lerFonte, semComentarios } from "./_fonte";

/**
 * SSRF: `buscarExterno` e a UNICA porta de saida HTTP para endereco que veio
 * de terceiro (03-arquitetura.md §12.4, A-17).
 *
 * Os tres casos obrigatorios do documento estao aqui: `169.254.169.254`
 * (metadata de nuvem), `127.0.0.1:9002` (o MinIO da propria infra) e um
 * redirecionamento de host PERMITIDO para endereco privado.
 */

/** O DNS e trocado: teste de rede nao pode depender de rede. */
const enderecos = new Map<string, string>([
  ["graph.facebook.com", "157.240.1.1"],
  ["lookaside.fbsbx.com", "10.0.0.5"],
  ["mmg.whatsapp.net", "157.240.1.2"],
]);

vi.mock("node:dns/promises", () => ({
  lookup: async (host: string) => {
    const endereco = enderecos.get(host);
    if (!endereco) throw new Error("ENOTFOUND");
    return [{ address: endereco, family: 4 }];
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

function respondendo(...respostas: Response[]): void {
  const fila = [...respostas];
  vi.stubGlobal("fetch", async () => fila.shift() ?? new Response("fim", { status: 200 }));
}

describe("SSRF: os enderecos da propria infra", () => {
  it("recusa a metadata de nuvem", async () => {
    respondendo(new Response("segredo", { status: 200 }));
    await expect(buscarExterno("http://169.254.169.254", { provedor: "meta" })).rejects.toThrow(
      /recusado/i,
    );
  });

  it("recusa o MinIO local", async () => {
    respondendo(new Response("bucket", { status: 200 }));
    await expect(buscarExterno("http://127.0.0.1:9002", { provedor: "meta" })).rejects.toThrow(
      /recusado/i,
    );
  });

  it("recusa Postgres e Redis da infra, mesmo por https", async () => {
    respondendo();
    for (const alvo of ["https://127.0.0.1:5437", "https://10.0.0.1:6382"]) {
      await expect(buscarExterno(alvo, { provedor: "meta" })).rejects.toThrow(/recusado/i);
    }
  });

  it("ehEnderecoInterno cobre loopback, link-local, privadas e IPv6", () => {
    for (const interno of [
      "127.0.0.1",
      "169.254.169.254",
      "10.0.0.5",
      "172.16.0.1",
      "192.168.1.1",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "nao-e-endereco",
    ]) {
      expect(ehEnderecoInterno(interno), interno).toBe(true);
    }
    for (const externo of ["157.240.1.1", "8.8.8.8", "2606:4700::1111"]) {
      expect(ehEnderecoInterno(externo), externo).toBe(false);
    }
  });
});

describe("SSRF: allowlist e esquema", () => {
  it("so https", async () => {
    respondendo();
    await expect(
      buscarExterno("http://graph.facebook.com/v23.0/x", { provedor: "meta" }),
    ).rejects.toThrow(/somente https/i);
  });

  it("host fora da allowlist do provedor nao e buscado", async () => {
    respondendo();
    await expect(
      buscarExterno("https://evil.example/arquivo.jpg", { provedor: "meta" }),
    ).rejects.toThrow(/allowlist/i);
  });

  it("host de OUTRO provedor tambem nao serve", async () => {
    respondendo();
    await expect(
      buscarExterno("https://graph.facebook.com/x", { provedor: "bling" }),
    ).rejects.toThrow(/allowlist/i);
  });

  it("host permitido e publico passa", async () => {
    respondendo(new Response("conteudo", { status: 200 }));
    const r = await buscarExterno("https://graph.facebook.com/v23.0/x", { provedor: "meta" });
    expect(r.status).toBe(200);
    expect(r.bytes.toString("utf8")).toBe("conteudo");
  });

  it("host permitido que RESOLVE para endereco privado e recusado", async () => {
    respondendo(new Response("nunca", { status: 200 }));
    await expect(
      buscarExterno("https://lookaside.fbsbx.com/x", { provedor: "meta" }),
    ).rejects.toThrow(/interno/i);
  });
});

describe("SSRF: redirecionamento", () => {
  it("um salto, e o destino do salto passa pelas regras de novo", async () => {
    respondendo(
      new Response(null, { status: 302, headers: { location: "https://lookaside.fbsbx.com/x" } }),
      new Response("nunca deveria chegar", { status: 200 }),
    );
    // Host PERMITIDO, endereco PRIVADO: era o buraco classico.
    await expect(
      buscarExterno("https://graph.facebook.com/v23.0/x", { provedor: "meta" }),
    ).rejects.toThrow(/interno/i);
  });

  it("dois saltos nao existem", async () => {
    respondendo(
      new Response(null, { status: 302, headers: { location: "https://mmg.whatsapp.net/a" } }),
      new Response(null, { status: 302, headers: { location: "https://mmg.whatsapp.net/b" } }),
    );
    await expect(
      buscarExterno("https://graph.facebook.com/x", { provedor: "meta" }),
    ).rejects.toThrow(/mais de um redirecionamento/i);
  });

  it("redirecionamento sem destino e recusado", async () => {
    respondendo(new Response(null, { status: 302 }));
    await expect(
      buscarExterno("https://graph.facebook.com/x", { provedor: "meta" }),
    ).rejects.toThrow(/sem destino/i);
  });
});

describe("SSRF: teto de bytes e timeout", () => {
  it("corpo acima do teto e abortado", async () => {
    respondendo(new Response("x".repeat(5_000), { status: 200 }));
    await expect(
      buscarExterno("https://graph.facebook.com/x", { provedor: "meta", maxBytes: 1_000 }),
    ).rejects.toThrow(/teto/i);
  });

  it("o timeout e de 8 s", () => {
    expect(TIMEOUT_MS).toBe(8_000);
  });
});

describe("SSRF fonte: nenhum fetch fora desta porta", () => {
  /**
   * A regra e sobre endereco que veio de TERCEIRO. O HIBP e a unica outra
   * chamada de saida, e o endereco dela nao vem de ninguem: o host esta
   * cravado no fonte e a unica parte interpolada sao os 5 primeiros caracteres
   * do SHA-1 da senha (k-anonimato). Passa-la por `buscarExterno` trocaria o
   * teto de 1,5 s — que existe para o login nao esperar o HIBP — pelo de 8 s.
   */
  const FORA_DA_REGRA = "src/lib/auth/politica-senha.ts";

  /**
   * A segunda excecao e de OUTRA natureza: roda no NAVEGADOR, nao no servidor.
   * `porta-de-auth.ts` fala com `/api/auth/**` da propria origem, porque a
   * recusa unica de login (bytes, cabecalhos e piso de tempo) mora no Route
   * Handler e uma Server Action passaria por fora dela. SSRF e sobre o servidor
   * alcancar endereco de terceiro; aqui nao ha servidor nem host.
   *
   * A excecao e estreita e conferida abaixo: o arquivo tem de ser `"use client"`
   * e o unico alvo do fetch tem de ser um caminho relativo em `/api/auth`.
   */
  const PORTA_DO_NAVEGADOR = "src/app/(publico)/_components/porta-de-auth.ts";

  it("fetch( so existe em rede/buscarExterno.ts, no HIBP e na porta do navegador", () => {
    const achados = arquivosDe("src", [".ts", ".tsx"]).filter((f) =>
      /\bfetch\(/.test(semComentarios(lerFonte(f))),
    );
    expect(achados.sort()).toEqual(
      [PORTA_DO_NAVEGADOR, FORA_DA_REGRA, "src/lib/rede/buscarExterno.ts"].sort(),
    );
  });

  it("a excecao do HIBP tem host literal e teto de tempo proprio", () => {
    const fonte = lerFonte(FORA_DA_REGRA);
    expect(fonte).toMatch(/fetch\(`https:\/\/api\.pwnedpasswords\.com\/range\/\$\{prefixo\}`/);
    expect(fonte).toMatch(/abortar\.abort\(\)/);
  });

  it("a porta do navegador e cliente e so alcanca /api/auth da propria origem", () => {
    const fonte = lerFonte(PORTA_DO_NAVEGADOR);
    expect(fonte.startsWith('"use client"')).toBe(true);

    const alvos = [...semComentarios(fonte).matchAll(/\bfetch\(([^,]+)/g)].map((m) =>
      (m[1] ?? "").trim(),
    );
    expect(alvos.length).toBeGreaterThan(0);
    for (const alvo of alvos) {
      // Caminho relativo literal: sem esquema, sem host, sem variavel na frente.
      expect(alvo, alvo).toMatch(/^`\/api\/auth\$\{caminho\}`$/);
    }
  });
});
