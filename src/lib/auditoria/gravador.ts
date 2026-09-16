import { sql, type SQL } from "drizzle-orm";
import type { Contexto } from "@/lib/auth/guard";
import type { AcaoAuditada } from "@/lib/db/schema/_enums/auditoria";
import { CAMPOS_PII } from "@/lib/db/schema/_enums/auditoria";
import type { DiffAuditado } from "@/lib/db/schema/auditoria";

/**
 * GRAVADOR da trilha de negócio (01-dados.md §7.2 e §7.4, 02-seguranca.md §17).
 *
 * Este módulo é só a escrita. A LEITURA (as três abas de `/auditoria`) é do
 * pacote M8 e nasce em `src/lib/auditoria/consulta.ts` — separadas porque
 * escrever é caminho crítico de toda mutação e ler é tela com filtro e página.
 *
 * POR QUE `execute(sql...)` E NÃO `tx.insert()`: `auditoria_eventos` é
 * append-only de verdade — `REVOKE UPDATE, DELETE, TRUNCATE` para `merlo_app` e
 * gatilho `trilha_imutavel()` (migração 0004). Ela não é tabela de domínio: não
 * tem soft delete, não tem trava de colisão, não tem `modified_by`. É a mesma
 * porta que `auth/trilha.ts` usa para `auth_eventos`, e é o que mantém a trava
 * `tests/travas/mutacoes.test.ts` valendo sem exceção nova.
 *
 * QUANDO CHAMAR DIRETO: em ação administrativa destrutiva, a trilha é gravada
 * ANTES do efeito e na MESMA transação (§17.2) — promoção a dono, reset por
 * admin, anonimização por LGPD. O efeito destrói o estado anterior, e trilha
 * depois seria trilha nenhuma. Nos casos normais quem chama é `mutacoes.ts`.
 */

/** A transação aberta por `emTransacao`, ou o próprio `db`. */
export type ExecutorAuditoria = { execute: (consulta: SQL) => Promise<unknown> };

export type Diff = { antes: DiffAuditado | null; depois: DiffAuditado };

/** Nome de campo que nunca entra no diff, nem com o valor mascarado. */
const SEGREDO = /senha|password|token|secret|credencia|authorization|apikey/i;

/** O diff só guarda escalar: objeto inteiro no log é PII entrando pela porta lateral. */
function paraValorDiff(valor: unknown): string | number | boolean | null {
  if (valor === null || valor === undefined) return null;
  if (valor instanceof Date) return valor.toISOString();
  if (typeof valor === "string" || typeof valor === "number" || typeof valor === "boolean") {
    return valor;
  }
  return "(alterado)";
}

/**
 * Campos que mudaram, sem PII e sem segredo. Campo da lista `CAMPOS_PII` grava
 * `"(alterado)"` no lugar do valor: a trilha prova QUE o telefone mudou sem
 * virar um segundo cadastro de telefones que ninguém protege.
 */
export function diffAuditado(
  entidade: string,
  antes: Record<string, unknown> | null,
  depois: Record<string, unknown>,
): Diff {
  const pii = new Set(CAMPOS_PII[entidade] ?? []);
  const a: DiffAuditado = {};
  const d: DiffAuditado = {};
  for (const [campo, valor] of Object.entries(depois)) {
    if (SEGREDO.test(campo)) continue;
    const anterior = antes?.[campo];
    if (antes && Object.is(anterior, valor)) continue;
    if (pii.has(campo)) {
      d[campo] = "(alterado)";
      if (antes) a[campo] = "(alterado)";
      continue;
    }
    d[campo] = paraValorDiff(valor);
    if (antes) a[campo] = paraValorDiff(anterior);
  }
  return { antes: antes ? a : null, depois: d };
}

/**
 * Grava a linha da trilha na MESMA transação do efeito: se ela falha, a operação
 * inteira cai. É o oposto do sistema antigo, em que a auditoria era best-effort
 * até para troca de papel (defeito D-13) — e "não sei quem promoveu" é a
 * pergunta que não pode ficar sem resposta.
 */
export async function registrarAuditoria(
  tx: ExecutorAuditoria,
  ctx: Contexto,
  acao: AcaoAuditada,
  entidade: string,
  entidadeId: string,
  diff: Diff,
  motivo?: string,
): Promise<void> {
  await tx.execute(sql`
    insert into auditoria_eventos
      (ator_tipo, ator_id, loja_id, acao, entidade, entidade_id, antes, depois, motivo)
    values (
      ${ctx.origem === "ui" ? "usuario" : "sistema"},
      ${ctx.autorId},
      ${ctx.escopo.tipo === "uma" ? ctx.escopo.lojaId : null},
      ${acao},
      ${entidade},
      ${entidadeId},
      ${diff.antes === null ? null : JSON.stringify(diff.antes)}::jsonb,
      ${JSON.stringify(diff.depois)}::jsonb,
      ${motivo ?? null}
    )
  `);
}
