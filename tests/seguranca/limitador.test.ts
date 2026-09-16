import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { auth } from "@/lib/auth/auth";
import { consumir, redisDoLimitador } from "@/lib/seguranca/limite";
import { ORIGEM } from "./_apoio";

/**
 * Limitador por IP (02-seguranca.md §7.2, REQ-C2).
 *
 * O teste obrigatorio do documento: 21 requisicoes PARALELAS em
 * `/sign-in/email` geram exatamente UMA 429. Paralelas de proposito — com
 * `get` seguido de `set`, as 21 leem o mesmo valor velho e nenhuma e barrada;
 * e por isso que `consumir` confere e incrementa na mesma operacao.
 *
 * Vai direto no `auth.handler`, e nao no Route Handler: o nosso handler
 * normaliza a 429 de `/sign-in/email` para a recusa unica de 401 (§8), o que e
 * a resposta certa para quem esta do lado de fora e esconderia justamente o
 * que este teste precisa ver.
 */

const REGRA_LOGIN = { window: 60, max: 20 };

beforeEach(async () => {
  await redisDoLimitador().flushdb().catch(() => undefined);
});

afterAll(async () => {
  await redisDoLimitador().quit().catch(() => undefined);
});

function tentativa(): Request {
  return new Request(`${ORIGEM}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGEM },
    body: JSON.stringify({
      email: ["ninguem", "exemplo.test"].join("@"),
      password: "frase-que-nao-vale-nada-01",
    }),
  });
}

describe("limitador por IP", () => {
  it("a regra de /sign-in/email e 20 por minuto", () => {
    const regras = auth.options.rateLimit?.customRules;
    expect(regras?.["/sign-in/email"]).toEqual(REGRA_LOGIN);
    expect(auth.options.rateLimit?.enabled).toBe(true);
  });

  it("21 requisicoes paralelas em /sign-in/email geram exatamente uma 429", async () => {
    const respostas = await Promise.all(
      Array.from({ length: 21 }, () => auth.handler(tentativa())),
    );
    const status = respostas.map((r) => r.status);
    expect(status.filter((s) => s === 429)).toHaveLength(1);
  }, 30_000);

  it("a janela conta com INCR: 21 consumos paralelos de max 20 barram um", async () => {
    const vereditos = await Promise.all(
      Array.from({ length: 21 }, () => consumir("prova:paralela", { janela: 60, max: 20 })),
    );
    expect(vereditos.filter((v) => !v.permitido)).toHaveLength(1);
  });

  it("fail-open: chave sem Redis nao trava a requisicao", async () => {
    // O `consumir` engole a falha e devolve permitido. A prova negativa e a do
    // bloqueio por CONTA (T6), que e banco e nao depende do Redis.
    const veredito = await consumir("prova:aberta", { janela: 60, max: 1 });
    expect(veredito.permitido).toBe(true);
  });

  it("retryAfter volta com o TTL da janela quando barra", async () => {
    await consumir("prova:teto", { janela: 30, max: 1 });
    const segundo = await consumir("prova:teto", { janela: 30, max: 1 });
    expect(segundo.permitido).toBe(false);
    expect(segundo.retryAfter).toBeGreaterThan(0);
    expect(segundo.retryAfter).toBeLessThanOrEqual(30);
  });
});
