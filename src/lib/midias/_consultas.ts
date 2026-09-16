import "server-only";
import { and, asc, desc, eq, inArray, lt, sql, type SQL } from "drizzle-orm";
import type { EscopoLoja } from "@/lib/auth/loja";
import { db } from "@/lib/db/client";
import { condicaoDeLoja, vivos, vivosE } from "@/lib/db/consultas";
import type { Transacao } from "@/lib/db/mutacoes";
import { conversas_mensagens_midias } from "@/lib/db/schema/conversas/mensagens-midias";
import { lojas_midias } from "@/lib/db/schema/midias";
import type { FiltrosGaleria } from "@/lib/validadores/midias";
import type { MidiaDto, PaginaDeMidias } from "./dto";

/**
 * Leituras do domínio de mídia. Toda consulta passa por `condicaoDeLoja` e
 * filtra `is_deleted` — a única leitura de linha excluída é a da rota de
 * leitura, e só quando a rota pede (RN-M06).
 */

const m = lojas_midias;

/** Projeção do DTO. Nenhum endereço entra aqui: a tela deriva a rota do `id`. */
const PROJECAO = {
  id: m.id,
  lojaId: m.loja_id,
  nomeOriginal: m.nome_original,
  tipoArquivo: m.tipo_arquivo,
  mimeType: m.mime_type,
  tamanhoBytes: m.tamanho_bytes,
  largura: m.largura,
  altura: m.altura,
  origem: m.origem,
  pasta: m.pasta,
  chaveMiniatura: m.chave_miniatura,
  criadaEm: m.created_at,
  updatedAt: m.updated_at,
};

type Linha = {
  id: string;
  lojaId: string;
  nomeOriginal: string | null;
  tipoArquivo: string;
  mimeType: string;
  tamanhoBytes: number;
  largura: number | null;
  altura: number | null;
  origem: string;
  pasta: string | null;
  chaveMiniatura: string | null;
  criadaEm: Date;
  updatedAt: Date;
};

function paraDto(l: Linha): MidiaDto {
  return {
    id: l.id,
    lojaId: l.lojaId,
    nomeOriginal: l.nomeOriginal,
    tipoArquivo: l.tipoArquivo as MidiaDto["tipoArquivo"],
    mimeType: l.mimeType,
    tamanhoBytes: l.tamanhoBytes,
    largura: l.largura,
    altura: l.altura,
    origem: l.origem as MidiaDto["origem"],
    pasta: l.pasta as MidiaDto["pasta"],
    temMiniatura: l.chaveMiniatura !== null,
    criadaEm: l.criadaEm.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };
}

/** Cursor opaco `(created_at, id)` (04-ui.md §8.1). */
export function codificarCursor(l: { criadaEm: string; id: string }): string {
  return Buffer.from(`${l.criadaEm}|${l.id}`).toString("base64url");
}

