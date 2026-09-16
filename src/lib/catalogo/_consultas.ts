import "server-only";
import { and, asc, desc, eq, ilike, inArray, notInArray, or } from "drizzle-orm";
import type { EscopoLoja } from "@/lib/auth/loja";
import { db } from "@/lib/db/client";
import { condicaoDeLoja, vivos, vivosE } from "@/lib/db/consultas";
import { STATUS_PEDIDO_SEM_RESERVA } from "@/lib/db/schema/_enums/pedidos";
import { produtos, produtos_variacoes } from "@/lib/db/schema/catalogo";
import { lojas } from "@/lib/db/schema/lojas";
import { pedidos, pedidos_itens } from "@/lib/db/schema/pedidos";
import { decodificarCursor, fatia, montarPagina, type Direcao, type Pagina } from "./_cursor";
import { tamanhosDaGrade, type ItemReservavel } from "./_regras";

/**
 * Leituras do catálogo. Toda consulta passa por `vivos()` e, quando a tabela
 * tem loja, por `condicaoDeLoja()`.
 */

/** Escapa `%` e `_` do termo digitado: busca é por texto, não por padrão. */
export function termoLike(termo: string): string {
  return termo.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export type ProdutoDaLista = {
  id: string;
  criadoEm: Date;
  lojaId: string;
  lojaNome: string;
  nome: string;
  sku: string | null;
  preco: string;
  sincronizadoEm: Date | null;
  blingProdutoId: string | null;
};

export async function paginaDeProdutos(
  escopo: EscopoLoja,
  filtro: { termo?: string; cursor?: string; direcao?: Direcao; porPagina: number },
): Promise<Pagina<ProdutoDaLista>> {
  const chave = decodificarCursor(filtro.cursor);
  const direcao = filtro.direcao ?? "proxima";
  const { onde, ordem } = fatia({ criadoEm: produtos.created_at, id: produtos.id }, chave, direcao);
  const termo = filtro.termo?.trim();
  const busca = termo
    ? or(ilike(produtos.nome, `%${termoLike(termo)}%`), ilike(produtos.sku, `${termoLike(termo)}%`))
    : undefined;

  const linhas = await db
    .select({
      id: produtos.id,
      criadoEm: produtos.created_at,
      lojaId: produtos.loja_id,
      lojaNome: lojas.nome,
      nome: produtos.nome,
      sku: produtos.sku,
      preco: produtos.preco,
      sincronizadoEm: produtos.sincronizado_em,
      blingProdutoId: produtos.bling_produto_id,
    })
    .from(produtos)
    .innerJoin(lojas, eq(lojas.id, produtos.loja_id))
    .where(vivosE(produtos, condicaoDeLoja(produtos, escopo), busca, onde))
    .orderBy(...ordem)
    .limit(filtro.porPagina + 1);

  return montarPagina(linhas, filtro.porPagina, chave, direcao);
}

export type VariacaoDoProduto = {
  id: string;
  tamanho: string;
  sku: string | null;
  blingProdutoId: string | null;
};

export type ProdutoCompleto = {
  id: string;
  lojaId: string;
  lojaNome: string;
  depositoId: string | null;
  nome: string;
  sku: string | null;
  descricao: string | null;
  tipoGrade: string;
  preco: string;
  precoComparacao: string | null;
  precoCusto: string | null;
  pesoGramas: number | null;
  blingProdutoId: string | null;
  sincronizadoEm: Date | null;
  variacoes: VariacaoDoProduto[];
};

async function carregarProduto(onde: ReturnType<typeof and>): Promise<ProdutoCompleto | null> {
  const [linha] = await db
    .select({
      id: produtos.id,
      lojaId: produtos.loja_id,
      lojaNome: lojas.nome,
      depositoId: lojas.bling_deposito_id,
      nome: produtos.nome,
      sku: produtos.sku,
      descricao: produtos.descricao,
      tipoGrade: produtos.tipo_grade,
      preco: produtos.preco,
      precoComparacao: produtos.preco_comparacao,
      precoCusto: produtos.preco_custo,
      pesoGramas: produtos.peso_gramas,
      blingProdutoId: produtos.bling_produto_id,
      sincronizadoEm: produtos.sincronizado_em,
    })
    .from(produtos)
    .innerJoin(lojas, eq(lojas.id, produtos.loja_id))
    .where(and(onde, vivos(lojas)))
    .limit(1);
  if (!linha) return null;

  const variacoes = await db
    .select({
      id: produtos_variacoes.id,
      tamanho: produtos_variacoes.tamanho,
      sku: produtos_variacoes.sku,
      blingProdutoId: produtos_variacoes.bling_produto_id,
    })
    .from(produtos_variacoes)
    .where(vivosE(produtos_variacoes, eq(produtos_variacoes.produto_id, linha.id)))
    .orderBy(asc(produtos_variacoes.created_at));

  // A grade tem ordem própria (PP → GG → 46 → 58); `created_at` empata em lote.
  const ordem = tamanhosDaGrade("ambos");
  variacoes.sort((a, b) => ordem.indexOf(a.tamanho) - ordem.indexOf(b.tamanho));
  return { ...linha, variacoes };
}

/**
 * `preco_custo` sai do DTO quando `verCusto` é falso (`produtos:ver_custo`,
 * só dono, admin e gerente). Quem decide é a action, pelo papel da sessão.
 */
export async function produtoPorId(
  escopo: EscopoLoja,
  id: string,
  verCusto: boolean,
): Promise<ProdutoCompleto | null> {
  const produto = await carregarProduto(
    vivosE(produtos, eq(produtos.id, id), condicaoDeLoja(produtos, escopo)),
  );
  return produto && !verCusto ? { ...produto, precoCusto: null } : produto;
}

export async function produtoPorSku(
  lojaId: string,
  sku: string,
  verCusto: boolean,
): Promise<ProdutoCompleto | null> {
  const produto = await carregarProduto(
    vivosE(produtos, eq(produtos.loja_id, lojaId), eq(produtos.sku, sku)),
  );
  return produto && !verCusto ? { ...produto, precoCusto: null } : produto;
}

export type ResultadoDeBusca = { id: string; nome: string; sku: string; preco: string };

/** Busca do seletor de produto: nome contém, SKU começa com. Até 10. */
export async function buscarProdutos(lojaId: string, termo: string): Promise<ResultadoDeBusca[]> {
  const t = termoLike(termo.trim());
  const linhas = await db
    .select({ id: produtos.id, nome: produtos.nome, sku: produtos.sku, preco: produtos.preco })
    .from(produtos)
    .where(
      vivosE(
        produtos,
        eq(produtos.loja_id, lojaId),
        or(ilike(produtos.nome, `%${t}%`), ilike(produtos.sku, `${t}%`)),
      ),
    )
    .orderBy(asc(produtos.nome))
    .limit(10);
  return linhas.flatMap((l) => (l.sku ? [{ ...l, sku: l.sku }] : []));
}

/**
 * Itens candidatos à reserva dos SKUs pedidos. O `where` já recorta pelo
 * mesmo filtro do índice parcial da fila do Masc; a regra final é a função
 * pura `itemReserva()`, que o teste de unidade prova.
 */
export async function itensReservaveis(
  lojaId: string,
  skus: readonly string[],
): Promise<ItemReservavel[]> {
  if (skus.length === 0) return [];
  return db
    .select({
      sku: pedidos_itens.sku,
      quantidade: pedidos_itens.quantidade,
      status: pedidos.status,
      mascStatus: pedidos.masc_status,
    })
    .from(pedidos_itens)
    .innerJoin(pedidos, eq(pedidos.id, pedidos_itens.pedido_id))
    .where(
      and(
        vivos(pedidos_itens),
        vivos(pedidos),
        eq(pedidos.loja_id, lojaId),
        eq(pedidos.masc_status, "pendente"),
        notInArray(pedidos.status, [...STATUS_PEDIDO_SEM_RESERVA]),
        inArray(pedidos_itens.sku, [...skus]),
      ),
    );
}

export type AlvoDeSaldo = { sku: string; blingId: string | null };

/**
 * Para cada SKU, o id do Bling de onde vem o saldo: variação primeiro (a
 * reserva é por tamanho), produto quando a variação não tem SKU.
 */
export async function alvosDeSaldo(
  lojaId: string,
  skus: readonly string[],
): Promise<{ depositoId: string | null; alvos: Map<string, AlvoDeSaldo> }> {
  const alvos = new Map<string, AlvoDeSaldo>();
  if (skus.length === 0) return { depositoId: null, alvos };
  const lista = [...skus];
  const [loja, doProduto, daVariacao] = await Promise.all([
    db
      .select({ depositoId: lojas.bling_deposito_id })
      .from(lojas)
      .where(vivosE(lojas, eq(lojas.id, lojaId)))
      .limit(1),
    db
      .select({ sku: produtos.sku, blingId: produtos.bling_produto_id })
      .from(produtos)
      .where(vivosE(produtos, eq(produtos.loja_id, lojaId), inArray(produtos.sku, lista))),
    db
      .select({ sku: produtos_variacoes.sku, blingId: produtos_variacoes.bling_produto_id })
      .from(produtos_variacoes)
      .where(
        vivosE(
          produtos_variacoes,
          eq(produtos_variacoes.loja_id, lojaId),
          inArray(produtos_variacoes.sku, lista),
        ),
      ),
  ]);
  for (const linha of [...doProduto, ...daVariacao]) {
    if (linha.sku) alvos.set(linha.sku, { sku: linha.sku, blingId: linha.blingId });
  }
  return { depositoId: loja[0]?.depositoId ?? null, alvos };
}

export type VendaDoProduto = {
  pedidoId: string;
  numero: string;
  tamanho: string;
  quantidade: number;
  status: string;
  criadoEm: Date;
};

/** "Onde foi vendido": os últimos 10 pedidos com este produto. */
export async function ultimasVendas(escopo: EscopoLoja, produtoId: string): Promise<VendaDoProduto[]> {
  return db
    .select({
      pedidoId: pedidos.id,
      numero: pedidos.numero,
      tamanho: pedidos_itens.tamanho,
      quantidade: pedidos_itens.quantidade,
      status: pedidos.status,
      criadoEm: pedidos.created_at,
    })
    .from(pedidos_itens)
    .innerJoin(pedidos, eq(pedidos.id, pedidos_itens.pedido_id))
    .where(
      vivosE(
        pedidos_itens,
        vivos(pedidos),
        eq(pedidos_itens.produto_id, produtoId),
        condicaoDeLoja(pedidos, escopo),
      ),
    )
    .orderBy(desc(pedidos.created_at))
    .limit(10);
}
