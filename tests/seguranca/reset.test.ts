import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * T8 — recuperação de senha (02-seguranca.md §5.1 item 7, §6, §11.2).
 *
 * Reprova quando: o token aparece em claro no banco; dois consumos simultâneos
 * dão dois sucessos; a resposta traz `Set-Cookie`; a sessão anterior sobrevive;
 * o link leva `?token=` ou `/token`; senha fraca QUEIMA o token; e o cooldown
 * muda a resposta.
 *
 * O e-mail é interceptado aqui porque o link só existe em memória: ele sai por
 * fila e nunca é persistido — que é justamente a propriedade a provar.
 */

const enviados: { assunto: string; link?: string }[] = [];

vi.mock("@/lib/auth/emails", () => ({
  enfileirarEmailSeguranca: (assunto: string, _usuarioId: string, link?: string) => {
    enviados.push({ assunto, ...(link === undefined ? {} : { link }) });
  },
}));

const {
  SENHA_PADRAO,
  cookieDaResposta,
  criarUsuario,
  fecharApoio,
  limparAuth,
  poolDeTeste,
  postar,
  obter,
} = await import("./_apoio");

const SENHA_NOVA = "outra-frase-de-teste-sem-valor-2";

beforeAll(async () => {
  await limparAuth();
});

beforeEach(() => {
  enviados.length = 0;
});

afterAll(async () => {
  await fecharApoio();
});

/**
 * Cada chamada sai de um IP diferente de propósito: `/request-password-reset`
 * tem teto de 5 por 10 min POR IP (§4.2). Sem isso, o 3º teste deste arquivo
 * receberia 429 do limitador — e, por isonomia, o mesmo `200 {"status":true}`
 * SEM e-mail nenhum, que é exatamente o que se quer do limitador em produção.
 */
let contadorDeIp = 0;

async function pedirReset(email: string) {
  contadorDeIp += 1;
  return postar(
    "/request-password-reset",
    { email, redirectTo: "/redefinir-senha" },
    { xff: `203.0.113.${contadorDeIp}` },
  );
}

function tokenDoUltimoEmail(): string {
  const link = enviados.at(-1)?.link ?? "";
  const marca = link.indexOf("#t=");
  expect(marca, `link sem fragmento: ${link}`).toBeGreaterThan(-1);
  return link.slice(marca + 3);
}

describe("recuperação de senha", () => {
  it("responde igual para conta existente e inexistente (E1)", async () => {
    const u = await criarUsuario("reset-existe@teste.local");
    const existente = await pedirReset(u.email);
    const inexistente = await pedirReset("reset-nao-existe@teste.local");

    expect(existente.status).toBe(200);
    expect(existente.corpo).toBe('{"status":true}');
    expect(inexistente.status).toBe(existente.status);
    expect(inexistente.corpo).toBe(existente.corpo);
    expect(inexistente.headers.get("content-length")).toBe(
      existente.headers.get("content-length"),
    );
    expect(existente.headers.getSetCookie()).toEqual([]);
    expect(existente.ms).toBeGreaterThanOrEqual(440);
    expect(inexistente.ms).toBeGreaterThanOrEqual(440);
  });

  it("o link leva o token no FRAGMENTO, nunca em query nem em segmento (G15)", async () => {
    const u = await criarUsuario("reset-link@teste.local");
    await pedirReset(u.email);

    const link = enviados.at(-1)?.link ?? "";
    expect(link).toContain("/redefinir-senha#t=");
    expect(link).not.toContain("?token=");
    expect(link).not.toMatch(/\/redefinir-senha\/[^#]/);
  });

  it("o token NÃO existe em claro em nenhuma coluna do banco (K3)", async () => {
    const u = await criarUsuario("reset-hash@teste.local");
    await pedirReset(u.email);
    const token = tokenDoUltimoEmail();

    const { rows } = await poolDeTeste.query<{ n: string }>(
      `select count(*)::text as n from usuarios_verificacoes
       where identificador like '%' || $1 || '%' or valor like '%' || $1 || '%'`,
      [token],
    );
    expect(rows[0]!.n).toBe("0");
  });

  it("senha fraca NÃO queima o token: a política roda antes do consumo (E9)", async () => {
    const u = await criarUsuario("reset-fraca@teste.local");
    await pedirReset(u.email);
    const token = tokenDoUltimoEmail();

    const fraca = await postar("/reset-password", { token, newPassword: "123456" });
    expect(fraca.status).toBeGreaterThanOrEqual(400);

    const boa = await postar("/reset-password", { token, newPassword: SENHA_NOVA });
    expect(boa.status).toBe(200);
  });

  it("concluir o reset não cria sessão e derruba as anteriores (G14/G16)", async () => {
    const u = await criarUsuario("reset-sessao@teste.local");

    const login = await postar("/sign-in/email", { email: u.email, password: u.senha });
    expect(login.status).toBe(200);
    const cookie = cookieDaResposta(login.headers);
    expect(cookie).not.toBe("");

    const sessaoViva = await obter("/get-session", { cookie });
    expect(sessaoViva.corpo).not.toBe("null");

    await pedirReset(u.email);
    const token = tokenDoUltimoEmail();
    const fim = await postar("/reset-password", { token, newPassword: SENHA_NOVA });
    expect(fim.status).toBe(200);

    // `autoSignIn: false`: reset NÃO pode criar sessão, senão pularia o 2º fator.
    const cookiesDoReset = fim.headers.getSetCookie().join(";");
    expect(cookiesDoReset).not.toContain("session_token");

    // `revokeSessionsOnPasswordReset: true`.
    const depois = await obter("/get-session", { cookie });
    expect(depois.corpo).toBe("null");
  });

  it("dois consumos simultâneos do mesmo token dão UM sucesso só", async () => {
    const u = await criarUsuario("reset-corrida@teste.local");
    await pedirReset(u.email);
    const token = tokenDoUltimoEmail();

    const [a, b] = await Promise.all([
      postar("/reset-password", { token, newPassword: SENHA_NOVA }),
      postar("/reset-password", { token, newPassword: SENHA_NOVA }),
    ]);
    const sucessos = [a, b].filter((r) => r.status === 200).length;
    expect(sucessos).toBe(1);
  });

  it("a senha nova passa a valer e a antiga deixa de valer", async () => {
    const u = await criarUsuario("reset-vale@teste.local");
    await pedirReset(u.email);
    const token = tokenDoUltimoEmail();
    expect((await postar("/reset-password", { token, newPassword: SENHA_NOVA })).status).toBe(200);

    expect((await postar("/sign-in/email", { email: u.email, password: SENHA_PADRAO })).status).toBe(
      401,
    );
    expect((await postar("/sign-in/email", { email: u.email, password: SENHA_NOVA })).status).toBe(
      200,
    );
  });
});
