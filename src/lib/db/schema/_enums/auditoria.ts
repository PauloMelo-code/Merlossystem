/** Listas fechadas da trilha de negócio, consentimento e LGPD (01-dados.md §16.3). */

/**
 * Lista fechada da trilha de negócio (01-dados.md §7.4). Ampliar é mudança de
 * código MAIS migração do CHECK — de propósito.
 */
export const ACOES_AUDITADAS = [
  "loja_criada",
  "loja_alterada",
  "loja_desativada",
  "usuario_criado",
  "usuario_alterado",
  "usuario_desativado",
  "usuario_reativado",
  "usuario_papel_alterado",
  "integracao_conectada",
  "integracao_alterada",
  "integracao_desconectada",
  "integracao_pareada",
  "conversa_resolvida",
  "conversa_reaberta",
  "conversa_transferida",
  "conversa_prioridade_alterada",
  "conversa_criada",
  "conversa_arquivada",
  "mensagem_enviada",
  "mensagem_reenviada",
  "mensagem_nota_interna",
  "mensagem_recebida",
  "midia_enviada",
  "midia_excluida",
  "midia_recebida",
  "midia_alterada",
  "contato_criado",
  "contato_alterado",
  "contato_excluido",
  "contato_etiqueta_alterada",
  "negocio_criado",
  "negocio_estagio_alterado",
  "negocio_valor_alterado",
  "negocio_excluido",
  "pedido_criado",
  "pedido_status_alterado",
  "pedido_cancelado",
  "pedido_lancado_masc",
  "pedido_dispensado_masc",
  "pedido_voltou_fila_masc",
  "pedido_rastreio_informado",
  "pagamento_gerado",
  "pagamento_confirmado",
  "pagamento_estornado",
  "devolucao_criada",
  "devolucao_status_alterado",
  "devolucao_estorno_aprovado",
  "devolucao_concluida",
  "campanha_criada",
  "campanha_iniciada",
  "campanha_pausada",
  "campanha_concluida",
  "campanha_excluida",
  "campanha_alterada",
  "template_enviado",
  "template_aprovado",
  "template_rejeitado",
  "template_criado",
  "template_alterado",
  "template_excluido",
  "template_pausado",
  "resposta_rapida_criada",
  "resposta_rapida_alterada",
  "resposta_rapida_excluida",
  "agendamento_criado",
  "agendamento_reagendado",
  "agendamento_cancelado",
  "produto_sincronizado",
  "produto_preco_alterado",
  "lgpd_exportado",
  "lgpd_anonimizado",
  "lgpd_solicitacao_registrada",
  "consentimento_registrado",
  // Migração 0018 (ADR 0032): o que a onda 2 provou faltar.
  "alerta_reconhecido",
  "convite_expirado",
] as const;
export type AcaoAuditada = (typeof ACOES_AUDITADAS)[number];

/**
 * Campos cujo valor NUNCA entra em `auditoria_eventos.antes/depois`: o diff
 * grava só o nome do campo, `"(alterado)"` (01-dados.md §7.2).
 */
export const CAMPOS_PII: Readonly<Record<string, readonly string[]>> = {
  contatos: [
    "nome",
    "telefone",
    "email",
    "whatsapp_id",
    "instagram_id",
    "facebook_id",
    "tiktok_id",
    "avatar_url",
    "endereco",
    "aniversario",
    "observacoes",
  ],
  usuarios: ["nome", "email", "avatar_url"],
  pedidos: ["endereco_entrega"],
  pesquisas_satisfacao: ["comentario"],
  /** Texto livre: quem registra pode escrever o nome do titular (ADR 0033). */
  lgpd_solicitacoes: ["motivo"],
};

export const TIPOS_CONSENTIMENTO = [
  "tratamento_dados",
  "marketing",
  "opt_out",
  "opt_in",
] as const;
export type TipoConsentimento = (typeof TIPOS_CONSENTIMENTO)[number];

export const ORIGENS_CONSENTIMENTO = [
  "mensagem",
  "tela",
  "importacao",
  "contato_direto",
] as const;
export type OrigemConsentimento = (typeof ORIGENS_CONSENTIMENTO)[number];

/** `correcao` é direito do art. 18, III: registra a solicitação e o protocolo. */
export const TIPOS_LGPD = ["acesso", "eliminacao", "correcao"] as const;
export type TipoLgpd = (typeof TIPOS_LGPD)[number];

export const GATILHOS_PESQUISA = ["conversa_encerrada", "pedido_entregue"] as const;
export type GatilhoPesquisa = (typeof GATILHOS_PESQUISA)[number];
