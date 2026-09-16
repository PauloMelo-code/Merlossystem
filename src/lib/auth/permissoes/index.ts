import type { Papel } from "@/lib/db/schema/_enums/auth";
import { ATENDIMENTO } from "./atendimento";
import { COMERCIAL } from "./comercial";
import { FASE_R2 } from "./fase-r2";
import { GOVERNANCA } from "./governanca";
import { PESSOAS } from "./pessoas";
import { PLATAFORMA } from "./plataforma";
import type { ChavePermissao, MapaPermissao } from "./_papeis";

/**
 * Matriz de permissão `recurso:acao` — negação por padrão (REQ-H5).
 *
 * Pasta por família, e não arquivo único: ~30 recursos x 5 papéis estoura 499
 * linhas por construção.
 *
 * `pode()` é PURO — sem I/O, sem trilha — porque a navegação e o índice de
 * Configurações renderizam no servidor já filtrados. Montar menu com
 * `exigirPermissao()` inundaria `auth_eventos` de `recusa_403` a cada page view.
 */

export type { ChavePermissao, MapaPermissao } from "./_papeis";

/** O que alguma tela ou action do R1 usa. INV-27 vale sobre este mapa. */
export const MATRIZ_R1: MapaPermissao = {
  ...ATENDIMENTO,
  ...COMERCIAL,
  ...PLATAFORMA,
  ...PESSOAS,
  ...GOVERNANCA,
};

export { FASE_R2 };

/** O que `pode()` consulta: R1 + as chaves já decididas da fase R2. */
export const MATRIZ: MapaPermissao = { ...MATRIZ_R1, ...FASE_R2 };

/**
 * Papel desconhecido = NENHUMA permissão. Nunca cair para o mais baixo: o
 * contraexemplo é `hug/src/lib/auth/guard.ts:97-101`, onde papel inválido
 * virava `viewer` e continuava lendo a base inteira.
 */
export function pode(papel: Papel, recurso: string, acao: string): boolean {
  const chave = `${recurso}:${acao}` as ChavePermissao;
  const permitidos = MATRIZ[chave];
  if (!permitidos) return false;
  return permitidos.includes(papel);
}

/** Mesma decisão, recebendo a chave já montada (o formato das actions). */
export function podeChave(papel: Papel, chave: ChavePermissao): boolean {
  const [recurso = "", acao = ""] = chave.split(":", 2);
  return pode(papel, recurso, acao);
}

export { exigirAlvoPermitido, ordemDePrivilegio } from "./alvo";
