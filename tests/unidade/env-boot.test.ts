import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * O boot recusa configuração perigosa das variáveis do R2 (03-arquitetura.md
 * §15). `env.ts` valida no import: cada caso importa um módulo novo.
 */

async function carregar(valores: Record<string, string>) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [chave, valor] of Object.entries(valores)) vi.stubEnv(chave, valor);
  return import("@/lib/env");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("variáveis do R2 no boot", () => {
  it("nascem desligadas", async () => {
    const { env } = await carregar({});
    expect(env.PAGAMENTOS_MERCADOPAGO).toBe("desligado");
    expect(env.IA_PROVEDOR_TEXTO).toBe("desligado");
    expect(env.IA_PROVEDOR_TRANSCRICAO).toBe("desligado");
    expect(env.IA_CLASSIFICACAO_AUTOMATICA).toBe(false);
    expect(env.CSAT_ATIVO).toBe(false);
    expect(env.IA_LIMITE_DIARIO_USD).toBe("2.00");
  });

  it("provedor simulado de IA é recusado em produção", async () => {
    await expect(carregar({ NODE_ENV: "production", IA_PROVEDOR_TEXTO: "simulado" })).rejects.toThrow(
      /IA_PROVEDOR_TEXTO: simulado é proibido em produção/,
    );
    await expect(
      carregar({ NODE_ENV: "production", IA_PROVEDOR_TRANSCRICAO: "simulado" }),
    ).rejects.toThrow(/IA_PROVEDOR_TRANSCRICAO/);
  });

  it("provedor ligado sem chave, e chave pela metade, não sobem", async () => {
    await expect(carregar({ IA_PROVEDOR_TEXTO: "anthropic" })).rejects.toThrow(/ANTHROPIC_API_KEY/);
    await expect(carregar({ IA_PROVEDOR_TRANSCRICAO: "openai" })).rejects.toThrow(/OPENAI_API_KEY/);
    await expect(carregar({ TIKTOK_APP_ID: "app-de-prova" })).rejects.toThrow(/TIKTOK_APP_SECRET/);
    await expect(carregar({ IA_CLASSIFICACAO_AUTOMATICA: "true" })).rejects.toThrow(
      /exige IA_PROVEDOR_TEXTO ligado/,
    );
  });

  it("a mensagem de recusa não carrega o valor recusado", async () => {
    const valor = "sk-ant-curta";
    await expect(carregar({ ANTHROPIC_API_KEY: valor })).rejects.toThrow(/ANTHROPIC_API_KEY/);
    await expect(carregar({ ANTHROPIC_API_KEY: valor })).rejects.not.toThrow(valor);
  });
});
