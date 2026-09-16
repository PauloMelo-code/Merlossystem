import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Contexto } from "@/lib/auth/guard";
import type { Papel } from "@/lib/db/schema/_enums/auth";

/**
 * Administração de acessos no banco real (02-seguranca.md §9.2, §9.3, §11.2).
 *
 * Reprova quando: o convite não respeita a escada ou deixa dois convites
 * vivos; o reenvio não mata o token antigo; desativar quem está em
 * provisionamento não fecha o provisionamento; reativar abre conta sem fator;
 * destravar conta livre "dá certo"; o reset por admin define senha ou ignora o
 * cooldown; a recuperação assistida deixa fator para trás; e a troca de e-mail
 * muda o endereço antes da confirmação da própria pessoa.
 */

const enviados: { assunto: string; link?: string; paraEmail?: string }[] = [];

vi.mock("@/lib/auth/emails", () => ({
  enfileirarEmailSeguranca: (
    assunto: string,
    _usuarioId: string,
    link?: string,
    extras: { paraEmail?: string } = {},
  ) => {
    enviados.push({
      assunto,
      ...(link === undefined ? {} : { link }),
      ...(extras.paraEmail === undefined ? {} : { paraEmail: extras.paraEmail }),
    });
  },
}));

const apoio = await import("../seguranca/_apoio");
const { criarUsuario, fecharApoio, limparAuth, poolDeTeste, contarEventos, lerUsuario } = apoio;
const { emTransacao } = await import("@/lib/db/mutacoes");
const { convidarUsuario, reenviarConvite } = await import("@/lib/usuarios/convites");
const adm = await import("@/lib/usuarios/administracao");
const acesso = await import("@/lib/usuarios/acesso");
const trocas = await import("@/lib/usuarios/trocas-email");
const { redisDoLimitador } = await import("@/lib/seguranca/limite");

type Fn<D, R> = (tx: never, ctx: Contexto, dados: D) => Promise<R>;

function ctxDe(id: string, papel: Papel, lojaId: string | null = null): Contexto {
  return {
    sessao: {
      usuarioId: id,
      sessaoId: randomUUID(),
      papel,
      lojaId,
      ativo: true,
      precisaTrocarSenha: false,
      precisaConfigurarFator: false,
    },
    escopo: lojaId ? { tipo: "uma", lojaId } : { tipo: "todas" },
    autorId: id,
    origem: "ui",
  };
}

function rodar<D, R>(ctx: Contexto, fn: Fn<D, R>, dados: D): Promise<R> {
  return emTransacao(ctx, (tx) => fn(tx as never, ctx, dados));
}

async function updatedAt(id: string): Promise<Date> {
  return (await lerUsuario(id)).updated_at as Date;
}

async function darFatores(id: string): Promise<void> {
  await poolDeTeste.query(
    `insert into usuarios_passkeys (usuario_id, nome, chave_publica, credential_id)
     values ($1::uuid, 'Aparelho', 'chave-sem-valor', gen_random_uuid()::text)`,
    [id],
  );
  await poolDeTeste.query(
    `insert into usuarios_totp (usuario_id, secret, verificado) values ($1::uuid, 'x', true)`,
    [id],
  );
  await poolDeTeste.query("update usuarios set two_factor_enabled = true where id = $1", [id]);
}

const MOTIVO = "motivo de teste com folga";
let lojaId: string;
let dono: { id: string };
let admin: { id: string };
let n = 0;
const email = (prefixo: string) => `${prefixo}-${String((n += 1))}@teste.local`;

beforeAll(async () => {
  await limparAuth();
  dono = await criarUsuario("dono@teste.local", { papel: "dono" });
  admin = await criarUsuario("admin@teste.local", { papel: "admin" });
  const { rows } = await poolDeTeste.query<{ id: string }>(
    `insert into lojas (nome, slug, sigla) values ('Centro', 'centro', 'CEN') returning id`,
  );
  lojaId = rows[0]!.id;
});

beforeEach(() => {
  enviados.length = 0;
});

afterAll(async () => {
  await fecharApoio();
});

