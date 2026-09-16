import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import { Queue } from "bullmq";
import { lerFonte } from "./_fonte";

/**
 * E-mail desligado (ADR 0062) — teste de EFEITO dos quatro pontos:
 *   1. convite: o link não entra na fila, volta só para quem emitiu, e o
 *      reenvio mata o link anterior;
 *   2. "Esqueci a senha": resposta igual para toda conta, nada na fila, e a
 *      tela manda procurar o administrador;
 *   3. aviso de conta vira alerta no sino, visível só para dono e admin;
 *   4. o token nunca aparece em log.
 *
 * O ambiente é lido no import de `env.ts`: a variável muda ANTES de qualquer
 * módulo da aplicação carregar.
 */
process.env.EMAIL_PROVEDOR = "desligado";

const apoio = await import("./_apoio");
const { criarUsuario, fecharApoio, limparAuth, poolDeTeste, postar, hashDeToken } = apoio;
const { env } = await import("@/lib/env");
const { logger } = await import("@/lib/logger");
const { enfileirarEmailSeguranca, emailDesligado } = await import("@/lib/auth/emails");
const { enviarConvite } = await import("@/lib/auth/convites");
const { emTransacao } = await import("@/lib/db/mutacoes");
const { convidarUsuario, reenviarConvite } = await import("@/lib/usuarios/convites");
const { emailSeguranca } = await import("@/server/processadores/emails");
const { reconhecerAlerta } = await import("@/lib/alertas");
const { alertasVisiveis } = await import("@/lib/alertas/visibilidade");
const { vivosE } = await import("@/lib/db/consultas");
const { alertas } = await import("@/lib/db/schema/alertas");
const { db } = await import("@/lib/db/client");
const { and, eq } = await import("drizzle-orm");
const { renderToStaticMarkup } = await import("react-dom/server");
const { default: PaginaEsqueciASenha } = await import("@/app/(publico)/esqueci-a-senha/page");
type Contexto = import("@/lib/auth/guard").Contexto;
type Papel = import("@/lib/db/schema/_enums/auth").Papel;

const filaDeEmails = new Queue("emails", { connection: { url: env.REDIS_URL } });

async function jobsNaFila(): Promise<number> {
  const c = await filaDeEmails.getJobCounts("waiting", "delayed", "active", "prioritized");
  return Object.values(c).reduce((a, b) => a + b, 0);
}

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

/** Tudo o que qualquer nível do logger e o console receberam, serializado. */
const registrado: string[] = [];
const NIVEIS = ["trace", "debug", "info", "warn", "error", "fatal"] as const;

let lojaId: string;
let outraLojaId: string;
let admin: { id: string };

async function lojaDeTeste(slug: string, sigla: string): Promise<string> {
  const { rows } = await poolDeTeste.query<{ id: string }>(
    `with nova as (
       insert into lojas (nome, slug, sigla)
       select $1, $1, $2
       where not exists (select 1 from lojas where lower(slug) = $1 and not is_deleted)
       returning id
     )
     select id from nova
     union all
     select id from lojas where lower(slug) = $1 and not is_deleted`,
    [slug, sigla],
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  await limparAuth();
  lojaId = await lojaDeTeste("email-off-a", "QEA");
  outraLojaId = await lojaDeTeste("email-off-b", "QEB");
  admin = await criarUsuario("admin-email-off@teste.local", { papel: "admin" });
  for (const nivel of NIVEIS) {
    vi.spyOn(logger, nivel).mockImplementation(((...args: unknown[]) => {
      registrado.push(JSON.stringify(args));
    }) as never);
  }
  for (const metodo of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, metodo).mockImplementation((...args: unknown[]) => {
      registrado.push(JSON.stringify(args.map(String)));
    });
  }
});

afterAll(async () => {
  vi.restoreAllMocks();
  await filaDeEmails.close();
  await fecharApoio();
});

