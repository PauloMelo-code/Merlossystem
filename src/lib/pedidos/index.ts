import "server-only";

/**
 * API pública do módulo `pedidos` (03-arquitetura.md §4.1): pedido, itens,
 * numeração atômica, ponte manual com o Masc e reserva.
 */

export {
  contarFilaDoMasc,
  linhaDoTempo,
  nomeDaLoja,
  paginaDePedidos,
  pedidoPorId,
  pedidosDoContato,
  type EventoDoPedido,
  type FiltroDePedidos,
  type ItemDoPedido,
  type PedidoCompleto,
  type PedidoDaLista,
} from "./_consultas";
export { anoMesDaVenda, numeroDoPedido } from "./_regras";
export { criarPedido, type PedidoCriado } from "./criacao";
export {
  alterarStatusDoPedido,
  cancelarPedido,
  dispensarDoMasc,
  informarRastreio,
  registrarLancamentoMasc,
  voltarParaFilaDoMasc,
  type Versao,
} from "./operacao";
