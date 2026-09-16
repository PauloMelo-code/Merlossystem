import { GESTAO, OPERACAO, TODOS, type MapaPermissao } from "./_papeis";

/**
 * Chaves que NASCEM JUNTO COM A FASE R2 (02-seguranca.md §2.2, último bloco).
 *
 * Nenhuma tela do R1 usa nada daqui — as tabelas existem, o módulo não
 * (01-dados.md §13.4). Estão escritas agora para que o estorno e a baixa de
 * pagamento não nasçam sem dono no dia em que a tela ligar; é decisão de
 * política, não dívida.
 *
 * Por isso este mapa é exportado SEPARADO: a invariante INV-27 ("toda entrada
 * da tabela é usada por alguma tela ou action") vale sobre `MATRIZ_R1`, e a
 * trava T12 confere a fase R2 só pelo outro lado (papel correto por chave).
 */
export const FASE_R2: MapaPermissao = {
  "devolucoes:ler": OPERACAO,
  "devolucoes:criar": OPERACAO,
  "devolucoes:aprovar": GESTAO,
  "devolucoes:negar": GESTAO,
  /** Motivo obrigatório, trilha antes do efeito: é dinheiro saindo. */
  "devolucoes:concluir_estorno": GESTAO,

  "pagamentos:ler": OPERACAO,
  "pagamentos:gerar_cobranca": OPERACAO,
  /** Motivo obrigatório: marcar pago à mão é o atalho de fraude clássico. */
  "pagamentos:marcar_pago": GESTAO,

  "negocios:ler": TODOS,
  "negocios:criar": OPERACAO,
  "negocios:editar": OPERACAO,
  "negocios:excluir": GESTAO,

  "conteudo:ler": TODOS,
  "conteudo:criar": OPERACAO,
  "conteudo:editar": OPERACAO,
  "conteudo:excluir": GESTAO,
};
