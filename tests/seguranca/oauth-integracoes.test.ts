import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  VALIDADE_ESTADO_MS,
  assinarEstado,
  conferirEstado,
} from "@/lib/seguranca/assinaturas";
import { marcarUmaVez, redisDoLimitador } from "@/lib/seguranca/limite";
import { arquivosDe, lerFonte } from "./_fonte";

/**
 * T16 — `state` do OAuth Bling (02-seguranca.md §12, D-11).
 *
 * O `state` assinado e o uso unico sao da FUNDACAO; o fluxo de conexao em si e
 * de M5, que amarra tambem o cookie `__Host-merlo.oauth_nonce` e o PKCE.
 */

const USUARIO = "7f000000-0000-4000-8000-000000000001";

beforeEach(async () => {
  await redisDoLimitador().flushdb().catch(() => undefined);
});

afterAll(async () => {
  await redisDoLimitador().quit().catch(() => undefined);
});

describe("T16 state assinado", () => {
  it("o state valido volta com nonce, prazo e usuario", () => {
    const { state, nonce } = assinarEstado(USUARIO);
    const aberto = conferirEstado(state);
    expect(aberto?.usuarioId).toBe(USUARIO);
    expect(aberto?.nonce).toBe(nonce);
    expect(aberto?.expira).toBeGreaterThan(Date.now());
  });

  it("a validade e de 5 minutos", () => {
    expect(VALIDADE_ESTADO_MS).toBe(5 * 60 * 1000);
  });

  it("state expirado nao abre", () => {
    const { state } = assinarEstado(USUARIO, Date.now() - VALIDADE_ESTADO_MS - 1_000);
    expect(conferirEstado(state)).toBeNull();
  });

  it("state adulterado nao abre — em nenhuma das quatro partes", () => {
    const { state } = assinarEstado(USUARIO);
    const [nonce = "", expira = "", usuario = "", assinatura = ""] = state.split(".");
    expect(conferirEstado(`${nonce}x.${expira}.${usuario}.${assinatura}`)).toBeNull();
    expect(conferirEstado(`${nonce}.${Number(expira) + 60_000}.${usuario}.${assinatura}`)).toBeNull();
    expect(conferirEstado(`${nonce}.${expira}.outro-usuario.${assinatura}`)).toBeNull();
    expect(conferirEstado(`${nonce}.${expira}.${usuario}.${assinatura.slice(0, -2)}ff`)).toBeNull();
  });

  it("state de outra sessao nao serve: o usuario esta assinado dentro dele", () => {
    const { state } = assinarEstado(USUARIO);
    expect(conferirEstado(state)?.usuarioId).not.toBe("outro-usuario");
  });

  it("state ausente ou malformado nao abre", () => {
    expect(conferirEstado(null)).toBeNull();
    expect(conferirEstado("")).toBeNull();
    expect(conferirEstado("a.b.c")).toBeNull();
  });
});

describe("T16 uso unico", () => {
  it("o mesmo nonce so e aceito uma vez (SET NX no Redis)", async () => {
    const { nonce } = assinarEstado(USUARIO);
    expect(await marcarUmaVez(`oauth:${nonce}`, 300)).toBe(true);
    expect(await marcarUmaVez(`oauth:${nonce}`, 300)).toBe(false);
  });

  it("21 consumos simultaneos do mesmo state deixam passar UM", async () => {
    const { nonce } = assinarEstado(USUARIO);
    const tentativas = await Promise.all(
      Array.from({ length: 21 }, () => marcarUmaVez(`oauth:${nonce}`, 300)),
    );
    expect(tentativas.filter(Boolean)).toHaveLength(1);
  });
});

describe("T16 fonte: o state nunca sai do codigo em texto comparavel", () => {
  it("nenhum arquivo compara state com === (a comparacao e HMAC)", () => {
    const achados = arquivosDe("src", [".ts"]).filter((f) =>
      /state\s*(===|!==)/.test(lerFonte(f)),
    );
    expect(achados).toEqual([]);
  });

  it("a chave do state e dedicada, nunca a de auth", () => {
    const fonte = lerFonte("src/lib/seguranca/assinaturas.ts");
    expect(fonte).toMatch(/env\.INTEGRATIONS_STATE_KEY/);
    expect(fonte).not.toMatch(/BETTER_AUTH_SECRETS/);
  });
});
