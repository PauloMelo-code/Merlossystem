import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { logger } from "@/lib/logger";
import { sanitizarErroBanco } from "@/lib/db/erros";
import type { MeioAuth } from "@/lib/db/schema/_enums/auth";
import { ipDoCliente } from "@/lib/seguranca/ip";
import { zerarPorId } from "./bloqueio";
import { registrarEventoAuth } from "./trilha";

/**
 * Ciclo de vida da sessão (02-seguranca.md §4.3 e §10).
 *
 * `databaseHooks.session.create.before` é o ÚNICO ponto que cobre TODO caminho
 * que cria sessão — senha pós-2FA, passkey e convite. Nenhuma lista de rotas
 * decide o que é login (L1).
 */

/** Teto de sessões simultâneas por pessoa (F14). */
export const TETO_SESSOES = 3;
export const TETO_SESSOES_PRIVILEGIADO = 2;

/** Inatividade: 60 min sem uso derruba a sessão (F3). */
export const INATIVIDADE_MS = 60 * 60 * 1000;
/** `ultimo_uso_em` é reescrito no máximo a cada 5 min. */
export const PASSO_ATIVIDADE_MS = 5 * 60 * 1000;
/** Frescor: o MESMO valor de `session.freshAge` (G11). */
export const FRESCOR_MS = 15 * 60 * 1000;

type SessaoBA = { id?: string; userId: string; token?: string };
type ContextoBA =
  | { path?: string | undefined; headers?: Headers | undefined }
  | null
  | undefined;

type LinhaUsuario = {
  id: string;
  papel: string;
  ativo: boolean;
  is_deleted: boolean;
  precisa_configurar_fator: boolean;
  bloqueado_ate: Date | null;
};

function caminho(ctx: ContextoBA): string {
  return ctx?.path ?? "";
}

/** O meio de autenticação sai do CAMINHO que criou a sessão, não de um palpite. */
export function meioDoCaminho(rota: string): MeioAuth {
  if (rota.startsWith("/two-factor/")) return "senha+totp";
  if (rota.startsWith("/passkey/") || rota === "/sign-in/passkey") return "passkey";
  if (rota === "/sign-in/email") return "senha";
  return "sistema";
}

async function lerUsuario(usuarioId: string): Promise<LinhaUsuario | undefined> {
  const linhas = await db.execute<LinhaUsuario>(sql`
    select id, papel, ativo, is_deleted, precisa_configurar_fator, bloqueado_ate
    from usuarios where id = ${usuarioId}::uuid limit 1
  `);
  return linhas.rows[0];
}

/**
 * Devolver `false` ABORTA a criação da sessão. Ordem exata de §4.3:
 *
 *   1. `is_deleted`                                           -> recusa sempre
 *   2. `ativo = false` E `precisa_configurar_fator = false`    -> conta DESATIVADA
 *   3. `ativo = false` E `precisa_configurar_fator = true`     -> PASSA: a conta
 *      está em PROVISIONAMENTO; a sessão nasce provisória e o guard só libera
 *      `/primeiro-acesso` (§9.4)
 *   4. `bloqueado_ate > now()`                                 -> recusa SOMENTE
 *      quando o meio é senha. No caminho passkey, ignora (C9): a vítima de um
 *      spray não pode ficar trancada fora do próprio sistema
 */
export async function podeCriarSessao(sessao: SessaoBA, ctx: ContextoBA): Promise<boolean> {
  try {
    const usuario = await lerUsuario(sessao.userId);
    if (!usuario) return false;
    if (usuario.is_deleted) return false;
    if (!usuario.ativo && !usuario.precisa_configurar_fator) return false;

    const rota = caminho(ctx);
    const porSenha = rota === "/sign-in/email" || rota.startsWith("/two-factor/");
    if (porSenha && usuario.bloqueado_ate && new Date(usuario.bloqueado_ate) > new Date()) {
      return false;
    }
    return true;
  } catch (erro) {
    // Fail-CLOSED: sem conseguir ler o usuário, não se cria sessão. É o
    // contrário do limitador, e de propósito — aqui o banco é a fonte.
    logger.error({ erro: sanitizarErroBanco(erro) }, "podeCriarSessao falhou");
    return false;
  }
}

/**
 * Trilha de entrada + teto de sessões. Nunca lança: é o funil best-effort de
 * §17.2 — trilha não pode impedir alguém de entrar (REQ-L3).
 */
export async function aposCriarSessao(sessao: SessaoBA, ctx: ContextoBA): Promise<void> {
  const rota = caminho(ctx);
  const meio = meioDoCaminho(rota);
  // O IP da trilha sai de `ipDoCliente()`, nunca do que o BA resolveu: a nossa
  // resolução tem o teto de 1 salto e cai para o socket em cadeia inesperada.
  const ip = ctx?.headers ? ipDoCliente(ctx.headers) : null;
  const agente = ctx?.headers?.get("user-agent") ?? null;

  const base = {
    usuarioId: sessao.userId,
    ...(sessao.id === undefined ? {} : { sessaoId: sessao.id }),
    meio,
    ip,
    agente,
    detalhes: { rota },
  };

  await registrarEventoAuth({ tipo: "sessao_criada", ...base });

  try {
    const usuario = await lerUsuario(sessao.userId);
    const plena = Boolean(usuario?.ativo) && !usuario?.precisa_configurar_fator;

    if (plena) {
      await registrarEventoAuth({ tipo: "login_sucesso", ...base });
      await db.execute(sql`
        update usuarios set ultimo_login_em = now() where id = ${sessao.userId}::uuid
      `);
    }

    // C9: entrar por passkey destrava a conta e zera o contador.
    if (meio === "passkey") await zerarPorId(sessao.userId);

    await aplicarTetoDeSessoes(sessao.userId, usuario?.papel ?? "viewer", sessao.token);
  } catch (erro) {
    logger.error({ erro: sanitizarErroBanco(erro) }, "aposCriarSessao falhou");
  }
}

