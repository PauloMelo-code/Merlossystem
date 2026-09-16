/** Listas fechadas de plataforma: integrações, modelos e alertas (01-dados.md §16.3). */

/** Contas que recebem dinheiro (R2, ADR 0040). No máximo uma viva por loja: `uq_lojas_integracoes_pagamento`. */
export const PROVEDORES_DE_PAGAMENTO = ["mercadopago", "pagamento_simulado"] as const;
export type ProvedorDeConta = (typeof PROVEDORES_DE_PAGAMENTO)[number];

/**
 * `tiktok` = mensagem direta pela Business Messaging API (R2, ADR 0055).
 * `tiktok_shop` fica no CHECK porque custa zero e NÃO tem adaptador: catálogo,
 * pedidos e atendimento do TikTok Shop estão fora (ADR 0055). `bling` é a
 * conta da rede: `loja_id` nulo. Pagamento: `PROVEDORES_DE_PAGAMENTO` (R2-B).
 */
export const PROVEDORES = [
  "whatsapp_oficial",
  "uazapi",
  "instagram",
  "facebook",
  "tiktok",
  "tiktok_shop",
  "bling",
  ...PROVEDORES_DE_PAGAMENTO,
] as const;
export type Provedor = (typeof PROVEDORES)[number];

/**
 * Provedores que ABREM CONVERSA (têm adaptador de canal). Lista explícita, e
 * não "PROVEDORES menos X": pagamento, Bling e `tiktok_shop` não conversam.
 * Fonte do CHECK de `lojas_sla` e do prazo padrão (`src/lib/sla/prazo.ts`).
 */
export const PROVEDORES_DE_CONVERSA = [
  "whatsapp_oficial",
  "uazapi",
  "instagram",
  "facebook",
  "tiktok",
] as const;
export type ProvedorDeConversa = (typeof PROVEDORES_DE_CONVERSA)[number];

export const STATUS_INTEGRACAO = ["desconectado", "conectado", "expirado", "erro"] as const;
export type StatusIntegracao = (typeof STATUS_INTEGRACAO)[number];

export const TIPOS_EVENTO_INTEGRACAO = [
  "recebido",
  "recusado",
  "descartado",
  "processado",
  "falhou",
] as const;
export type TipoEventoIntegracao = (typeof TIPOS_EVENTO_INTEGRACAO)[number];

export const CATEGORIAS_TEMPLATE = ["marketing", "utility", "authentication"] as const;
export type CategoriaTemplate = (typeof CATEGORIAS_TEMPLATE)[number];

export const STATUS_TEMPLATE = [
  "rascunho",
  "enviado",
  "aprovado",
  "rejeitado",
  "pausado",
] as const;
export type StatusTemplate = (typeof STATUS_TEMPLATE)[number];

export const TIPOS_CABECALHO_TEMPLATE = ["texto", "imagem", "video", "documento"] as const;
export type TipoCabecalhoTemplate = (typeof TIPOS_CABECALHO_TEMPLATE)[number];

export const TIPOS_BOTAO = ["url", "telefone", "resposta_rapida"] as const;
export type TipoBotao = (typeof TIPOS_BOTAO)[number];

export const TIPOS_ALERTA = [
  "sla_estourado",
  "risco_avaliacao",
  "negocio_parado",
  "pagamento_pendente",
  "primeiro_contato",
  "cliente_retornando",
  "follow_up_atrasado",
  "sessao_uazapi_caiu",
  "integracao_com_erro",
  /** Reconciliação noturna: espelho × verdade divergem (01-dados-dominio.md §7.2). */
  "espelho_divergente",
  /** Pagamento que o provedor e o sistema não fecham sozinhos (R2-B, ADR 0044). */
  "pagamento_conferir",
  /** Aviso de conta que sairia por e-mail, com o e-mail desligado: só dono e admin veem (ADR 0062). */
  "aviso_seguranca",
] as const;
export type TipoAlerta = (typeof TIPOS_ALERTA)[number];

export const SEVERIDADES = ["baixa", "media", "alta", "critica"] as const;
export type Severidade = (typeof SEVERIDADES)[number];
