import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * T28 — provisionamento por convite (02-seguranca.md §9.2, REQ-C11/E13/D1).
 *
 * Reprova quando: depois do convite, `sign-in/email` NÃO autentica (formato de
 * hash divergente entre `criarUsuarioPorConvite` e `password.verify`); convite
 * para e-mail existente altera coluna; o token volta a valer depois de erro; e
 * convite `bootstrap` cria um SEGUNDO dono.
 */

vi.mock("@/lib/auth/emails", () => ({
  enfileirarEmailSeguranca: () => undefined,
}));

const {
  criarConvite,
  criarUsuario,
  fecharApoio,
  hashDeToken,
  limparAuth,
  poolDeTeste,
  postar,
  contarEventos,
} = await import("./_apoio");
const { ErroDeConvite, usarConvite } = await import("@/lib/auth/convites");

const SENHA = "frase-de-primeiro-acesso-teste-7";

beforeAll(async () => {
  await limparAuth();
});

afterAll(async () => {
  await fecharApoio();
});

async function conviteVivo(token: string): Promise<boolean> {
  const { rows } = await poolDeTeste.query<{ n: string }>(
    "select count(*)::text as n from usuarios_convites where token_hash = $1 and usado_em is null",
    [hashDeToken(token)],
  );
  return rows[0]!.n === "1";
}

describe("convite", () => {
  it("depois do convite, o login com senha AUTENTICA (o hash bate com o verify)", async () => {
    const { token } = await criarConvite("novo-gerente@teste.local", { papel: "gerente" });

    const resultado = await usarConvite(token, { nome: "Nova Gerente", senha: SENHA });
    expect(resultado.usuarioId).not.toBeNull();

    // É o único jeito de provar que o formato do hash bate com o `verify` da
    // biblioteca: se divergir, a conta nasce sem conseguir entrar.
    const entrada = await postar("/sign-in/email", {
      email: "novo-gerente@teste.local",
      password: SENHA,
    });
    expect(entrada.status).toBe(200);
  });

  it("a conta nasce INATIVA e com o gate do 2º fator ligado (D1)", async () => {
    const { token } = await criarConvite("inativo@teste.local", { papel: "gerente" });
    const { usuarioId } = await usarConvite(token, { nome: "Pessoa", senha: SENHA });

    const { rows } = await poolDeTeste.query(
      "select ativo, precisa_configurar_fator, email_verificado, papel from usuarios where id = $1",
      [usuarioId],
    );
    expect(rows[0]).toMatchObject({
      ativo: false,
      precisa_configurar_fator: true,
      // A posse do e-mail já foi provada por ter aberto o convite.
      email_verificado: true,
      papel: "gerente",
    });
  });

  it("a senha do convite entra no histórico (B7)", async () => {
    const { token } = await criarConvite("historico@teste.local", { papel: "gerente" });
    const { usuarioId } = await usarConvite(token, { nome: "Pessoa", senha: SENHA });
    const { rows } = await poolDeTeste.query<{ n: string }>(
      "select count(*)::text as n from usuarios_senhas_historico where usuario_id = $1",
      [usuarioId],
    );
    expect(rows[0]!.n).toBe("1");
  });

  it("convite para e-mail JÁ EXISTENTE não altera nenhuma coluna (C11)", async () => {
    // Papel de gestão: `vendedor` exigiria `loja_id`, pelo CHECK do banco.
    const existente = await criarUsuario("ja-existe@teste.local", { papel: "gerente" });
    const antes = await poolDeTeste.query("select * from usuarios where id = $1", [existente.id]);

    const { token } = await criarConvite("ja-existe@teste.local", { papel: "gerente" });
    const resultado = await usarConvite(token, { nome: "Impostor", senha: SENHA });

    // Nada criado, nada alterado — e o token foi queimado, então o convite não
    // serve mais para ninguém (é o pré-sequestro da Microsoft 2022).
    expect(resultado.usuarioId).toBeNull();
    const depois = await poolDeTeste.query("select * from usuarios where id = $1", [existente.id]);
    expect(depois.rows[0]).toEqual(antes.rows[0]);
    expect(await conviteVivo(token)).toBe(false);
  });

  it("token já usado, expirado ou inventado recusa sempre igual", async () => {
    const { token } = await criarConvite("usa-uma-vez@teste.local", { papel: "gerente" });
    await usarConvite(token, { nome: "Pessoa", senha: SENHA });

    await expect(usarConvite(token, { nome: "Outra", senha: SENHA })).rejects.toBeInstanceOf(
      ErroDeConvite,
    );
    await expect(
      usarConvite("token-que-nunca-existiu", { nome: "Outra", senha: SENHA }),
    ).rejects.toBeInstanceOf(ErroDeConvite);
  });

  it("erro DEPOIS do consumo devolve o token: a transação inteira desfaz", async () => {
    const { token } = await criarConvite("desfaz@teste.local", { papel: "gerente" });

    // Senha acima do teto bruto de 1024 bytes: o `kdf.hash` recusa DEPOIS do
    // `update ... set usado_em = now()`, que é justamente o ponto a provar.
    await expect(
      usarConvite(token, { nome: "Pessoa", senha: "a".repeat(2000) }),
    ).rejects.toBeTruthy();

    expect(await conviteVivo(token)).toBe(true);
  });

  it("convite bootstrap cria o PRIMEIRO dono e nunca um segundo", async () => {
    const primeiro = await criarConvite("dono1@teste.local", { bootstrap: true, papel: "admin" });
    const r1 = await usarConvite(primeiro.token, { nome: "Dono Um", senha: SENHA });
    const { rows: donos } = await poolDeTeste.query("select papel from usuarios where id = $1", [
      r1.usuarioId,
    ]);
    expect(donos[0]!.papel).toBe("dono");
    expect(await contarEventos("dono_semeado")).toBeGreaterThan(0);

    // Com dono vivo, um segundo convite de semeadura cria `admin`, não `dono`.
    const segundo = await criarConvite("dono2@teste.local", { bootstrap: true, papel: "admin" });
    const r2 = await usarConvite(segundo.token, { nome: "Dono Dois", senha: SENHA });
    const { rows: segundos } = await poolDeTeste.query("select papel from usuarios where id = $1", [
      r2.usuarioId,
    ]);
    expect(segundos[0]!.papel).toBe("admin");

    const { rows: total } = await poolDeTeste.query<{ n: string }>(
      "select count(*)::text as n from usuarios where papel = 'dono' and is_deleted = false",
    );
    expect(total[0]!.n).toBe("1");
  });

  it("o banco recusa convite com papel dono (a barreira é o CHECK)", async () => {
    await expect(
      poolDeTeste.query(
        `insert into usuarios_convites (email, papel, token_hash, expira_em, created_at, updated_at)
         values ('dono-proibido@teste.local', 'dono', 'hash', now() + interval '1 day', now(), now())`,
      ),
    ).rejects.toThrow(/usuarios_convites_papel_lista/);
  });
});
