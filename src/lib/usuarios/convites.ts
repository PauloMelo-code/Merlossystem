import "server-only";
import { sql } from "drizzle-orm";
import type { Contexto } from "@/lib/auth/guard";
import { linkDoConvite, VALIDADE_CONVITE_HORAS } from "@/lib/auth/convites";
import { enfileirarEmailSeguranca } from "@/lib/auth/emails";
import { conferirLojaViva } from "@/lib/auth/loja";
import { exigirPapelConvidavel } from "@/lib/auth/permissoes/alvo";
import { novoToken } from "@/lib/auth/tokens";
import { gravarEventoAuth } from "@/lib/auth/trilha";
import type { Transacao } from "@/lib/db/mutacoes";
import type { PapelConvidavel } from "@/lib/db/schema/_enums/auth";
import { ErroDeEscopo, ErroDeValidacao } from "@/lib/erros";
import { CIENCIA_ADMIN_VERSAO } from "@/lib/validadores/usuarios";
import { recusaDeAlvo } from "./_alvo";
import { encerrarConvitesAbertos } from "./administracao";

/**
 * Emissão e reenvio de convite (02-seguranca.md §9.2, §2.3 item 4).
 *
 * POR QUE NÃO `emitirConvite` de `src/lib/auth/convites.ts`: aquela função
 * abre a PRÓPRIA transação. O reenvio precisa aposentar o convite antigo e
 * emitir o novo numa transação só — o único parcial
 * `uq_usuarios_convites_email_aberto` faria a segunda transação esperar a
 * primeira, que espera a segunda. Token, hash, link e validade continuam vindo
 * de `auth/` (uma fonte só); daqui sai só a composição transacional.
 *
 * A escada é a de §2.3: `admin` convida gerente/vendedor/viewer; `admin` só
 * pelo `dono`, com ciência versionada; `dono` não é convidável (CHECK
 * `convites_papel`, a barreira final).
 *
 * O link volta para quem emitiu (README, "E-mail: ainda sem provedor") e
 * NUNCA vai para o log.
 */

export type ConviteEmitido = { id: string; link: string; expiraEm: Date };

type DadosConvite = {
  email: string;
  papel: PapelConvidavel;
  lojaId: string | null;
  motivo: string;
};

async function emitirNaTransacao(
  tx: Transacao,
  ctx: Contexto,
  dados: DadosConvite,
): Promise<ConviteEmitido> {
  const { token, hash } = novoToken();
  const ciencia = dados.papel === "admin" ? CIENCIA_ADMIN_VERSAO : null;

  const linhas = await tx.execute<{ id: string; expira_em: Date | string }>(sql`
    insert into usuarios_convites
      (email, papel, loja_id, token_hash, expira_em, criado_por, ciencia_versao,
       motivo, created_at, updated_at, modified_by)
    values (
      ${dados.email}, ${dados.papel}, ${dados.lojaId}, ${hash},
      now() + make_interval(hours => ${VALIDADE_CONVITE_HORAS}),
      ${ctx.autorId}::uuid, ${ciencia}, ${dados.motivo},
      now(), now(), ${ctx.autorId}::uuid
    )
    returning id, expira_em
  `);
  const linha = linhas.rows[0];
  if (!linha) throw new ErroDeEscopo();

  // Fail-closed e na transação: convite sem prova de quem emitiu não existe.
  await gravarEventoAuth(
    {
      tipo: "convite_emitido",
      atorId: ctx.autorId,
      email: dados.email,
      meio: "convite",
      motivo: dados.motivo,
      detalhes: {
        papel: dados.papel,
        ...(ciencia ? { acao: `ciencia:${ciencia}` } : {}),
      },
    },
    tx,
  );

  const link = linkDoConvite(token);
  enfileirarEmailSeguranca("convite", ctx.autorId, link, { paraEmail: dados.email });
  return { id: linha.id, link, expiraEm: new Date(linha.expira_em) };
}

async function conferirEscada(ctx: Contexto, papel: PapelConvidavel): Promise<void> {
  try {
    exigirPapelConvidavel(ctx.sessao, papel);
  } catch {
    throw await recusaDeAlvo(ctx, "usuarios:convidar", ctx.sessao.usuarioId, ctx.sessao.papel);
  }
}

async function conferirLoja(lojaId: string | null): Promise<void> {
  if (!lojaId) return;
  try {
    await conferirLojaViva(lojaId);
  } catch {
    throw new ErroDeValidacao({ lojaId: ["Esta loja não existe mais. Escolha outra."] });
  }
}

/** Convite aberto e AINDA válido para o e-mail? */
async function conviteVivoPara(tx: Transacao, email: string): Promise<boolean> {
  const linhas = await tx.execute<{ existe: boolean }>(sql`
    select exists (
      select 1 from usuarios_convites
      where lower(email) = ${email} and usado_em is null and is_deleted = false
        and expira_em > now()
    ) as existe
  `);
  return Boolean(linhas.rows[0]?.existe);
}

export async function convidarUsuario(
  tx: Transacao,
  ctx: Contexto,
  dados: DadosConvite,
): Promise<ConviteEmitido> {
  await conferirEscada(ctx, dados.papel);
  await conferirLoja(dados.lojaId);

  const email = dados.email.trim().toLowerCase();
  const conta = await tx.execute<{ existe: boolean }>(sql`
    select exists (select 1 from usuarios where lower(email) = ${email}) as existe
  `);
  // Quem convida tem `usuarios:ler_detalhe`: dizer que a conta existe não é
  // oráculo para ninguém de fora. O convite NUNCA sobrescreve identidade (C11).
  if (conta.rows[0]?.existe) {
    throw new ErroDeValidacao({ email: ["Já existe uma conta com este e-mail."] });
  }
  if (await conviteVivoPara(tx, email)) {
    throw new ErroDeValidacao({
      email: ["Já existe um convite válido para este e-mail. Use “Reenviar” na lista."],
    });
  }
  // Convite vencido e nunca usado segura o único parcial: aposenta antes.
  await encerrarConvitesAbertos(tx, ctx, email);
  return emitirNaTransacao(tx, ctx, { ...dados, email });
}

/**
 * Reenviar = aposentar o convite aberto e emitir outro, com token novo e
 * validade nova. O token antigo morre na mesma transação.
 */
export async function reenviarConvite(
  tx: Transacao,
  ctx: Contexto,
  dados: { conviteId: string; motivo: string },
): Promise<ConviteEmitido> {
  const linhas = await tx.execute<{ email: string; papel: PapelConvidavel; loja_id: string | null }>(sql`
    select email, papel, loja_id from usuarios_convites
    where id = ${dados.conviteId}::uuid and usado_em is null and is_deleted = false
      and bootstrap = false
    limit 1
    for update
  `);
  const antigo = linhas.rows[0];
  if (!antigo) throw new ErroDeEscopo();

  await conferirEscada(ctx, antigo.papel);
  await conferirLoja(antigo.loja_id);
  await encerrarConvitesAbertos(tx, ctx, antigo.email);
  return emitirNaTransacao(tx, ctx, {
    email: antigo.email,
    papel: antigo.papel,
    lojaId: antigo.loja_id,
    motivo: dados.motivo,
  });
}
