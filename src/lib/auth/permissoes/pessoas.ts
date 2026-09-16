import { ADMINISTRACAO, SO_DONO, TODOS, type MapaPermissao } from "./_papeis";

/**
 * Equipe e acesso (02-seguranca.md §2.2 e §2.3).
 *
 * A chave sozinha não basta: toda action sobre conta alheia passa também por
 * `exigirAlvoPermitido()` (`./alvo.ts`) — sem ele, `admin` reseta, desativa e
 * troca o e-mail de outro `admin` e do `dono`.
 *
 * "Meu perfil > Segurança" NÃO tem chave nesta tabela: é alcançável por
 * qualquer sessão plena, e o alvo é sempre a própria sessão (REQ-G1).
 */
export const PESSOAS: MapaPermissao = {
  /** Id, nome, papel e loja — SEM e-mail. É o que o seletor de transferência usa. */
  "usuarios:listar_colegas": TODOS,

  /** E-mail, ativo, último acesso e desativados. */
  "usuarios:ler_detalhe": ADMINISTRACAO,
  "usuarios:convidar": ADMINISTRACAO,
  "usuarios:editar": ADMINISTRACAO,
  "usuarios:desativar": ADMINISTRACAO,
  "usuarios:destravar": ADMINISTRACAO,
  /** Dispara o e-mail de reset ao alvo. NUNCA define a senha (E8). */
  "usuarios:iniciar_reset": ADMINISTRACAO,
  "usuarios:recuperar_fator": ADMINISTRACAO,
  "usuarios:encerrar_sessoes": ADMINISTRACAO,
  "usuarios:trocar_email": ADMINISTRACAO,

  /** Sem `dono`, quem promove `admin` é o próprio `admin` (REQ-H1). */
  "usuarios:promover_admin": SO_DONO,
  "usuarios:rebaixar_admin": SO_DONO,
  "usuarios:transferir_posse": SO_DONO,
};
