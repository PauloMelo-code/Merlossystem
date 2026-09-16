import "server-only";
import { randomInt } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Contexto } from "@/lib/auth/guard";
import { enfileirarEmailSeguranca } from "@/lib/auth/emails";
import { hashToken } from "@/lib/auth/tokens";
import { gravarEventoAuth } from "@/lib/auth/trilha";
import { db } from "@/lib/db/client";
import { atualizarComTrava, inserirAuditado, type Transacao } from "@/lib/db/mutacoes";
import { usuarios } from "@/lib/db/schema/auth/usuarios";
import { usuarios_trocas_email } from "@/lib/db/schema/auth/trocas-email";
import { env } from "@/lib/env";
import { ErroDeValidacao } from "@/lib/erros";
import { compararEmTempoConstante } from "@/lib/seguranca/assinaturas";
import { ESCOPO_DE_REDE, baseDoEvento, travarAlvo } from "./_alvo";

/**
 * Troca de e-mail em duas mãos (02-seguranca.md §11.2, REQ-E12; 01-dados.md §5.9).
 *
 * O admin INICIA; um código de 6 dígitos (10 min) vai para o endereço NOVO; o
 * PRÓPRIO usuário confirma, com sessão fresca. Até confirmar, tudo — inclusive
 * o reset — continua indo para o endereço antigo, que recebe o aviso com a
 * instrução de contestação. `usuarios.email_pendente` não existe: "troca em
 * andamento" é linha aberta nesta tabela.
 */

export const VALIDADE_CODIGO_MIN = 10;
export const MAX_TENTATIVAS_CODIGO = 5;

function naRede(ctx: Contexto): Contexto {
  return { ...ctx, escopo: ESCOPO_DE_REDE };
}

type TrocaAberta = { id: string; email_novo: string; codigo_hash: string };

/** Fecha a troca aberta (vencida ou substituída), com motivo. */
async function cancelarAbertas(
  tx: Transacao,
  ctx: Contexto,
  usuarioId: string,
  motivo: string,
): Promise<void> {
  const abertas = await tx.execute<{ id: string; updated_at: Date | string }>(sql`
    select id, updated_at from usuarios_trocas_email
    where usuario_id = ${usuarioId}::uuid and confirmado_em is null
      and cancelado_em is null and is_deleted = false
    for update
  `);
  for (const troca of abertas.rows) {
    await atualizarComTrava(
      tx,
      usuarios_trocas_email,
      {
        id: troca.id,
        escopo: ESCOPO_DE_REDE,
        updatedAtOriginal: new Date(troca.updated_at),
        dados: { cancelado_em: new Date(), cancelado_motivo: motivo },
      },
      naRede(ctx),
      "usuario_alterado",
    );
  }
}

export async function iniciarTrocaDeEmail(
  tx: Transacao,
  ctx: Contexto,
  dados: { alvoId: string; emailNovo: string; motivo: string },
): Promise<void> {
  const { alvo } = await travarAlvo(tx, ctx, dados.alvoId, "usuarios:trocar_email");
  const emailNovo = dados.emailNovo.trim().toLowerCase();
  if (emailNovo === alvo.email.toLowerCase()) {
    throw new ErroDeValidacao({ emailNovo: ["Este já é o e-mail da conta."] });
  }
  const ocupado = await tx.execute<{ existe: boolean }>(sql`
    select exists (select 1 from usuarios where lower(email) = ${emailNovo}) as existe
  `);
  if (ocupado.rows[0]?.existe) {
    throw new ErroDeValidacao({ emailNovo: ["Este e-mail já pertence a outra conta."] });
  }

  await cancelarAbertas(tx, ctx, alvo.id, "substituida por nova solicitacao");

  const codigo = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await inserirAuditado(
    tx,
    usuarios_trocas_email,
    {
      usuario_id: alvo.id,
      email_novo: emailNovo,
      codigo_hash: hashToken(codigo),
      expira_em: new Date(Date.now() + VALIDADE_CODIGO_MIN * 60_000),
      solicitado_por: ctx.sessao.usuarioId,
      motivo: dados.motivo,
    },
    naRede(ctx),
    "usuario_alterado",
  );
  await gravarEventoAuth(
    {
      tipo: "email_trocado",
      ...baseDoEvento(ctx, alvo, dados.motivo),
      detalhes: { acao: "solicitada" },
    },
    tx,
  );

  // PENDÊNCIA (bloqueio registrado): `AssuntoDeSeguranca` não tem assunto
  // próprio para "código de troca de e-mail". Até a fundação criar, o código
  // segue no FRAGMENTO do link para o endereço novo, como o convite.
  enfileirarEmailSeguranca("email-trocado", alvo.id, `${env.APP_URL}/perfil#codigo=${codigo}`, {
    paraEmail: emailNovo,
  });
  // Aviso ao endereço ANTIGO: "não foi você? conteste".
  enfileirarEmailSeguranca("email-trocado", alvo.id);
}

