import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { STATUS_PEDIDO_SEM_RESERVA } from "@/lib/db/schema/_enums/pedidos";
import { logger } from "@/lib/logger";
import type { Leitor } from "./_consultas";

/**
 * Job `reconciliacao` (noturno, fila `manutencao`) — 01-dados-dominio.md §7.2 e
 * 03-arquitetura.md §8.1.
 *
 * Confere os dois espelhos que o sistema mantém por conta própria:
 *
 *   1. `contatos.opt_out` × a ÚLTIMA linha de marketing em `consentimentos`
 *      (mesma tabela-verdade de `optOutDe()`, em `src/lib/lgpd/consentimento.ts`);
 *   2. `contatos.pedidos_contagem` / `pedidos_valor_total` × `pedidos` vivos
 *      fora de `STATUS_PEDIDO_SEM_RESERVA` (é o que criar e cancelar movem).
 *
 * NÃO CORRIGE NADA. Correção silenciosa esconde o defeito que causou a
 * divergência. O resultado vira ALERTA — e aqui está o limite desta entrega:
 * `TIPOS_ALERTA` não tem um tipo para divergência de espelho (ampliar é
 * migração do CHECK), então a divergência sai hoje como log `error` com os ids
 * e fica registrada como bloqueio do pacote M8.
 */

export type Divergencia = {
  tipo: "opt_out" | "contadores";
  lojaId: string;
  contatoId: string;
};

const SEM_RESERVA = sql.raw(STATUS_PEDIDO_SEM_RESERVA.map((s) => `'${s}'`).join(", "));

export async function encontrarDivergencias(
  lojaId: string | null = null,
  leitor: Leitor = db,
): Promise<Divergencia[]> {
  const daLoja = lojaId ? sql`and ct.loja_id = ${lojaId}::uuid` : sql``;
  const resultado = await leitor.execute<{ tipo: Divergencia["tipo"]; loja_id: string; contato_id: string }>(sql`
    select 'opt_out' as tipo, ct.loja_id, ct.id as contato_id
      from contatos ct
      left join lateral (
        select k.tipo, k.concedido from consentimentos k
         where k.contato_id = ct.id and k.tipo in ('marketing', 'opt_in', 'opt_out')
         order by k.criado_em desc, k.id desc
         limit 1) u on true
     where ct.is_deleted = false
       and ct.opt_out is distinct from coalesce(
             case u.tipo when 'opt_out' then u.concedido else not u.concedido end, false)
       ${daLoja}
    union all
    select 'contadores', ct.loja_id, ct.id
      from contatos ct
      left join lateral (
        select count(*) as n, coalesce(sum(p.total), 0) as soma from pedidos p
         where p.contato_id = ct.id and p.is_deleted = false
           and p.status not in (${SEM_RESERVA})) r on true
     where ct.is_deleted = false
       and (ct.pedidos_contagem <> r.n or ct.pedidos_valor_total <> r.soma)
       ${daLoja}
     order by 1, 2, 3`);
  return resultado.rows.map((l) => ({ tipo: l.tipo, lojaId: l.loja_id, contatoId: l.contato_id }));
}

/** O job: encontra, registra, não corrige. Devolve quantas achou. */
export async function reconciliar(lojaId: string | null = null): Promise<Divergencia[]> {
  const divergencias = await encontrarDivergencias(lojaId);
  if (divergencias.length > 0) {
    // Só ids: nome e telefone não vão para log.
    logger.error(
      {
        total: divergencias.length,
        optOut: divergencias.filter((d) => d.tipo === "opt_out").length,
        contadores: divergencias.filter((d) => d.tipo === "contadores").length,
        amostra: divergencias.slice(0, 20),
      },
      "reconciliacao: espelho divergente (sem correção automática)",
    );
  } else {
    logger.info({ lojaId }, "reconciliacao: nenhum espelho divergente");
  }
  return divergencias;
}
