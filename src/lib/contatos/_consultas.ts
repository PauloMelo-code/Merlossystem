import "server-only";
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import type { EscopoLoja } from "@/lib/auth/loja";
import { condicaoDeLoja, vivos, vivosE } from "@/lib/db/consultas";
import type { Transacao } from "@/lib/db/mutacoes";
import { contatos, contatos_etiquetas } from "@/lib/db/schema/contatos";
import { conversas } from "@/lib/db/schema/conversas/conversas";
import { lojas_integracoes } from "@/lib/db/schema/integracoes";
import { lojas, lojas_etiquetas } from "@/lib/db/schema/lojas";
import { pedidos } from "@/lib/db/schema/pedidos/pedidos";
import type { FiltrosContatos } from "@/lib/validadores/contatos";
import { codificarCursor, decodificarCursor, escaparLike } from "./_regras";
import { digitosDaBusca } from "./telefone";

/**
 * Leituras do módulo de contatos. TODA consulta passa por `condicaoDeLoja`
 * (escopo) e por `vivos` (soft delete) — a carteira é isolada por loja (DN-05).
 */

const projecaoDaLista = {
  id: contatos.id,
  lojaId: contatos.loja_id,
  lojaNome: lojas.nome,
  nome: contatos.nome,
  telefone: contatos.telefone,
  email: contatos.email,
  whatsappId: contatos.whatsapp_id,
  instagramId: contatos.instagram_id,
  optOut: contatos.opt_out,
  ultimoContatoEm: contatos.ultimo_contato_em,
  pedidosContagem: contatos.pedidos_contagem,
  anonimizadoEm: contatos.anonimizado_em,
};

export type LinhaDaCarteira = {
  id: string;
  lojaId: string;
  lojaNome: string | null;
  nome: string | null;
  telefone: string | null;
  email: string | null;
  whatsappId: string | null;
  instagramId: string | null;
  optOut: boolean;
  ultimoContatoEm: Date | null;
  pedidosContagem: number;
  anonimizadoEm: Date | null;
};

/** O `WHERE` dos filtros — o MESMO na lista, na contagem e no CSV. */
function condicaoDosFiltros(escopo: EscopoLoja, filtros: FiltrosContatos): SQL | undefined {
  const partes: (SQL | undefined)[] = [condicaoDeLoja(contatos, escopo)];
  const termo = filtros.busca?.trim();
  if (termo) {
    const porNome = ilike(contatos.nome, `${escaparLike(termo)}%`);
    const digitos = digitosDaBusca(termo);
    partes.push(
      digitos.length >= 4 ? or(porNome, sql`${contatos.telefone} like ${`%${digitos}%`}`) : porNome,
    );
  }
  if (filtros.optOut) partes.push(eq(contatos.opt_out, filtros.optOut === "sim"));
  if (filtros.etiqueta) {
    partes.push(
      sql`exists (select 1 from ${contatos_etiquetas}
            where ${contatos_etiquetas.contato_id} = ${contatos.id}
              and ${contatos_etiquetas.etiqueta_id} = ${filtros.etiqueta}
              and ${contatos_etiquetas.is_deleted} = false)`,
    );
  }
  return vivosE(contatos, ...partes);
}

/**
 * Keyset `(ultimo_contato_em DESC NULLS LAST, id DESC)` (04-ui.md §8.1). O
 * `null` entra no cursor: contato criado à mão e nunca contatado também pagina.
 */
function condicaoDoCursor(texto: string | undefined, anterior: boolean): SQL | undefined {
  const cursor = decodificarCursor(texto);
  if (!cursor) return undefined;
  const u = contatos.ultimo_contato_em;
  if (cursor.t === null) {
    return anterior
      ? or(isNotNull(u), and(isNull(u), sql`${contatos.id} > ${cursor.id}`))
      : and(isNull(u), sql`${contatos.id} < ${cursor.id}`);
  }
  const t = new Date(cursor.t);
  return anterior
    ? or(sql`${u} > ${t}`, and(eq(u, t), sql`${contatos.id} > ${cursor.id}`))
    : or(sql`${u} < ${t}`, and(eq(u, t), sql`${contatos.id} < ${cursor.id}`), isNull(u));
}

