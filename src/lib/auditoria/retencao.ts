import "server-only";
import { and, lt, sql } from "drizzle-orm";
import { fecharConviteVencido } from "@/lib/auth/convites";
import { db } from "@/lib/db/client";
import { vivos } from "@/lib/db/consultas";
import { atualizarEstado, contextoDeSistema, emTransacao } from "@/lib/db/mutacoes";
import { lojas_integracoes_eventos } from "@/lib/db/schema/integracoes";
import { logger } from "@/lib/logger";

/**
 * Retenção e prazos (jobs `retencao-eventos` e `expirar-convites`).
 *
 * NENHUMA LINHA SOME. A retenção do diário de ingestão é ANONIMIZAÇÃO por
 * `UPDATE` (01-dados.md §6.4): `corpo` vira `{"anonimizado":true}`,
 * `cabecalhos` vira `{}` e `ip` vira nulo. A idempotência por
 * `evento_externo_id` continua valendo para sempre.
 */

export const RETENCAO_DIAS = 30;
const LOTE = 500;
/** Teto de lotes por execução: o job é diário e retoma de onde parou. */
const MAX_LOTES = 200;

export const CORPO_ANONIMIZADO = { anonimizado: true } as const;

/** Devolve quantas linhas foram anonimizadas nesta execução. */
export async function anonimizarEventosAntigos(agora = new Date()): Promise<number> {
  const limite = new Date(agora.getTime() - RETENCAO_DIAS * 86_400_000);
  let total = 0;

  for (let lote = 0; lote < MAX_LOTES; lote += 1) {
    const ids = await db
      .select({ id: lojas_integracoes_eventos.id })
      .from(lojas_integracoes_eventos)
      .where(
        and(
          vivos(lojas_integracoes_eventos),
          lt(lojas_integracoes_eventos.created_at, limite),
          // `ip` também: linha anonimizada antes de o ip entrar na retenção.
          sql`(${lojas_integracoes_eventos.corpo} <> ${JSON.stringify(CORPO_ANONIMIZADO)}::jsonb
               or ${lojas_integracoes_eventos.ip} is not null)`,
        ),
      )
      .limit(LOTE);
    if (ids.length === 0) break;

    await db.transaction(async (tx) => {
      for (const { id } of ids) {
        // O diário é da rede: `todas` porque a linha pode não ter loja.
        await atualizarEstado(tx, lojas_integracoes_eventos, { id, escopo: { tipo: "todas" } }, {
          corpo: CORPO_ANONIMIZADO,
          cabecalhos: {},
          ip: null,
        });
      }
    });
    total += ids.length;
    if (ids.length < LOTE) break;
  }

  logger.info({ total, limite: limite.toISOString() }, "retencao-eventos concluída");
  return total;
}

/**
 * Convite vencido já não é aceitável (`consumirToken()` exige `expira_em >
 * now()`), mas segura o único parcial `uq_usuarios_convites_email_aberto` e
 * impede um convite novo para a mesma pessoa. O job FECHA o vencido (exclusão
 * lógica com trilha `convite_expirado`) pela porta da fundação.
 */
export async function fecharConvitesVencidos(): Promise<number> {
  const ctx = contextoDeSistema({ origem: "worker" });
  const fechados = await emTransacao(ctx, (tx) => fecharConviteVencido(tx, ctx));
  if (fechados > 0) logger.info({ fechados }, "expirar-convites: convites vencidos fechados");
  return fechados;
}
