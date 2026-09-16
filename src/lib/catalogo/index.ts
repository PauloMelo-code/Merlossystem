import "server-only";

/**
 * API pública do módulo `catalogo` (03-arquitetura.md §4.1). O resto da pasta
 * é privado. Catálogo é SOMENTE LEITURA: nenhuma função daqui cria ou edita
 * produto a pedido de uma pessoa — quem grava é o job `sincronizar-bling`.
 */

export {
  buscarProdutos,
  paginaDeProdutos,
  produtoPorId,
  produtoPorSku,
  ultimasVendas,
  type ProdutoCompleto,
  type ProdutoDaLista,
  type ResultadoDeBusca,
  type VariacaoDoProduto,
  type VendaDoProduto,
} from "./_consultas";
export {
  codificarCursor,
  decodificarCursor,
  fatia,
  montarPagina,
  type Direcao,
  type Pagina,
} from "./_cursor";
export { tamanhosDaGrade } from "./_regras";
export { calcularDisponivel, calcularDisponiveis, type Disponibilidade } from "./disponibilidade";
export { sincronizarCatalogoBling, ultimaSincronizacao } from "./sincronizacao";