const cursorDe = (l: LinhaDaCarteira) =>
  codificarCursor({ t: l.ultimoContatoEm ? l.ultimoContatoEm.toISOString() : null, id: l.id });

export async function listarCarteira(tx: Transacao, escopo: EscopoLoja, filtros: FiltrosContatos) {
  const anterior = filtros.direcao === "anterior" && Boolean(filtros.cursor);
  const ordem = anterior
    ? [sql`${contatos.ultimo_contato_em} asc nulls first`, asc(contatos.id)]
    : [sql`${contatos.ultimo_contato_em} desc nulls last`, desc(contatos.id)];

  const filtro = condicaoDosFiltros(escopo, filtros);
  const linhas: LinhaDaCarteira[] = await tx
    .select(projecaoDaLista)
    .from(contatos)
    .leftJoin(lojas, eq(lojas.id, contatos.loja_id))
    .where(and(filtro, condicaoDoCursor(filtros.cursor, anterior)))
    .orderBy(...ordem)
    .limit(filtros.porPagina + 1);

  const temMais = linhas.length > filtros.porPagina;
  const pagina = linhas.slice(0, filtros.porPagina);
  if (anterior) pagina.reverse();

  const [contagem] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(contatos)
    .where(filtro);

  const primeira = pagina[0];
  const ultima = pagina[pagina.length - 1];
  const houveCursor = Boolean(filtros.cursor);
  return {
    itens: pagina,
    total: contagem?.total ?? 0,
    cursorAnterior: primeira && (anterior ? temMais : houveCursor) ? cursorDe(primeira) : null,
    cursorProximo: ultima && (anterior ? true : temMais) ? cursorDe(ultima) : null,
  };
}

/** Teto do CSV: a exportação é da lista filtrada, não um backup da carteira. */
export const LIMITE_CSV = 5000;

export async function carteiraParaCsv(tx: Transacao, escopo: EscopoLoja, filtros: FiltrosContatos) {
  return tx
    .select(projecaoDaLista)
    .from(contatos)
    .leftJoin(lojas, eq(lojas.id, contatos.loja_id))
    .where(condicaoDosFiltros(escopo, filtros))
    .orderBy(sql`${contatos.ultimo_contato_em} desc nulls last`, desc(contatos.id))
    .limit(LIMITE_CSV);
}

export async function lerContato(tx: Transacao, escopo: EscopoLoja, id: string) {
  const [linha] = await tx
    .select({ contato: contatos, lojaNome: lojas.nome })
    .from(contatos)
    .leftJoin(lojas, eq(lojas.id, contatos.loja_id))
    .where(vivosE(contatos, eq(contatos.id, id), condicaoDeLoja(contatos, escopo)))
    .limit(1);
  return linha ?? null;
}

export async function etiquetasDoContato(tx: Transacao, lojaId: string, contatoId: string) {
  return tx
    .select({
      vinculoId: contatos_etiquetas.id,
      vinculoAtualizadoEm: contatos_etiquetas.updated_at,
      id: lojas_etiquetas.id,
      nome: lojas_etiquetas.nome,
      cor: lojas_etiquetas.cor,
    })
    .from(contatos_etiquetas)
    .innerJoin(lojas_etiquetas, eq(lojas_etiquetas.id, contatos_etiquetas.etiqueta_id))
    .where(
      and(
        vivos(contatos_etiquetas),
        eq(contatos_etiquetas.loja_id, lojaId),
        eq(contatos_etiquetas.contato_id, contatoId),
      ),
    )
    .orderBy(asc(lojas_etiquetas.nome));
}

/** Catálogo de etiquetas; `todas` lista as da rede, para o filtro da gestão. */
export async function etiquetasDisponiveis(tx: Transacao, escopo: EscopoLoja) {
  return tx
    .select({ id: lojas_etiquetas.id, nome: lojas_etiquetas.nome, cor: lojas_etiquetas.cor })
    .from(lojas_etiquetas)
    .where(vivosE(lojas_etiquetas, condicaoDeLoja(lojas_etiquetas, escopo)))
    .orderBy(asc(lojas_etiquetas.nome));
}

