import "server-only";
import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import type { EscopoLoja } from "@/lib/auth/loja";
import { db } from "@/lib/db/client";
import { condicaoDeLoja, vivos } from "@/lib/db/consultas";
import type { Transacao } from "@/lib/db/mutacoes";
import { auditoria_eventos } from "@/lib/db/schema/auditoria";
import { usuarios } from "@/lib/db/schema/auth/usuarios";
import { ErroDeEscopo } from "@/lib/erros";
import {
  detalhesParaTela,
  diffParaTela,
  type LinhaDeDiff,
  type ValorExibido,
} from "./apresentacao";
import {
  condicaoDoCursor,
  montarPagina,
  ordemDoCursor,
  type Cursor,
  type Direcao,
  type Pagina,
} from "./cursor";

/**
 * LEITURA da trilha de negócio (`auditoria_eventos`) — a aba principal de
 * `/auditoria` (04-ui.md §5.5). A escrita é `gravador.ts`, da fundação.
 *
 * `auditoria_eventos` é append-only e não tem `is_deleted`: não existe evento
 * "excluído", e esta tela não tem ação de exclusão em lugar nenhum.
 *
 * Escopo: gestão com uma loja escolhida vê só os eventos daquela loja; com
 * "todas", vê também as ações de rede (`loja_id` nulo).
 */

export type Leitor = typeof db | Transacao;

export type FiltrosTrilha = {
  pessoa?: string | undefined;
  acao?: string | undefined;
  entidade?: string | undefined;
  entidadeId?: string | undefined;
  de?: Date | undefined;
  ate?: Date | undefined;
  cursor: Cursor | null;
  direcao: Direcao;
  porPagina: number;
};

export type EventoNaLista = {
  id: string;
  criadoEm: Date;
  atorTipo: string;
  atorId: string | null;
  atorNome: string | null;
  lojaId: string | null;
  acao: string;
  entidade: string;
  entidadeId: string | null;
};

export type EventoDetalhado = EventoNaLista & {
  motivo: string | null;
  diff: LinhaDeDiff[];
  detalhes: Record<string, ValorExibido>;
};

const nomeDoAtor = sql<string | null>`(select u.nome from usuarios u where u.id = ${auditoria_eventos.ator_id})`;

const PROJECAO = {
  id: auditoria_eventos.id,
  criadoEm: auditoria_eventos.criado_em,
  atorTipo: auditoria_eventos.ator_tipo,
  atorId: auditoria_eventos.ator_id,
  atorNome: nomeDoAtor,
  lojaId: auditoria_eventos.loja_id,
  acao: auditoria_eventos.acao,
  entidade: auditoria_eventos.entidade,
  entidadeId: auditoria_eventos.entidade_id,
};

export async function listarTrilha(
  escopo: EscopoLoja,
  f: FiltrosTrilha,
  leitor: Leitor = db,
): Promise<Pagina<EventoNaLista>> {
  const linhas = await leitor
    .select(PROJECAO)
    .from(auditoria_eventos)
    .where(
      and(
        condicaoDeLoja(auditoria_eventos, escopo),
        f.pessoa ? eq(auditoria_eventos.ator_id, f.pessoa) : undefined,
        f.acao ? eq(auditoria_eventos.acao, f.acao) : undefined,
        f.entidade ? eq(auditoria_eventos.entidade, f.entidade) : undefined,
        f.entidadeId ? eq(auditoria_eventos.entidade_id, f.entidadeId) : undefined,
        f.de ? gte(auditoria_eventos.criado_em, f.de) : undefined,
        f.ate ? lt(auditoria_eventos.criado_em, f.ate) : undefined,
        condicaoDoCursor(auditoria_eventos.criado_em, auditoria_eventos.id, f.cursor, f.direcao),
      ),
    )
    .orderBy(...ordemDoCursor(auditoria_eventos.criado_em, auditoria_eventos.id, f.direcao))
    .limit(f.porPagina + 1);

  return montarPagina(linhas, f.porPagina, f.direcao, f.cursor !== null, (e) => ({
    em: e.criadoEm,
    id: e.id,
  }));
}

/** Evento de outra loja responde 404 — nunca 403 (INV-04). */
export async function detalheDoEvento(
  escopo: EscopoLoja,
  id: string,
  leitor: Leitor = db,
): Promise<EventoDetalhado> {
  const [linha] = await leitor
    .select({
      ...PROJECAO,
      motivo: auditoria_eventos.motivo,
      antes: auditoria_eventos.antes,
      depois: auditoria_eventos.depois,
      detalhes: auditoria_eventos.detalhes,
    })
    .from(auditoria_eventos)
    .where(and(eq(auditoria_eventos.id, id), condicaoDeLoja(auditoria_eventos, escopo)))
    .limit(1);
  if (!linha) throw new ErroDeEscopo();
  const { antes, depois, detalhes, ...resto } = linha;
  return {
    ...resto,
    diff: diffParaTela(linha.entidade, antes, depois),
    detalhes: detalhesParaTela(detalhes),
  };
}

/** Pessoas para o filtro "pessoa" (equipe viva e desativada: a trilha é histórica). */
export async function pessoasDaEquipe(
  escopo: EscopoLoja,
  leitor: Leitor = db,
): Promise<{ id: string; nome: string }[]> {
  return leitor
    .select({ id: usuarios.id, nome: usuarios.nome })
    .from(usuarios)
    .where(
      and(
        vivos(usuarios),
        escopo.tipo === "uma"
          ? sql`(${usuarios.loja_id} = ${escopo.lojaId}::uuid or ${usuarios.loja_id} is null)`
          : escopo.tipo === "nenhuma"
            ? sql`false`
            : undefined,
      ),
    )
    .orderBy(asc(usuarios.nome));
}