describe("ADR 0062: e-mail desligado", () => {
  it("EMAIL_PROVEDOR=desligado é lido como desligado", () => {
    expect(env.EMAIL_PROVEDOR).toBe("desligado");
    expect(emailDesligado()).toBe(true);
  });

  it("1. convite: link só para quem emitiu, nada na fila, reenvio mata o anterior", async () => {
    const ctx = ctxDe(admin.id, "admin");
    const antes = await jobsNaFila();
    const primeiro = await emTransacao(ctx, (tx) =>
      convidarUsuario(tx, ctx, {
        email: "convidada-off@teste.local",
        papel: "vendedor",
        lojaId,
        motivo: "motivo de teste com folga",
      }),
    );
    enviarConvite(primeiro, admin.id);
    await new Promise((r) => setTimeout(r, 100));
    expect(await jobsNaFila()).toBe(antes);

    const token1 = primeiro.link.slice(primeiro.link.indexOf("#") + 3);
    expect(token1.length).toBeGreaterThan(20);
    // O banco guarda só o hash: nenhuma coluna tem o token.
    const linha = await poolDeTeste.query<{ j: string }>(
      "select row_to_json(c)::text as j from usuarios_convites c where token_hash = $1",
      [hashDeToken(token1)],
    );
    expect(linha.rows).toHaveLength(1);
    expect(linha.rows[0]!.j).not.toContain(token1);

    const { rows } = await poolDeTeste.query<{ id: string }>(
      "select id from usuarios_convites where token_hash = $1",
      [hashDeToken(token1)],
    );
    const segundo = await emTransacao(ctx, (tx) =>
      reenviarConvite(tx, ctx, { conviteId: rows[0]!.id, motivo: "reenvio de teste com folga" }),
    );
    enviarConvite(segundo, admin.id);
    const token2 = segundo.link.slice(segundo.link.indexOf("#") + 3);
    expect(token2).not.toBe(token1);

    const vivo = async (token: string) =>
      (
        await poolDeTeste.query(
          `select 1 from usuarios_convites
            where token_hash = $1 and usado_em is null and is_deleted = false and expira_em > now()`,
          [hashDeToken(token)],
        )
      ).rowCount;
    expect(await vivo(token1)).toBe(0);
    expect(await vivo(token2)).toBe(1);
    expect(await jobsNaFila()).toBe(antes);

    // A tela mostra o link UMA vez, com sessão fresca: é o contrato da action.
    const acao = lerFonte("src/lib/actions/convites.ts");
    expect(acao.match(/fresca: true/g)).toHaveLength(2);
    expect(registrado.join("\n")).not.toContain(token1);
    expect(registrado.join("\n")).not.toContain(token2);
  });

  it("2. esqueci a senha: resposta igual, nada na fila, tela orienta a recuperação assistida", async () => {
    const u = await criarUsuario("reset-off@teste.local", { papel: "vendedor", lojaId });
    const antes = await jobsNaFila();
    const existente = await postar("/request-password-reset", { email: u.email, redirectTo: "/redefinir-senha" }, { xff: "203.0.113.201" });
    const inexistente = await postar("/request-password-reset", { email: "nao-existe-off@teste.local", redirectTo: "/redefinir-senha" }, { xff: "203.0.113.202" });
    expect(existente.status).toBe(200);
    expect(inexistente.status).toBe(existente.status);
    expect(inexistente.corpo).toBe(existente.corpo);
    await new Promise((r) => setTimeout(r, 200));
    expect(await jobsNaFila()).toBe(antes);

    const html = renderToStaticMarkup(PaginaEsqueciASenha());
    expect(html).toContain("procure o administrador da sua loja");
    expect(html).not.toContain("enviamos um link");
    expect(registrado.join("\n")).not.toMatch(/redefinir-senha#t=|reset-password:/);
  });

  it("3. aviso de conta vira alerta no sino, só para dono e admin", async () => {
    const vendedora = await criarUsuario("vend-off@teste.local", { papel: "vendedor", lojaId });
    const antes = await jobsNaFila();
    enfileirarEmailSeguranca("senha-alterada", vendedora.id);
    await new Promise((r) => setTimeout(r, 200));
    // O aviso sem link continua indo para a fila: é o worker que o põe no sino.
    expect(await jobsNaFila()).toBe(antes + 1);

    const job = { id: `aviso-${randomUUID()}`, data: { assunto: "senha-alterada", usuarioId: vendedora.id } };
    await emailSeguranca(job as unknown as Job);
    await emailSeguranca(job as unknown as Job); // retentativa não duplica

    const chave = `aviso_seguranca:senha-alterada:${vendedora.id}:${job.id}`;
    const abertos = await db
      .select({ id: alertas.id, lojaId: alertas.loja_id, updatedAt: alertas.updated_at, mensagem: alertas.mensagem })
      .from(alertas)
      .where(and(eq(alertas.chave_deduplicacao, chave), eq(alertas.tipo, "aviso_seguranca")));
    expect(abertos).toHaveLength(1);
    expect(abertos[0]!.lojaId).toBe(lojaId);
    expect(abertos[0]!.mensagem).toContain("a senha foi alterada");

    const ve = async (escopo: Contexto["escopo"], papel: Papel) =>
      (
        await db
          .select({ id: alertas.id })
          .from(alertas)
          .where(vivosE(alertas, alertasVisiveis(escopo, papel), eq(alertas.chave_deduplicacao, chave)))
      ).length;
    expect(await ve({ tipo: "todas" }, "dono")).toBe(1);
    expect(await ve({ tipo: "uma", lojaId: outraLojaId }, "admin")).toBe(1);
    expect(await ve({ tipo: "todas" }, "gerente")).toBe(0);
    expect(await ve({ tipo: "uma", lojaId }, "vendedor")).toBe(0);
    expect(await ve({ tipo: "uma", lojaId }, "viewer")).toBe(0);

    const gerente = await criarUsuario("ger-off@teste.local", { papel: "gerente" });
    await expect(
      db.transaction((tx) =>
        reconhecerAlerta({ id: abertos[0]!.id, updatedAt: abertos[0]!.updatedAt }, ctxDe(gerente.id, "gerente"), tx),
      ),
    ).rejects.toMatchObject({ codigo: "NAO_ENCONTRADO" });
  });

  it("4. o token nunca vai para log: nem na fila, nem no worker", async () => {
    const u = await criarUsuario("token-off@teste.local", { papel: "vendedor", lojaId });
    const token = `token-secreto-${randomUUID()}`;
    const link = `${env.APP_URL}/redefinir-senha#t=${token}`;
    enfileirarEmailSeguranca("reset", u.id, link);
    enfileirarEmailSeguranca("convite", u.id, `${env.APP_URL}/primeiro-acesso#t=${token}`, { paraEmail: u.email });
    // Job com link enfileirado antes de desligar: o worker descarta sem ler o link.
    await emailSeguranca({ id: `legado-${randomUUID()}`, data: { assunto: "reset", usuarioId: u.id, link } } as unknown as Job);
    await new Promise((r) => setTimeout(r, 200));
    const tudo = registrado.join("\n");
    expect(tudo).not.toContain(token);
    expect(tudo).toContain("e-mail de segurança descartado: envio desligado");
    const alertasComToken = await poolDeTeste.query("select 1 from alertas where mensagem like $1", [`%${token}%`]);
    expect(alertasComToken.rowCount).toBe(0);
  });
});
