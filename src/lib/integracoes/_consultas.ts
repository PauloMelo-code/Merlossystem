import "server-only";
import { and, desc, eq, isNull, or, type SQL } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { condicaoDeLoja, vivos, vivosE } from "@/lib/db/consultas";
import { lojas } from "@/lib/db/schema/lojas";
import { lojas_integracoes, lojas_integracoes_eventos } from "@/lib/db/schema/integracoes";
import type { EscopoLoja } from "@/lib/auth/loja";
import { ErroDeIntegracao } from "@/lib/erros";
import {
  conferirCofre,
  credenciaisVisiveis,
  decifrar,
  ErroDoCofre,
  type CredencialVisivel,
} from "@/lib/seguranca/cofre";

/**
 * Leituras do módulo de integrações. Toda consulta passa por `vivos()` e, a de
 * tela, por `condicaoDeLoja()`.
 */

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A conta de rede (loja nula) aparece para quem gere qualquer loja. */
function escopoComRede(escopo: EscopoLoja): SQL | undefined {
  const daLoja = condicaoDeLoja(lojas_integracoes, escopo);
  return daLoja === undefined ? undefined : or(daLoja, isNull(lojas_integracoes.loja_id));
}

export type ContaParaWebhook = {
  id: string;
  provedor: string;
  lojaId: string | null;
  status: string;
  segredoHash: string | null;
};

const PROJECAO_WEBHOOK = {
  id: lojas_integracoes.id,
  provedor: lojas_integracoes.provedor,
  lojaId: lojas_integracoes.loja_id,
  status: lojas_integracoes.status,
  segredoHash: lojas_integracoes.segredo_webhook_hash,
};

/** Viva e não revogada. `null` para inexistente, revogada ou id malformado. */
export async function contaPorId(id: string): Promise<ContaParaWebhook | null> {
  if (!UUID.test(id)) return null;
  const [linha] = await db
    .select(PROJECAO_WEBHOOK)
    .from(lojas_integracoes)
    .where(vivosE(lojas_integracoes, eq(lojas_integracoes.id, id), isNull(lojas_integracoes.revogada_em)))
    .limit(1);
  return linha ?? null;
}

/** `(provedor, referencia_externa)` é único entre as vivas (01-dados.md §6.3). */
export async function contaPorReferencia(provedor: string, referencia: string): Promise<ContaParaWebhook | null> {
  const [linha] = await db
    .select(PROJECAO_WEBHOOK)
    .from(lojas_integracoes)
    .where(
      vivosE(
        lojas_integracoes,
        eq(lojas_integracoes.provedor, provedor),
        eq(lojas_integracoes.referencia_externa, referencia),
        isNull(lojas_integracoes.revogada_em),
      ),
    )
    .limit(1);
  return linha ?? null;
}

/** Contas vivas de um provedor, para o fan-out dos jobs periódicos. */
export async function contasDoProvedor(provedor: string): Promise<{ id: string; lojaId: string | null }[]> {
  return db
    .select({ id: lojas_integracoes.id, lojaId: lojas_integracoes.loja_id })
    .from(lojas_integracoes)
    .where(
      vivosE(lojas_integracoes, eq(lojas_integracoes.provedor, provedor), isNull(lojas_integracoes.revogada_em)),
    );
}

export type ContaComCredencial = {
  id: string;
  provedor: string;
  lojaId: string | null;
  status: string;
  updatedAt: Date;
  expiraEm: Date | null;
  credencial: Record<string, string>;
};

/** Abre o envelope. Credencial ilegível é erro permanente: retentar não muda. */
export async function contaComCredencial(id: string): Promise<ContaComCredencial | null> {
  if (!UUID.test(id)) return null;
  const [linha] = await db
    .select({
      id: lojas_integracoes.id,
      provedor: lojas_integracoes.provedor,
      lojaId: lojas_integracoes.loja_id,
      status: lojas_integracoes.status,
      updatedAt: lojas_integracoes.updated_at,
      expiraEm: lojas_integracoes.expira_em,
      cifradas: lojas_integracoes.credenciais_cifradas,
      aad: lojas_integracoes.credenciais_aad,
    })
    .from(lojas_integracoes)
    .where(vivosE(lojas_integracoes, eq(lojas_integracoes.id, id), isNull(lojas_integracoes.revogada_em)))
    .limit(1);
  if (!linha) return null;
  if (!linha.cifradas || !linha.aad) {
    throw new ErroDeIntegracao("A conta está sem credencial. Conecte de novo.", true);
  }
  // Chave do cofre ausente é configuração (503), não defeito desta conta: sobe
  // antes. Daqui para baixo, envelope que não abre é credencial ilegível.
  conferirCofre();
  let bruto: unknown;
  try {
    bruto = JSON.parse(decifrar(linha.cifradas, linha.aad));
  } catch (erro) {
    if (erro instanceof SyntaxError || erro instanceof ErroDoCofre) {
      throw new ErroDeIntegracao("Credencial ilegível. Conecte de novo.", true);
    }
    throw erro;
  }
  const credencial: Record<string, string> = {};
  if (typeof bruto === "object" && bruto !== null) {
    for (const [k, v] of Object.entries(bruto)) if (typeof v === "string") credencial[k] = v;
  }
  return {
    id: linha.id,
    provedor: linha.provedor,
    lojaId: linha.lojaId,
    status: linha.status,
    updatedAt: linha.updatedAt,
    expiraEm: linha.expiraEm,
    credencial,
  };
}

