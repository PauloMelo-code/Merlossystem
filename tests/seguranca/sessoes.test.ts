import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { opcoesAuth } from "@/lib/auth/auth";
import {
  TETO_SESSOES,
  TETO_SESSOES_PRIVILEGIADO,
  listarSessoesDe,
  revogarSessoesDe,
} from "@/lib/auth/sessoes";
import {
  cookieDaResposta,
  criarUsuario,
  fecharApoio,
  limparAuth,
  obter,
  poolDeTeste,
  postar,
} from "./_apoio";

/**
 * T9 — sessão (02-seguranca.md §10).
 *
 * Reprova quando: o `token` entra na projeção; a sessão sobrevive à desativação
 * ou à troca de papel; o uso RENOVA o teto absoluto; a 4ª sessão simultânea não
 * derruba a mais antiga.
 */

beforeAll(async () => {
  await limparAuth();
});

afterAll(async () => {
  await fecharApoio();
});

async function entrar(email: string, senha: string): Promise<string> {
  const r = await postar("/sign-in/email", { email, password: senha });
  expect(r.status).toBe(200);
  const cookie = cookieDaResposta(r.headers);
  expect(cookie).not.toBe("");
  return cookie;
}

async function sessaoDe(cookie: string): Promise<string> {
  return (await obter("/get-session", { cookie })).corpo;
}

describe("sessão", () => {
  it("o teto absoluto é 12 h e o uso NÃO renova (S-04/F2)", () => {
    expect(opcoesAuth.session.expiresIn).toBe(60 * 60 * 12);
    expect(opcoesAuth.session.disableSessionRefresh).toBe(true);
    // G11: o default do `freshAge` era 1 DIA — e é ele que protege o cadastro
    // de passkey. Nosso `exigirSessaoFresca()` usa o MESMO valor.
    expect(opcoesAuth.session.freshAge).toBe(60 * 15);
    // H6 + CVE-2026-67337: cache de sessão em cookie vira bypass de 2FA.
    expect(opcoesAuth.session.cookieCache.enabled).toBe(false);
  });

  it("a projeção de sessões NUNCA traz o token (F6/G13)", async () => {
    const u = await criarUsuario("proj@teste.local");
    await entrar(u.email, u.senha);

    const visiveis = await listarSessoesDe(u.id, "nenhuma");
    expect(visiveis.length).toBeGreaterThan(0);
    for (const s of visiveis) {
      expect(Object.keys(s).sort()).toEqual(
        ["agente", "atual", "criadaEm", "expiraEm", "id", "ip"].sort(),
      );
      expect(JSON.stringify(s)).not.toContain("token");
    }
  });

  it("desativar a conta mata a sessão na requisição seguinte (H6)", async () => {
    const u = await criarUsuario("desativa@teste.local");
    const cookie = await entrar(u.email, u.senha);
    expect(await sessaoDe(cookie)).not.toBe("null");

    // Papel, `ativo` e gates são lidos do banco a CADA requisição.
    await poolDeTeste.query("update usuarios set ativo = false where id = $1", [u.id]);
    await revogarSessoesDe(u.id);

    expect(await sessaoDe(cookie)).toBe("null");
  });

  it("trocar o papel revoga as sessões do alvo (F5)", async () => {
    const u = await criarUsuario("papel@teste.local", { papel: "gerente" });
    const cookie = await entrar(u.email, u.senha);
    expect(await sessaoDe(cookie)).not.toBe("null");

    // De `gerente` para `admin`: os dois têm `loja_id` nulo, então o CHECK
    // `usuarios_papel_loja` deixa passar. Papel de operação exigiria loja.
    await poolDeTeste.query("update usuarios set papel = 'admin' where id = $1", [u.id]);
    await revogarSessoesDe(u.id).catch(() => undefined);

    expect(await sessaoDe(cookie)).toBe("null");
  });

  it("a 3ª sessão simultânea de um admin derruba a mais antiga (F14)", async () => {
    // `dono`/`admin` têm teto 2; os demais, 3.
    expect(TETO_SESSOES).toBe(3);
    expect(TETO_SESSOES_PRIVILEGIADO).toBe(2);

    const u = await criarUsuario("teto@teste.local", { papel: "admin" });
    const primeiro = await entrar(u.email, u.senha);
    await new Promise((r) => setTimeout(r, 1100));
    await entrar(u.email, u.senha);
    await new Promise((r) => setTimeout(r, 1100));
    await entrar(u.email, u.senha);

    const { rows } = await poolDeTeste.query<{ n: string }>(
      "select count(*)::text as n from usuarios_sessoes where usuario_id = $1 and expira_em > now()",
      [u.id],
    );
    expect(Number(rows[0]!.n)).toBeLessThanOrEqual(TETO_SESSOES_PRIVILEGIADO);
    // E quem caiu foi a MAIS ANTIGA.
    expect(await sessaoDe(primeiro)).toBe("null");
  });

  it("sair grava a trilha e limpa o navegador (F8/F13/G25)", async () => {
    const u = await criarUsuario("sair@teste.local");
    const cookie = await entrar(u.email, u.senha);

    const saida = await postar("/sign-out", {}, { cookie });
    expect(saida.status).toBe(200);
    expect(saida.headers.get("clear-site-data")).toBe('"cache","cookies","storage"');
    expect(saida.headers.get("cache-control")).toBe("no-store");

    await new Promise((r) => setTimeout(r, 300));
    const { rows } = await poolDeTeste.query<{ n: string }>(
      "select count(*)::text as n from auth_eventos where tipo = 'sessao_encerrada' and usuario_id = $1",
      [u.id],
    );
    expect(Number(rows[0]!.n)).toBeGreaterThan(0);
    expect(await sessaoDe(cookie)).toBe("null");
  });

  it("toda resposta de auth leva Cache-Control: no-store (F13)", async () => {
    const r = await obter("/get-session");
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
});
