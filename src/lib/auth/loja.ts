import "server-only";
import { cookies } from "next/headers";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { ErroDeEscopo, ErroFaltaLoja } from "@/lib/erros";
import { PAPEIS_SEM_LOJA } from "@/lib/db/schema/_enums/auth";
import type { Papel } from "@/lib/db/schema/_enums/auth";
import type { Contexto, Sessao } from "./guard";

/**
 * Escopo de loja (02-seguranca.md §2.4, contrato de 01-dados.md §13.1).
 *
 * `escopoDeLeitura()` e `exigirLoja()` NÃO existem — eram nomes do rascunho.
 * `condicaoDeLoja()` vive em `src/lib/db/consultas.ts` e é usada por TODA
 * consulta de tabela com `loja_id`. Quem importa só o TIPO daqui
 * (`consultas.ts`, `mutacoes.ts`) usa `import type`, que é apagado na
 * compilação — o `server-only` deste arquivo não os alcança.
 */
export type EscopoLoja =
  | { tipo: "todas" }
  | { tipo: "uma"; lojaId: string }
  | { tipo: "nenhuma" };

const GESTAO = new Set<Papel>(PAPEIS_SEM_LOJA);

/** Papel de gestão escolhe a loja; operação usa a do próprio cadastro. */
export function ehPapelDeGestao(papel: Papel): boolean {
  return GESTAO.has(papel);
}

/**
 * `vendedor`/`viewer`: a loja vem do BANCO; parâmetro e cookie são IGNORADOS
 * (INV-02). Sem loja — estado que o CHECK do banco torna impossível — o escopo
 * é `nenhuma`, que FECHA, nunca abre (INV-04).
 *
 * `dono`/`admin`/`gerente`: a loja pedida vale se já tiver passado por
 * `conferirLojaViva()`. Sem escolha, `todas` para LER.
 */
export function escopoDeLoja(s: Sessao, lojaPedida?: string): EscopoLoja {
  if (!ehPapelDeGestao(s.papel)) {
    return s.lojaId ? { tipo: "uma", lojaId: s.lojaId } : { tipo: "nenhuma" };
  }
  return lojaPedida ? { tipo: "uma", lojaId: lojaPedida } : { tipo: "todas" };
}

/**
 * Para GRAVAR não existe "todas": gestão sem loja escolhida recebe
 * `FALTA_LOJA`. Chutar a loja é o começo de todo dado nascido na loja errada
 * (INV-05).
 */
export function lojaParaGravar(s: Sessao, lojaPedida?: string): string {
  const escopo = escopoDeLoja(s, lojaPedida);
  if (escopo.tipo !== "uma") throw new ErroFaltaLoja();
  return escopo.lojaId;
}

export function contextoDe(s: Sessao, lojaPedida?: string): Contexto {
  return {
    sessao: s,
    escopo: escopoDeLoja(s, lojaPedida),
    autorId: s.usuarioId,
    origem: "ui",
  };
}

/**
 * A metade assíncrona de §2.4: a loja pedida por cookie ou `?loja=` só é aceita
 * depois de conferir que EXISTE e tem `is_deleted = false`. `lojas` não tem
 * coluna `ativo` (01-dados.md §6.1): "loja ativa" é `is_deleted = false`.
 *
 * Fica fora de `escopoDeLoja()` porque a assinatura publicada em §13.1 é
 * SÍNCRONA, e é dela que dependem `consultas.ts`, `mutacoes.ts` e os oito
 * pacotes da onda 2. Quem resolve escopo a partir de entrada do cliente
 * (`actions/_base.ts` e a action que grava o cookie `loja_ativa`) chama isto
 * antes.
 */
export async function conferirLojaViva(lojaId: string): Promise<void> {
  const linhas = await db.execute<{ existe: boolean }>(sql`
    select exists (
      select 1 from lojas where id = ${lojaId}::uuid and is_deleted = false
    ) as existe
  `);
  // 404, nunca 403: confirmar que existe já entrega o que o escopo esconde.
  if (!linhas.rows[0]?.existe) throw new ErroDeEscopo();
}

/**
 * Resolve a loja pedida pelo cliente. Papel de operação nunca chega a consultar
 * o banco — a loja dele é a do cadastro, e o pedido é descartado.
 */
export async function resolverLojaPedida(
  s: Sessao,
  lojaPedida?: string | undefined,
): Promise<string | undefined> {
  if (!ehPapelDeGestao(s.papel)) return undefined;
  if (!lojaPedida) return undefined;
  await conferirLojaViva(lojaPedida);
  return lojaPedida;
}

/** Cookie de PREFERÊNCIA de loja (§2.4). Nunca autorização. */
export const COOKIE_LOJA = "loja_ativa";

/**
 * Porta única de leitura do cookie fora das actions: página de servidor e
 * Route Handler (SSE) chamam isto, nunca `cookies().get(COOKIE_LOJA)` (T13).
 * A loja pedida passa por `resolverLojaPedida`; cookie de loja que morreu cai
 * no escopo padrão do papel em vez de derrubar a tela.
 */
export async function escopoDoCookie(s: Sessao): Promise<EscopoLoja> {
  const pedida = (await cookies()).get(COOKIE_LOJA)?.value;
  let resolvida: string | undefined;
  try {
    resolvida = await resolverLojaPedida(s, pedida);
  } catch (erro) {
    if (!(erro instanceof ErroDeEscopo)) throw erro;
  }
  return escopoDeLoja(s, resolvida);
}
