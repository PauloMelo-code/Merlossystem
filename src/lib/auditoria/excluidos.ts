import "server-only";
import { sql } from "drizzle-orm";
import type { EscopoLoja } from "@/lib/auth/loja";
import { db } from "@/lib/db/client";
import type { EntidadeExcluivel } from "@/lib/validadores/auditoria";
import type { Leitor } from "./consulta";
import { montarPagina, type Cursor, type Direcao, type Pagina } from "./cursor";

/**
 * `/auditoria/excluidos` — SOMENTE LEITURA (04-ui.md §5.5, R-01).
 *
 * Não existe "restaurar" no R1: não há ação em `ACOES_AUDITADAS`, não há
 * `restaurarLogico()` em `mutacoes.ts`, e restaurar colidiria com o único
 * parcial (telefone, atalho, slug reaproveitado). Esta tela mostra quem
 * excluiu (`modified_by`) e quando (`deleted_at`), e leva à trilha.
 *
 * A lista de entidades é FECHADA e o nome da tabela entra no SQL só a partir
 * dela — nunca da URL.
 */

type Config = { rotulo: string };

/** Expressão SQL do "o que era", por tabela. Constantes, sem entrada externa. */
const ENTIDADES: Readonly<Record<EntidadeExcluivel, Config>> = {
  contatos: { rotulo: "coalesce(t.nome, 'Contato sem nome')" },
  pedidos: { rotulo: "'Pedido ' || t.numero" },
  campanhas: { rotulo: "t.nome" },
  respostas_rapidas: { rotulo: "t.titulo" },
  conversas_agendamentos: { rotulo: "'Mensagem agendada'" },
  lojas_midias: { rotulo: "coalesce(t.nome_original, 'Arquivo sem nome')" },
  lojas_etiquetas: { rotulo: "t.nome" },
  lojas_integracoes: { rotulo: "t.rotulo" },
};

export type RegistroExcluido = {
  id: string;
  entidade: EntidadeExcluivel;
  rotulo: string;
  lojaId: string | null;
  excluidoEm: Date;
  excluidoPor: string | null;
  excluidoPorNome: string | null;
};

export type FiltrosExcluidos = {
  entidade: EntidadeExcluivel;
  de?: Date | undefined;
  ate?: Date | undefined;
  cursor: Cursor | null;
  direcao: Direcao;
  porPagina: number;
};

export async function listarExcluidos(
  escopo: EscopoLoja,
  f: FiltrosExcluidos,
  leitor: Leitor = db,
): Promise<Pagina<RegistroExcluido>> {
  const config = ENTIDADES[f.entidade];
  const tabela = sql.raw(f.entidade);
  const quando = sql.raw("coalesce(t.deleted_at, t.updated_at)");
  const loja =
    escopo.tipo === "nenhuma"
      ? sql`and false`
      : escopo.tipo === "uma"
        ? sql`and t.loja_id = ${escopo.lojaId}::uuid`
        : sql``;
  const anterior = f.direcao === "anterior";
  const cursor = f.cursor
    ? sql`and (${quando}, t.id) ${sql.raw(anterior ? ">" : "<")}
            (${f.cursor.em.toISOString()}::timestamptz, ${f.cursor.id}::uuid)`
    : sql``;
  const ordem = sql.raw(anterior ? "asc" : "desc");

  const resultado = await leitor.execute<{
    id: string;
    rotulo: string | null;
    loja_id: string | null;
    excluido_em: Date | string;
    excluido_por: string | null;
    excluido_por_nome: string | null;
  }>(sql`
    select t.id, ${sql.raw(config.rotulo)} as rotulo, t.loja_id,
           ${quando} as excluido_em, t.modified_by as excluido_por,
           (select u.nome from usuarios u where u.id = t.modified_by) as excluido_por_nome
      from ${tabela} t
     where t.is_deleted = true
       ${loja}
       ${f.de ? sql`and ${quando} >= ${f.de.toISOString()}::timestamptz` : sql``}
       ${f.ate ? sql`and ${quando} < ${f.ate.toISOString()}::timestamptz` : sql``}
       ${cursor}
     order by ${quando} ${ordem}, t.id ${ordem}
     limit ${f.porPagina + 1}`);

  const linhas = resultado.rows.map(
    (l): RegistroExcluido => ({
      id: l.id,
      entidade: f.entidade,
      rotulo: l.rotulo ?? "Sem descrição",
      lojaId: l.loja_id,
      excluidoEm: new Date(l.excluido_em),
      excluidoPor: l.excluido_por,
      excluidoPorNome: l.excluido_por_nome,
    }),
  );

  return montarPagina(linhas, f.porPagina, f.direcao, f.cursor !== null, (r) => ({
    em: r.excluidoEm,
    id: r.id,
  }));
}
