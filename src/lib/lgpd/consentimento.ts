import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Contexto } from "@/lib/auth/guard";
import { condicaoDeLoja, vivosE } from "@/lib/db/consultas";
import { atualizarComTrava, registrarAuditoria, type Transacao } from "@/lib/db/mutacoes";
import type { OrigemConsentimento, TipoConsentimento } from "@/lib/db/schema/_enums/auditoria";
import { contatos } from "@/lib/db/schema/contatos";
import { consentimentos } from "@/lib/db/schema/lgpd";
import { ErroDeEscopo } from "@/lib/erros";
import { optOutDe, TERMO_VIGENTE } from "./regras";

/**
 * Consentimento e opt-out (01-dados-dominio.md §7.2; 02-seguranca.md §16).
 *
 * `registrarConsentimento()` é a ÚNICA função que grava `consentimentos` e o
 * espelho `contatos.opt_out`/`opt_out_em`, sempre na MESMA transação. Não
 * existe segundo caminho de escrita — o M1 (palavra-chave "SAIR" na conversa)
 * chama esta mesma função, com `origem: "mensagem"`.
 *
 * POR QUE `execute(sql...)` NO INSERT: `consentimentos` é trilha append-only
 * (REVOKE + gatilho `trilha_imutavel()`, migração 0015), não tabela de domínio
 * — sem soft delete, sem `modified_by`. É a mesma porta de
 * `src/lib/auditoria/gravador.ts`.
 *
 * O IP vem do SERVIDOR (`ipDoCliente()` na action), nunca do corpo (02/L-08).
 */

export type NovoConsentimento = {
  contatoId: string;
  tipo: TipoConsentimento;
  concedido: boolean;
  origem: OrigemConsentimento;
  canal?: string | null;
  mensagemId?: string | null;
  /** De `ipDoCliente()`. Webhook e worker passam `null`. */
  ip: string | null;
  termoVersao?: string;
};

export async function registrarConsentimento(
  tx: Transacao,
  ctx: Contexto,
  novo: NovoConsentimento,
): Promise<{ optOut: boolean; espelhoMudou: boolean }> {
  if (ctx.escopo.tipo !== "uma") throw new ErroDeEscopo();
  const lojaId = ctx.escopo.lojaId;

  // Trava a linha: dois registros simultâneos não deixam o espelho divergir
  // da última linha da trilha.
  const [contato] = await tx
    .select({ id: contatos.id, optOut: contatos.opt_out, updatedAt: contatos.updated_at })
    .from(contatos)
    .where(vivosE(contatos, eq(contatos.id, novo.contatoId), eq(contatos.loja_id, lojaId)))
    .for("update");
  if (!contato) throw new ErroDeEscopo();

  await tx.execute(sql`
    insert into consentimentos
      (loja_id, contato_id, tipo, concedido, origem, canal, mensagem_id, termo_versao, ip, registrado_por)
    values (
      ${lojaId}, ${novo.contatoId}, ${novo.tipo}, ${novo.concedido}, ${novo.origem},
      ${novo.canal ?? null}, ${novo.mensagemId ?? null}, ${novo.termoVersao ?? TERMO_VIGENTE},
      ${novo.ip}, ${ctx.origem === "ui" ? ctx.autorId : null}
    )
  `);

  const alvo = optOutDe(novo.tipo, novo.concedido);
  if (alvo === null || alvo === contato.optOut) {
    await registrarAuditoria(tx, ctx, "consentimento_registrado", "contatos", contato.id, {
      antes: null,
      depois: { tipo: novo.tipo, concedido: novo.concedido, origem: novo.origem },
    });
    return { optOut: contato.optOut, espelhoMudou: false };
  }

  // Relê o `updated_at` na mesma transação, com a linha travada: o espelho não
  // é edição humana e não pode falhar por colisão com um formulário aberto.
  await atualizarComTrava(
    tx,
    contatos,
    {
      id: contato.id,
      escopo: ctx.escopo,
      updatedAtOriginal: contato.updatedAt,
      dados: { opt_out: alvo, opt_out_em: alvo ? new Date() : null },
    },
    ctx,
    "consentimento_registrado",
  );
  return { optOut: alvo, espelhoMudou: true };
}

/** Histórico recente para a ficha. O dossiê traz o histórico COMPLETO. */
export async function ultimosConsentimentos(tx: Transacao, ctx: Contexto, contatoId: string, limite = 10) {
  return tx
    .select({
      id: consentimentos.id,
      tipo: consentimentos.tipo,
      concedido: consentimentos.concedido,
      origem: consentimentos.origem,
      termoVersao: consentimentos.termo_versao,
      criadoEm: consentimentos.criado_em,
    })
    .from(consentimentos)
    .where(and(eq(consentimentos.contato_id, contatoId), condicaoDeLoja(consentimentos, ctx.escopo)))
    .orderBy(desc(consentimentos.criado_em))
    .limit(limite);
}
