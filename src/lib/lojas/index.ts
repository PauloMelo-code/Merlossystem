import "server-only";
import { and, count, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { vivos, vivosE } from "@/lib/db/consultas";
import {
  atualizarComTrava,
  excluirLogico,
  inserirAuditado,
  type Transacao,
} from "@/lib/db/mutacoes";
import { lojas } from "@/lib/db/schema/lojas";
import { usuarios } from "@/lib/db/schema/auth/usuarios";
import { lojas_integracoes } from "@/lib/db/schema/integracoes";
import type { Contexto } from "@/lib/auth/guard";
import { ErroDeValidacao } from "@/lib/erros";
import type { CriarLoja, DesativarLoja, EditarLoja } from "@/lib/validadores/lojas";

/**
 * Lojas — a unidade de escopo do sistema (01-dados.md §6.1; 04-ui.md §5.6).
 *
 * `lojas` não tem `loja_id`: o escopo desta tabela é o PAPEL (só dono e admin
 * gravam), e a action chama com `loja: "nenhuma"` para o escopo ser `todas`.
 */

export type LojaNaTela = {
  id: string;
  nome: string;
  slug: string;
  sigla: string;
  blingDepositoId: string | null;
  updatedAt: Date;
};

export async function listarLojas(): Promise<LojaNaTela[]> {
  return db
    .select({
      id: lojas.id,
      nome: lojas.nome,
      slug: lojas.slug,
      sigla: lojas.sigla,
      blingDepositoId: lojas.bling_deposito_id,
      updatedAt: lojas.updated_at,
    })
    .from(lojas)
    .where(vivos(lojas))
    .orderBy(lojas.nome);
}

/** Violação de único (`uq_lojas_slug`/`uq_lojas_sigla`) vira erro de campo. */
function traduzirUnico(erro: unknown, valores: Record<string, string>): never {
  const e = erro as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  const pg = e?.code ? e : e?.cause;
  if (pg?.code === "23505") {
    if (pg.constraint === "uq_lojas_slug") {
      throw new ErroDeValidacao({ slug: ["Já existe uma loja com este endereço."] }, valores);
    }
    if (pg.constraint === "uq_lojas_sigla") {
      throw new ErroDeValidacao({ sigla: ["Já existe uma loja com esta sigla."] }, valores);
    }
  }
  throw erro;
}

function valoresDe(d: CriarLoja): Record<string, string> {
  return { nome: d.nome, slug: d.slug, sigla: d.sigla, blingDepositoId: d.blingDepositoId ?? "" };
}

/**
 * O INSERT roda em SAVEPOINT: no Postgres um erro aborta a transação inteira, e
 * a tradução da violação de único precisa acontecer antes do rollback.
 */
export async function criarLoja(tx: Transacao, dados: CriarLoja, ctx: Contexto): Promise<{ id: string }> {
  try {
    const linha = await tx.transaction((sp) =>
      inserirAuditado(
        sp,
        lojas,
        { nome: dados.nome, slug: dados.slug, sigla: dados.sigla, bling_deposito_id: dados.blingDepositoId },
        ctx,
        "loja_criada",
      ),
    );
    return { id: String(linha.id) };
  } catch (erro) {
    return traduzirUnico(erro, valoresDe(dados));
  }
}

export async function editarLoja(
  tx: Transacao,
  dados: EditarLoja,
  ctx: Contexto,
): Promise<{ id: string; updatedAt: Date }> {
  try {
    const linha = await tx.transaction((sp) =>
      atualizarComTrava(
        sp,
        lojas,
        {
          id: dados.id,
          escopo: ctx.escopo,
          updatedAtOriginal: dados.updatedAt,
          dados: {
            nome: dados.nome,
            slug: dados.slug,
            sigla: dados.sigla,
            bling_deposito_id: dados.blingDepositoId,
          },
        },
        ctx,
        "loja_alterada",
      ),
    );
    return { id: dados.id, updatedAt: linha.updated_at as Date };
  } catch (erro) {
    return traduzirUnico(erro, valoresDe(dados));
  }
}

/**
 * Desativar é soft delete. Recusa enquanto a loja tiver pessoa de operação
 * ativa ou conta de canal viva: a FK `RESTRICT` não enxerga soft delete, e uma
 * vendedora presa a loja excluída — ou um webhook entrando nela — seria dado
 * nascendo em loja morta.
 */
export async function desativarLoja(tx: Transacao, dados: DesativarLoja, ctx: Contexto): Promise<void> {
  const [pessoas] = await tx
    .select({ n: count() })
    .from(usuarios)
    .where(vivosE(usuarios, eq(usuarios.loja_id, dados.id), eq(usuarios.ativo, true)));
  const [contas] = await tx
    .select({ n: count() })
    .from(lojas_integracoes)
    .where(
      vivosE(
        lojas_integracoes,
        eq(lojas_integracoes.loja_id, dados.id),
        isNull(lojas_integracoes.revogada_em),
        ne(lojas_integracoes.status, "desconectado"),
      ),
    );
  const problemas: string[] = [];
  if ((pessoas?.n ?? 0) > 0) problemas.push(`${pessoas!.n} pessoa(s) ativa(s) nesta loja — mude a loja delas antes`);
  if ((contas?.n ?? 0) > 0) problemas.push(`${contas!.n} conta(s) conectada(s) — desconecte antes`);
  if (problemas.length > 0) {
    throw new ErroDeValidacao({ _: problemas }, undefined, "Esta loja ainda está em uso.");
  }

  await excluirLogico(
    tx,
    lojas,
    { id: dados.id, escopo: ctx.escopo, updatedAtOriginal: dados.updatedAt },
    ctx,
    "loja_desativada",
  );
}

/** Existe e está viva? Usado ao atribuir conta de canal a uma loja. */
export async function lojaViva(tx: Transacao, lojaId: string): Promise<boolean> {
  const [linha] = await tx
    .select({ id: lojas.id })
    .from(lojas)
    .where(and(eq(lojas.id, lojaId), vivos(lojas)))
    .limit(1);
  return linha !== undefined;
}
