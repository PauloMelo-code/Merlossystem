/** Listas fechadas de conversas, mensagens e agendamentos (01-dados.md §16.3). */

export const STATUS_CONVERSA = ["aberta", "pendente", "resolvida", "arquivada"] as const;
export type StatusConversa = (typeof STATUS_CONVERSA)[number];

/** Conversa `resolvida` que recebe mensagem REABRE; `arquivada` não. */
export const STATUS_CONVERSA_ABERTOS = ["aberta", "pendente"] as const;

export const PRIORIDADES = ["baixa", "media", "alta", "urgente"] as const;
export type Prioridade = (typeof PRIORIDADES)[number];

export const DIRECOES = ["entrada", "saida"] as const;
export type Direcao = (typeof DIRECOES)[number];

export const AUTOR_TIPOS = ["contato", "usuario", "sistema", "campanha"] as const;
export type AutorTipo = (typeof AUTOR_TIPOS)[number];

/**
 * `produto`, `pedido` e `pagamento` NÃO são tipos de conteúdo: o cartão é
 * derivado de `metadados.card` numa mensagem de texto (01-dados-dominio.md
 * §2.3). O antigo tinha `content_type = 'product'`, valor que o adaptador não
 * sabia enviar e que virava falha de envio.
 */
export const TIPOS_CONTEUDO = [
  "texto",
  "imagem",
  "video",
  "audio",
  "documento",
  "sticker",
  "localizacao",
  "template",
  "sistema",
] as const;
export type TipoConteudo = (typeof TIPOS_CONTEUDO)[number];

/** Escala monotônica: `pendente < enviada < entregue < lida`; `falhou` é terminal. */
export const STATUS_ENTREGA = ["pendente", "enviada", "entregue", "lida", "falhou"] as const;
export type StatusEntrega = (typeof STATUS_ENTREGA)[number];

export const TIPOS_ARQUIVO_MENSAGEM = [
  "imagem",
  "video",
  "audio",
  "documento",
  "sticker",
] as const;
export type TipoArquivoMensagem = (typeof TIPOS_ARQUIVO_MENSAGEM)[number];

export const STATUS_TRANSCRICAO = ["pendente", "processando", "concluida", "falhou"] as const;
export type StatusTranscricao = (typeof STATUS_TRANSCRICAO)[number];

export const TIPOS_CONTEUDO_AGENDAMENTO = ["texto", "template", "midia"] as const;
export type TipoConteudoAgendamento = (typeof TIPOS_CONTEUDO_AGENDAMENTO)[number];

export const GATILHOS_AGENDAMENTO = [
  "manual",
  "follow_up",
  "pos_venda",
  "abandono",
  "reativacao",
  "aniversario",
  "promocao",
] as const;
export type GatilhoAgendamento = (typeof GATILHOS_AGENDAMENTO)[number];

/** Só estes respeitam opt-out (01-dados-dominio.md §7.2). */
export const GATILHOS_PROMOCIONAIS = ["promocao", "reativacao", "abandono"] as const;

export const STATUS_AGENDAMENTO = ["agendada", "enviada", "cancelada", "falhou"] as const;
export type StatusAgendamento = (typeof STATUS_AGENDAMENTO)[number];

export const ORIGENS_ETIQUETA = ["manual", "importacao", "automacao"] as const;
export type OrigemEtiqueta = (typeof ORIGENS_ETIQUETA)[number];
