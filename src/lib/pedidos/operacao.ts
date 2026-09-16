import "server-only";
import { eq } from "drizzle-orm";
import type { Contexto } from "@/lib/auth/guard";
import { condicaoDeLoja, vivosE } from "@/lib/db/consultas";
import {
  atualizarComTrava,
  atualizarContador,
  type OpcoesDeTrava,
  type Transacao,
} from "@/lib/db/mutacoes";
import { contatos } from "@/lib/db/schema/contatos";
import { pedidos } from "@/lib/db/schema/pedidos";
import { ErroDeEscopo, ErroDeValidacao } from "@/lib/erros";
import { paraCentavos } from "@/lib/formato";
import type {
  AlterarStatus,
  AlvoDePedido,
  CancelarPedido,
  DispensarDoMasc,
  InformarRastreio,
  LancarNoMasc,
} from "@/lib/validadores/pedidos";
import { pedidoEncerrado } from "./_regras";

/**
 * Operação do pedido: ponte MANUAL com o Masc, status, rastreio e
 * cancelamento. Toda escrita passa por `atualizarComTrava()` com o
 * `updated_at` que a tela levou — duas pessoas na mesma fila não se atropelam.
 *
 * O sistema NÃO escreve no Masc: não há API (docs/integracoes.md). A ponte é
 * alguém lançar a venda lá e anotar o número aqui.
 */

export type Versao = { id: string; atualizadoEm: Date };

async function carregar(tx: Transacao, ctx: Contexto, id: string) {
  const [linha] = await tx
    .select({
      id: pedidos.id,
      status: pedidos.status,
      mascStatus: pedidos.masc_status,
      total: pedidos.total,
      contatoId: pedidos.contato_id,
    })
    .from(pedidos)
    .where(vivosE(pedidos, eq(pedidos.id, id), condicaoDeLoja(pedidos, ctx.escopo)))
    .limit(1);
  if (!linha) throw new ErroDeEscopo("Pedido não encontrado.");
  return linha;
}

function recusar(campo: string, mensagem: string): never {
  throw new ErroDeValidacao({ [campo]: [mensagem] }, undefined, mensagem);
}

function ehVendaRepetida(erro: unknown): boolean {
  for (let atual: unknown = erro; atual; atual = (atual as { cause?: unknown }).cause) {
    const e = atual as { code?: string; constraint?: string };
    if (e.code === "23505" && e.constraint === "uq_pedidos_masc_venda") return true;
  }
  return false;
}

async function gravar(
  tx: Transacao,
  ctx: Contexto,
  alvo: AlvoDePedido,
  dados: Record<string, unknown>,
  acao: Parameters<typeof atualizarComTrava>[4],
  opcoes: OpcoesDeTrava = {},
): Promise<Versao> {
  const linha = await atualizarComTrava(
    tx,
    pedidos,
    { id: alvo.id, escopo: ctx.escopo, updatedAtOriginal: alvo.updatedAt, dados },
    ctx,
    acao,
    opcoes,
  );
  return { id: alvo.id, atualizadoEm: linha.updated_at as Date };
}

/** "Marcar como lançado no Masc" — número da venda obrigatório e único na loja. */
export async function registrarLancamentoMasc(
  dados: LancarNoMasc,
  ctx: Contexto,
  tx: Transacao,
): Promise<Versao> {
  const atual = await carregar(tx, ctx, dados.id);
  if (pedidoEncerrado(atual.status)) recusar("mascVendaId", "Pedido cancelado ou devolvido não vai para o Masc.");
  if (atual.mascStatus === "lancado") recusar("mascVendaId", "Este pedido já foi lançado no Masc.");
  try {
    // Savepoint: a violação de único aborta só este passo e vira mensagem.
    return await tx.transaction((sp) =>
      gravar(
        sp,
        ctx,
        dados,
        {
          masc_status: "lancado",
          masc_venda_id: dados.mascVendaId,
          masc_lancado_em: new Date(),
          masc_lancado_por: ctx.autorId,
        },
        "pedido_lancado_masc",
      ),
    );
  } catch (erro) {
    if (ehVendaRepetida(erro)) {
      recusar("mascVendaId", "Este número de venda do Masc já está em outro pedido desta loja.");
    }
    throw erro;
  }
}