/** DTO da tela. Nunca carrega segredo: só os 4 últimos caracteres. */
export type ContaNaTela = {
  id: string;
  provedor: string;
  rotulo: string;
  lojaId: string | null;
  lojaNome: string | null;
  status: string;
  referencia: string | null;
  expiraEm: Date | null;
  ultimoErro: string | null;
  ultimaSincronizacao: Date | null;
  temSegredoWebhook: boolean;
  credencial: CredencialVisivel;
  updatedAt: Date;
};

const PROJECAO_TELA = {
  id: lojas_integracoes.id,
  provedor: lojas_integracoes.provedor,
  rotulo: lojas_integracoes.rotulo,
  lojaId: lojas_integracoes.loja_id,
  lojaNome: lojas.nome,
  status: lojas_integracoes.status,
  referencia: lojas_integracoes.referencia_externa,
  expiraEm: lojas_integracoes.expira_em,
  ultimoErro: lojas_integracoes.ultimo_erro,
  ultimaSincronizacao: lojas_integracoes.ultima_sincronizacao,
  segredo: lojas_integracoes.segredo_webhook_hash,
  cifradas: lojas_integracoes.credenciais_cifradas,
  aad: lojas_integracoes.credenciais_aad,
  updatedAt: lojas_integracoes.updated_at,
};

type LinhaTela = Omit<ContaNaTela, "temSegredoWebhook" | "credencial"> & {
  segredo: string | null;
  cifradas: string | null;
  aad: string | null;
};

function paraTela(l: LinhaTela): ContaNaTela {
  return {
    id: l.id,
    provedor: l.provedor,
    rotulo: l.rotulo,
    lojaId: l.lojaId,
    lojaNome: l.lojaNome,
    status: l.status,
    referencia: l.referencia,
    expiraEm: l.expiraEm,
    ultimoErro: l.ultimoErro,
    ultimaSincronizacao: l.ultimaSincronizacao,
    temSegredoWebhook: l.segredo !== null,
    // Ilegível vira `{erro:"ilegivel"}` e NÃO derruba a listagem (§13).
    credencial: credenciaisVisiveis(l.cifradas, l.aad),
    updatedAt: l.updatedAt,
  };
}

export async function listarContas(escopo: EscopoLoja): Promise<ContaNaTela[]> {
  const linhas = await db
    .select(PROJECAO_TELA)
    .from(lojas_integracoes)
    .leftJoin(lojas, eq(lojas.id, lojas_integracoes.loja_id))
    .where(vivosE(lojas_integracoes, escopoComRede(escopo)))
    .orderBy(lojas_integracoes.provedor, lojas_integracoes.rotulo);
  return linhas.map(paraTela);
}

export type EventoNaTela = {
  id: string;
  tipo: string;
  eventoExternoId: string | null;
  erro: string | null;
  recebidoEm: Date;
  processadoEm: Date | null;
};

/** Detalhe + últimos eventos do diário. O CORPO não sai: é PII de cliente. */
export async function detalheDaConta(
  id: string,
  escopo: EscopoLoja,
): Promise<{ conta: ContaNaTela; eventos: EventoNaTela[] } | null> {
  if (!UUID.test(id)) return null;
  const [linha] = await db
    .select(PROJECAO_TELA)
    .from(lojas_integracoes)
    .leftJoin(lojas, eq(lojas.id, lojas_integracoes.loja_id))
    .where(vivosE(lojas_integracoes, eq(lojas_integracoes.id, id), escopoComRede(escopo)))
    .limit(1);
  if (!linha) return null;

  const eventos = await db
    .select({
      id: lojas_integracoes_eventos.id,
      tipo: lojas_integracoes_eventos.tipo,
      eventoExternoId: lojas_integracoes_eventos.evento_externo_id,
      erro: lojas_integracoes_eventos.erro,
      recebidoEm: lojas_integracoes_eventos.created_at,
      processadoEm: lojas_integracoes_eventos.processado_em,
    })
    .from(lojas_integracoes_eventos)
    .where(and(eq(lojas_integracoes_eventos.integracao_id, id), vivos(lojas_integracoes_eventos)))
    .orderBy(desc(lojas_integracoes_eventos.created_at))
    .limit(20);

  return { conta: paraTela(linha), eventos };
}

/** A conta de rede viva (Bling), para reconectar sem criar uma segunda. */
export async function contaDaRede(provedor: "bling"): Promise<{ id: string; updatedAt: Date } | null> {
  const [linha] = await db
    .select({ id: lojas_integracoes.id, updatedAt: lojas_integracoes.updated_at })
    .from(lojas_integracoes)
    .where(vivosE(lojas_integracoes, eq(lojas_integracoes.provedor, provedor), isNull(lojas_integracoes.loja_id)))
    // Determinístico: se um dia houver duas vivas, reconectar mexe sempre na mais antiga.
    .orderBy(lojas_integracoes.created_at)
    .limit(1);
  return linha ?? null;
}
