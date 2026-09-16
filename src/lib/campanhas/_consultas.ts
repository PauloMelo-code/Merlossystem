import "server-only";
import { asc, count, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { EscopoLoja } from "@/lib/auth/loja";
import { db } from "@/lib/db/client";
import { condicaoDeLoja, vivosE } from "@/lib/db/consultas";
import type { StatusDestinatario } from "@/lib/db/schema/_enums/catalogo";
import { campanhas, campanhas_destinatarios } from "@/lib/db/schema/campanhas";
import { contatos } from "@/lib/db/schema/contatos";
import { lojas_integracoes, lojas_integracoes_templates } from "@/lib/db/schema/integracoes";
import { lojas_etiquetas } from "@/lib/db/schema/lojas";
import { ErroDeEscopo } from "@/lib/erros";
import { montarPagina, type Cursor, type Direcao } from "./cursor";
import { PROVEDORES_DE_CAMPANHA } from "./regras";

/**
 * Leituras do módulo de campanhas. Toda consulta passa por `vivosE` +
 * `condicaoDeLoja`; registro de outra loja é "não encontrado" (404).
 *
 * Contadores são `count(*)` sobre `campanhas_destinatarios` — nunca coluna
 * (01-dados-dominio.md §5.4: o antigo tinha 6 contadores e 4 nunca mudavam).
 */

/** `(em, id) > cursor` ou `<`, com os tipos que o Postgres precisa. */
export function depoisDoCursor(em: PgColumn, id: PgColumn, cursor: Cursor, maior: boolean): SQL {
  const valor = sql`(${cursor.em.toISOString()}::timestamptz, ${cursor.id}::uuid)`;
  return maior ? sql`(${em}, ${id}) > ${valor}` : sql`(${em}, ${id}) < ${valor}`;
}

export type Metricas = {
  total: number;
  naFila: number;
  enviados: number;
  entregues: number;
  lidos: number;
  respondidos: number;
  falhas: number;
};

const ESCALA: Record<StatusDestinatario, (keyof Metricas)[]> = {
  pendente: ["naFila"],
  reservado: ["naFila"],
  enviado: ["enviados"],
  entregue: ["enviados", "entregues"],
  lido: ["enviados", "entregues", "lidos"],
  respondido: ["enviados", "entregues", "lidos", "respondidos"],
  falhou: ["falhas"],
};

/** Métricas por campanha, num `GROUP BY` só. */
export async function metricasDe(ids: readonly string[]): Promise<Map<string, Metricas>> {
  const mapa = new Map<string, Metricas>();
  if (ids.length === 0) return mapa;
  const linhas = await db
    .select({
      campanhaId: campanhas_destinatarios.campanha_id,
      status: campanhas_destinatarios.status,
      n: count(),
    })
    .from(campanhas_destinatarios)
    .where(vivosE(campanhas_destinatarios, inArray(campanhas_destinatarios.campanha_id, [...ids])))
    .groupBy(campanhas_destinatarios.campanha_id, campanhas_destinatarios.status);
  for (const id of ids) {
    mapa.set(id, { total: 0, naFila: 0, enviados: 0, entregues: 0, lidos: 0, respondidos: 0, falhas: 0 });
  }
  for (const l of linhas) {
    const m = mapa.get(l.campanhaId)!;
    m.total += l.n;
    for (const chave of ESCALA[l.status as StatusDestinatario] ?? []) m[chave] += l.n;
  }
  return mapa;
}

export type LinhaCampanha = {
  id: string;
  nome: string;
  status: string;
  conta: string;
  criadoEm: Date;
  iniciadaEm: Date | null;
  metricas: Metricas;
};

export async function listarCampanhas(
  escopo: EscopoLoja,
  pagina: { cursor: Cursor | null; direcao: Direcao; limite: number },
) {
  const { cursor, direcao, limite } = pagina;
  const recentesPrimeiro = direcao === "proxima";
  const linhas = await db
    .select({
      id: campanhas.id,
      nome: campanhas.nome,
      status: campanhas.status,
      conta: lojas_integracoes.rotulo,
      criadoEm: campanhas.created_at,
      iniciadaEm: campanhas.iniciada_em,
    })
    .from(campanhas)
    .innerJoin(lojas_integracoes, eq(lojas_integracoes.id, campanhas.integracao_id))
    .where(
      vivosE(
        campanhas,
        condicaoDeLoja(campanhas, escopo),
        cursor ? depoisDoCursor(campanhas.created_at, campanhas.id, cursor, !recentesPrimeiro) : undefined,
      ),
    )
    .orderBy(
      recentesPrimeiro ? desc(campanhas.created_at) : asc(campanhas.created_at),
      recentesPrimeiro ? desc(campanhas.id) : asc(campanhas.id),
    )
    .limit(limite + 1);
  const pag = montarPagina(linhas, limite, direcao, cursor !== null);
  const metricas = await metricasDe(pag.itens.map((i) => i.id));
  return {
    ...pag,
    itens: pag.itens.map((i): LinhaCampanha => ({ ...i, metricas: metricas.get(i.id)! })),
  };
}

export async function detalheCampanha(escopo: EscopoLoja, id: string) {
  const [linha] = await db
    .select({
      id: campanhas.id,
      lojaId: campanhas.loja_id,
      nome: campanhas.nome,
      status: campanhas.status,
      atualizadoEm: campanhas.updated_at,
      criadoEm: campanhas.created_at,
      iniciadaEm: campanhas.iniciada_em,
      concluidaEm: campanhas.concluida_em,
      totalMaterializado: campanhas.total_destinatarios,
      conteudoTexto: campanhas.conteudo_texto,
      segmento: campanhas.segmento,
      conta: lojas_integracoes.rotulo,
      provedor: lojas_integracoes.provedor,
      modelo: lojas_integracoes_templates.nome,
    })
    .from(campanhas)
    .innerJoin(lojas_integracoes, eq(lojas_integracoes.id, campanhas.integracao_id))
    .leftJoin(lojas_integracoes_templates, eq(lojas_integracoes_templates.id, campanhas.template_id))
    .where(vivosE(campanhas, condicaoDeLoja(campanhas, escopo), eq(campanhas.id, id)))
    .limit(1);
  if (!linha) throw new ErroDeEscopo();
  const metricas = (await metricasDe([id])).get(id)!;
  return { ...linha, metricas };
}

export async function listarDestinatarios(
  escopo: EscopoLoja,
  campanhaId: string,
  filtro: { status?: StatusDestinatario | undefined },
  pagina: { cursor: Cursor | null; direcao: Direcao; limite: number },
) {
  const { cursor, direcao, limite } = pagina;
  const adiante = direcao === "proxima";
  const linhas = await db
    .select({
      id: campanhas_destinatarios.id,
      status: campanhas_destinatarios.status,
      erro: campanhas_destinatarios.erro,
      enviadoEm: campanhas_destinatarios.enviado_em,
      tentativas: campanhas_destinatarios.tentativas,
      criadoEm: campanhas_destinatarios.created_at,
      contatoId: contatos.id,
      nome: contatos.nome,
    })
    .from(campanhas_destinatarios)
    .innerJoin(contatos, eq(contatos.id, campanhas_destinatarios.contato_id))
    .where(
      vivosE(
        campanhas_destinatarios,
        condicaoDeLoja(campanhas_destinatarios, escopo),
        eq(campanhas_destinatarios.campanha_id, campanhaId),
        filtro.status ? eq(campanhas_destinatarios.status, filtro.status) : undefined,
        cursor
          ? depoisDoCursor(campanhas_destinatarios.created_at, campanhas_destinatarios.id, cursor, adiante)
          : undefined,
      ),
    )
    .orderBy(
      adiante ? asc(campanhas_destinatarios.created_at) : desc(campanhas_destinatarios.created_at),
      adiante ? asc(campanhas_destinatarios.id) : desc(campanhas_destinatarios.id),
    )
    .limit(limite + 1);
  return montarPagina(linhas, limite, direcao, cursor !== null);
}

/** Contas de WhatsApp da loja — a conta de saída é escolha explícita. */
export async function contasDeCampanha(lojaId: string) {
  return db
    .select({
      id: lojas_integracoes.id,
      rotulo: lojas_integracoes.rotulo,
      provedor: lojas_integracoes.provedor,
      status: lojas_integracoes.status,
    })
    .from(lojas_integracoes)
    .where(
      vivosE(
        lojas_integracoes,
        eq(lojas_integracoes.loja_id, lojaId),
        inArray(lojas_integracoes.provedor, [...PROVEDORES_DE_CAMPANHA]),
      ),
    )
    .orderBy(asc(lojas_integracoes.rotulo));
}

/** Modelos que a Meta aprovou — só esses disparam. */
export async function modelosAprovados(lojaId: string) {
  return db
    .select({
      id: lojas_integracoes_templates.id,
      integracaoId: lojas_integracoes_templates.integracao_id,
      nome: lojas_integracoes_templates.nome,
      corpo: lojas_integracoes_templates.corpo,
      variaveisContagem: lojas_integracoes_templates.variaveis_contagem,
    })
    .from(lojas_integracoes_templates)
    .where(
      vivosE(
        lojas_integracoes_templates,
        eq(lojas_integracoes_templates.loja_id, lojaId),
        eq(lojas_integracoes_templates.status, "aprovado"),
      ),
    )
    .orderBy(asc(lojas_integracoes_templates.nome));
}

export async function etiquetasDaLoja(lojaId: string) {
  return db
    .select({ id: lojas_etiquetas.id, nome: lojas_etiquetas.nome })
    .from(lojas_etiquetas)
    .where(vivosE(lojas_etiquetas, eq(lojas_etiquetas.loja_id, lojaId)))
    .orderBy(asc(lojas_etiquetas.nome));
}
