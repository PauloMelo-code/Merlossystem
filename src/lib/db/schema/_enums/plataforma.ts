/** Listas fechadas de plataforma: integrações, modelos e alertas (01-dados.md §16.3). */

/**
 * `facebook` e `tiktok_shop` ficam no CHECK porque custam zero; estão FORA do
 * R1 (sem rota e sem adaptador). `bling` é a conta da rede: `loja_id` nulo.
 */
export const PROVEDORES = [
  "whatsapp_oficial",
  "uazapi",
  "instagram",
  "facebook",
  "tiktok_shop",
  "bling",
] as const;
export type Provedor = (typeof PROVEDORES)[number];

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
] as const;
export type TipoAlerta = (typeof TIPOS_ALERTA)[number];

export const SEVERIDADES = ["baixa", "media", "alta", "critica"] as const;
export type Severidade = (typeof SEVERIDADES)[number];
