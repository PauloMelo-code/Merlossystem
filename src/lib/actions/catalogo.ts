"use server";

import type { z } from "zod";
import { executarAcao } from "@/lib/actions/_base";
import { pode } from "@/lib/auth/guard";
import {
  buscarProdutos,
  calcularDisponiveis,
  paginaDeProdutos,
  produtoPorId,
  produtoPorSku,
  ultimaSincronizacao,
  ultimasVendas,
  type Disponibilidade,
  type Pagina,
  type ProdutoCompleto,
  type ProdutoDaLista,
  type ResultadoDeBusca,
  type VendaDoProduto,
} from "@/lib/catalogo";
import { ErroDeEscopo, type Resultado } from "@/lib/erros";
import {
  buscaDeProdutoSchema,
  filtroDeProdutosSchema,
  idDeProdutoSchema,
  produtoPorSkuSchema,
} from "@/lib/validadores/catalogo";

/**
 * Actions do catálogo — TODAS de leitura (`produtos:ler`). Não existe action
 * de criar, editar ou excluir produto: quem grava é o job `sincronizar-bling`.
 *
 * As telas leem por aqui (03-arquitetura.md §4.1: página não importa domínio),
 * e cada leitura reaplica o portão.
 */

export type LinhaDeProduto = ProdutoDaLista & { disponivel: Disponibilidade | null };
export type ListaDeProdutos = Pagina<LinhaDeProduto> & {
  lojaEscolhida: boolean;
  ultimaLeitura: Date | null;
};

export async function listarProdutos(
  filtro: z.input<typeof filtroDeProdutosSchema>,
): Promise<Resultado<ListaDeProdutos>> {
  return executarAcao(
    {
      permissao: "produtos:ler",
      entrada: filtroDeProdutosSchema,
      loja: "le",
      executar: async (dados, ctx) => {
        const pagina = await paginaDeProdutos(ctx.escopo, {
          ...(dados.q ? { termo: dados.q } : {}),
          ...(dados.cursor ? { cursor: dados.cursor } : {}),
          ...(dados.direcao ? { direcao: dados.direcao } : {}),
          porPagina: dados.porPagina,
        });
        // Saldo só com UMA loja: o depósito é da loja. "Todas" mostra a lista
        // sem saldo e pede para escolher — nunca soma depósitos diferentes.
        const escopo = ctx.escopo;
        const disponiveis =
          escopo.tipo === "uma"
            ? await calcularDisponiveis(
                escopo.lojaId,
                pagina.itens.flatMap((p) => (p.sku ? [p.sku] : [])),
              )
            : new Map<string, Disponibilidade>();
        return {
          ...pagina,
          itens: pagina.itens.map((p) => ({
            ...p,
            disponivel: (p.sku && disponiveis.get(p.sku)) || null,
          })),
          lojaEscolhida: escopo.tipo === "uma",
          ultimaLeitura: await ultimaSincronizacao(),
        };
      },
    },
    filtro,
  );
}

export type FichaDeProduto = {
  produto: ProdutoCompleto;
  /** Por SKU (da variação ou, sem ela, do produto). */
  disponiveis: Record<string, Disponibilidade>;
  vendas: VendaDoProduto[];
  verCusto: boolean;
};

export async function verProduto(bruto: { id: string }): Promise<Resultado<FichaDeProduto>> {
  return executarAcao(
    {
      permissao: "produtos:ler",
      entrada: idDeProdutoSchema,
      loja: "le",
      executar: async (dados, ctx) => {
        const verCusto = pode(ctx.sessao.papel, "produtos", "ver_custo");
        const produto = await produtoPorId(ctx.escopo, dados.id, verCusto);
        if (!produto) throw new ErroDeEscopo("Produto não encontrado.");
        const skus = produto.variacoes.map((v) => v.sku ?? produto.sku).filter((s): s is string => !!s);
        const [mapa, vendas] = await Promise.all([
          calcularDisponiveis(produto.lojaId, skus),
          ultimasVendas(ctx.escopo, produto.id),
        ]);
        return { produto, disponiveis: Object.fromEntries(mapa), vendas, verCusto };
      },
    },
    bruto,
  );
}

/** Seletor de produto da conversa: nome contém ou SKU começa com. */
export async function buscarProdutosParaVenda(bruto: {
  termo: string;
  loja?: string;
}): Promise<Resultado<ResultadoDeBusca[]>> {
  return executarAcao(
    {
      permissao: "produtos:ler",
      entrada: buscaDeProdutoSchema,
      loja: "grava",
      executar: async (dados, ctx) =>
        ctx.escopo.tipo === "uma" ? buscarProdutos(ctx.escopo.lojaId, dados.termo) : [],
    },
    bruto,
  );
}

export type ProdutoParaVenda = {
  id: string;
  nome: string;
  sku: string | null;
  preco: string;
  variacoes: {
    id: string;
    tamanho: string;
    sku: string | null;
    disponivel: Disponibilidade | null;
  }[];
};

/** Tamanhos e disponibilidade do produto escolhido. Preço é o do servidor. */
export async function produtoParaVenda(bruto: {
  sku: string;
  loja?: string;
}): Promise<Resultado<ProdutoParaVenda>> {
  return executarAcao(
    {
      permissao: "produtos:ler",
      entrada: produtoPorSkuSchema,
      loja: "grava",
      executar: async (dados, ctx) => {
        if (ctx.escopo.tipo !== "uma") throw new ErroDeEscopo();
        const produto = await produtoPorSku(ctx.escopo.lojaId, dados.sku, false);
        if (!produto) throw new ErroDeEscopo("Produto não encontrado nesta loja.");
        const skus = produto.variacoes.map((v) => v.sku ?? produto.sku).filter((s): s is string => !!s);
        const mapa = await calcularDisponiveis(produto.lojaId, skus);
        return {
          id: produto.id,
          nome: produto.nome,
          sku: produto.sku,
          preco: produto.preco,
          variacoes: produto.variacoes.map((v) => {
            const sku = v.sku ?? produto.sku;
            return { id: v.id, tamanho: v.tamanho, sku: v.sku, disponivel: (sku && mapa.get(sku)) || null };
          }),
        };
      },
    },
    bruto,
  );
}
