import "server-only";
import { and, desc, eq } from "drizzle-orm";
import type { EscopoLoja } from "@/lib/auth/loja";
import { condicaoDeLoja, vivos, vivosE } from "@/lib/db/consultas";
import type { Transacao } from "@/lib/db/mutacoes";
import { contatos } from "@/lib/db/schema/contatos";
import { lgpd_solicitacoes } from "@/lib/db/schema/lgpd";

/** Leituras do módulo LGPD, sempre por loja (DN-05). */

/** O único parcial `(loja_id, protocolo)` recusaria; a tela diz o porquê antes. */
export async function protocoloEmUso(tx: Transacao, lojaId: string, protocolo: string) {
  const [linha] = await tx
    .select({ id: lgpd_solicitacoes.id })
    .from(lgpd_solicitacoes)
    .where(
      vivosE(
        lgpd_solicitacoes,
        eq(lgpd_solicitacoes.loja_id, lojaId),
        eq(lgpd_solicitacoes.protocolo, protocolo),
      ),
    )
    .limit(1);
  return Boolean(linha);
}

export async function contatoVivoDaLoja(tx: Transacao, lojaId: string, contatoId: string) {
  const [linha] = await tx
    .select({ id: contatos.id })
    .from(contatos)
    .where(vivosE(contatos, eq(contatos.id, contatoId), eq(contatos.loja_id, lojaId)))
    .limit(1);
  return Boolean(linha);
}

export async function lerSolicitacao(tx: Transacao, escopo: EscopoLoja, id: string) {
  const [linha] = await tx
    .select({
      id: lgpd_solicitacoes.id,
      lojaId: lgpd_solicitacoes.loja_id,
      contatoId: lgpd_solicitacoes.contato_id,
      tipo: lgpd_solicitacoes.tipo,
      executadoEm: lgpd_solicitacoes.executado_em,
    })
    .from(lgpd_solicitacoes)
    .where(vivosE(lgpd_solicitacoes, eq(lgpd_solicitacoes.id, id), condicaoDeLoja(lgpd_solicitacoes, escopo)))
    .limit(1);
  return linha ?? null;
}

export async function solicitacoesDoContato(tx: Transacao, escopo: EscopoLoja, contatoId: string) {
  return tx
    .select({
      id: lgpd_solicitacoes.id,
      tipo: lgpd_solicitacoes.tipo,
      protocolo: lgpd_solicitacoes.protocolo,
      solicitadoEm: lgpd_solicitacoes.solicitado_em,
      executadoEm: lgpd_solicitacoes.executado_em,
    })
    .from(lgpd_solicitacoes)
    .where(
      and(
        vivos(lgpd_solicitacoes),
        eq(lgpd_solicitacoes.contato_id, contatoId),
        condicaoDeLoja(lgpd_solicitacoes, escopo),
      ),
    )
    .orderBy(desc(lgpd_solicitacoes.solicitado_em))
    .limit(20);
}

/** A eliminação já executada, travada para o job regravar o resultado. */
export async function eliminacaoParaGravar(tx: Transacao, escopo: EscopoLoja, id: string) {
  const [linha] = await tx
    .select({
      lojaId: lgpd_solicitacoes.loja_id,
      updatedAt: lgpd_solicitacoes.updated_at,
      resultado: lgpd_solicitacoes.resultado,
    })
    .from(lgpd_solicitacoes)
    .where(
      vivosE(
        lgpd_solicitacoes,
        eq(lgpd_solicitacoes.id, id),
        eq(lgpd_solicitacoes.tipo, "eliminacao"),
        condicaoDeLoja(lgpd_solicitacoes, escopo),
      ),
    )
    .for("update");
  return linha ?? null;
}
