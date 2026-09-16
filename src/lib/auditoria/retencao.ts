import "server-only";
import { and, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { vivos } from "@/lib/db/consultas";
import { atualizarEstado } from "@/lib/db/mutacoes";
import { lojas_integracoes_eventos } from "@/lib/db/schema/integracoes";
import { logger } from "@/lib/logger";

/**
 * Retenção e prazos (jobs `retencao-eventos` e `expirar-convites`).
 *
 * NENHUMA LINHA SOME. A retenção do diário de ingestão é ANONIMIZAÇÃO por
 * `UPDATE` (01-dados.md §6.4): `corpo` vira `{"anonimizado":true}` e
 * `cabecalhos` vira `{}`. A idempotência por `evento_externo_id` continua
 * valendo para sempre.
 *
 * LIMITE DESTA ENTREGA: o documento manda zerar também `ip`, mas
 * `ESTADOS_DE_SISTEMA.lojas_integracoes_eventos` (`src/lib/db/listas-fechadas.ts`)
 * não inclui `ip`, e `atualizarEstado()` recusa par fora da lista. O `ip` fica
 * até a fundação ampliar a lista (bloqueio registrado do pacote M8).
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
          sql`${lojas_integracoes_eventos.corpo} <> ${JSON.stringify(CORPO_ANONIMIZADO)}::jsonb`,
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
 * Convite vencido JÁ não é aceitável: `consumirToken()` exige `expira_em >
 * now()` (`src/lib/auth/convites.ts`). O que falta é LIBERAR o e-mail: o único
 * parcial `uq_usuarios_convites_email_aberto` (`usado_em IS NULL AND
 * is_deleted = false`) segura o convite vencido e impede um convite novo para a
 * mesma pessoa. Fechar o vencido é gravação em tabela de auth (fundação) e não
 * tem ação auditada que a descreva — bloqueio registrado do pacote M8. Até lá,
 * o job CONTA e avisa, sem gravar.
 */
export async function contarConvitesVencidos(): Promise<number> {
  const resultado = await db.execute<{ n: string }>(sql`
    select count(*)::text as n from usuarios_convites
     where is_deleted = false and usado_em is null and expira_em <= now()`);
  const n = Number(resultado.rows[0]?.n ?? 0);
  if (n > 0) {
    logger.warn({ vencidos: n }, "expirar-convites: convites vencidos ainda seguram o e-mail");
  }
  return n;
}