/** Só os ids que existem, vivos, NA loja — id de outra loja nunca vira vínculo (INV-10). */
export async function etiquetasDaLoja(tx: Transacao, lojaId: string, ids: readonly string[]) {
  if (ids.length === 0) return [];
  const linhas = await tx
    .select({ id: lojas_etiquetas.id })
    .from(lojas_etiquetas)
    .where(vivosE(lojas_etiquetas, eq(lojas_etiquetas.loja_id, lojaId), inArray(lojas_etiquetas.id, [...ids])));
  return linhas.map((l) => l.id);
}

export async function contatosDaLoja(tx: Transacao, lojaId: string, ids: readonly string[]) {
  if (ids.length === 0) return [];
  const linhas = await tx
    .select({ id: contatos.id })
    .from(contatos)
    .where(vivosE(contatos, eq(contatos.loja_id, lojaId), inArray(contatos.id, [...ids])));
  return linhas.map((l) => l.id);
}

/** Vínculos vivos de uma etiqueta para os contatos dados (evita duplicar). */
export async function vinculosExistentes(tx: Transacao, lojaId: string, etiquetaId: string, contatoIds: readonly string[]) {
  if (contatoIds.length === 0) return [];
  const linhas = await tx
    .select({ contatoId: contatos_etiquetas.contato_id })
    .from(contatos_etiquetas)
    .where(
      vivosE(
        contatos_etiquetas,
        eq(contatos_etiquetas.loja_id, lojaId),
        eq(contatos_etiquetas.etiqueta_id, etiquetaId),
        inArray(contatos_etiquetas.contato_id, [...contatoIds]),
      ),
    );
  return linhas.map((l) => l.contatoId);
}

/** Telefone já usado por contato VIVO desta loja (o único parcial recusaria). */
export async function telefoneEmUso(tx: Transacao, lojaId: string, telefone: string, excetoId?: string) {
  const [linha] = await tx
    .select({ id: contatos.id })
    .from(contatos)
    .where(
      vivosE(
        contatos,
        eq(contatos.loja_id, lojaId),
        eq(contatos.telefone, telefone),
        excetoId ? ne(contatos.id, excetoId) : undefined,
      ),
    )
    .limit(1);
  return Boolean(linha);
}

/**
 * Contato EXCLUÍDO com o mesmo número (01-dados-dominio.md §2.1): o índice
 * parcial libera o novo; a tela só avisa. Reativar o antigo é decisão de
 * produto, não deste módulo. Lê de propósito `is_deleted = true`.
 */
export async function existeExcluidoComTelefone(tx: Transacao, lojaId: string, telefone: string) {
  const [linha] = await tx
    .select({ id: contatos.id })
    .from(contatos)
    .where(and(eq(contatos.loja_id, lojaId), eq(contatos.telefone, telefone), eq(contatos.is_deleted, true)))
    .limit(1);
  return Boolean(linha);
}

const LIMITE_DA_FICHA = 20;

export async function conversasDoContato(tx: Transacao, lojaId: string, contatoId: string) {
  return tx
    .select({
      id: conversas.id,
      status: conversas.status,
      ultimaMensagemEm: conversas.ultima_mensagem_em,
      provedor: lojas_integracoes.provedor,
      contaRotulo: lojas_integracoes.rotulo,
    })
    .from(conversas)
    .leftJoin(lojas_integracoes, eq(lojas_integracoes.id, conversas.integracao_id))
    .where(vivosE(conversas, eq(conversas.loja_id, lojaId), eq(conversas.contato_id, contatoId)))
    .orderBy(sql`${conversas.ultima_mensagem_em} desc nulls last`)
    .limit(LIMITE_DA_FICHA);
}

export async function pedidosDoContato(tx: Transacao, lojaId: string, contatoId: string) {
  return tx
    .select({
      id: pedidos.id,
      numero: pedidos.numero,
      status: pedidos.status,
      total: pedidos.total,
      criadoEm: pedidos.created_at,
    })
    .from(pedidos)
    .where(vivosE(pedidos, eq(pedidos.loja_id, lojaId), eq(pedidos.contato_id, contatoId)))
    .orderBy(desc(pedidos.created_at))
    .limit(LIMITE_DA_FICHA);
}
