import "server-only";
import { and, eq, sql, type SQL } from "drizzle-orm";
import type { EscopoLoja } from "@/lib/auth/loja";
import { db } from "@/lib/db/client";
import { vivos } from "@/lib/db/consultas";
import type { Transacao } from "@/lib/db/mutacoes";
import { lojas } from "@/lib/db/schema/lojas";
import type { Indicadores, PontoDaSerie } from "./definicoes";

/**
 * Agregados de `/relatorios`, calculados no servidor (04-ui.md §5.5). As
 * fórmulas são as de `definicoes.ts` — se uma mudar, muda lá e aqui juntas.
 *
 * Todas as consultas filtram `is_deleted = false` e a loja do escopo. O dia da
 * série é o de São Paulo.
 */

export type Leitor = typeof db | Transacao;
export type Periodo = { de: Date; ate: Date };

const FUSO = "America/Sao_Paulo";

function daLoja(coluna: string, escopo: EscopoLoja): SQL {
  if (escopo.tipo === "nenhuma") return sql`and false`;
  if (escopo.tipo === "todas") return sql``;
  return sql`and ${sql.raw(coluna)} = ${escopo.lojaId}::uuid`;
}

export async function calcularIndicadores(
  escopo: EscopoLoja,
  periodo: Periodo,
  leitor: Leitor = db,
): Promise<Indicadores> {
  const de = periodo.de.toISOString();
  const ate = periodo.ate.toISOString();
  const resultado = await leitor.execute<{
    receita: string;
    lancados: string;
    ticket: string | null;
    criados: string;
    conversas: string;
    respondidas: string;
    mediana_seg: string | null;
  }>(sql`
    with lancados as (
      select p.total from pedidos p
       where p.is_deleted = false and p.masc_status = 'lancado'
         and p.masc_lancado_em >= ${de}::timestamptz and p.masc_lancado_em < ${ate}::timestamptz
         ${daLoja("p.loja_id", escopo)}
    ),
    criados as (
      select count(*) as n from pedidos p
       where p.is_deleted = false and p.status <> 'cancelado'
         and p.created_at >= ${de}::timestamptz and p.created_at < ${ate}::timestamptz
         ${daLoja("p.loja_id", escopo)}
    ),
    conversas_periodo as (
      select c.created_at, c.primeira_resposta_em from conversas c
       where c.is_deleted = false
         and c.created_at >= ${de}::timestamptz and c.created_at < ${ate}::timestamptz
         ${daLoja("c.loja_id", escopo)}
    )
    select
      (select coalesce(sum(total), 0)::numeric(14,2)::text from lancados) as receita,
      (select count(*)::text from lancados) as lancados,
      (select case when count(*) = 0 then null
                   else round(sum(total) / count(*), 2)::numeric(14,2)::text end from lancados) as ticket,
      (select n::text from criados) as criados,
      (select count(*)::text from conversas_periodo) as conversas,
      (select count(*)::text from conversas_periodo where primeira_resposta_em is not null) as respondidas,
      (select percentile_cont(0.5) within group (
                order by extract(epoch from primeira_resposta_em - created_at))::text
         from conversas_periodo where primeira_resposta_em is not null) as mediana_seg`);

  const l = resultado.rows[0];
  const conversas = Number(l?.conversas ?? 0);
  const respondidas = Number(l?.respondidas ?? 0);
  return {
    receita: l?.receita ?? "0.00",
    pedidosLancados: Number(l?.lancados ?? 0),
    ticketMedio: l?.ticket ?? null,
    pedidosCriados: Number(l?.criados ?? 0),
    conversasIniciadas: conversas,
    taxaResposta: conversas === 0 ? null : respondidas / conversas,
    tempoPrimeiraResposta:
      l?.mediana_seg == null ? null : Math.round((Number(l.mediana_seg) / 60) * 10) / 10,
  };
}

/** Um ponto por dia do período, inclusive os dias zerados (gráfico sem buraco). */
export async function serieDiaria(
  escopo: EscopoLoja,
  periodo: Periodo,
  leitor: Leitor = db,
): Promise<PontoDaSerie[]> {
  const de = periodo.de.toISOString();
  const ate = periodo.ate.toISOString();
  const resultado = await leitor.execute<{ dia: string; receita: string; conversas: string }>(sql`
    with dias as (
      select generate_series(
        (${de}::timestamptz at time zone ${FUSO})::date,
        ((${ate}::timestamptz at time zone ${FUSO})::date - 1),
        interval '1 day')::date as dia
    ),
    receita as (
      select (p.masc_lancado_em at time zone ${FUSO})::date as dia, sum(p.total) as valor
        from pedidos p
       where p.is_deleted = false and p.masc_status = 'lancado'
         and p.masc_lancado_em >= ${de}::timestamptz and p.masc_lancado_em < ${ate}::timestamptz
         ${daLoja("p.loja_id", escopo)}
       group by 1
    ),
    conversas_dia as (
      select (c.created_at at time zone ${FUSO})::date as dia, count(*) as n
        from conversas c
       where c.is_deleted = false
         and c.created_at >= ${de}::timestamptz and c.created_at < ${ate}::timestamptz
         ${daLoja("c.loja_id", escopo)}
       group by 1
    )
    select to_char(d.dia, 'YYYY-MM-DD') as dia,
           coalesce(r.valor, 0)::numeric(14,2)::text as receita,
           coalesce(cd.n, 0)::text as conversas
      from dias d
      left join receita r on r.dia = d.dia
      left join conversas_dia cd on cd.dia = d.dia
     order by d.dia`);
  return resultado.rows.map((l) => ({
    dia: l.dia,
    receita: l.receita,
    conversas: Number(l.conversas),
  }));
}

/** "Todas as lojas" ou o nome da loja — o cabeçalho diz de onde é o número. */
export async function nomeDoEscopo(escopo: EscopoLoja, leitor: Leitor = db): Promise<string> {
  if (escopo.tipo === "todas") return "Todas as lojas";
  if (escopo.tipo === "nenhuma") return "Nenhuma loja";
  const [loja] = await leitor
    .select({ nome: lojas.nome })
    .from(lojas)
    .where(and(eq(lojas.id, escopo.lojaId), vivos(lojas)))
    .limit(1);
  return loja?.nome ?? "Loja";
}