/**
 * "Dispensar" — observação obrigatória (o CHECK `pedidos_masc_dispensado`
 * confere de novo). Trilha ANTES do efeito, com a observação como motivo
 * (01-dados.md §7.4): o pedido sai da fila e ninguém mais olha para ele.
 */
export async function dispensarDoMasc(
  dados: DispensarDoMasc,
  ctx: Contexto,
  tx: Transacao,
): Promise<Versao> {
  const atual = await carregar(tx, ctx, dados.id);
  if (atual.mascStatus !== "pendente") recusar("observacao", "Só pedido na fila do Masc pode ser dispensado.");
  return gravar(
    tx,
    ctx,
    dados,
    { masc_status: "dispensado", masc_observacao: dados.observacao },
    "pedido_dispensado_masc",
    { trilhaAntes: true, motivo: dados.observacao },
  );
}

/**
 * Volta para a fila. PRESERVA `masc_venda_id`, `masc_lancado_em` e
 * `masc_lancado_por` (06/INV-96): o número antigo é a pista de quem vai
 * corrigir o lançamento.
 */
export async function voltarParaFilaDoMasc(
  dados: AlvoDePedido,
  ctx: Contexto,
  tx: Transacao,
): Promise<Versao> {
  const atual = await carregar(tx, ctx, dados.id);
  if (pedidoEncerrado(atual.status)) recusar("id", "Pedido cancelado ou devolvido não volta para a fila.");
  if (atual.mascStatus === "pendente") recusar("id", "Este pedido já está na fila do Masc.");
  return gravar(tx, ctx, dados, { masc_status: "pendente" }, "pedido_voltou_fila_masc");
}

export async function alterarStatusDoPedido(
  dados: AlterarStatus,
  ctx: Contexto,
  tx: Transacao,
): Promise<Versao> {
  const atual = await carregar(tx, ctx, dados.id);
  if (pedidoEncerrado(atual.status)) recusar("status", "Pedido cancelado ou devolvido não muda de status.");
  if (atual.status === dados.status) recusar("status", "O pedido já está neste status.");
  return gravar(tx, ctx, dados, { status: dados.status }, "pedido_status_alterado");
}

export async function informarRastreio(
  dados: InformarRastreio,
  ctx: Contexto,
  tx: Transacao,
): Promise<Versao> {
  const atual = await carregar(tx, ctx, dados.id);
  if (pedidoEncerrado(atual.status)) recusar("rastreioCodigo", "Pedido cancelado ou devolvido não recebe rastreio.");
  return gravar(
    tx,
    ctx,
    dados,
    {
      rastreio_codigo: dados.rastreioCodigo,
      rastreio_url: dados.rastreioUrl ?? null,
      entrega_metodo: dados.entregaMetodo ?? null,
    },
    "pedido_rastreio_informado",
  );
}

/**
 * Cancelar — motivo obrigatório. Sai da reserva e da fila do Masc sozinho (o
 * filtro de `status` do índice e da fórmula). Os contadores do contato voltam
 * atrás, como na devolução concluída (01-dados-dominio.md §6.6). Trilha ANTES
 * do efeito, com o motivo (01-dados.md §7.4).
 */
export async function cancelarPedido(
  dados: CancelarPedido,
  ctx: Contexto,
  tx: Transacao,
): Promise<Versao> {
  const atual = await carregar(tx, ctx, dados.id);
  if (pedidoEncerrado(atual.status)) recusar("motivo", "Este pedido já está encerrado.");
  const versao = await gravar(
    tx,
    ctx,
    dados,
    { status: "cancelado", cancelado_em: new Date(), cancelado_motivo: dados.motivo },
    "pedido_cancelado",
    { trilhaAntes: true, motivo: dados.motivo },
  );
  await atualizarContador(
    tx,
    contatos,
    { id: atual.contatoId, escopo: ctx.escopo },
    { pedidos_contagem: -1, pedidos_valor_total: -paraCentavos(atual.total) / 100 },
  );
  return versao;
}
