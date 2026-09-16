import "server-only";
import { eq } from "drizzle-orm";
import { vivosE } from "@/lib/db/consultas";
import {
  anonimizarTitular,
  atualizarComTrava,
  inserirAuditado,
  registrarAuditoria,
  type ContextoDeGravacao,
  type Transacao,
} from "@/lib/db/mutacoes";
import { contatos } from "@/lib/db/schema/contatos";
import type { ResultadoLgpd } from "@/lib/db/schema/lgpd";
import { lgpd_solicitacoes } from "@/lib/db/schema/lgpd";
import { ErroDeEscopo, ErroDeValidacao } from "@/lib/erros";
import { protocoloEmUso } from "./_consultas";

/**
 * Anonimização do titular (01-dados-dominio.md §8, ADR 0013 e ADR 0033) — a
 * eliminação do art. 18, VI, em TRANSAÇÃO ÚNICA, nunca `DELETE`.
 *
 * A ordem é a do documento e não muda:
 *   1. trilha `lgpd_anonimizado` ANTES do efeito, sem PII (o efeito destrói o
 *      estado anterior; trilha depois seria trilha nenhuma);
 *   2. `contatos` sem identidade, pela trava de colisão;
 *   3. os depósitos em lote, por `anonimizarTitular()` da fundação: mensagens
 *      com o MARCADOR (nunca `NULL`), prévia da lista, legendas, transcrições,
 *      comentário de pesquisa, agendamentos (os pendentes são cancelados),
 *      observação e endereço do pedido, e as mídias recebidas (excluídas, sem
 *      `nome_original`; o binário sai DEPOIS do commit, pelo job `limpar-midia`);
 *   4. a solicitação com a contagem por tabela.
 * O pedido, os itens e os pagamentos PERMANECEM (a venda de verdade mora no Masc).
 */

export const MARCADOR = "[removido a pedido do titular]";
export const NOME_ANONIMO = "Titular anonimizado";

export type EntradaAnonimizacao = {
  contatoId: string;
  updatedAt: Date;
  protocolo: string;
  motivo: string;
};

export type SaidaAnonimizacao = {
  solicitacaoId: string;
  lojaId: string;
  midiaIds: string[];
  resultado: ResultadoLgpd;
};

export async function anonimizarContato(
  tx: Transacao,
  ctx: ContextoDeGravacao,
  entrada: EntradaAnonimizacao,
): Promise<SaidaAnonimizacao> {
  if (ctx.escopo.tipo !== "uma") throw new ErroDeEscopo();
  const lojaId = ctx.escopo.lojaId;
  const { contatoId } = entrada;

  const [contato] = await tx
    .select({ id: contatos.id, anonimizadoEm: contatos.anonimizado_em })
    .from(contatos)
    .where(vivosE(contatos, eq(contatos.id, contatoId), eq(contatos.loja_id, lojaId)))
    .for("update");
  if (!contato) throw new ErroDeEscopo();
  if (contato.anonimizadoEm) {
    throw new ErroDeValidacao({ protocolo: ["Os dados deste contato já foram eliminados."] });
  }
  if (await protocoloEmUso(tx, lojaId, entrada.protocolo)) {
    throw new ErroDeValidacao({ protocolo: ["Este protocolo já foi usado nesta loja."] });
  }

  // 1. Trilha ANTES do efeito, na mesma transação (fail-closed). Sem motivo:
  //    texto livre pode carregar o nome do titular.
  await registrarAuditoria(tx, ctx, "lgpd_anonimizado", "contatos", contatoId, {
    antes: null,
    depois: { protocolo: entrada.protocolo },
  });

  const agora = new Date();

  // 2. Identidade. A trava de colisão usa a versão que a tela mostrou.
  await atualizarComTrava(
    tx,
    contatos,
    {
      id: contatoId,
      escopo: ctx.escopo,
      updatedAtOriginal: entrada.updatedAt,
      dados: {
        nome: NOME_ANONIMO,
        telefone: null,
        email: null,
        whatsapp_id: null,
        instagram_id: null,
        facebook_id: null,
        tiktok_id: null,
        avatar_url: null,
        observacoes: null,
        endereco: null,
        aniversario: null,
        anonimizado_em: agora,
      },
    },
    ctx,
    "contato_alterado",
  );

  // 3. Os depósitos em lote. Alcança também linhas já excluídas.
  const { tabelas, midiaIds } = await anonimizarTitular(tx, ctx, {
    lojaId,
    contatoId,
    marcador: MARCADOR,
    agora,
  });

  // 4. A solicitação, com a contagem. `objetos_removidos` é do job
  //    (`registrarObjetosRemovidos`, depois do commit).
  const resultado: ResultadoLgpd = {
    tabelas: { contatos: 1, ...tabelas },
    objetos_removidos: 0,
    concluido_em: agora.toISOString(),
  };
  const solicitacao = await inserirAuditado(
    tx,
    lgpd_solicitacoes,
    {
      loja_id: lojaId,
      contato_id: contatoId,
      tipo: "eliminacao",
      protocolo: entrada.protocolo,
      motivo: entrada.motivo,
      solicitado_em: agora,
      executado_por: ctx.origem === "ui" ? ctx.autorId : null,
      executado_em: agora,
      resultado,
    },
    ctx,
    "lgpd_solicitacao_registrada",
  );

  return { solicitacaoId: String(solicitacao.id), lojaId, midiaIds, resultado };
}
