"use server";

import type { z } from "zod";
import { executarAcao } from "@/lib/actions/_base";
import { pode } from "@/lib/auth/guard";
import type { Pagina } from "@/lib/catalogo";
import { ErroDeEscopo, type Resultado } from "@/lib/erros";
import {
  alterarStatusDoPedido,
  cancelarPedido as cancelarNoDominio,
  contarFilaDoMasc,
  criarPedido,
  dispensarDoMasc as dispensarNoDominio,
  informarRastreio as informarNoDominio,
  linhaDoTempo,
  nomeDaLoja,
  paginaDePedidos,
  pedidoPorId,
  pedidosDoContato,
  registrarLancamentoMasc,
  voltarParaFilaDoMasc,
  type EventoDoPedido,
  type PedidoCompleto,
  type PedidoCriado,
  type PedidoDaLista,
  type Versao,
} from "@/lib/pedidos";
import { uuidSchema } from "@/lib/validadores/comum";
import {
  alterarStatusSchema,
  alvoDePedidoSchema,
  cancelarPedidoSchema,
  dispensarDoMascSchema,
  filtroDePedidosSchema,
  informarRastreioSchema,
  lancarNoMascSchema,
  novoPedidoSchema,
} from "@/lib/validadores/pedidos";
import { z as zod } from "zod";

/**
 * Actions de pedido (04-ui.md §5.2 e §5.3). Mutações de pedido e do Masc NÃO
 * são otimistas (§10): a tela espera o servidor. Cada uma devolve o
 * `updated_at` novo, que a tela usa na próxima gravação.
 */

const REVALIDAR = ["/pedidos", "/pedidos/[id]", "/produtos"] as const;

export type ListaDePedidos = Pagina<PedidoDaLista> & {
  pendentesNoMasc: number;
  filaPadrao: boolean;
};

export async function listarPedidos(
  filtro: z.input<typeof filtroDePedidosSchema>,
): Promise<Resultado<ListaDePedidos>> {
  return executarAcao(
    {
      permissao: "pedidos:ler",
      entrada: filtroDePedidosSchema,
      loja: "le",
      executar: async (dados, ctx) => {
        const pendentesNoMasc = await contarFilaDoMasc(ctx.escopo);
        // Enquanto houver pendente, o filtro padrão é a fila (04-ui.md §5.3).
        const filaPadrao = dados.masc === undefined && pendentesNoMasc > 0;
        const masc = filaPadrao ? "fila" : dados.masc === "todos" ? undefined : dados.masc;
        const pagina = await paginaDePedidos(ctx.escopo, {
          porPagina: dados.porPagina,
          ...(masc ? { masc } : {}),
          ...(dados.status ? { status: dados.status } : {}),
          ...(dados.de ? { de: dados.de } : {}),
          ...(dados.ate ? { ate: dados.ate } : {}),
          ...(dados.q ? { numero: dados.q } : {}),
          ...(dados.cursor ? { cursor: dados.cursor } : {}),
          ...(dados.direcao ? { direcao: dados.direcao } : {}),
        });
        return { ...pagina, pendentesNoMasc, filaPadrao };
      },
    },
    filtro,
  );
}

export type PermissoesDoPedido = {
  editar: boolean;
  lancarMasc: boolean;
  dispensarMasc: boolean;
  cancelar: boolean;
};

export type DetalheDoPedido = {
  pedido: PedidoCompleto;
  eventos: EventoDoPedido[];
  pode: PermissoesDoPedido;
};

export async function verPedido(bruto: { id: string }): Promise<Resultado<DetalheDoPedido>> {
  return executarAcao(
    {
      permissao: "pedidos:ler",
      entrada: zod.object({ id: uuidSchema }),
      loja: "le",
      executar: async (dados, ctx) => {
        const pedido = await pedidoPorId(ctx.escopo, dados.id);
        if (!pedido) throw new ErroDeEscopo("Pedido não encontrado.");
        const papel = ctx.sessao.papel;
        return {
          pedido,
          eventos: await linhaDoTempo(pedido.id),
          pode: {
            editar: pode(papel, "pedidos", "editar"),
            lancarMasc: pode(papel, "pedidos", "lancar_masc"),
            dispensarMasc: pode(papel, "pedidos", "dispensar_masc"),
            cancelar: pode(papel, "pedidos", "cancelar"),
          },
        };
      },
    },
    bruto,
  );
}

