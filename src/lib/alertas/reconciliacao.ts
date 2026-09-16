import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import type { Severidade } from "@/lib/db/schema/_enums/plataforma";
import { STATUS_PEDIDO_SEM_RESERVA } from "@/lib/db/schema/_enums/pedidos";
import { logger } from "@/lib/logger";
import { alertasAbertos, type Leitor } from "./_consultas";
import { abrir, resolver } from "./escrita";

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
 * divergência. Cada divergência vira ALERTA `espelho_divergente`, uma por
 * (tipo, contato). A reconciliação é o gerador desse tipo: ela também o
 * RESOLVE quando a divergência some (alguém corrigiu a causa).
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

const TIPO = "espelho_divergente" as const;

const SEVERIDADE: Readonly<Record<Divergencia["tipo"], Severidade>> = {
  // Opt-out errado para menos = campanha para quem pediu para sair (LGPD).
  opt_out: "critica",
  contadores: "media",
};

/** Sem PII: a mensagem aparece para a equipe inteira da loja. */
const MENSAGEM: Readonly<Record<Divergencia["tipo"], string>> = {
  opt_out: "O opt-out do contato diverge do último consentimento registrado. Confira a ficha.",
  contadores: "Os contadores de pedidos do contato divergem dos pedidos registrados.",
};

export function chaveDaDivergencia(d: Pick<Divergencia, "tipo" | "contatoId">): string {
  return `${TIPO}|${d.tipo}|${d.contatoId}`;
}

/**
 * O job: encontra, abre alerta, resolve o que deixou de divergir. Não corrige
 * o dado. Cada gravação na própria transação; falha é contada e relançada.
 */
export async function reconciliar(lojaId: string | null = null, agora = new Date()): Promise<Divergencia[]> {
  const divergencias = await encontrarDivergencias(lojaId);
  const vigentes = new Set(divergencias.map((d) => `${d.lojaId}|${chaveDaDivergencia(d)}`));
  const abertos = await alertasAbertos([TIPO], lojaId);
  const jaAbertos = new Set(abertos.map((a) => `${a.lojaId}|${a.chave}`));
  let falhas = 0;
  const gravar = (fn: () => Promise<unknown>) =>
    fn().catch((erro: unknown) => {
      falhas += 1;
      logger.error({ erro: erro instanceof Error ? erro.message : String(erro) }, "reconciliacao: alerta não gravado");
    });

  for (const a of abertos) {
    if (vigentes.has(`${a.lojaId}|${a.chave}`)) continue;
    await gravar(() => db.transaction((tx) => resolver(tx, { id: a.id, lojaId: a.lojaId }, agora)));
  }
  for (const d of divergencias) {
    const chave = chaveDaDivergencia(d);
    if (jaAbertos.has(`${d.lojaId}|${chave}`)) continue;
    await gravar(() =>
      db.transaction((tx) =>
        abrir(tx, {
          lojaId: d.lojaId,
          tipo: TIPO,
          severidade: SEVERIDADE[d.tipo],
          mensagem: MENSAGEM[d.tipo],
          chave,
          contatoId: d.contatoId,
        }),
      ),
    );
  }

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
  if (falhas > 0) throw new Error(`reconciliacao: ${falhas} gravação(ões) de alerta falharam`);
  return divergencias;
}
