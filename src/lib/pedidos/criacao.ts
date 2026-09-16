import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { Contexto } from "@/lib/auth/guard";
import { vivos, vivosE } from "@/lib/db/consultas";
import {
  atualizarComTrava,
  atualizarContador,
  inserirAuditado,
  proximoNumeroDePedido,
  type Transacao,
} from "@/lib/db/mutacoes";
import { produtos, produtos_variacoes } from "@/lib/db/schema/catalogo";
import { contatos } from "@/lib/db/schema/contatos";
import { conversas } from "@/lib/db/schema/conversas/conversas";
import { lojas } from "@/lib/db/schema/lojas";
import { negocios } from "@/lib/db/schema/negocios";
import { pedidos, pedidos_itens } from "@/lib/db/schema/pedidos";
import { ErroDeEscopo, ErroDeValidacao } from "@/lib/erros";
import { paraCentavos } from "@/lib/formato";
import type { NovoPedido } from "@/lib/validadores/pedidos";
import { anoMesDaVenda, calcularTotais, descontoCabe, numeroDoPedido } from "./_regras";

/**
 * "Fechar venda" (04-ui.md §5.2, 01-dados-dominio.md §6.2–§6.4).
 *
 * Tudo numa transação: número atômico, pedido, itens, negócio para `ganho` e
 * contadores do contato. Se qualquer passo falha, NADA fica — inclusive o
 * número, que volta com o rollback e por isso a numeração não tem buraco.
 *
 * Preço e nome vêm do CATÁLOGO, no servidor (02/O-01). O cliente manda só a
 * variação e a quantidade.
 */

export type PedidoCriado = { id: string; numero: string; total: string };

function lojaDo(ctx: Contexto): string {
  if (ctx.escopo.tipo !== "uma") throw new ErroDeEscopo();
  return ctx.escopo.lojaId;
}

async function conferirVinculos(tx: Transacao, lojaId: string, dados: NovoPedido) {
  const [contato] = await tx
    .select({ id: contatos.id })
    .from(contatos)
    .where(vivosE(contatos, eq(contatos.id, dados.contatoId), eq(contatos.loja_id, lojaId)))
    .limit(1);
  if (!contato) throw new ErroDeEscopo("Contato não encontrado nesta loja.");

  if (dados.conversaId) {
    const [conversa] = await tx
      .select({ id: conversas.id })
      .from(conversas)
      .where(
        vivosE(
          conversas,
          eq(conversas.id, dados.conversaId),
          eq(conversas.loja_id, lojaId),
          eq(conversas.contato_id, dados.contatoId),
        ),
      )
      .limit(1);
    if (!conversa) throw new ErroDeEscopo("Conversa não encontrada nesta loja.");
  }

  if (!dados.negocioId) return null;
  const [negocio] = await tx
    .select({ id: negocios.id, estagio: negocios.estagio, updatedAt: negocios.updated_at })
    .from(negocios)
    .where(
      vivosE(
        negocios,
        eq(negocios.id, dados.negocioId),
        eq(negocios.loja_id, lojaId),
        eq(negocios.contato_id, dados.contatoId),
      ),
    )
    .limit(1);
  if (!negocio) throw new ErroDeEscopo("Negócio não encontrado nesta loja.");
  return negocio;
}

async function carregarItens(tx: Transacao, lojaId: string, dados: NovoPedido) {
  const ids = [...new Set(dados.itens.map((i) => i.variacaoId))];
  const linhas = await tx
    .select({
      variacaoId: produtos_variacoes.id,
      tamanho: produtos_variacoes.tamanho,
      skuVariacao: produtos_variacoes.sku,
      produtoId: produtos.id,
      skuProduto: produtos.sku,
      nome: produtos.nome,
      preco: produtos.preco,
    })
    .from(produtos_variacoes)
    .innerJoin(produtos, eq(produtos.id, produtos_variacoes.produto_id))
    .where(
      and(
        vivos(produtos_variacoes),
        vivos(produtos),
        eq(produtos_variacoes.loja_id, lojaId),
        eq(produtos.loja_id, lojaId),
        inArray(produtos_variacoes.id, ids),
      ),
    );
  const porId = new Map(linhas.map((l) => [l.variacaoId, l]));
  return dados.itens.map((item, indice) => {
    const linha = porId.get(item.variacaoId);
    if (!linha) {
      throw new ErroDeValidacao({
        [`itens.${indice}.variacaoId`]: ["Este produto não está mais no catálogo desta loja."],
      });
    }
    return { ...linha, quantidade: item.quantidade };
  });
}