export type PainelDoContato = {
  pedidos: PedidoDaLista[];
  lojaNome: string | null;
  podeCriar: boolean;
};

/** Pedidos do contato para o painel da conversa, e se a pessoa pode vender. */
export async function listarPedidosDoContato(bruto: {
  contatoId: string;
  loja?: string;
}): Promise<Resultado<PainelDoContato>> {
  return executarAcao(
    {
      permissao: "pedidos:ler",
      entrada: zod.object({ contatoId: uuidSchema, loja: zod.string().trim().max(64).optional() }),
      loja: "le",
      executar: async (dados, ctx) => ({
        pedidos: await pedidosDoContato(ctx.escopo, dados.contatoId),
        lojaNome: ctx.escopo.tipo === "uma" ? await nomeDaLoja(ctx.escopo.lojaId) : null,
        podeCriar: pode(ctx.sessao.papel, "pedidos", "criar"),
      }),
    },
    bruto,
  );
}

/** "Fechar venda" — ação crítica (block de 3 s, 04-ui.md §9.1 item 1). */
export async function fecharVenda(bruto: unknown): Promise<Resultado<PedidoCriado>> {
  return executarAcao(
    {
      permissao: "pedidos:criar",
      entrada: novoPedidoSchema,
      loja: "grava",
      revalidar: REVALIDAR,
      executar: (dados, ctx, tx) => criarPedido(dados, ctx, tx),
    },
    bruto,
  );
}

/** Block de 3 s, nº da venda obrigatório (§9.1 item 2). */
export async function lancarNoMasc(bruto: unknown): Promise<Resultado<Versao>> {
  return executarAcao(
    {
      permissao: "pedidos:lancar_masc",
      entrada: lancarNoMascSchema,
      loja: "grava",
      revalidar: REVALIDAR,
      executar: (dados, ctx, tx) => registrarLancamentoMasc(dados, ctx, tx),
    },
    bruto,
  );
}

/** Block de 3 s, observação obrigatória (§9.1 item 3). */
export async function dispensarDoMasc(bruto: unknown): Promise<Resultado<Versao>> {
  return executarAcao(
    {
      permissao: "pedidos:dispensar_masc",
      entrada: dispensarDoMascSchema,
      loja: "grava",
      revalidar: REVALIDAR,
      executar: (dados, ctx, tx) => dispensarNoDominio(dados, ctx, tx),
    },
    bruto,
  );
}

export async function voltarParaFilaMasc(bruto: unknown): Promise<Resultado<Versao>> {
  return executarAcao(
    {
      permissao: "pedidos:lancar_masc",
      entrada: alvoDePedidoSchema,
      loja: "grava",
      revalidar: REVALIDAR,
      executar: (dados, ctx, tx) => voltarParaFilaDoMasc(dados, ctx, tx),
    },
    bruto,
  );
}

/** Block de 3 s, motivo obrigatório (§9.1 item 4). */
export async function cancelarPedido(bruto: unknown): Promise<Resultado<Versao>> {
  return executarAcao(
    {
      permissao: "pedidos:cancelar",
      entrada: cancelarPedidoSchema,
      loja: "grava",
      revalidar: REVALIDAR,
      executar: (dados, ctx, tx) => cancelarNoDominio(dados, ctx, tx),
    },
    bruto,
  );
}

export async function mudarStatusDoPedido(bruto: unknown): Promise<Resultado<Versao>> {
  return executarAcao(
    {
      permissao: "pedidos:editar",
      entrada: alterarStatusSchema,
      loja: "grava",
      revalidar: REVALIDAR,
      executar: (dados, ctx, tx) => alterarStatusDoPedido(dados, ctx, tx),
    },
    bruto,
  );
}

export async function salvarRastreio(bruto: unknown): Promise<Resultado<Versao>> {
  return executarAcao(
    {
      permissao: "pedidos:editar",
      entrada: informarRastreioSchema,
      loja: "grava",
      revalidar: REVALIDAR,
      executar: (dados, ctx, tx) => informarNoDominio(dados, ctx, tx),
    },
    bruto,
  );
}
