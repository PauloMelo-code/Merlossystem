import { PAPEIS } from "@/lib/db/schema/_enums/auth";
import type { Papel } from "@/lib/db/schema/_enums/auth";

/**
 * Conjuntos de papéis usados pelas famílias da matriz
 * (02-seguranca.md §2.2). Módulo PURO: sem I/O, sem trilha.
 *
 * Os nomes vêm de `PAPEIS` (01-dados.md §16.2) — nenhuma família redigita a
 * lista de papéis, senão um papel novo entraria em umas tabelas e não em
 * outras.
 */

export type ChavePermissao = `${string}:${string}`;
export type MapaPermissao = Readonly<Record<ChavePermissao, readonly Papel[]>>;

export const TODOS: readonly Papel[] = PAPEIS;

/** Tudo menos `viewer`: quem escreve no dia a dia (INV-19). */
export const OPERACAO: readonly Papel[] = ["dono", "admin", "gerente", "vendedor"];

/** Quem responde pelo resultado da loja: exclui, cancela e lê a trilha. */
export const GESTAO: readonly Papel[] = ["dono", "admin", "gerente"];

/** Configuração, integrações e pessoas (DN-07 tira o gerente daqui). */
export const ADMINISTRACAO: readonly Papel[] = ["dono", "admin"];

/** Só o privilégio máximo: concede/retira `admin` e transfere a posse. */
export const SO_DONO: readonly Papel[] = ["dono"];
