import { GESTAO, OPERACAO, TODOS, type MapaPermissao } from "./_papeis";

/**
 * Pós-venda (R2-A, ADRs 0035–0039): funil, trocas/devoluções e CSAT.
 * `ganho` não tem chave (só a venda ganha). Estorno é gestão com sessão
 * fresca. O painel de CSAT mostra comentário (PII) e fica com a gestão.
 */
export const POS_VENDA: MapaPermissao = {
  "negocios:ler": TODOS,
  "negocios:criar": OPERACAO,
  "negocios:editar": OPERACAO,
  "negocios:excluir": GESTAO,

  "devolucoes:ler": OPERACAO,
  "devolucoes:criar": OPERACAO,
  /** Registrar envio (rastreio) e recebimento: é a loja que recebe a peça. */
  "devolucoes:editar": OPERACAO,
  "devolucoes:aprovar": GESTAO,
  "devolucoes:negar": GESTAO,
  /** Motivo obrigatório, sessão fresca, trilha antes do efeito: é dinheiro saindo. */
  "devolucoes:concluir_estorno": GESTAO,

  "pesquisas:ler": GESTAO,
};
