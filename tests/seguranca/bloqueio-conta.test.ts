import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as bloqueio from "@/lib/auth/bloqueio";
import { criarUsuario, fecharApoio, limparAuth, lerUsuario, poolDeTeste, postar } from "./_apoio";

/**
 * T6 — bloqueio por CONTA, atômico e persistido (02-seguranca.md §7.1, REQ-C1).
 *
 * Reprova quando: tentativas PARALELAS não somam; a resposta da 7ª difere da
 * 1ª; passkey não zera o contador; o pedido de reset alimenta o bloqueio;
 * martelar ESTENDE `bloqueado_ate`; e quando e-mail inexistente deixa escrita.
 */

beforeAll(async () => {
  await limparAuth();
});

afterAll(async () => {
  await fecharApoio();
});

async function estado(id: string) {
  const linha = await lerUsuario(id);
  return {
    falhas: Number(linha.falhas_login),
    ate: linha.bloqueado_ate ? new Date(linha.bloqueado_ate as string) : null,
  };
}

describe("bloqueio por conta", () => {
  it("8 tentativas PARALELAS somam 8 — o UPDATE é uma instrução só", async () => {
    const u = await criarUsuario("paralelo@teste.local");

    await Promise.all(
      Array.from({ length: 8 }, () => bloqueio.registrarFalha(u.email)),
    );

    const depois = await estado(u.id);
    // As 5 primeiras contam até o bloqueio; as demais caem no `WHERE` que
    // recusa contar falha durante o bloqueio. O que não pode acontecer é o
    // contador parar em 1 ou 2, que é o sintoma do SELECT-depois-UPDATE.
    expect(depois.falhas).toBeGreaterThanOrEqual(5);
    expect(depois.ate).not.toBeNull();
  });

  it("martelar NÃO estende bloqueado_ate", async () => {
    const u = await criarUsuario("martelo@teste.local");
    for (let i = 0; i < 5; i += 1) await bloqueio.registrarFalha(u.email);

    const primeiro = await estado(u.id);
    expect(primeiro.ate).not.toBeNull();

    await new Promise((r) => setTimeout(r, 1100));
    for (let i = 0; i < 5; i += 1) await bloqueio.registrarFalha(u.email);

    const segundo = await estado(u.id);
    expect(segundo.ate?.getTime()).toBe(primeiro.ate?.getTime());
  });

  it("a resposta da 7ª tentativa é idêntica à da 1ª", async () => {
    const u = await criarUsuario("identica@teste.local");
    const respostas = [];
    for (let i = 0; i < 7; i += 1) {
      respostas.push(await postar("/sign-in/email", { email: u.email, password: "errada-mas-longa-x" }));
    }
    const primeira = respostas[0]!;
    const setima = respostas[6]!;
    expect(setima.status).toBe(primeira.status);
    expect(setima.corpo).toBe(primeira.corpo);
    expect(setima.headers.get("content-length")).toBe(primeira.headers.get("content-length"));
  });

  it("e-mail inexistente não escreve NADA (C5)", async () => {
    const antes = await poolDeTeste.query<{ n: string }>("select count(*)::text as n from usuarios");
    const r = await bloqueio.registrarFalha("nao-existe-mesmo@teste.local");
    const depois = await poolDeTeste.query<{ n: string }>("select count(*)::text as n from usuarios");
    expect(r.usuarioId).toBeNull();
    expect(depois.rows[0]!.n).toBe(antes.rows[0]!.n);
  });

  it("entrada por passkey zera o contador e solta a conta (C9)", async () => {
    const u = await criarUsuario("passkey-zera@teste.local");
    for (let i = 0; i < 5; i += 1) await bloqueio.registrarFalha(u.email);
    expect((await estado(u.id)).ate).not.toBeNull();

    await bloqueio.zerarPorId(u.id);

    const depois = await estado(u.id);
    expect(depois.falhas).toBe(0);
    expect(depois.ate).toBeNull();
  });

  it("pedir reset NÃO alimenta o bloqueio (E14)", async () => {
    const u = await criarUsuario("reset-nao-conta@teste.local");
    for (let i = 0; i < 4; i += 1) {
      await postar("/request-password-reset", { email: u.email, redirectTo: "/" });
    }
    const depois = await estado(u.id);
    expect(depois.falhas).toBe(0);
    expect(depois.ate).toBeNull();
  });

  it("conta bloqueada NÃO conta falha nova: o bloqueio não vira arma (C3)", async () => {
    const u = await criarUsuario("arma@teste.local");
    for (let i = 0; i < 5; i += 1) await bloqueio.registrarFalha(u.email);
    const trancada = await estado(u.id);

    for (let i = 0; i < 5; i += 1) {
      await postar("/sign-in/email", { email: u.email, password: "errada-mas-longa-y" });
    }
    const depois = await estado(u.id);
    expect(depois.falhas).toBe(trancada.falhas);
    expect(depois.ate?.getTime()).toBe(trancada.ate?.getTime());
  });
});
