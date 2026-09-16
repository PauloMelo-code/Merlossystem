import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { condicaoDeLoja } from "@/lib/db/consultas";
import { registrarConsentimentoBase, type ContextoDeGravacao, type Transacao } from "@/lib/db/mutacoes";
import type { OrigemConsentimento, TipoConsentimento } from "@/lib/db/schema/_enums/auditoria";
import { consentimentos } from "@/lib/db/schema/lgpd";
import { optOutDe, TERMO_VIGENTE } from "./regras";

/**
 * Consentimento e opt-out (01-dados-dominio.md §7.2; 02-seguranca.md §16).
 *
 * `registrarConsentimento()` é a ÚNICA porta de negócio que grava
 * `consentimentos` e o espelho `contatos.opt_out`/`opt_out_em`, sempre na
 * MESMA transação. A regra (o que `concedido` significa para cada tipo) é
 * `optOutDe()`; a gravação é `registrarConsentimentoBase()` da fundação, que
 * trava o contato em `FOR UPDATE` para o espelho não divergir da trilha. O M1
 * (palavra-chave "SAIR" na conversa) chama esta mesma função, com
 * `origem: "mensagem"` e o contexto de sistema.
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
  ctx: ContextoDeGravacao,
  novo: NovoConsentimento,
): Promise<{ optOut: boolean; espelhoMudou: boolean }> {
  return registrarConsentimentoBase(tx, ctx, {
    contatoId: novo.contatoId,
    tipo: novo.tipo,
    concedido: novo.concedido,
    origem: novo.origem,
    canal: novo.canal ?? null,
    mensagemId: novo.mensagemId ?? null,
    termoVersao: novo.termoVersao ?? TERMO_VIGENTE,
    ip: novo.ip,
    optOut: optOutDe(novo.tipo, novo.concedido),
  });
}

/**
 * Histórico recente para a ficha. O dossiê traz o histórico COMPLETO.
 * `consentimentos` é trilha append-only: não tem `is_deleted`, nada a filtrar.
 */
export async function ultimosConsentimentos(
  tx: Transacao,
  ctx: ContextoDeGravacao,
  contatoId: string,
  limite = 10,
) {
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