describe("convite", () => {
  it("admin convida vendedora; o link vai no fragmento e o e-mail é enfileirado", async () => {
    const alvo = email("vendedora");
    const saida = await rodar(ctxDe(admin.id, "admin"), convidarUsuario, {
      email: alvo,
      papel: "vendedor",
      lojaId,
      motivo: MOTIVO,
    });
    expect(saida.link).toMatch(/\/primeiro-acesso#t=[A-Za-z0-9_-]{43}$/);
    expect(enviados).toEqual([{ assunto: "convite", link: saida.link, paraEmail: alvo }]);
    const { rows } = await poolDeTeste.query(
      "select papel, loja_id, criado_por, motivo, token_hash from usuarios_convites where email = $1",
      [alvo],
    );
    expect(rows[0]).toMatchObject({ papel: "vendedor", loja_id: lojaId, criado_por: admin.id });
    // O token em claro nunca vai para o banco.
    expect(rows[0].token_hash).not.toContain(saida.link.split("#t=")[1]);
  });

  it("admin NÃO convida admin; dono convida, e a ciência fica registrada", async () => {
    const alvo = email("novo-admin");
    const dados = { email: alvo, papel: "admin" as const, lojaId: null, motivo: MOTIVO };
    await expect(rodar(ctxDe(admin.id, "admin"), convidarUsuario, dados)).rejects.toMatchObject({
      codigo: "SEM_PERMISSAO",
    });
    await rodar(ctxDe(dono.id, "dono"), convidarUsuario, dados);
    const { rows } = await poolDeTeste.query(
      "select ciencia_versao from usuarios_convites where email = $1",
      [alvo],
    );
    expect(rows[0].ciencia_versao).toBe("CIENCIA_ADMIN_V1");
  });

  it("recusa e-mail que já tem conta e segundo convite vivo", async () => {
    const ctx = ctxDe(admin.id, "admin");
    const base = { papel: "gerente" as const, lojaId: null, motivo: MOTIVO };
    await expect(
      rodar(ctx, convidarUsuario, { ...base, email: "dono@teste.local" }),
    ).rejects.toMatchObject({ codigo: "VALIDACAO" });
    const alvo = email("duplo");
    await rodar(ctx, convidarUsuario, { ...base, email: alvo });
    await expect(rodar(ctx, convidarUsuario, { ...base, email: alvo })).rejects.toMatchObject({
      codigo: "VALIDACAO",
    });
  });

  it("reenviar aposenta o token antigo e emite outro", async () => {
    const ctx = ctxDe(admin.id, "admin");
    const alvo = email("reenvio");
    await rodar(ctx, convidarUsuario, { email: alvo, papel: "viewer", lojaId, motivo: MOTIVO });
    const { rows } = await poolDeTeste.query<{ id: string; token_hash: string }>(
      "select id, token_hash from usuarios_convites where email = $1",
      [alvo],
    );
    const novo = await rodar(ctx, reenviarConvite, { conviteId: rows[0]!.id, motivo: MOTIVO });
    const depois = await poolDeTeste.query(
      "select is_deleted, token_hash from usuarios_convites where email = $1 order by created_at",
      [alvo],
    );
    expect(depois.rows).toHaveLength(2);
    expect(depois.rows[0]).toMatchObject({ is_deleted: true, token_hash: rows[0]!.token_hash });
    expect(depois.rows[1].is_deleted).toBe(false);
    expect(novo.link).toContain("#t=");
  });
});

describe("papel e ativo", () => {
  it("trocar papel grava a trilha, muda campo a campo e derruba as sessões", async () => {
    const alvo = await criarUsuario(email("troca"), { papel: "vendedor", lojaId });
    await poolDeTeste.query(
      `insert into usuarios_sessoes (token, usuario_id, expira_em)
       values ($1, $2, now() + interval '1 hour')`,
      [randomUUID(), alvo.id],
    );
    await rodar(ctxDe(admin.id, "admin"), adm.trocarPapel, {
      alvoId: alvo.id,
      updatedAt: await updatedAt(alvo.id),
      papel: "gerente",
      lojaId: null,
      motivo: MOTIVO,
    });
    expect(await lerUsuario(alvo.id)).toMatchObject({ papel: "gerente", loja_id: null });
    const { rows } = await poolDeTeste.query(
      "select count(*)::int as n from usuarios_sessoes where usuario_id = $1",
      [alvo.id],
    );
    expect(rows[0].n).toBe(0);
    const trilha = await poolDeTeste.query(
      "select ator_id, motivo from auth_eventos where tipo = 'papel_alterado' and alvo_id = $1",
      [alvo.id],
    );
    expect(trilha.rows[0]).toMatchObject({ ator_id: admin.id, motivo: MOTIVO });
  });

  it("updated_at velho vira COLISAO, e nada muda", async () => {
    const alvo = await criarUsuario(email("colisao"), { papel: "viewer", lojaId });
    await expect(
      rodar(ctxDe(admin.id, "admin"), adm.trocarPapel, {
        alvoId: alvo.id,
        updatedAt: new Date(Date.now() - 60_000),
        papel: "vendedor",
        lojaId,
        motivo: MOTIVO,
      }),
    ).rejects.toMatchObject({ codigo: "COLISAO" });
    expect((await lerUsuario(alvo.id)).papel).toBe("viewer");
  });

  it("desativar conta em provisionamento FECHA o provisionamento e o convite", async () => {
    const endereco = email("provisionando");
    const alvo = await criarUsuario(endereco, {
      papel: "gerente",
      ativo: false,
      precisaConfigurarFator: true,
    });
    await poolDeTeste.query(
      `insert into usuarios_convites (email, papel, token_hash, expira_em, criado_por)
       values ($1, 'gerente', $2, now() + interval '1 day', $3)`,
      [endereco, randomUUID(), admin.id],
    );
    await rodar(ctxDe(admin.id, "admin"), adm.desativarUsuario, {
      alvoId: alvo.id,
      updatedAt: await updatedAt(alvo.id),
      motivo: MOTIVO,
    });
    expect(await lerUsuario(alvo.id)).toMatchObject({
      ativo: false,
      precisa_configurar_fator: false,
    });
    const { rows } = await poolDeTeste.query(
      "select is_deleted from usuarios_convites where email = $1",
      [endereco],
    );
    expect(rows.every((r) => r.is_deleted === true)).toBe(true);
    // Reativar conta que nunca teve fator não abre acesso.
    await expect(
      rodar(ctxDe(admin.id, "admin"), adm.reativarUsuario, {
        alvoId: alvo.id,
        updatedAt: await updatedAt(alvo.id),
        motivo: MOTIVO,
      }),
    ).rejects.toMatchObject({ codigo: "VALIDACAO" });
  });

  it("promover exige passkey e aplicativo do alvo (H7)", async () => {
    const alvo = await criarUsuario(email("promovido"), { papel: "gerente" });
    const ctx = ctxDe(dono.id, "dono");
    const dados = async () => ({
      alvoId: alvo.id,
      updatedAt: await updatedAt(alvo.id),
      motivo: MOTIVO,
    });
    await expect(rodar(ctx, adm.promoverAAdmin, await dados())).rejects.toMatchObject({
      codigo: "VALIDACAO",
    });
    await darFatores(alvo.id);
    await rodar(ctx, adm.promoverAAdmin, await dados());
    expect((await lerUsuario(alvo.id)).papel).toBe("admin");
    expect(await contarEventos("admin_promovido")).toBeGreaterThanOrEqual(1);
  });
});

describe("acesso de outra pessoa", () => {
  it("destravar conta livre é 409; conta travada é destravada", async () => {
    const alvo = await criarUsuario(email("travada"), { papel: "vendedor", lojaId });
    const ctx = ctxDe(admin.id, "admin");
    await expect(
      rodar(ctx, acesso.destravarConta, { alvoId: alvo.id, motivo: MOTIVO }),
    ).rejects.toMatchObject({ codigo: "CONTA_LIVRE", status: 409 });
    await poolDeTeste.query(
      "update usuarios set falhas_login = 5, bloqueado_ate = now() + interval '10 min' where id = $1",
      [alvo.id],
    );
    await rodar(ctx, acesso.destravarConta, { alvoId: alvo.id, motivo: MOTIVO });
    expect(await lerUsuario(alvo.id)).toMatchObject({ falhas_login: 0, bloqueado_ate: null });
  });

  it("reset por admin não toca na senha e respeita o cooldown de 60 s", async () => {
    const alvo = await criarUsuario(email("reset"), { papel: "vendedor", lojaId });
    await redisDoLimitador().del(`reset:${alvo.id}`);
    const antes = await poolDeTeste.query(
      "select senha_hash from usuarios_contas where usuario_id = $1",
      [alvo.id],
    );
    const ctx = ctxDe(admin.id, "admin");
    await rodar(ctx, acesso.iniciarResetDeSenha, { alvoId: alvo.id, motivo: MOTIVO });
    await rodar(ctx, acesso.iniciarResetDeSenha, { alvoId: alvo.id, motivo: MOTIVO });
    // Duas trilhas, UM e-mail: a resposta é a mesma, o cooldown segura o envio.
    expect(enviados.filter((e) => e.assunto === "reset")).toHaveLength(1);
    const depois = await poolDeTeste.query(
      "select senha_hash from usuarios_contas where usuario_id = $1",
      [alvo.id],
    );
    expect(depois.rows[0].senha_hash).toBe(antes.rows[0].senha_hash);
  });

  it("recuperação assistida remove TODOS os fatores e liga o gate", async () => {
    const alvo = await criarUsuario(email("recupera"), { papel: "gerente" });
    await darFatores(alvo.id);
    await rodar(ctxDe(admin.id, "admin"), acesso.recuperarAcessoAssistido, {
      alvoId: alvo.id,
      motivo: "identidade conferida por vídeo com documento",
    });
    const { rows } = await poolDeTeste.query(
      `select (select count(*)::int from usuarios_passkeys where usuario_id = $1) as p,
              (select count(*)::int from usuarios_totp where usuario_id = $1) as t`,
      [alvo.id],
    );
    expect(rows[0]).toEqual({ p: 0, t: 0 });
    expect(await lerUsuario(alvo.id)).toMatchObject({
      precisa_configurar_fator: true,
      two_factor_enabled: false,
    });
    expect(enviados.map((e) => e.assunto)).toEqual(
      expect.arrayContaining(["reset", "recuperacao-assistida"]),
    );
  });
});

describe("troca de e-mail", () => {
  it("só muda depois que a PRÓPRIA pessoa confirma o código", async () => {
    const alvo = await criarUsuario(email("troca-email"), { papel: "vendedor", lojaId });
    const novo = email("novo-endereco");
    await rodar(ctxDe(admin.id, "admin"), trocas.iniciarTrocaDeEmail, {
      alvoId: alvo.id,
      emailNovo: novo,
      motivo: MOTIVO,
    });
    expect((await lerUsuario(alvo.id)).email).toBe(alvo.email);
    const paraNovo = enviados.find((e) => e.paraEmail === novo);
    const codigo = paraNovo?.link?.split("#codigo=")[1] ?? "";
    expect(codigo).toMatch(/^\d{6}$/);

    const propria = ctxDe(alvo.id, "vendedor", lojaId);
    const errado = codigo === "000000" ? "111111" : "000000";
    await expect(
      rodar(propria, (tx, ctx, c: string) => trocas.confirmarTrocaDeEmail(tx, ctx, c), errado),
    ).rejects.toMatchObject({ codigo: "VALIDACAO" });
    await rodar(propria, (tx, ctx, c: string) => trocas.confirmarTrocaDeEmail(tx, ctx, c), codigo);
    expect((await lerUsuario(alvo.id)).email).toBe(novo);
    const { rows } = await poolDeTeste.query(
      "select tentativas, confirmado_em from usuarios_trocas_email where usuario_id = $1",
      [alvo.id],
    );
    expect(rows[0].tentativas).toBe(2);
    expect(rows[0].confirmado_em).not.toBeNull();
  });
});
