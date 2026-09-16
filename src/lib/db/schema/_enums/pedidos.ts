/** Listas fechadas de CRM, pedidos, pagamento e pós-venda (01-dados.md §16.3). */

export const ESTAGIOS_NEGOCIO = [
  "lead",
  "interessada",
  "negociando",
  "fechando",
  "ganho",
  "perdido",
] as const;
export type EstagioNegocio = (typeof ESTAGIOS_NEGOCIO)[number];

export const MOTIVOS_PERDA = [
  "preco",
  "tamanho_indisponivel",
  "concorrente",
  "sem_resposta",
  "mudou_de_ideia",
  "outro",
] as const;
export type MotivoPerda = (typeof MOTIVOS_PERDA)[number];

export const STATUS_PEDIDO = [
  "confirmado",
  "preparando",
  "enviado",
  "entregue",
  "devolvido",
  "cancelado",
] as const;
export type StatusPedido = (typeof STATUS_PEDIDO)[number];

/** Pedido nestes status não reserva estoque nem entra na fila do Masc. */
export const STATUS_PEDIDO_SEM_RESERVA = ["cancelado", "devolvido"] as const;

export const STATUS_PAGAMENTO_PEDIDO = ["pendente", "pago", "estornado", "cancelado"] as const;
export type StatusPagamentoPedido = (typeof STATUS_PAGAMENTO_PEDIDO)[number];

/** Vale para `pedidos.forma_pagamento` e para `pagamentos.metodo`. */
export const FORMAS_PAGAMENTO = ["pix", "cartao", "boleto", "link", "dinheiro"] as const;
export type FormaPagamento = (typeof FORMAS_PAGAMENTO)[number];

export const MASC_STATUS = ["pendente", "lancado", "dispensado"] as const;
export type MascStatus = (typeof MASC_STATUS)[number];

export const PROVEDORES_PAGAMENTO = ["mercadopago", "asaas", "pagbank", "manual"] as const;
export type ProvedorPagamento = (typeof PROVEDORES_PAGAMENTO)[number];

export const STATUS_PAGAMENTO = [
  "pendente",
  "aprovado",
  "recusado",
  "estornado",
  "expirado",
  "cancelado",
] as const;
export type StatusPagamento = (typeof STATUS_PAGAMENTO)[number];

export const TIPOS_DEVOLUCAO = ["troca", "devolucao", "reembolso"] as const;
export type TipoDevolucao = (typeof TIPOS_DEVOLUCAO)[number];

export const MOTIVOS_DEVOLUCAO = [
  "tamanho_errado",
  "defeito",
  "diferente_do_esperado",
  "mudou_de_ideia",
  "outro",
] as const;
export type MotivoDevolucao = (typeof MOTIVOS_DEVOLUCAO)[number];

export const STATUS_DEVOLUCAO = [
  "solicitada",
  "aprovada",
  "em_transito",
  "recebida",
  "concluida",
  "negada",
] as const;
export type StatusDevolucao = (typeof STATUS_DEVOLUCAO)[number];

/** Devolução nestes status exige `resolvido_por` e `resolvido_em`. */
export const STATUS_DEVOLUCAO_RESOLVIDOS = ["concluida", "negada"] as const;

export const METODOS_ESTORNO = ["pix", "cartao", "credito_loja"] as const;
export type MetodoEstorno = (typeof METODOS_ESTORNO)[number];
