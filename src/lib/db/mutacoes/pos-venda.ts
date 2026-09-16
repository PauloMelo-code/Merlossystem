import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { condicaoDeLoja, vivos } from "../consultas";
import { pesquisas_satisfacao } from "../schema/lgpd";
import type { ContextoDeGravacao } from "../sistema";
import { diffAuditado, registrarAuditoria, type Transacao } from "./base";

const p = pesquisas_satisfacao;

/**
 * Resposta de pesquisa de satisfação (ADR 0038): registro atômico. Só a PRIMEIRA
 * resposta vale; zero linhas = já respondida e nada acontece. `nota` nula = a
 * cliente pediu para sair. Grava `updated_at`, `modified_by` e a trilha.
 * `ctx` é de gravação: a resposta chega pela ingestão (worker), sem sessão.
 */
export async function registrarRespostaDePesquisa(
  tx: Transacao,
  pesquisaId: string,
  resposta: { nota: number | null; respondidaEm: Date },
  ctx: ContextoDeGravacao,
): Promise<boolean> {
  const dados = { nota: resposta.nota, respondida_em: resposta.respondidaEm };
  const linhas = await tx
    .update(p)
    .set({ ...dados, updated_at: new Date(), modified_by: ctx.autorId })
    .where(and(eq(p.id, pesquisaId), isNull(p.respondida_em), condicaoDeLoja(p as never, ctx.escopo), vivos(p)))
    .returning({ id: p.id });
  if (linhas.length === 0) return false;
  await registrarAuditoria(
    tx,
    ctx,
    "pesquisa_respondida",
    "pesquisas_satisfacao",
    pesquisaId,
    diffAuditado("pesquisas_satisfacao", { nota: null, respondida_em: null }, dados),
    resposta.nota === null ? "pediu para sair" : undefined,
  );
  return true;
}

/** Comentário depois da nota: grava uma vez só. O diff sai mascarado (CAMPOS_PII). */
export async function registrarComentarioDePesquisa(
  tx: Transacao,
  pesquisaId: string,
  comentario: string,
  ctx: ContextoDeGravacao,
): Promise<boolean> {
  const linhas = await tx
    .update(p)
    .set({ comentario, updated_at: new Date(), modified_by: ctx.autorId })
    .where(
      and(
        eq(p.id, pesquisaId),
        isNotNull(p.nota),
        isNull(p.comentario),
        condicaoDeLoja(p as never, ctx.escopo),
        vivos(p),
      ),
    )
    .returning({ id: p.id });
  if (linhas.length === 0) return false;
  await registrarAuditoria(
    tx,
    ctx,
    "pesquisa_respondida",
    "pesquisas_satisfacao",
    pesquisaId,
    diffAuditado("pesquisas_satisfacao", { comentario: null }, { comentario }),
  );
  return true;
}
