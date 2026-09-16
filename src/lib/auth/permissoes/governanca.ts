import { ADMINISTRACAO, GESTAO, type MapaPermissao } from "./_papeis";

/**
 * Trilha, auditoria, LGPD e eventos de segurança (02-seguranca.md §2.2).
 *
 * `gerente` tem `trilha:ler` (a trilha de NEGÓCIO, que o cliente pediu em
 * DN-07) e NÃO tem `seguranca:ler_eventos`: `auth_eventos` carrega IP, agente,
 * meio e alvo de `dono` e `admin`. Dar a trilha de auth a quem não pode nem ver
 * o detalhe de um usuário é contornar o próprio controle.
 *
 * `viewer` não exporta dossiê nem lê trilha (S-15).
 */
export const GOVERNANCA: MapaPermissao = {
  /** Abas `/auditoria`, `/auditoria/qualidade` e `/auditoria/excluidos`. */
  "trilha:ler": GESTAO,
  "auditoria:restaurar": GESTAO,

  "lgpd:exportar": GESTAO,
  "lgpd:anonimizar": GESTAO,
  "lgpd:registrar_solicitacao": GESTAO,

  /** Aba `/auditoria/seguranca`, que lê `auth_eventos`. */
  "seguranca:ler_eventos": ADMINISTRACAO,
};
