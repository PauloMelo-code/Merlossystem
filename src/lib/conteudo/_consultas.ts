import "server-only";
import { asc, eq } from "drizzle-orm";
import type { EscopoLoja } from "@/lib/auth/loja";
import { db } from "@/lib/db/client";
import { condicaoDeLoja, vivosE } from "@/lib/db/consultas";
import { respostas_rapidas } from "@/lib/db/schema/conteudo/respostas-rapidas";
import { lojas_integracoes, lojas_integracoes_templates } from "@/lib/db/schema/integracoes";

/**
 * Leituras de respostas rápidas e modelos.
 * ponytail: sem cursor — dezenas de linhas por loja; cursor quando passar de 200.
 */
const TETO = 200;

export async function listarRespostas(escopo: EscopoLoja) {
  return db
    .select({
      id: respostas_rapidas.id,
      titulo: respostas_rapidas.titulo,
      atalho: respostas_rapidas.atalho,
      categoria: respostas_rapidas.categoria,
      conteudo: respostas_rapidas.conteudo,
      ativa: respostas_rapidas.ativa,
      atualizadoEm: respostas_rapidas.updated_at,
    })
    .from(respostas_rapidas)
    .where(vivosE(respostas_rapidas, condicaoDeLoja(respostas_rapidas, escopo)))
    .orderBy(asc(respostas_rapidas.titulo), asc(respostas_rapidas.id))
    .limit(TETO);
}

export async function listarModelos(escopo: EscopoLoja) {
  return db
    .select({
      id: lojas_integracoes_templates.id,
      nome: lojas_integracoes_templates.nome,
      categoria: lojas_integracoes_templates.categoria,
      cabecalho: lojas_integracoes_templates.cabecalho_conteudo,
      corpo: lojas_integracoes_templates.corpo,
      rodape: lojas_integracoes_templates.rodape,
      variaveisContagem: lojas_integracoes_templates.variaveis_contagem,
      status: lojas_integracoes_templates.status,
      motivoRejeicao: lojas_integracoes_templates.motivo_rejeicao,
      atualizadoEm: lojas_integracoes_templates.updated_at,
      conta: lojas_integracoes.rotulo,
    })
    .from(lojas_integracoes_templates)
    .innerJoin(lojas_integracoes, eq(lojas_integracoes.id, lojas_integracoes_templates.integracao_id))
    .where(vivosE(lojas_integracoes_templates, condicaoDeLoja(lojas_integracoes_templates, escopo)))
    .orderBy(asc(lojas_integracoes.rotulo), asc(lojas_integracoes_templates.nome))
    .limit(TETO);
}

/** Números oficiais da loja — os únicos que têm modelo. */
export async function contasOficiais(lojaId: string) {
  return db
    .select({ id: lojas_integracoes.id, rotulo: lojas_integracoes.rotulo })
    .from(lojas_integracoes)
    .where(
      vivosE(
        lojas_integracoes,
        eq(lojas_integracoes.loja_id, lojaId),
        eq(lojas_integracoes.provedor, "whatsapp_oficial"),
      ),
    )
    .orderBy(asc(lojas_integracoes.rotulo));
}
