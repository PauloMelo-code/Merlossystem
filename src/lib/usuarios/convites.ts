import "server-only";
import { sql } from "drizzle-orm";
import type { Contexto } from "@/lib/auth/guard";
import {
  CIENCIA_ADMIN_V1,
  emitirConviteEm,
  fecharConviteVencido,
  type ConviteEmitido,
} from "@/lib/auth/convites";
import { conferirLojaViva } from "@/lib/auth/loja";
import { exigirPapelConvidavel } from "@/lib/auth/permissoes/alvo";
import type { Transacao } from "@/lib/db/mutacoes";
import type { PapelConvidavel } from "@/lib/db/schema/_enums/auth";
import { ErroDeEscopo, ErroDeValidacao } from "@/lib/erros";
import { recusaDeAlvo } from "./_alvo";
import { encerrarConvitesAbertos } from "./administracao";

/**
 * Emissão e reenvio de convite (02-seguranca.md §9.2, §2.3 item 4).
 *
 * A emissão é a da fundação, `emitirConviteEm`, DENTRO da transação de
 * `executarAcao`: o reenvio aposenta o convite antigo e emite o novo numa
 * transação só, que é o que o único parcial `uq_usuarios_convites_email_aberto`
 * aceita. Ela grava `convite_emitido` com `detalhes.ciencia_versao` e NÃO envia
 * o e-mail — quem envia é a action, depois do commit (`enviarConvite`), para um
 * rollback não deixar link morto na caixa da pessoa.
 *
 * A escada é a de §2.3: `admin` convida gerente/vendedor/viewer; `admin` só
 * pelo `dono`, com ciência versionada; `dono` não é convidável (CHECK
 * `convites_papel`, a barreira final).
 *
 * O link volta para quem emitiu (README, "E-mail: ainda sem provedor") e
 * NUNCA vai para o log.
 */

export type ConviteDaTela = ConviteEmitido & { email: string };

type DadosConvite = {
  email: string;
  papel: PapelConvidavel;
  lojaId: string | null;
  motivo: string;
};

function emitir(tx: Transacao, ctx: Contexto, dados: DadosConvite): Promise<ConviteDaTela> {
  return emitirConviteEm(
    tx,
    {
      email: dados.email,
      papel: dados.papel,
      lojaId: dados.lojaId,
      cienciaVersao: dados.papel === "admin" ? CIENCIA_ADMIN_V1 : null,
      motivo: dados.motivo,
    },
    ctx,
  );
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
): Promise<ConviteDaTela> {
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
  // Convite vencido e nunca usado segura o único parcial: fecha antes, com a
  // trilha `convite_expirado`.
  await fecharConviteVencido(tx, ctx, { email });
  return emitir(tx, ctx, { ...dados, email });
}

/**
 * Reenviar = aposentar o convite aberto e emitir outro, com token novo e
 * validade nova. O token antigo morre na mesma transação.
 */
export async function reenviarConvite(
  tx: Transacao,
  ctx: Contexto,
  dados: { conviteId: string; motivo: string },
): Promise<ConviteDaTela> {
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
  return emitir(tx, ctx, {
    email: antigo.email,
    papel: antigo.papel,
    lojaId: antigo.loja_id,
    motivo: dados.motivo,
  });
}
