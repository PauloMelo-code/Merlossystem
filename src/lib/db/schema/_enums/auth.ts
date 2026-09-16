/** Listas fechadas de autenticação e conta (01-dados.md §16.3). */

/** Ordem de privilégio: dono > admin > gerente > vendedor > viewer. */
export const PAPEIS = ["dono", "admin", "gerente", "vendedor", "viewer"] as const;
export type Papel = (typeof PAPEIS)[number];

/** `dono` NÃO é convidável: posse só se transfere (02-seguranca.md §9.2). */
export const PAPEIS_CONVIDAVEIS = ["admin", "gerente", "vendedor", "viewer"] as const;
export type PapelConvidavel = (typeof PAPEIS_CONVIDAVEIS)[number];

/** Papéis de gestão: loja_id é NULL. Os demais exigem loja. */
export const PAPEIS_SEM_LOJA = ["dono", "admin", "gerente"] as const;
export const PAPEIS_COM_LOJA = ["vendedor", "viewer"] as const;

export const MEIOS_AUTH = [
  "senha",
  "senha+totp",
  "passkey",
  "convite",
  "reset",
  "admin",
  "sistema",
] as const;
export type MeioAuth = (typeof MEIOS_AUTH)[number];

export const RESULTADOS_AUTH = ["sucesso", "falha", "recusado"] as const;
export type ResultadoAuth = (typeof RESULTADOS_AUTH)[number];

export const ATOR_TIPOS = ["usuario", "sistema", "integracao"] as const;
export type AtorTipo = (typeof ATOR_TIPOS)[number];

/**
 * Funil único de tudo que cria, nega ou destrói acesso (01-dados.md §7.1).
 *
 * `posse_transferida` está aqui porque a transferência de posse grava a trilha
 * fail-closed na mesma transação: sem o tipo no CHECK, o sistema nunca trocaria
 * de dono. `lgpd_anonimizado` e `integracao_conectada` NÃO são eventos de auth
 * — vivem em `ACOES_AUDITADAS`.
 */
export const TIPOS_AUTH_EVENTO = [
  "login_sucesso",
  "senha_aceita_aguardando_2fa",
  "login_falha",
  "conta_bloqueada",
  "conta_destravada",
  "logout",
  "sessao_criada",
  "sessao_encerrada",
  "reset_solicitado",
  "reset_concluido",
  "senha_trocada",
  "fator_adicionado",
  "fator_removido",
  "passkey_adicionada",
  "passkey_removida",
  "papel_alterado",
  "admin_promovido",
  "admin_rebaixado",
  "posse_transferida",
  "dono_semeado",
  "usuario_desativado",
  "usuario_reativado",
  "convite_emitido",
  "convite_usado",
  "email_trocado",
  "recusa_403",
  "sonda_caminho_desligado",
  "webhook_recusado",
  "recuperacao_assistida",
  "limitador_indisponivel",
  "hibp_indisponivel",
  "email_seguranca_falhou",
  "ip_cadeia_inesperada",
] as const;
export type TipoAuthEvento = (typeof TIPOS_AUTH_EVENTO)[number];