/**
 * Acima do teto, encerra a MAIS ANTIGA e grava `sessao_encerrada` com
 * `motivo = 'teto_de_sessoes'`. Promessa de "máximo 3 sessões" sem mecanismo é
 * tela que promete o que o código não faz (I6).
 */
export async function aplicarTetoDeSessoes(
  usuarioId: string,
  papel: string,
  tokenAtual?: string,
): Promise<void> {
  const teto = papel === "dono" || papel === "admin" ? TETO_SESSOES_PRIVILEGIADO : TETO_SESSOES;

  const linhas = await db.execute<{ id: string; token: string }>(sql`
    select id, token from usuarios_sessoes
    where usuario_id = ${usuarioId}::uuid and expira_em > now()
    order by created_at asc
  `);
  const vivas = linhas.rows;
  if (vivas.length <= teto) return;

  const { auth } = await import("./auth");
  const interno = (await auth.$context).internalAdapter;

  for (const sessaoVelha of vivas.slice(0, vivas.length - teto)) {
    if (tokenAtual && sessaoVelha.token === tokenAtual) continue;
    await interno.deleteSession(sessaoVelha.token);
    await registrarEventoAuth({
      tipo: "sessao_encerrada",
      usuarioId,
      sessaoId: sessaoVelha.id,
      motivo: "teto_de_sessoes",
      resultado: "recusado",
    });
  }
}

/**
 * Revogação em massa (F5): desativar conta, trocar papel/loja, remover fator,
 * reset e recuperação assistida passam por aqui.
 */
export async function revogarSessoesDe(usuarioId: string): Promise<void> {
  const { auth } = await import("./auth");
  const contexto = await auth.$context;
  await contexto.internalAdapter.deleteUserSessions(usuarioId);
}

export type SessaoVisivel = {
  id: string;
  ip: string | null;
  agente: string | null;
  criadaEm: Date;
  expiraEm: Date;
  atual: boolean;
};

/**
 * Projeção de §10 (F6/G13): a coluna `token` NUNCA entra no `select`. O
 * `/list-sessions` do BA devolve e recebe o token, por isso está desligado.
 */
export async function listarSessoesDe(
  usuarioId: string,
  sessaoAtualId: string,
): Promise<SessaoVisivel[]> {
  const linhas = await db.execute<{
    id: string;
    ip: string | null;
    agente: string | null;
    created_at: Date;
    expira_em: Date;
  }>(sql`
    select id, ip, agente, created_at, expira_em
    from usuarios_sessoes
    where usuario_id = ${usuarioId}::uuid and expira_em > now()
    order by created_at desc
  `);
  return linhas.rows.map((l) => ({
    id: l.id,
    ip: l.ip,
    agente: l.agente,
    criadaEm: new Date(l.created_at),
    expiraEm: new Date(l.expira_em),
    atual: l.id === sessaoAtualId,
  }));
}

/**
 * Encerra UMA sessão, sempre dentro das do próprio usuário. O `id` vem da
 * projeção; o token é lido aqui e não sai desta função.
 */
export async function encerrarSessaoDoUsuario(
  usuarioId: string,
  sessaoId: string,
): Promise<boolean> {
  const linhas = await db.execute<{ token: string }>(sql`
    select token from usuarios_sessoes
    where id = ${sessaoId}::uuid and usuario_id = ${usuarioId}::uuid
    limit 1
  `);
  const alvo = linhas.rows[0];
  if (!alvo) return false;

  const { auth } = await import("./auth");
  const contexto = await auth.$context;
  await contexto.internalAdapter.deleteSession(alvo.token);
  await registrarEventoAuth({
    tipo: "sessao_encerrada",
    usuarioId,
    sessaoId,
    motivo: "encerrada_pelo_usuario",
  });
  return true;
}

/**
 * Atualiza `ultimo_uso_em` no máximo a cada 5 min e SÓ em requisição iniciada
 * pela pessoa. O polling do inbox passa `renovaAtividade: false` — senão a
 * inatividade de 60 min nunca aconteceria com a aba aberta.
 */
export async function marcarAtividade(sessaoId: string, ultimoUso: Date | null): Promise<void> {
  if (ultimoUso && Date.now() - ultimoUso.getTime() < PASSO_ATIVIDADE_MS) return;
  try {
    await db.execute(sql`
      update usuarios_sessoes set ultimo_uso_em = now() where id = ${sessaoId}::uuid
    `);
  } catch (erro) {
    logger.error({ erro: sanitizarErroBanco(erro) }, "marcarAtividade falhou");
  }
}
