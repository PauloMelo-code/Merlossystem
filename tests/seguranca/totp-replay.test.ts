import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { symmetricEncrypt } from "better-auth/crypto";
import { createOTP } from "@better-auth/utils/otp";
import { auth } from "@/lib/auth/auth";
import {
  type UsuarioDeTeste,
  cookieDaResposta,
  criarUsuario,
  fecharApoio,
  limparAuth,
  poolDeTeste,
  postar,
} from "./_apoio";

/**
 * Anti-replay de TOTP no banco (02-seguranca.md §9.1, D6) — teste de EFEITO.
 *
 * Reprova quando: o mesmo código de 6 dígitos abre uma segunda sessão; a
 * recusa da reapresentação difere, em status ou bytes, da recusa única de
 * credencial; `ultimo_passo_totp` continua nulo depois de um login com código;
 * e quando o passo gravado é o do relógio e não o do código.
 */

/** Semente sem valor real, usada só aqui. */
const SEMENTE = "semente-de-teste-sem-valor-real-0";
const OTP = createOTP(SEMENTE, { digits: 6, period: 30 });

beforeAll(async () => {
  await limparAuth();
});

afterAll(async () => {
  await fecharApoio();
});

/** Liga o TOTP como o plugin deixaria depois da confirmação. */
async function ligarTotp(usuarioId: string): Promise<void> {
  const contexto = await auth.$context;
  const cifrada = await symmetricEncrypt({ key: contexto.secretConfig, data: SEMENTE });
  await poolDeTeste.query(
    `insert into usuarios_totp (usuario_id, secret, backup_codes, verificado)
     values ($1::uuid, $2, '[]', true)`,
    [usuarioId, cifrada],
  );
  await poolDeTeste.query("update usuarios set two_factor_enabled = true where id = $1::uuid", [
    usuarioId,
  ]);
}

/** Senha certa abre o desafio de 2º fator; devolve o cookie dele. */
async function abrirDesafio(u: UsuarioDeTeste): Promise<string> {
  const r = await postar("/sign-in/email", { email: u.email, password: u.senha });
  expect(r.status).toBe(200);
  expect(r.corpo).toContain("twoFactorRedirect");
  return cookieDaResposta(r.headers);
}

async function passoGravado(usuarioId: string): Promise<number | null> {
  const { rows } = await poolDeTeste.query<{ passo: string | null }>(
    "select ultimo_passo_totp::text as passo from usuarios_totp where usuario_id = $1::uuid",
    [usuarioId],
  );
  const passo = rows[0]?.passo;
  return passo === null || passo === undefined ? null : Number(passo);
}

describe("anti-replay de TOTP", () => {
  it("o mesmo código duas vezes: a segunda é recusada com a resposta única", async () => {
    const u = await criarUsuario("replay@teste.local");
    await ligarTotp(u.id);
    const codigo = await OTP.totp();

    const primeira = await postar(
      "/two-factor/verify-totp",
      { code: codigo },
      { cookie: await abrirDesafio(u) },
    );
    expect(primeira.status).toBe(200);
    expect(await passoGravado(u.id)).not.toBeNull();

    const segunda = await postar(
      "/two-factor/verify-totp",
      { code: codigo },
      { cookie: await abrirDesafio(u) },
    );

    // A referência é a recusa de senha errada: mesmo status, mesmos bytes.
    const senhaErrada = await postar("/sign-in/email", {
      email: u.email,
      password: "errada-mas-longa-o-bastante",
    });
    expect(segunda.status).toBe(401);
    expect(segunda.corpo).toBe(senhaErrada.corpo);
    expect(segunda.headers.get("content-length")).toBe(
      senhaErrada.headers.get("content-length"),
    );
    expect(segunda.headers.getSetCookie().some((c) => /session_token=[^;]+/.test(c))).toBe(false);

    const { rows } = await poolDeTeste.query<{ n: string }>(
      "select count(*)::text as n from usuarios_sessoes where usuario_id = $1::uuid",
      [u.id],
    );
    expect(rows[0]!.n).toBe("1");
  });

  it("grava o passo DO CÓDIGO: um código mais novo continua entrando", async () => {
    const u = await criarUsuario("passo-do-codigo@teste.local");
    await ligarTotp(u.id);
    // Longe da virada do passo, para o "anterior" ainda estar na janela.
    const resto = 30_000 - (Date.now() % 30_000);
    if (resto < 3_000) await new Promise((r) => setTimeout(r, resto + 100));
    const agora = Math.floor(Date.now() / 30_000);

    const r = await postar(
      "/two-factor/verify-totp",
      { code: await OTP.hotp(agora - 1) },
      { cookie: await abrirDesafio(u) },
    );
    expect(r.status).toBe(200);
    // O relógio diria `agora`; gravar isso recusaria o código atual, que é outro.
    expect(await passoGravado(u.id)).toBe(agora - 1);

    const atual = await postar(
      "/two-factor/verify-totp",
      { code: await OTP.hotp(agora) },
      { cookie: await abrirDesafio(u) },
    );
    expect(atual.status).toBe(200);
    expect(await passoGravado(u.id)).toBe(agora);
  });
});
