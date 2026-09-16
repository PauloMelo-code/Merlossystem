import "server-only";
import { env } from "@/lib/env";
import { ErroDeConfiguracao, ErroDeIntegracao } from "@/lib/erros";
import { buscarExterno } from "@/lib/rede/buscarExterno";
import type { StatusTemplate } from "@/lib/db/schema/_enums/plataforma";

/**
 * Modelos do WhatsApp na Graph API (03-arquitetura.md §12.2): leitura para a
 * sincronização e envio para revisão (costura `aprovacao.ts`).
 *
 * `META_GRAPH_VERSION` vem do ambiente, SEM default no código: a armadilha
 * registrada é um adaptador com `v18.0` cravado envelhecendo sem ninguém ver.
 */

export type ModeloDaMeta = {
  id: string;
  nome: string;
  idioma: string;
  status: StatusTemplate | null;
  motivo: string | null;
};

const MAX_PAGINAS = 20;

function versao(): string {
  const v = env.META_GRAPH_VERSION;
  if (!v) throw new ErroDeConfiguracao("Falta META_GRAPH_VERSION para falar com a Meta.");
  return v;
}

/** Status da Meta → os nossos. Desconhecido = não mexe (null). */
export function statusDaMeta(bruto: unknown): StatusTemplate | null {
  switch (String(bruto ?? "").toUpperCase()) {
    case "APPROVED":
      return "aprovado";
    case "REJECTED":
    case "DISABLED":
      return "rejeitado";
    case "PAUSED":
      return "pausado";
    case "PENDING":
    case "IN_APPEAL":
    case "PENDING_DELETION":
      return "enviado";
    default:
      return null;
  }
}

type Objeto = Record<string, unknown>;
const ehObjeto = (v: unknown): v is Objeto => typeof v === "object" && v !== null && !Array.isArray(v);

export function lerPagina(corpo: unknown): { modelos: ModeloDaMeta[]; proxima: string | null } {
  if (!ehObjeto(corpo)) return { modelos: [], proxima: null };
  const dados = Array.isArray(corpo.data) ? corpo.data : [];
  const modelos: ModeloDaMeta[] = [];
  for (const d of dados) {
    if (!ehObjeto(d) || typeof d.id !== "string" || typeof d.name !== "string") continue;
    const motivo = typeof d.rejected_reason === "string" && d.rejected_reason !== "NONE" ? d.rejected_reason : null;
    modelos.push({
      id: d.id,
      nome: d.name,
      idioma: typeof d.language === "string" ? d.language : "pt_BR",
      status: statusDaMeta(d.status),
      motivo,
    });
  }
  const paginacao = ehObjeto(corpo.paging) ? corpo.paging : {};
  return { modelos, proxima: typeof paginacao.next === "string" ? paginacao.next : null };
}

/** Texto que a Meta devolve no erro, curto e sem quebra: vai para a tela. */
function motivoDaMeta(corpo: unknown): string {
  const erro = ehObjeto(corpo) && ehObjeto(corpo.error) ? corpo.error : {};
  const texto = [erro.error_user_msg, erro.message].find((t): t is string => typeof t === "string");
  return (texto ?? "sem detalhe").replace(/\s+/g, " ").slice(0, 200);
}

/**
 * Uma chamada à Graph. 401/403 e 4xx (fora 429) são permanentes: retentar não
 * muda o veredito. 429 e 5xx sobem como transitórios.
 */
async function chamarGraph(url: string, token: string, corpo?: Objeto): Promise<unknown> {
  const resposta = await buscarExterno(url, {
    provedor: "meta",
    ...(corpo ? { metodo: "POST" as const, corpo: JSON.stringify(corpo) } : {}),
    cabecalhos: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      ...(corpo ? { "content-type": "application/json" } : {}),
    },
    maxBytes: 2 * 1024 * 1024,
  });
  let lido: unknown = null;
  try {
    lido = JSON.parse(resposta.bytes.toString("utf8"));
  } catch {
    lido = null;
  }
  const { status } = resposta;
  if (status === 401 || status === 403) {
    throw new ErroDeIntegracao("A Meta recusou o token da conta. Reconecte o número.", true);
  }
  if (status >= 400 && status < 500 && status !== 429) {
    throw new ErroDeIntegracao(`A Meta recusou o pedido: ${motivoDaMeta(lido)}`, true);
  }
  if (status < 200 || status >= 300) {
    throw new ErroDeIntegracao(`A Meta respondeu ${status}. Tente de novo em instantes.`, false);
  }
  if (lido === null) throw new ErroDeIntegracao("A Meta respondeu num formato inesperado.", false);
  return lido;
}

function exigirWaba(wabaId: string): void {
  if (!/^\d{5,32}$/.test(wabaId)) throw new ErroDeIntegracao("waba_id inválido na credencial.", true);
}

export async function listarModelosDaMeta(wabaId: string, token: string): Promise<ModeloDaMeta[]> {
  exigirWaba(wabaId);
  let url: string | null =
    `https://graph.facebook.com/${versao()}/${wabaId}/message_templates` +
    "?fields=id,name,language,status,rejected_reason&limit=100";
  const todos: ModeloDaMeta[] = [];

  for (let pagina = 0; url && pagina < MAX_PAGINAS; pagina += 1) {
    const lida = lerPagina(await chamarGraph(url, token));
    todos.push(...lida.modelos);
    url = lida.proxima;
  }
  return todos;
}

export type ModeloParaMeta = {
  nome: string;
  idioma: string;
  /** Já no formato da Meta: MARKETING, UTILITY. */
  categoria: string;
  componentes: Objeto[];
};

/**
 * Submete o modelo à revisão. Sem `metaId`, CRIA na WABA; com `metaId` (modelo
 * rejeitado), EDITA o que a Meta já tem — criar de novo com o mesmo nome é
 * recusado lá. Devolve o id da Meta e o status que ela respondeu.
 */
export async function submeterModeloNaMeta(
  wabaId: string,
  token: string,
  modelo: ModeloParaMeta,
  metaId: string | null,
): Promise<{ id: string; status: StatusTemplate }> {
  exigirWaba(wabaId);
  if (metaId !== null) {
    if (!/^\d{1,32}$/.test(metaId)) throw new ErroDeIntegracao("Id do modelo na Meta inválido.", true);
    await chamarGraph(`https://graph.facebook.com/${versao()}/${metaId}`, token, {
      category: modelo.categoria,
      components: modelo.componentes,
    });
    return { id: metaId, status: "enviado" };
  }
  const corpo = await chamarGraph(`https://graph.facebook.com/${versao()}/${wabaId}/message_templates`, token, {
    name: modelo.nome,
    language: modelo.idioma,
    category: modelo.categoria,
    components: modelo.componentes,
  });
  if (!ehObjeto(corpo) || typeof corpo.id !== "string") {
    throw new ErroDeIntegracao("A Meta não devolveu o id do modelo.", false);
  }
  return { id: corpo.id, status: statusDaMeta(corpo.status) ?? "enviado" };
}
