import { and, eq, ne, or, type SQL } from "drizzle-orm";
import type { EscopoLoja } from "@/lib/auth/loja";
import { condicaoDeLoja } from "@/lib/db/consultas";
import type { Papel } from "@/lib/db/schema/_enums/auth";
import type { TipoAlerta } from "@/lib/db/schema/_enums/plataforma";
import { alertas } from "@/lib/db/schema/alertas";

/**
 * Quem vê qual alerta (dono: FUNDAÇÃO, ADR 0062). Usado pelo sino da casca e
 * pela central `/alertas` — um lugar só, para as duas telas não divergirem.
 *
 * `aviso_seguranca` é aviso de CONTA (senha trocada, fator removido, conta
 * bloqueada) que sairia por e-mail, com o e-mail desligado. Só dono e admin o
 * veem, em qualquer loja escolhida: ele fica ancorado numa loja só porque
 * `alertas.loja_id` é obrigatório. Para os demais papéis ele não existe.
 */

export const TIPO_AVISO_SEGURANCA = "aviso_seguranca" as const satisfies TipoAlerta;

export const PAPEIS_DO_AVISO_SEGURANCA: readonly Papel[] = ["dono", "admin"];

export function veAvisoDeSeguranca(papel: Papel): boolean {
  return PAPEIS_DO_AVISO_SEGURANCA.includes(papel);
}

/** Condição de `where` sobre `alertas`: escopo de loja + regra do aviso de segurança. */
export function alertasVisiveis(escopo: EscopoLoja, papel: Papel): SQL | undefined {
  const daLoja = condicaoDeLoja(alertas, escopo);
  if (!veAvisoDeSeguranca(papel)) return and(daLoja, ne(alertas.tipo, TIPO_AVISO_SEGURANCA));
  // `todas` já inclui o aviso; com uma loja escolhida, o aviso vem junto.
  return daLoja === undefined ? undefined : or(daLoja, eq(alertas.tipo, TIPO_AVISO_SEGURANCA));
}
