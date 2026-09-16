import "server-only";
import { sql } from "drizzle-orm";
import type { Contexto } from "@/lib/auth/guard";
import { enfileirarEmailSeguranca } from "@/lib/auth/emails";
import { removerTodosOsFatores } from "@/lib/auth/fatores";
import { revogarSessoesDe } from "@/lib/auth/sessoes";
import { gravarEventoAuth } from "@/lib/auth/trilha";
import { atualizarComTrava, type Transacao } from "@/lib/db/mutacoes";
import { usuarios } from "@/lib/db/schema/auth/usuarios";
import { ErroDoAplicativo, ErroDeValidacao } from "@/lib/erros";
import { logger } from "@/lib/logger";
import { redisDoLimitador } from "@/lib/seguranca/limite";
import { ESCOPO_DE_REDE, baseDoEvento, travarAlvo } from "./_alvo";

/**
 * Destravar, resetar, recuperar e encerrar sessões de OUTRA pessoa
 * (02-seguranca.md §7.1, §9.3, §11.2; REQ-E7/E8, H9).
 *
 * O que não existe aqui, e não pode existir: definir a senha de alguém. Nenhuma
 * função recebe `novaSenha` — o admin dispara o e-mail de redefinição e a
 * pessoa escolhe a senha dela (E8).
 */

/** H9: destravar conta que não está travada é conflito, não sucesso silencioso. */
export class ErroContaLivre extends ErroDoAplicativo {
  constructor() {
    super("CONTA_LIVRE", "Esta conta não está bloqueada.", 409);
  }
}

/** Cooldown por conta-alvo do reset iniciado por admin (D18). */
export const COOLDOWN_RESET_S = 60;

function naRede(ctx: Contexto): Contexto {
  return { ...ctx, escopo: ESCOPO_DE_REDE };
}

export async function destravarConta(
  tx: Transacao,
  ctx: Contexto,
  dados: { alvoId: string; motivo: string },
): Promise<void> {
  const { alvo } = await travarAlvo(tx, ctx, dados.alvoId, "usuarios:destravar");
  if (!alvo.bloqueadoAte || alvo.bloqueadoAte.getTime() <= Date.now()) throw new ErroContaLivre();

  await gravarEventoAuth(
    { tipo: "conta_destravada", ...baseDoEvento(ctx, alvo, dados.motivo) },
    tx,
  );
  await atualizarComTrava(
    tx,
    usuarios,
    {
      id: alvo.id,
      escopo: ESCOPO_DE_REDE,
      updatedAtOriginal: alvo.updatedAt,
      dados: { falhas_login: 0, ultima_falha_em: null, bloqueado_ate: null },
    },
    naRede(ctx),
    "usuario_alterado",
  );
}

/**
 * `SET NX EX 60`: só a primeira chamada da janela passa. Redis fora do ar
 * deixa passar — é anti-rajada de e-mail, não controle de acesso.
 */
async function dentroDoCooldown(usuarioId: string): Promise<boolean> {
  try {
    const gravou = await redisDoLimitador().set(
      `reset:${usuarioId}`,
      "1",
      "EX",
      COOLDOWN_RESET_S,
      "NX",
    );
    return gravou !== "OK";
  } catch (erro) {
    logger.warn({ erro: String(erro) }, "cooldown de reset indisponível");
    return false;
  }
}

/** O e-mail de redefinição sai pelo MESMO caminho do "esqueci a senha". */
async function pedirRedefinicao(email: string): Promise<void> {
  const { auth } = await import("@/lib/auth/auth");
  await auth.api.requestPasswordReset({ body: { email } });
}

/**
 * Dispara o e-mail de redefinição ao alvo e derruba as sessões dele. A trilha
 * vem ANTES, na transação. A resposta é a mesma com ou sem cooldown (D18).
 */
export async function iniciarResetDeSenha(
  tx: Transacao,
  ctx: Contexto,
  dados: { alvoId: string; motivo: string },
): Promise<void> {
  const { alvo } = await travarAlvo(tx, ctx, dados.alvoId, "usuarios:iniciar_reset");
  if (!alvo.ativo && !alvo.precisaConfigurarFator) {
    throw new ErroDeValidacao({}, undefined, "Reative a conta antes de redefinir o acesso.");
  }

  await gravarEventoAuth(
    { tipo: "reset_solicitado", ...baseDoEvento(ctx, alvo, dados.motivo) },
    tx,
  );
  await revogarSessoesDe(alvo.id);
  if (await dentroDoCooldown(alvo.id)) return;
  await pedirRedefinicao(alvo.email);
}

/**
 * Recuperação assistida (§9.3, E7): a pessoa perdeu os dois fatores. Quem
 * atende registra COMO confirmou a identidade no próprio motivo.
 *
 * Efeito: remove os fatores, revoga as sessões, liga o gate de 2º fator e
 * dispara a redefinição de senha. A conta entra pelo login normal e cai em
 * `/primeiro-acesso` (item 3 de `podeCriarSessao`).
 */
export async function recuperarAcessoAssistido(
  tx: Transacao,
  ctx: Contexto,
  dados: { alvoId: string; motivo: string },
): Promise<void> {
  const { alvo } = await travarAlvo(tx, ctx, dados.alvoId, "usuarios:recuperar_fator");

  await gravarEventoAuth(
    { tipo: "recuperacao_assistida", ...baseDoEvento(ctx, alvo, dados.motivo) },
    tx,
  );
  await atualizarComTrava(
    tx,
    usuarios,
    {
      id: alvo.id,
      escopo: ESCOPO_DE_REDE,
      updatedAtOriginal: alvo.updatedAt,
      dados: { precisa_configurar_fator: true, two_factor_enabled: false },
    },
    naRede(ctx),
    "usuario_alterado",
  );
  // Pelo adaptador do Better Auth, em conexão própria (ADR 0029).
  await removerTodosOsFatores(alvo.id);
  await revogarSessoesDe(alvo.id);
  await pedirRedefinicao(alvo.email);
  enfileirarEmailSeguranca("recuperacao-assistida", alvo.id);
}

/** Derruba TODAS as sessões do alvo. Devolve quantas estavam abertas. */
export async function encerrarSessoesDe(
  tx: Transacao,
  ctx: Contexto,
  dados: { alvoId: string; motivo: string },
): Promise<{ encerradas: number }> {
  const { alvo } = await travarAlvo(tx, ctx, dados.alvoId, "usuarios:encerrar_sessoes");
  const abertas = await tx.execute<{ n: string }>(sql`
    select count(*)::text as n from usuarios_sessoes
    where usuario_id = ${alvo.id}::uuid and expira_em > now()
  `);
  const encerradas = Number(abertas.rows[0]?.n ?? "0");

  await gravarEventoAuth(
    {
      tipo: "sessao_encerrada",
      ...baseDoEvento(ctx, alvo, dados.motivo),
      detalhes: { contagem: encerradas, acao: "usuarios:encerrar_sessoes" },
    },
    tx,
  );
  await revogarSessoesDe(alvo.id);
  return { encerradas };
}
