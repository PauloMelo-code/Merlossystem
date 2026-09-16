import "server-only";
import type { z } from "zod";
import type { Contexto } from "@/lib/auth/guard";
import { inserirAuditado, registrarAuditoria, type Transacao } from "@/lib/db/mutacoes";
import { lgpd_solicitacoes } from "@/lib/db/schema/lgpd";
import { ErroDeEscopo, ErroDeValidacao } from "@/lib/erros";
import { enfileirar } from "@/lib/fila/filas";
import { jobId } from "@/lib/fila/idempotencia";
import { logger } from "@/lib/logger";
import {
  SECOES_DOSSIE,
  type iniciarExportacaoSchema,
  type lerDossieSchema,
  type registrarSolicitacaoSchema,
} from "@/lib/validadores/lgpd";
import type { SaidaAnonimizacao } from "./_anonimizacao";
import {
  contatoVivoDaLoja,
  lerSolicitacao,
  protocoloEmUso,
  solicitacoesDoContato,
} from "./_consultas";
import { lerPaginaDoDossie } from "./_dossie";
import { ultimosConsentimentos } from "./consentimento";

/**
 * API pública do módulo LGPD (03-arquitetura.md §4.2): consentimento,
 * dossiê do titular e anonimização. Escopo SEMPRE por loja (DN-05): a mesma
 * pessoa nas duas lojas são dois contatos e duas solicitações.
 */

export { anonimizarContato, MARCADOR, NOME_ANONIMO } from "./_anonimizacao";
export type { EntradaAnonimizacao, SaidaAnonimizacao } from "./_anonimizacao";
export { registrarConsentimento } from "./consentimento";
export { optOutDe, TERMO_VIGENTE } from "./regras";
export type { NovoConsentimento } from "./consentimento";
export type { PaginaDossie } from "./_dossie";

/** A exportação aberta vale por uma hora; depois, nova solicitação. */
const VALIDADE_DA_EXPORTACAO_MS = 60 * 60 * 1000;

function lojaDaEscrita(ctx: Contexto): string {
  if (ctx.escopo.tipo !== "uma") throw new ErroDeEscopo();
  return ctx.escopo.lojaId;
}

async function exigirProtocoloLivre(tx: Transacao, lojaId: string, protocolo: string) {
  if (await protocoloEmUso(tx, lojaId, protocolo)) {
    throw new ErroDeValidacao({ protocolo: ["Este protocolo já foi usado nesta loja."] });
  }
}

/** O que a ficha mostra do lado LGPD: consentimentos recentes e solicitações. */
export async function lerHistoricoLgpd(tx: Transacao, ctx: Contexto, contatoId: string) {
  const consentimentos = await ultimosConsentimentos(tx, ctx, contatoId);
  const solicitacoes = await solicitacoesDoContato(tx, ctx.escopo, contatoId);
  return { consentimentos, solicitacoes };
}

/**
 * Abre a exportação: registra a solicitação de ACESSO e grava `lgpd_exportado`
 * na trilha, antes de a primeira página sair.
 */
export async function iniciarExportacao(
  tx: Transacao,
  ctx: Contexto,
  dados: z.output<typeof iniciarExportacaoSchema>,
) {
  const lojaId = lojaDaEscrita(ctx);
  if (!(await contatoVivoDaLoja(tx, lojaId, dados.contatoId))) throw new ErroDeEscopo();
  await exigirProtocoloLivre(tx, lojaId, dados.protocolo);
  const agora = new Date();
  const linha = await inserirAuditado(
    tx,
    lgpd_solicitacoes,
    {
      loja_id: lojaId,
      contato_id: dados.contatoId,
      tipo: "acesso",
      protocolo: dados.protocolo,
      motivo: dados.motivo,
      solicitado_em: agora,
      executado_por: ctx.origem === "ui" ? ctx.autorId : null,
      executado_em: agora,
    },
    ctx,
    "lgpd_solicitacao_registrada",
  );
  await registrarAuditoria(tx, ctx, "lgpd_exportado", "contatos", dados.contatoId, {
    antes: null,
    depois: { protocolo: dados.protocolo },
  });
  return { solicitacaoId: String(linha.id), secoes: SECOES_DOSSIE };
}

/** Uma página de uma seção, só para a solicitação de acesso aberta e recente. */
export async function lerDossie(
  tx: Transacao,
  ctx: Contexto,
  dados: z.output<typeof lerDossieSchema>,
  agora: Date = new Date(),
) {
  const solicitacao = await lerSolicitacao(tx, ctx.escopo, dados.solicitacaoId);
  if (!solicitacao || solicitacao.tipo !== "acesso" || !solicitacao.executadoEm) {
    throw new ErroDeEscopo();
  }
  if (agora.getTime() - solicitacao.executadoEm.getTime() > VALIDADE_DA_EXPORTACAO_MS) {
    throw new ErroDeValidacao(
      { protocolo: ["Esta exportação expirou. Registre uma nova solicitação."] },
      undefined,
      "Esta exportação expirou. Registre uma nova solicitação.",
    );
  }
  return lerPaginaDoDossie(
    tx,
    { lojaId: solicitacao.lojaId, contatoId: solicitacao.contatoId },
    dados.secao,
    dados.cursor,
  );
}

/**
 * Pedido de CORREÇÃO (art. 18, III): registra a solicitação e o protocolo. A
 * correção em si sai pela edição normal do contato, com `contato_alterado`.
 */
export async function registrarSolicitacao(
  tx: Transacao,
  ctx: Contexto,
  dados: z.output<typeof registrarSolicitacaoSchema>,
) {
  const lojaId = lojaDaEscrita(ctx);
  if (!(await contatoVivoDaLoja(tx, lojaId, dados.contatoId))) throw new ErroDeEscopo();
  await exigirProtocoloLivre(tx, lojaId, dados.protocolo);
  const linha = await inserirAuditado(
    tx,
    lgpd_solicitacoes,
    {
      loja_id: lojaId,
      contato_id: dados.contatoId,
      tipo: dados.tipo,
      protocolo: dados.protocolo,
      motivo: dados.motivo,
      solicitado_em: new Date(),
    },
    ctx,
    "lgpd_solicitacao_registrada",
  );
  return { solicitacaoId: String(linha.id) };
}

/**
 * O binário sai FORA da transação (01-dados-dominio.md §8): chamar SÓ depois
 * do commit. `jobId` determinístico — reenfileirar a mesma solicitação não
 * duplica — e o job é idempotente (objeto ausente = sucesso).
 *
 * Redis fora do ar não desfaz a anonimização: a linha já está excluída e a
 * varredura de `limpar-midia` alcança o objeto no prazo dela (90 dias). Fica o
 * log de erro para alguém reenfileirar antes.
 */
export async function agendarLimpezaDeMidia(saida: SaidaAnonimizacao): Promise<string | null> {
  if (saida.midiaIds.length === 0) return null;
  const id = await enfileirar(
    "manutencao",
    "limpar-midia",
    { lojaId: saida.lojaId, solicitacaoId: saida.solicitacaoId, midiaIds: saida.midiaIds },
    { jobId: jobId("lgpd", saida.solicitacaoId) },
  );
  if (!id) {
    logger.error({ solicitacaoId: saida.solicitacaoId }, "limpeza de mídia LGPD não entrou na fila");
  }
  return id;
}

