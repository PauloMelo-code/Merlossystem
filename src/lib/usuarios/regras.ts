import type { Papel } from "@/lib/db/schema/_enums/auth";
import type { Sessao } from "@/lib/auth/guard";
import { podeChave, type ChavePermissao } from "@/lib/auth/permissoes";
import { exigirAlvoPermitido, ordemDePrivilegio } from "@/lib/auth/permissoes/alvo";
import { ErroDeValidacao } from "@/lib/erros";

/**
 * Regras PURAS da administração de acessos (02-seguranca.md §2.3, §9.2, §11.2).
 *
 * Sem banco e sem sessão: é o que o teste de unidade prova linha a linha. Quem
 * lê o quadro de donos e admins com `FOR UPDATE` e chama estas funções é
 * `administracao.ts`.
 */

/** Contas ATIVAS com privilégio, lidas sob `FOR UPDATE` na mesma transação. */
export type Quadro = { donos: number; admins: number };

/** Uma conta antes e depois da operação. */
export type Mudanca = {
  antes: { papel: Papel; ativo: boolean };
  depois: { papel: Papel; ativo: boolean };
};

export const MAX_DONOS = 2;

function contribuicao(estado: { papel: Papel; ativo: boolean }): Quadro {
  if (!estado.ativo) return { donos: 0, admins: 0 };
  return {
    donos: estado.papel === "dono" ? 1 : 0,
    admins: estado.papel === "admin" ? 1 : 0,
  };
}

/** O quadro depois de aplicar as mudanças (alvo e, na transferência, o ator). */
export function quadroDepois(quadro: Quadro, mudancas: readonly Mudanca[]): Quadro {
  let { donos, admins } = quadro;
  for (const m of mudancas) {
    const antes = contribuicao(m.antes);
    const depois = contribuicao(m.depois);
    donos += depois.donos - antes.donos;
    admins += depois.admins - antes.admins;
  }
  return { donos, admins };
}

function recusa(mensagem: string): ErroDeValidacao {
  return new ErroDeValidacao({}, undefined, mensagem);
}

/**
 * INV-31: nunca zero dono, nunca mais de dois donos, nunca zero admin.
 *
 * Só recusa o que a operação PIORA: o sistema recém-semeado tem um dono e
 * nenhum admin, e isso não pode travar a promoção do primeiro admin.
 */
export function conferirQuadro(antes: Quadro, depois: Quadro): void {
  if (depois.donos < 1 && depois.donos < antes.donos) {
    throw recusa("O sistema precisa manter pelo menos um dono ativo.");
  }
  if (depois.donos > MAX_DONOS && depois.donos > antes.donos) {
    throw recusa(`O sistema aceita no máximo ${String(MAX_DONOS)} donos ativos.`);
  }
  if (depois.admins < 1 && depois.admins < antes.admins) {
    throw recusa(
      "O sistema precisa manter pelo menos um administrador ativo. Promova outra pessoa antes.",
    );
  }
}

/**
 * Para onde `trocarPapel` pode levar alguém.
 *
 * - `dono` nunca é destino: posse só se transfere.
 * - `admin` só é destino quando o alvo é `dono` sendo rebaixado pelo outro
 *   dono. Conceder `admin` a quem está abaixo é `promoverAAdmin`, com ciência.
 * - o destino precisa ficar ESTRITAMENTE abaixo do ator — senão um `admin`
 *   rebaixaria um `gerente` para... `admin` e fabricaria um par.
 */
export function conferirDestinoDePapel(ator: Papel, alvo: Papel, destino: Papel): void {
  if (destino === "dono") throw recusa("A posse só muda por transferência.");
  if (destino === "admin" && alvo !== "dono") {
    throw recusa("Para dar acesso de administrador, use “Promover a administrador”.");
  }
  if (ordemDePrivilegio(ator) >= ordemDePrivilegio(destino)) {
    throw recusa("Você não pode dar um papel igual ou superior ao seu.");
  }
}

/** O evento de `auth_eventos` que descreve a troca (01-dados.md §7.1). */
export function eventoDaTroca(
  alvo: Papel,
  destino: Papel,
): "admin_rebaixado" | "papel_alterado" {
  return alvo === "admin" && destino !== "admin" ? "admin_rebaixado" : "papel_alterado";
}

/**
 * Papéis que o ator pode oferecer no convite. `dono` nunca; `admin` só pelo
 * dono (a ciência é conferida no Zod e o CHECK `convites_ciencia_admin` é a
 * última linha).
 */
export function papeisConvidaveisPor(ator: Papel): Papel[] {
  const convidaveis: Papel[] = ["admin", "gerente", "vendedor", "viewer"];
  return convidaveis.filter((p) => ordemDePrivilegio(ator) < ordemDePrivilegio(p));
}

/** Reativar só vale para quem já concluiu o 2º fator (§4.3 de 02-seguranca.md). */
export function conferirReativacao(alvo: { ativo: boolean; temFator: boolean }): void {
  if (alvo.ativo) throw recusa("Esta conta já está ativa.");
  if (!alvo.temFator) {
    throw recusa(
      "Esta conta nunca concluiu o primeiro acesso. Envie um convite novo ou use a recuperação assistida.",
    );
  }
}

/** O que a linha da tabela oferece. A tela esconde; o servidor decide de novo. */
export type AcaoAdministrativa =
  | "papel"
  | "promover"
  | "transferir"
  | "desativar"
  | "reativar"
  | "destravar"
  | "reset"
  | "recuperar"
  | "sessoes"
  | "email";

export type UsuarioAlvo = {
  id: string;
  papel: Papel;
  ativo: boolean;
  emProvisionamento: boolean;
  bloqueado: boolean;
};

/**
 * Filtra as ações da linha com `pode()` (puro, sem trilha — montar menu com
 * `exigirPermissao()` inundaria `auth_eventos`) e com a MESMA escada de
 * `exigirAlvoPermitido`. Botão que o servidor recusaria não aparece.
 */
export function acoesDisponiveis(ator: Sessao, alvo: UsuarioAlvo): AcaoAdministrativa[] {
  try {
    exigirAlvoPermitido(ator, { id: alvo.id, papel: alvo.papel });
  } catch {
    return [];
  }
  const tem = (chave: ChavePermissao) => podeChave(ator.papel, chave);
  const privilegiado = alvo.papel === "admin" || alvo.papel === "dono";
  const plena = alvo.ativo && !alvo.emProvisionamento;
  const lista: AcaoAdministrativa[] = [];

  if (tem("usuarios:editar") && (!privilegiado || tem("usuarios:rebaixar_admin"))) {
    lista.push("papel");
  }
  if (tem("usuarios:promover_admin") && !privilegiado && plena) lista.push("promover");
  if (tem("usuarios:transferir_posse") && alvo.papel === "admin" && plena) {
    lista.push("transferir");
  }
  if (tem("usuarios:desativar")) {
    lista.push(alvo.ativo || alvo.emProvisionamento ? "desativar" : "reativar");
  }
  if (tem("usuarios:destravar") && alvo.bloqueado) lista.push("destravar");
  if (tem("usuarios:iniciar_reset")) lista.push("reset");
  if (tem("usuarios:recuperar_fator")) lista.push("recuperar");
  if (tem("usuarios:encerrar_sessoes")) lista.push("sessoes");
  if (tem("usuarios:trocar_email")) lista.push("email");
  return lista;
}