export function decodificarCursor(bruto: string): { em: string; id: string } | null {
  const [em, id] = Buffer.from(bruto, "base64url").toString("utf8").split("|");
  if (!em || !id || Number.isNaN(Date.parse(em)) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return { em, id };
}

/** Grade da galeria, por cursor, nos dois sentidos. */
export async function listarMidias(escopo: EscopoLoja, f: FiltrosGaleria): Promise<PaginaDeMidias> {
  const cursor = f.cursor ? decodificarCursor(f.cursor) : null;
  const voltando = cursor !== null && f.direcao === "anterior";
  const par = sql`(${m.created_at}, ${m.id})`;
  const doCursor = cursor ? sql`(${cursor.em}::timestamptz, ${cursor.id}::uuid)` : null;
  const corte: SQL | undefined = doCursor
    ? voltando
      ? sql`${par} > ${doCursor}`
      : sql`${par} < ${doCursor}`
    : undefined;

  const linhas = (await db
    .select(PROJECAO)
    .from(m)
    .where(
      vivosE(
        m,
        condicaoDeLoja(m, escopo),
        eq(m.origem, f.origem),
        f.pasta ? eq(m.pasta, f.pasta) : undefined,
        f.tipo ? eq(m.tipo_arquivo, f.tipo) : undefined,
        corte,
      ),
    )
    .orderBy(...(voltando ? [asc(m.created_at), asc(m.id)] : [desc(m.created_at), desc(m.id)]))
    .limit(f.porPagina + 1)) as Linha[];

  const temMais = linhas.length > f.porPagina;
  const pagina = linhas.slice(0, f.porPagina);
  if (voltando) pagina.reverse();
  const itens = pagina.map(paraDto);
  const primeiro = itens[0];
  const ultimo = itens.at(-1);

  return {
    itens,
    cursorAnterior: primeiro && cursor && (!voltando || temMais) ? codificarCursor(primeiro) : null,
    cursorProximo: ultimo && (voltando || temMais) ? codificarCursor(ultimo) : null,
  };
}

export type MidiaParaLeitura = {
  id: string;
  tipoArquivo: string;
  mimeType: string;
  nomeOriginal: string | null;
  chaveObjeto: string;
  chaveMiniatura: string | null;
};

/**
 * Linha para a rota de leitura. Por padrão só lê linha viva. Com
 * `servirExcluidaReferenciada`, lê também a EXCLUÍDA que uma mensagem viva
 * ainda aponta — apagar da galeria não pode furar o histórico (RN-M06). A
 * decisão de pedir isso é da rota, que carrega a `EXCECAO-SEG`.
 */
export async function midiaParaLeitura(
  id: string,
  escopo: EscopoLoja,
  opcoes: { servirExcluidaReferenciada?: boolean } = {},
): Promise<MidiaParaLeitura | null> {
  const referenciada = sql`exists (
    select 1 from ${conversas_mensagens_midias} ref
    where ref.midia_id = ${m.id} and ref.is_deleted = false)`;
  const visivel = opcoes.servirExcluidaReferenciada
    ? sql`(${m.is_deleted} = false or ${referenciada})`
    : vivos(m);

  const [linha] = await db
    .select({
      id: m.id,
      tipoArquivo: m.tipo_arquivo,
      mimeType: m.mime_type,
      nomeOriginal: m.nome_original,
      chaveObjeto: m.chave_objeto,
      chaveMiniatura: m.chave_miniatura,
    })
    .from(m)
    .where(and(eq(m.id, id), condicaoDeLoja(m, escopo), visivel))
    .limit(1);
  return linha ?? null;
}

/** Mídia viva com o mesmo conteúdo na loja (único parcial `(loja_id, hash)`). */
export async function midiaPorHash(
  executor: Transacao | typeof db,
  lojaId: string,
  hash: string,
): Promise<string | null> {
  const [linha] = await executor
    .select({ id: m.id })
    .from(m)
    .where(vivosE(m, eq(m.loja_id, lojaId), eq(m.hash_sha256, hash)))
    .limit(1);
  return linha?.id ?? null;
}

/** Chaves de uma mídia viva, para o job de miniatura. */
export async function chavesDaMidia(lojaId: string, midiaId: string) {
  const [linha] = await db
    .select({
      tipoArquivo: m.tipo_arquivo,
      chaveObjeto: m.chave_objeto,
      chaveMiniatura: m.chave_miniatura,
    })
    .from(m)
    .where(vivosE(m, eq(m.id, midiaId), eq(m.loja_id, lojaId)))
    .limit(1);
  return linha ?? null;
}

const a = conversas_mensagens_midias;

/** O anexo que ainda espera download (coluna de trabalho `url_externa`). */
export async function anexoParaBaixar(lojaId: string, anexoId: string) {
  const [linha] = await db
    .select({
      id: a.id,
      urlExterna: a.url_externa,
      baixada: a.baixada,
      midiaId: a.midia_id,
      mimeType: a.mime_type,
    })
    .from(a)
    .where(vivosE(a, eq(a.id, anexoId), eq(a.loja_id, lojaId)))
    .limit(1);
  return linha ?? null;
}

export const DIAS_DE_GUARDA = 90;

/**
 * Objetos de linha excluída há mais de 90 dias (01-dados-dominio.md §3.1), fora
 * os ainda referenciados por mensagem viva (RN-M06). Leitura de linha EXCLUÍDA
 * é o propósito: `is_deleted = true` explícito.
 */
export async function midiasParaLimpar(lojaId: string | undefined, limite: number) {
  return db
    .select({ id: m.id, chaveObjeto: m.chave_objeto, chaveMiniatura: m.chave_miniatura })
    .from(m)
    .where(
      and(
        eq(m.is_deleted, true),
        lt(m.deleted_at, sql`now() - make_interval(days => ${DIAS_DE_GUARDA})`),
        lojaId ? eq(m.loja_id, lojaId) : undefined,
        sql`not exists (select 1 from ${a} ref where ref.midia_id = ${m.id} and ref.is_deleted = false)`,
      ),
    )
    .orderBy(asc(m.deleted_at))
    .limit(limite);
}

/** Chaves de mídias por id, vivas ou não: a anonimização LGPD já as marcou. */
export async function chavesPorIds(ids: readonly string[]) {
  if (ids.length === 0) return [];
  return db
    .select({ id: m.id, chaveObjeto: m.chave_objeto, chaveMiniatura: m.chave_miniatura })
    .from(m)
    .where(inArray(m.id, [...ids]));
}
