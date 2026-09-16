import { GESTAO, OPERACAO, TODOS, type MapaPermissao } from "./_papeis";

/**
 * Conversas, contatos, mídia, etiquetas e alertas — a linha de frente
 * (02-seguranca.md §2.2). Célula vazia = negado; a ausência de uma chave é a
 * negação (REQ-H5).
 */
export const ATENDIMENTO: MapaPermissao = {
  "conversas:ler": TODOS,
  "contatos:ler": TODOS,
  "alertas:ler": TODOS,
  "midia:ler": TODOS,
  "etiquetas:ler": TODOS,

  /** Enviar mensagem e nota interna. */
  "conversas:escrever": OPERACAO,
  /** Transferir, resolver, reabrir, arquivar, prioridade, etiquetar. */
  "conversas:gerir": OPERACAO,
  "contatos:criar": OPERACAO,
  "contatos:editar": OPERACAO,
  "contatos:optout": OPERACAO,
  "midia:enviar": OPERACAO,
  /** Pasta e etiquetas da galeria; o vendedor só alcança a própria loja pelo escopo. */
  "midia:editar": OPERACAO,
  "alertas:reconhecer": OPERACAO,

  "contatos:excluir": GESTAO,
  "midia:excluir": GESTAO,
  "etiquetas:gerir": GESTAO,
};