export async function criarPedido(
  dados: NovoPedido,
  ctx: Contexto,
  tx: Transacao,
): Promise<PedidoCriado> {
  const lojaId = lojaDo(ctx);
  const negocio = await conferirVinculos(tx, lojaId, dados);
  const itens = await carregarItens(tx, lojaId, dados);

  const totais = calcularTotais(
    itens.map((i) => ({ precoUnitario: i.preco, quantidade: i.quantidade })),
    dados.frete,
    dados.desconto,
  );
  if (!descontoCabe(totais.subtotal, dados.desconto)) {
    throw new ErroDeValidacao({ desconto: ["O desconto não pode passar do valor dos produtos."] });
  }

  const [loja] = await tx
    .select({ sigla: lojas.sigla })
    .from(lojas)
    .where(vivosE(lojas, eq(lojas.id, lojaId)))
    .limit(1);
  if (!loja) throw new ErroDeEscopo();

  const agora = new Date();
  const anoMes = anoMesDaVenda(agora);
  const numero = numeroDoPedido(anoMes, loja.sigla, await proximoNumeroDePedido(tx, lojaId, anoMes));

  const pedido = await inserirAuditado(
    tx,
    pedidos,
    {
      loja_id: lojaId,
      contato_id: dados.contatoId,
      conversa_id: dados.conversaId ?? null,
      negocio_id: dados.negocioId ?? null,
      numero,
      status: "confirmado",
      masc_status: "pendente",
      subtotal: totais.subtotal,
      frete: dados.frete,
      desconto: dados.desconto,
      total: totais.total,
      forma_pagamento: dados.formaPagamento ?? null,
      entrega_metodo: dados.entregaMetodo ?? null,
      observacoes: dados.observacoes ?? null,
      criado_por: ctx.autorId,
    },
    ctx,
    "pedido_criado",
  );
  const pedidoId = String(pedido.id);

  for (const [indice, item] of itens.entries()) {
    await inserirAuditado(
      tx,
      pedidos_itens,
      {
        loja_id: lojaId,
        pedido_id: pedidoId,
        produto_id: item.produtoId,
        variacao_id: item.variacaoId,
        // Sem SKU por tamanho, a reserva degrada para o SKU do produto.
        sku: item.skuVariacao ?? item.skuProduto,
        nome: item.nome,
        tamanho: item.tamanho,
        quantidade: item.quantidade,
        preco_unitario: item.preco,
        total_item: totais.itens[indice]!,
      },
      ctx,
      "pedido_criado",
    );
  }

  // 02/RN-DL5 + 06/INV-100: pedido com negócio move o negócio para `ganho`
  // na MESMA transação, mesmo com o funil fora do R1.
  if (negocio && negocio.estagio !== "ganho") {
    await atualizarComTrava(
      tx,
      negocios,
      {
        id: negocio.id,
        escopo: ctx.escopo,
        updatedAtOriginal: negocio.updatedAt,
        dados: { estagio: "ganho" },
      },
      ctx,
      "negocio_estagio_alterado",
    );
  }
  if (negocio) {
    await atualizarContador(tx, negocios, { id: negocio.id, escopo: ctx.escopo }, { ultima_atividade_em: agora });
  }

  await atualizarContador(
    tx,
    contatos,
    { id: dados.contatoId, escopo: ctx.escopo },
    {
      pedidos_contagem: 1,
      pedidos_valor_total: paraCentavos(totais.total) / 100,
      ultima_compra_em: agora,
    },
  );

  return { id: pedidoId, numero, total: totais.total };
}
