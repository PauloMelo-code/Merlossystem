import "server-only";
import { and, asc, count, desc, eq, gte, ilike, lt, notInArray, or } from "drizzle-orm";
import type { EscopoLoja } from "@/lib/auth/loja";
import { decodificarCursor, fatia, montarPagina, type Direcao, type Pagina } from "@/lib/catalogo";
import { db } from "@/lib/db/client";
import { condicaoDeLoja, vivos, vivosE } from "@/lib/db/consultas";
import { STATUS_PEDIDO_SEM_RESERVA } from "@/lib/db/schema/_enums/pedidos";
import { auditoria_eventos } from "@/lib/db/schema/auditoria";
import { usuarios } from "@/lib/db/schema/auth/usuarios";
import { contatos } from "@/lib/db/schema/contatos";
import { lojas } from "@/lib/db/schema/lojas";
import { pedidos, pedidos_itens } from "@/lib/db/schema/pedidos";

/** Leituras de pedido. Toda consulta passa por `vivos()` e `condicaoDeLoja()`. */

/** O mesmo recorte do índice parcial `ix_pedidos_fila_masc`. */
export const naFilaDoMasc = () =>
  and(eq(pedidos.masc_status, "pendente"), notInArray(pedidos.status, [...STATUS_PEDIDO_SEM_RESERVA]));

export type FiltroDePedidos = {
  status?: string;
  masc?: string;
  /** `AAAA-MM-DD`, dia inteiro no fuso da loja (UTC−3; o Brasil não tem horário de verão desde 2019). */
  de?: string;
  ate?: string;
  numero?: string;
  cursor?: string;
  direcao?: Direcao;
  porPagina: number;
};

export type PedidoDaLista = {
  id: string;
  criadoEm: Date;
  numero: string;
  lojaNome: string;
  contatoNome: string | null;
  status: string;
  mascStatus: string;
  mascVendaId: string | null;
  total: string;
};

export async function paginaDePedidos(
  escopo: EscopoLoja,
  filtro: FiltroDePedidos,
): Promise<Pagina<PedidoDaLista>> {
  const chave = decodificarCursor(filtro.cursor);
  const direcao = filtro.direcao ?? "proxima";
  const { onde, ordem } = fatia({ criadoEm: pedidos.created_at, id: pedidos.id }, chave, direcao);
  const numero = filtro.numero?.trim();
  const ate = filtro.ate ? new Date(`${filtro.ate}T00:00:00-03:00`) : null;
  if (ate) ate.setUTCDate(ate.getUTCDate() + 1);

  const linhas = await db
    .select({
      id: pedidos.id,
      criadoEm: pedidos.created_at,
      numero: pedidos.numero,
      lojaNome: lojas.nome,
      contatoNome: contatos.nome,
      status: pedidos.status,
      mascStatus: pedidos.masc_status,
      mascVendaId: pedidos.masc_venda_id,
      total: pedidos.total,
    })
    .from(pedidos)
    .innerJoin(lojas, eq(lojas.id, pedidos.loja_id))
    .innerJoin(contatos, eq(contatos.id, pedidos.contato_id))
    .where(
      vivosE(
        pedidos,
        condicaoDeLoja(pedidos, escopo),
        filtro.masc === "fila" ? naFilaDoMasc() : undefined,
        filtro.masc && filtro.masc !== "fila" ? eq(pedidos.masc_status, filtro.masc) : undefined,
        filtro.status ? eq(pedidos.status, filtro.status) : undefined,
        filtro.de ? gte(pedidos.created_at, new Date(`${filtro.de}T00:00:00-03:00`)) : undefined,
        ate ? lt(pedidos.created_at, ate) : undefined,
        numero
          ? or(ilike(pedidos.numero, `${numero}%`), eq(pedidos.masc_venda_id, numero))
          : undefined,
        onde,
      ),
    )
    .orderBy(...ordem)
    .limit(filtro.porPagina + 1);

  return montarPagina(linhas, filtro.porPagina, chave, direcao);
}

/** Contador da fila "falta lançar no Masc" — usa o índice parcial. */
export async function contarFilaDoMasc(escopo: EscopoLoja): Promise<number> {
  const [linha] = await db
    .select({ total: count() })
    .from(pedidos)
    .where(vivosE(pedidos, condicaoDeLoja(pedidos, escopo), naFilaDoMasc()));
  return linha?.total ?? 0;
}

export type ItemDoPedido = {
  id: string;
  produtoId: string;
  sku: string | null;
  nome: string;
  tamanho: string;
  quantidade: number;
  precoUnitario: string;
  totalItem: string;
};

export type PedidoCompleto = {
  id: string;
  lojaId: string;
  lojaNome: string;
  contatoId: string;
  contatoNome: string | null;
  conversaId: string | null;
  numero: string;
  status: string;
  pagamentoStatus: string;
  subtotal: string;
  frete: string;
  desconto: string;
  total: string;
  formaPagamento: string | null;
  entregaMetodo: string | null;
  rastreioCodigo: string | null;
  rastreioUrl: string | null;
  observacoes: string | null;
  mascStatus: string;
  mascVendaId: string | null;
  mascLancadoEm: Date | null;
  mascLancadoPorNome: string | null;
  mascObservacao: string | null;
  canceladoEm: Date | null;
  canceladoMotivo: string | null;
  criadoEm: Date;
  atualizadoEm: Date;
  itens: ItemDoPedido[];
};

