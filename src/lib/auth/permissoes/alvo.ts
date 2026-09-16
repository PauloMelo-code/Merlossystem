import { PAPEIS, type Papel } from "@/lib/db/schema/_enums/auth";
import { ErroDePermissao } from "@/lib/erros";
import type { Sessao } from "../guard";

/**
 * Quem pode agir sobre quem (02-seguranca.md §2.3, S-17).
 *
 * Sem este guarda, `admin` reseta, desativa, destrava, encerra sessões, troca
 * e-mail e recupera fator de outro `admin` e do `dono` — negação de serviço e
 * degrau para tomada de conta. Toda action de `src/lib/actions/usuarios.ts`
 * chama isto ALÉM de `exigirPermissao`.
 *
 * Só tipos são importados de `../guard`, então não há ciclo em runtime.
 */

/** 0 = `dono`. Quanto menor, mais privilégio (01-dados.md §16.2). */
export function ordemDePrivilegio(papel: Papel): number {
  return PAPEIS.indexOf(papel);
}

export class ErroDeAlvo extends ErroDePermissao {
  constructor() {
    super("Você não tem acesso a esta ação sobre esta pessoa.");
  }
}

/**
 * Regras, NESTA ordem. Recusa = 403 `ALVO_NAO_PERMITIDO` + `recusa_403` na
 * trilha (quem chama grava; aqui é decisão pura).
 *
 * 1. auto-alvo recusado em TODA action administrativa (INV-32) — o caminho do
 *    próprio usuário é `/perfil/seguranca`;
 * 2. alvo com papel `dono` só é alcançado por outro `dono`;
 * 3. fora disso, o alvo precisa ter papel ESTRITAMENTE inferior ao do ator.
 */
export function exigirAlvoPermitido(
  ator: Sessao,
  alvo: { id: string; papel: Papel },
): void {
  if (ator.usuarioId === alvo.id) throw new ErroDeAlvo();
  if (alvo.papel === "dono") {
    if (ator.papel !== "dono") throw new ErroDeAlvo();
    return;
  }
  if (ordemDePrivilegio(ator.papel) >= ordemDePrivilegio(alvo.papel)) throw new ErroDeAlvo();
}

/**
 * Mesma escada para o convite: `admin` convida `gerente`/`vendedor`/`viewer`;
 * convite com papel `admin` só pelo `dono`; convite com papel `dono` não
 * existe (barreira no `CHECK convites_papel`, 01-dados.md §5.7).
 */
export function exigirPapelConvidavel(ator: Sessao, papel: Papel): void {
  if (papel === "dono") throw new ErroDeAlvo();
  if (ordemDePrivilegio(ator.papel) >= ordemDePrivilegio(papel)) throw new ErroDeAlvo();
}
