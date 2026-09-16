import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Funções da fundação pedidas pela onda 2 (D9):
 *   - `removerTodosOsFatores` apaga TOTP e passkeys SÓ da pessoa-alvo;
 *   - `fecharConviteVencido` libera o índice único de e-mail aberto, com a
 *     trilha `convite_expirado`, e não toca convite ainda válido;
 *   - `emitirConviteEm` emite na transação de quem chama, com a ciência
 *     registrada em `detalhes.ciencia_versao`.
 */

vi.mock("@/lib/auth/emails", () => ({
  enfileirarEmailSeguranca: () => undefined,
}));

const { criarConvite, criarUsuario, fecharApoio, limparAuth, poolDeTeste } = await import("./_apoio");
const { removerTodosOsFatores } = await import("@/lib/auth/fatores");
const { emitirConviteEm, fecharConviteVencido } = await import("@/lib/auth/convites");
const { emTransacao } = await import("@/lib/db/mutacoes");
const { contextoDeSistema } = await import("@/lib/db/sistema");

beforeAll(async () => {
  await limparAuth();
});

afterAll(async () => {
  await fecharApoio();
});

async function darFatores(usuarioId: string): Promise<void> {
  await poolDeTeste.query(
    `insert into usuarios_totp (usuario_id, secret) values ($1, 'semente-cifrada-de-teste')`,
    [usuarioId],
  );
  await poolDeTeste.query(
    `insert into usuarios_passkeys (usuario_id, nome, chave_publica, credential_id)
     values ($1, 'chave', 'pk', gen_random_uuid()::text)`,
    [usuarioId],
  );
}

async function contarFatores(usuarioId: string): Promise<number> {
  const { rows } = await poolDeTeste.query<{ n: number }>(
    `select (select count(*) from usuarios_totp where usuario_id = $1)
          + (select count(*) from usuarios_passkeys where usuario_id = $1) as n`,
    [usuarioId],
  );
  return Number(rows[0]?.n ?? 0);
}

describe("removerTodosOsFatores", () => {
  it("apaga os fatores da pessoa-alvo e só dela", async () => {
    const alvo = await criarUsuario("alvo.fatores@teste.local");
    const outro = await criarUsuario("outro.fatores@teste.local");
    await darFatores(alvo.id);
    await darFatores(outro.id);

    const removidos = await removerTodosOsFatores(alvo.id);

    expect(removidos).toEqual({ totp: 1, passkeys: 1 });
    expect(await contarFatores(alvo.id)).toBe(0);
    expect(await contarFatores(outro.id)).toBe(2);
  });
});

describe("convites", () => {
  it("fecha o vencido com trilha, preserva o válido e libera o e-mail", async () => {
    const admin = await criarUsuario("admin.convites@teste.local", { papel: "admin" });
    const vencido = await criarConvite("vencido@teste.local", { criadoPor: admin.id });
    const valido = await criarConvite("valido@teste.local", { criadoPor: admin.id });
    await poolDeTeste.query(
      `update usuarios_convites set expira_em = now() - interval '1 minute' where id = $1`,
      [vencido.id],
    );

    const ctx = contextoDeSistema({ origem: "worker" });
    const fechados = await emTransacao(ctx, (tx) => fecharConviteVencido(tx, ctx));
    expect(fechados).toBe(1);

    const { rows } = await poolDeTeste.query<{ id: string; is_deleted: boolean }>(
      `select id, is_deleted from usuarios_convites where id = any($1::uuid[])`,
      [[vencido.id, valido.id]],
    );
    const estado = Object.fromEntries(rows.map((r) => [r.id, r.is_deleted]));
    expect(estado).toEqual({ [vencido.id]: true, [valido.id]: false });

    const trilha = await poolDeTeste.query<{ n: string }>(
      `select count(*)::text n from auditoria_eventos
        where acao = 'convite_expirado' and entidade_id = $1`,
      [vencido.id],
    );
    expect(trilha.rows[0]?.n).toBe("1");

    // O índice único parcial já não segura o e-mail: o convite novo entra.
    const ctxAdmin = { ...ctx, autorId: admin.id, origem: "ui" as const };
    const novo = await emTransacao(ctxAdmin, (tx) =>
      emitirConviteEm(
        tx,
        { email: "Vencido@teste.local", papel: "admin", cienciaVersao: "CIENCIA_ADMIN_V1", motivo: "reemissão" },
        ctxAdmin,
      ),
    );
    expect(novo.email).toBe("vencido@teste.local");
    expect(novo.link).toContain("/primeiro-acesso");

    const evento = await poolDeTeste.query<{ detalhes: Record<string, unknown> }>(
      `select detalhes from auth_eventos where tipo = 'convite_emitido' and ator_id = $1`,
      [admin.id],
    );
    expect(evento.rows[0]?.detalhes).toMatchObject({ papel: "admin", ciencia_versao: "CIENCIA_ADMIN_V1" });
  });

  it("com e-mail, fecha só o vencido daquele endereço", async () => {
    const admin = await criarUsuario("admin2.convites@teste.local", { papel: "admin" });
    const a = await criarConvite("a.vencido@teste.local", { criadoPor: admin.id });
    const b = await criarConvite("b.vencido@teste.local", { criadoPor: admin.id });
    await poolDeTeste.query(
      `update usuarios_convites set expira_em = now() - interval '1 minute' where id = any($1::uuid[])`,
      [[a.id, b.id]],
    );
    const ctx = contextoDeSistema({ origem: "worker" });
    const fechados = await emTransacao(ctx, (tx) =>
      fecharConviteVencido(tx, ctx, { email: "A.Vencido@teste.local" }),
    );
    expect(fechados).toBe(1);
    const { rows } = await poolDeTeste.query<{ is_deleted: boolean }>(
      `select is_deleted from usuarios_convites where id = $1`,
      [b.id],
    );
    expect(rows[0]?.is_deleted).toBe(false);
  });
});
