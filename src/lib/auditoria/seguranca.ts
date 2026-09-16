import "server-only";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db } from "@/lib/db/client";
import { auth_eventos } from "@/lib/db/schema/auth-eventos";
import { ErroDeEscopo } from "@/lib/erros";
import { detalhesParaTela, type ValorExibido } from "./apresentacao";
import type { Leitor } from "./consulta";
import {
  condicaoDoCursor,
  montarPagina,
  ordemDoCursor,
  type Cursor,
  type Direcao,
  type Pagina,
} from "./cursor";

/**
 * `/auditoria/seguranca` — a trilha de ACESSO (`auth_eventos`), 04-ui.md §5.5 e
 * 02-seguranca.md §17.8. Chave `seguranca:ler_eventos` (dono e admin; o gerente
 * NÃO alcança: a trilha carrega IP, agente e alvo de quem administra).
 *
 * Regras de exibição, e só esta camada as garante:
 *   - e-mail aparece como `email_hash` (HMAC), nunca em claro — a tabela nem
 *     tem o e-mail, e a consulta não faz join para buscá-lo;
 *   - a LISTAGEM não traz IP nem agente; eles aparecem só no detalhe.
 *
 * `auth_eventos` é da rede (sem loja): quem tem a chave vê a rede toda. E é
 * trilha append-only: não tem `is_deleted`, não há o que filtrar.
 */

export type FiltrosSeguranca = {
  pessoa?: string | undefined;
  tipo?: string | undefined;
  de?: Date | undefined;
  ate?: Date | undefined;
  cursor: Cursor | null;
  direcao: Direcao;
  porPagina: number;
};

const nome = (coluna: PgColumn) =>
  sql<string | null>`(select u.nome from usuarios u where u.id = ${coluna})`;

const RESUMO = {
  id: auth_eventos.id,
  criadoEm: auth_eventos.criado_em,
  tipo: auth_eventos.tipo,
  resultado: auth_eventos.resultado,
  meio: auth_eventos.meio,
  atorTipo: auth_eventos.ator_tipo,
  usuarioId: auth_eventos.usuario_id,
  usuarioNome: nome(auth_eventos.usuario_id),
  emailHash: auth_eventos.email_hash,
};

export type EventoDeAcesso = {
  id: string;
  criadoEm: Date;
  tipo: string;
  resultado: string;
  meio: string | null;
  atorTipo: string;
  usuarioId: string | null;
  usuarioNome: string | null;
  emailHash: string | null;
};

export type EventoDeAcessoDetalhado = EventoDeAcesso & {
  ip: string | null;
  agente: string | null;
  sessaoId: string | null;
  atorId: string | null;
  atorNome: string | null;
  alvoId: string | null;
  alvoNome: string | null;
  motivo: string | null;
  detalhes: Record<string, ValorExibido>;
};

export async function listarEventosDeAcesso(
  f: FiltrosSeguranca,
  leitor: Leitor = db,
): Promise<Pagina<EventoDeAcesso>> {
  const linhas = await leitor
    .select(RESUMO)
    .from(auth_eventos)
    .where(
      and(
        f.pessoa ? eq(auth_eventos.usuario_id, f.pessoa) : undefined,
        f.tipo ? eq(auth_eventos.tipo, f.tipo) : undefined,
        f.de ? gte(auth_eventos.criado_em, f.de) : undefined,
        f.ate ? lt(auth_eventos.criado_em, f.ate) : undefined,
        condicaoDoCursor(auth_eventos.criado_em, auth_eventos.id, f.cursor, f.direcao),
      ),
    )
    .orderBy(...ordemDoCursor(auth_eventos.criado_em, auth_eventos.id, f.direcao))
    .limit(f.porPagina + 1);

  return montarPagina(linhas, f.porPagina, f.direcao, f.cursor !== null, (e) => ({
    em: e.criadoEm,
    id: e.id,
  }));
}

export async function detalheDoEventoDeAcesso(
  id: string,
  leitor: Leitor = db,
): Promise<EventoDeAcessoDetalhado> {
  const [linha] = await leitor
    .select({
      ...RESUMO,
      ip: auth_eventos.ip,
      agente: auth_eventos.agente,
      sessaoId: auth_eventos.sessao_id,
      atorId: auth_eventos.ator_id,
      atorNome: nome(auth_eventos.ator_id),
      alvoId: auth_eventos.alvo_id,
      alvoNome: nome(auth_eventos.alvo_id),
      motivo: auth_eventos.motivo,
      detalhes: auth_eventos.detalhes,
    })
    .from(auth_eventos)
    .where(eq(auth_eventos.id, id))
    .limit(1);
  if (!linha) throw new ErroDeEscopo();
  return { ...linha, detalhes: detalhesParaTela(linha.detalhes) };
}