export async function pedidoPorId(escopo: EscopoLoja, id: string): Promise<PedidoCompleto | null> {
  const [linha] = await db
    .select({
      id: pedidos.id,
      lojaId: pedidos.loja_id,
      lojaNome: lojas.nome,
      contatoId: pedidos.contato_id,
      contatoNome: contatos.nome,
      conversaId: pedidos.conversa_id,
      numero: pedidos.numero,
      status: pedidos.status,
      pagamentoStatus: pedidos.pagamento_status,
      subtotal: pedidos.subtotal,
      frete: pedidos.frete,
      desconto: pedidos.desconto,
      total: pedidos.total,
      formaPagamento: pedidos.forma_pagamento,
      entregaMetodo: pedidos.entrega_metodo,
      rastreioCodigo: pedidos.rastreio_codigo,
      rastreioUrl: pedidos.rastreio_url,
      observacoes: pedidos.observacoes,
      mascStatus: pedidos.masc_status,
      mascVendaId: pedidos.masc_venda_id,
      mascLancadoEm: pedidos.masc_lancado_em,
      mascLancadoPorNome: usuarios.nome,
      mascObservacao: pedidos.masc_observacao,
      canceladoEm: pedidos.cancelado_em,
      canceladoMotivo: pedidos.cancelado_motivo,
      criadoEm: pedidos.created_at,
      atualizadoEm: pedidos.updated_at,
    })
    .from(pedidos)
    .innerJoin(lojas, eq(lojas.id, pedidos.loja_id))
    .innerJoin(contatos, eq(contatos.id, pedidos.contato_id))
    .leftJoin(usuarios, eq(usuarios.id, pedidos.masc_lancado_por))
    .where(vivosE(pedidos, eq(pedidos.id, id), condicaoDeLoja(pedidos, escopo)))
    .limit(1);
  if (!linha) return null;

  const itens = await db
    .select({
      id: pedidos_itens.id,
      produtoId: pedidos_itens.produto_id,
      sku: pedidos_itens.sku,
      nome: pedidos_itens.nome,
      tamanho: pedidos_itens.tamanho,
      quantidade: pedidos_itens.quantidade,
      precoUnitario: pedidos_itens.preco_unitario,
      totalItem: pedidos_itens.total_item,
    })
    .from(pedidos_itens)
    .where(vivosE(pedidos_itens, eq(pedidos_itens.pedido_id, id)))
    .orderBy(asc(pedidos_itens.created_at), asc(pedidos_itens.id));

  return { ...linha, itens };
}

export type EventoDoPedido = {
  id: string;
  criadoEm: Date;
  acao: string;
  atorNome: string | null;
  atorTipo: string;
  depois: Record<string, unknown> | null;
};

/** Linha do tempo: `auditoria_eventos` por `(entidade = 'pedidos', entidade_id)`. */
export async function linhaDoTempo(pedidoId: string): Promise<EventoDoPedido[]> {
  return db
    .select({
      id: auditoria_eventos.id,
      criadoEm: auditoria_eventos.criado_em,
      acao: auditoria_eventos.acao,
      atorNome: usuarios.nome,
      atorTipo: auditoria_eventos.ator_tipo,
      depois: auditoria_eventos.depois,
    })
    .from(auditoria_eventos)
    .leftJoin(usuarios, eq(usuarios.id, auditoria_eventos.ator_id))
    .where(and(eq(auditoria_eventos.entidade, "pedidos"), eq(auditoria_eventos.entidade_id, pedidoId)))
    .orderBy(desc(auditoria_eventos.criado_em), desc(auditoria_eventos.id))
    .limit(100);
}

/** Pedidos do contato, para o painel da conversa. */
export async function pedidosDoContato(
  escopo: EscopoLoja,
  contatoId: string,
): Promise<PedidoDaLista[]> {
  return db
    .select({
      id: pedidos.id,
      criadoEm: pedidos.created_at,
      numero: pedidos.numero,
      lojaNome: lojas.nome,
      contatoNome: contatos.nome,
      status: pedidos.status,
      mascStatus: pedidos.masc_status,
      mascVendaId: pedidos.masc_venda_id,
      total: pedidos.total,
    })
    .from(pedidos)
    .innerJoin(lojas, eq(lojas.id, pedidos.loja_id))
    .innerJoin(contatos, eq(contatos.id, pedidos.contato_id))
    .where(vivosE(pedidos, eq(pedidos.contato_id, contatoId), condicaoDeLoja(pedidos, escopo), vivos(contatos)))
    .orderBy(desc(pedidos.created_at))
    .limit(10);
}

export async function nomeDaLoja(lojaId: string): Promise<string | null> {
  const [linha] = await db
    .select({ nome: lojas.nome })
    .from(lojas)
    .where(vivosE(lojas, eq(lojas.id, lojaId)))
    .limit(1);
  return linha?.nome ?? null;
}
