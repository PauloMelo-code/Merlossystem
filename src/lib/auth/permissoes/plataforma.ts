import { ADMINISTRACAO, TODOS, type MapaPermissao } from "./_papeis";

/**
 * Lojas, integrações e configuração (02-seguranca.md §2.2).
 *
 * O `gerente` NÃO alcança nada aqui (DN-07, INV-21/22) — nem a LEITURA de
 * integrações e da sessão uazapi, que expõem credencial e estado de conexão.
 */
export const PLATAFORMA: MapaPermissao = {
  "lojas:ler": TODOS,

  "lojas:criar": ADMINISTRACAO,
  "lojas:editar": ADMINISTRACAO,
  /** O "desativar loja" da tela é soft delete. */
  "lojas:excluir": ADMINISTRACAO,

  "integracoes:ler": ADMINISTRACAO,
  "integracoes:conectar": ADMINISTRACAO,
  "integracoes:editar": ADMINISTRACAO,
  "integracoes:desconectar": ADMINISTRACAO,

  "configuracao:ler": ADMINISTRACAO,
  "configuracao:editar": ADMINISTRACAO,
};
