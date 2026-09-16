import "server-only";
import { sql } from "drizzle-orm";
import type { Contexto } from "@/lib/auth/guard";
import { podeChave, type ChavePermissao } from "@/lib/auth/permissoes";
import { exigirAlvoPermitido } from "@/lib/auth/permissoes/alvo";
import { registrarEventoAuth } from "@/lib/auth/trilha";
import type { Transacao } from "@/lib/db/mutacoes";
import type { EscopoLoja } from "@/lib/auth/loja";
import { ATOR_SISTEMA, PAPEIS, type Papel } from "@/lib/db/schema/_enums/auth";
import { ErroDeEscopo, ErroDePermissao } from "@/lib/erros";
import type { Quadro } from "./regras";

/**
 * Leitura TRAVADA do alvo, do ator e do quadro de privilégio
 * (02-seguranca.md §9.2 "Mínimo 1 dono, máximo 2", INV-31).
 *
 * Um `SELECT ... FOR UPDATE` só, em ordem de `id` (sem deadlock entre duas
 * ações cruzadas), sobre: todo `dono`/`admin` ativo, o alvo e o ator. Duas
 * ações concorrentes que mexem no quadro passam a acontecer uma depois da
 * outra, e a segunda relê o quadro JÁ com o efeito da primeira.
 *
 * O papel do ATOR também é relido aqui: a sessão foi lida no começo da
 * requisição, e um dono rebaixado no meio de uma corrida não pode concluir a
 * ação que começou como dono.
 */

/** `usuarios` não pertence a loja nenhuma para quem administra (rede). */
export const ESCOPO_DE_REDE: EscopoLoja = { tipo: "todas" };

export type LinhaTravada = {
  id: string;
  nome: string;
  email: string;
  papel: Papel;
  lojaId: string | null;
  ativo: boolean;
  precisaConfigurarFator: boolean;
  temFator: boolean;
  bloqueadoAte: Date | null;
  updatedAt: Date;
};

export type Travado = { alvo: LinhaTravada; ator: LinhaTravada; quadro: Quadro };

type LinhaCrua = {
  id: string;
  nome: string;
  email: string;
  papel: string;
  loja_id: string | null;
  ativo: boolean;
  precisa_configurar_fator: boolean;
  two_factor_enabled: boolean;
  bloqueado_ate: Date | string | null;
  updated_at: Date | string;
};

function paraLinha(l: LinhaCrua): LinhaTravada | null {
  if (!(PAPEIS as readonly string[]).includes(l.papel)) return null;
  return {
    id: l.id,
    nome: l.nome,
    email: l.email,
    papel: l.papel as Papel,
    lojaId: l.loja_id,
    ativo: l.ativo,
    precisaConfigurarFator: l.precisa_configurar_fator,
    temFator: l.two_factor_enabled,
    // `db.execute` devolve `timestamptz` como string (ver `sessoes.ts`).
    bloqueadoAte: l.bloqueado_ate === null ? null : new Date(l.bloqueado_ate),
    updatedAt: new Date(l.updated_at),
  };
}

/**
 * Recusa com trilha. `recusa_403` vai pelo funil best-effort (outra conexão),
 * então fica gravada mesmo com o rollback da transação. Uso: `throw await`.
 *
 * A resposta é `SEM_PERMISSAO`, igual à de chave faltando: um código próprio
 * de alvo diria a quem sonda que a pessoa existe (ADR 0032). O porquê fica só
 * na trilha, em `detalhes.motivo`.
 */
export async function recusaDeAlvo(
  ctx: Contexto,
  chave: ChavePermissao,
  alvoId: string,
  papel: Papel,
): Promise<ErroDePermissao> {
  await registrarEventoAuth({
    tipo: "recusa_403",
    usuarioId: ctx.sessao.usuarioId,
    sessaoId: ctx.sessao.sessaoId,
    atorId: ctx.sessao.usuarioId,
    alvoId,
    resultado: "recusado",
    detalhes: { acao: chave, papel, motivo: "alvo" },
  });
  return new ErroDePermissao("Você não tem acesso a esta ação sobre esta pessoa.");
}

export async function travarAlvo(
  tx: Transacao,
  ctx: Contexto,
  alvoId: string,
  chave: ChavePermissao,
): Promise<Travado> {
  const atorId = ctx.sessao.usuarioId;
  const resultado = await tx.execute<LinhaCrua>(sql`
    select id, nome, email, papel, loja_id, ativo, precisa_configurar_fator,
           two_factor_enabled, bloqueado_ate, updated_at
    from usuarios
    where is_deleted = false and id <> ${ATOR_SISTEMA}::uuid
      and ((papel in ('dono', 'admin') and ativo)
           or id = ${alvoId}::uuid or id = ${atorId}::uuid)
    order by id
    for update
  `);
  const linhas = resultado.rows.map(paraLinha);

  const alvo = linhas.find((l) => l?.id === alvoId) ?? null;
  const ator = linhas.find((l) => l?.id === atorId) ?? null;
  // Registro inexistente responde 404, nunca 403. O ATOR_SISTEMA não é
  // pessoa: some da consulta e cai aqui também.
  if (!alvo) throw new ErroDeEscopo();
  if (!ator || !ator.ativo || !podeChave(ator.papel, chave)) {
    throw await recusaDeAlvo(ctx, chave, alvoId, ator?.papel ?? ctx.sessao.papel);
  }

  try {
    exigirAlvoPermitido({ ...ctx.sessao, papel: ator.papel }, { id: alvo.id, papel: alvo.papel });
  } catch {
    throw await recusaDeAlvo(ctx, chave, alvoId, ator.papel);
  }

  const quadro: Quadro = { donos: 0, admins: 0 };
  for (const l of linhas) {
    if (!l?.ativo) continue;
    if (l.papel === "dono") quadro.donos += 1;
    if (l.papel === "admin") quadro.admins += 1;
  }
  return { alvo, ator, quadro };
}

/** O que TODA trilha administrativa leva: ator, alvo e motivo (§11.2). */
export function baseDoEvento(ctx: Contexto, alvo: LinhaTravada, motivo: string) {
  return {
    usuarioId: alvo.id,
    atorId: ctx.sessao.usuarioId,
    alvoId: alvo.id,
    email: alvo.email,
    meio: "admin" as const,
    motivo,
  };
}
