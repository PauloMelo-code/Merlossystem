import { asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { EscopoLoja } from "@/lib/auth/loja";
import { vivosE } from "@/lib/db/consultas";
import type { Transacao } from "@/lib/db/mutacoes";
import { PRIORIDADES, type Prioridade } from "@/lib/db/schema/_enums/conversas";
import { PROVEDORES_DE_CONVERSA, type ProvedorDeConversa } from "@/lib/db/schema/_enums/plataforma";
import { lojas } from "@/lib/db/schema/lojas";
import { lojas_sla } from "@/lib/db/schema/lojas-sla";
import { ROTULO_PRIORIDADE, ROTULO_PROVEDOR_CONVERSA } from "@/lib/ui/tons";

/**
 * COSTURA — dono: R2-E2 (SLA configurável). Consumida por M8 (`gerar-alertas`
 * e `/alertas`). ADR 0060.
 *
 * Fonte ÚNICA do prazo de resposta. Nenhum outro arquivo declara 5/15/30/60 —
 * a trava `tests/travas/sla-fonte-unica.test.ts` reprova. Sem `server-only` e
 * sem `db`: recebe `tx`, monta SQL e lê por quem chama.
 */

export type { ProvedorDeConversa };

export const PRAZO_SLA_PADRAO_MIN: Readonly<Record<ProvedorDeConversa, number>> = {
  whatsapp_oficial: 5,
  uazapi: 5,
  instagram: 15,
  facebook: 30,
  tiktok: 60,
};

/** Provedor fora da lista: o prazo mais curto — erra para o lado de avisar. */
export const PRAZO_SLA_DESCONHECIDO_MIN = 5;
/** Igual ao agendador de `gerar-alertas` (a trava confere). ADR 0061. */
export const INTERVALO_CONFERENCIA_SLA_MIN = 5;
export const MAXIMO_SLA_MIN = 1440;

type Ref = AnyPgColumn | SQL;
export type RefsSla = { lojaId: Ref; provedor: Ref; prioridade: Ref };

// Literais de constante, nunca parâmetro: `case ... else $1` tipa mal no Postgres.
const QUANDO = Object.entries(PRAZO_SLA_PADRAO_MIN)
  .map(([provedor, minutos]) => `when '${provedor}' then ${minutos}`)
  .join(" ");

export function padraoDoCanalSql(provedor: Ref): SQL<number> {
  return sql<number>`(case ${provedor} ${sql.raw(QUANDO)} else ${sql.raw(String(PRAZO_SLA_DESCONHECIDO_MIN))} end)`;
}

/** Vale o MENOR entre a regra do canal (ou o padrão) e a regra da prioridade. `least` ignora nulo. */
export function minutosDeSlaSql({ lojaId, provedor, prioridade }: RefsSla): SQL<number> {
  return sql<number>`least(
    coalesce(
      (select s.minutos from ${lojas_sla} s
        where s.loja_id = ${lojaId} and s.provedor = ${provedor} and s.is_deleted = false),
      ${padraoDoCanalSql(provedor)}),
    (select s.minutos from ${lojas_sla} s
      where s.loja_id = ${lojaId} and s.prioridade = ${prioridade} and s.is_deleted = false))`;
}

/** Instante em que o prazo vence. O gerador compara com `now()`. */
export function venceEmSql(inicio: Ref, refs: RefsSla): SQL<Date> {
  return sql<Date>`(${inicio} + make_interval(mins => ${minutosDeSlaSql(refs)}))`;
}

export type PrazoDeCanal = {
  chave: ProvedorDeConversa;
  minutos: number;
  padrao: number;
  origem: "padrao" | "loja";
  updatedAt: Date | null;
};
export type PrazoDePrioridade = { chave: Prioridade; minutos: number | null; updatedAt: Date | null };
export type PrazosDaLoja = {
  lojaId: string;
  lojaNome: string;
  lojaSigla: string;
  canais: PrazoDeCanal[];
  prioridades: PrazoDePrioridade[];
};

/** Prazos vigentes das lojas vivas do escopo, em ordem de sigla. */
export async function lerPrazosVigentes(tx: Transacao, escopo: EscopoLoja): Promise<PrazosDaLoja[]> {
  if (escopo.tipo === "nenhuma") return [];
  const doEscopo = await tx
    .select({ id: lojas.id, nome: lojas.nome, sigla: lojas.sigla })
    .from(lojas)
    .where(vivosE(lojas, escopo.tipo === "uma" ? eq(lojas.id, escopo.lojaId) : undefined))
    .orderBy(asc(lojas.sigla));
  if (doEscopo.length === 0) return [];
  const regras = await tx
    .select({
      lojaId: lojas_sla.loja_id,
      provedor: lojas_sla.provedor,
      prioridade: lojas_sla.prioridade,
      minutos: lojas_sla.minutos,
      updatedAt: lojas_sla.updated_at,
    })
    .from(lojas_sla)
    .where(vivosE(lojas_sla, inArray(lojas_sla.loja_id, doEscopo.map((l) => l.id))));

  return doEscopo.map((l) => {
    const daLoja = regras.filter((r) => r.lojaId === l.id);
    return {
      lojaId: l.id,
      lojaNome: l.nome,
      lojaSigla: l.sigla,
      canais: PROVEDORES_DE_CONVERSA.map((chave): PrazoDeCanal => {
        const padrao = PRAZO_SLA_PADRAO_MIN[chave];
        const r = daLoja.find((x) => x.provedor === chave);
        return r
          ? { chave, minutos: r.minutos, padrao, origem: "loja", updatedAt: r.updatedAt }
          : { chave, minutos: padrao, padrao, origem: "padrao", updatedAt: null };
      }),
      prioridades: PRIORIDADES.map((chave): PrazoDePrioridade => {
        const r = daLoja.find((x) => x.prioridade === chave);
        return { chave, minutos: r?.minutos ?? null, updatedAt: r?.updatedAt ?? null };
      }),
    };
  });
}

/** A frase de `/alertas` (spec R2-E §7.3). */
export function textoDosPrazos(prazos: readonly PrazosDaLoja[]): string {
  const partes = prazos.map((l) => {
    const canais = l.canais.map((c) => `${ROTULO_PROVEDOR_CONVERSA[c.chave]} ${c.minutos} min`);
    const prioridades = l.prioridades
      .filter((p) => p.minutos !== null)
      .map((p) => `prioridade ${ROTULO_PRIORIDADE[p.chave]} ${p.minutos} min`);
    return `${l.lojaSigla} — ${[...canais, ...prioridades].join(" · ")}`;
  });
  return `${partes.join("; ")}. Vale o menor entre canal e prioridade; o sistema confere a cada ${INTERVALO_CONFERENCIA_SLA_MIN} min`;
}
