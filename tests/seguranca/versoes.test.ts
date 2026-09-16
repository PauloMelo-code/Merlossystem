import { describe, expect, it } from "vitest";
import { lerFonte } from "./_fonte";

/**
 * T23 — versoes conferidas no LOCKFILE, nao no `package.json` (02-seguranca.md
 * §18, M2). O `package.json` diz o que foi pedido; o lockfile diz o que esta
 * instalado, e e o instalado que responde a requisicao.
 */

type Pacotes = { packages: Record<string, { version?: string }> };

const trava = JSON.parse(lerFonte("package-lock.json")) as Pacotes;

function versao(nome: string): string {
  const entrada = trava.packages[`node_modules/${nome}`];
  if (!entrada?.version) throw new Error(`${nome} nao esta no lockfile.`);
  return entrada.version;
}

/** "16.3.5" >= "16.3.3", comparando numero a numero (nunca string a string). */
function peloMenos(atual: string, minimo: string): boolean {
  const a = atual.split(".").map(Number);
  const m = minimo.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    const x = a[i] ?? 0;
    const y = m[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

describe("T23 pisos de versao", () => {
  it.each([
    ["next", "16.3.3"],
    ["better-auth", "1.7.3"],
    ["zod", "4.0.0"],
    ["bullmq", "5.0.0"],
    /** R2-C (ADR 0047): `helpers/zod` e `messages.parse`, conferidos no typecheck do FR1. */
    ["@anthropic-ai/sdk", "0.126.0"],
  ])("%s instalado e pelo menos %s", (nome, minimo) => {
    expect(peloMenos(versao(nome), minimo)).toBe(true);
  });

  it("drizzle-orm esta na 0.45.2 (CVE-2026-39356)", () => {
    expect(versao("drizzle-orm")).toBe("0.45.2");
  });
});

describe("T23 plugins do Better Auth acompanham o core", () => {
  it("@better-auth/passkey tem a MESMA versao de better-auth", () => {
    // Plugin de auth fora de sincronia com o core e como deixar meia biblioteca
    // atualizada: a opcao existe no tipo e nao existe no runtime.
    expect(versao("@better-auth/passkey")).toBe(versao("better-auth"));
  });

  it("nenhum PLUGIN @better-auth/* declarado fora de sincronia", () => {
    // `@better-auth/utils` e dependencia transitiva do proprio core, com
    // versionamento proprio; a regra e sobre o que NOS declaramos.
    const core = versao("better-auth");
    const declarados = Object.keys(
      (trava.packages[""] as unknown as { dependencies?: Record<string, string> })
        ?.dependencies ?? {},
    ).filter((nome) => nome.startsWith("@better-auth/"));
    expect(declarados.length).toBeGreaterThan(0);
    expect(declarados.filter((nome) => versao(nome) !== core)).toEqual([]);
  });
});