/**
 * Consome UMA tentativa, FORA da transação e ANTES de travar qualquer linha:
 * dentro dela o erro desfaria o incremento, e um `UPDATE` por outra conexão
 * sobre a linha já travada esperaria a própria transação para sempre. Conta
 * inclusive a tentativa certa: o teto `MAX_TENTATIVAS_CODIGO` é no total.
 */
async function consumirTentativa(usuarioId: string): Promise<TrocaAberta | null> {
  const linhas = await db.execute<TrocaAberta>(sql`
    update usuarios_trocas_email set tentativas = tentativas + 1
    where usuario_id = ${usuarioId}::uuid and confirmado_em is null
      and cancelado_em is null and is_deleted = false
      and expira_em > now() and tentativas < ${MAX_TENTATIVAS_CODIGO}
    returning id, email_novo, codigo_hash
  `);
  return linhas.rows[0] ?? null;
}

const CODIGO_RECUSADO = "Código incorreto ou vencido. Peça ao administrador uma nova troca.";

/** O próprio usuário confirma. O alvo é SEMPRE a sessão corrente. */
export async function confirmarTrocaDeEmail(
  tx: Transacao,
  ctx: Contexto,
  codigo: string,
): Promise<{ email: string }> {
  const usuarioId = ctx.sessao.usuarioId;
  const tentativa = await consumirTentativa(usuarioId);
  if (!tentativa || !compararEmTempoConstante(tentativa.codigo_hash, hashToken(codigo))) {
    throw new ErroDeValidacao({ codigo: [CODIGO_RECUSADO] });
  }

  const linhas = await tx.execute<{ updated_at: Date | string }>(sql`
    select updated_at from usuarios_trocas_email
    where id = ${tentativa.id}::uuid and confirmado_em is null and cancelado_em is null
      and is_deleted = false
    for update
  `);
  const aberta = linhas.rows[0];
  if (!aberta) throw new ErroDeValidacao({ codigo: [CODIGO_RECUSADO] });
  const troca = { ...tentativa, updated_at: aberta.updated_at };

  const atual = await tx.execute<{ email: string; updated_at: Date | string }>(sql`
    select email, updated_at from usuarios where id = ${usuarioId}::uuid for update
  `);
  const pessoa = atual.rows[0];
  if (!pessoa) throw new ErroDeValidacao({ codigo: [CODIGO_RECUSADO] });

  const ocupado = await tx.execute<{ existe: boolean }>(sql`
    select exists (
      select 1 from usuarios where lower(email) = ${troca.email_novo} and id <> ${usuarioId}::uuid
    ) as existe
  `);
  if (ocupado.rows[0]?.existe) {
    throw new ErroDeValidacao({ codigo: ["Este e-mail passou a pertencer a outra conta."] });
  }

  await gravarEventoAuth(
    {
      tipo: "email_trocado",
      usuarioId,
      atorId: usuarioId,
      alvoId: usuarioId,
      sessaoId: ctx.sessao.sessaoId,
      email: pessoa.email,
      detalhes: { acao: "confirmada" },
    },
    tx,
  );
  await atualizarComTrava(
    tx,
    usuarios_trocas_email,
    {
      id: troca.id,
      escopo: ESCOPO_DE_REDE,
      updatedAtOriginal: new Date(troca.updated_at),
      dados: { confirmado_em: new Date() },
    },
    naRede(ctx),
    "usuario_alterado",
  );
  await atualizarComTrava(
    tx,
    usuarios,
    {
      id: usuarioId,
      escopo: ESCOPO_DE_REDE,
      updatedAtOriginal: new Date(pessoa.updated_at),
      dados: { email: troca.email_novo },
    },
    naRede(ctx),
    "usuario_alterado",
  );
  // Aviso ao endereço ANTIGO (§11.3): é para ele que vai o "não foi você?".
  enfileirarEmailSeguranca("email-trocado", usuarioId, undefined, { paraEmail: pessoa.email });
  return { email: troca.email_novo };
}
