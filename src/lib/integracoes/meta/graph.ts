import "server-only";
import { env } from "@/lib/env";
import { ErroDeConfiguracao, ErroDeIntegracao } from "@/lib/erros";
import { buscarExterno } from "@/lib/rede/buscarExterno";
import type { StatusTemplate } from "@/lib/db/schema/_enums/plataforma";

/**
 * Leitura dos modelos do WhatsApp na Graph API (03-arquitetura.md §12.2).
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

export async function listarModelosDaMeta(wabaId: string, token: string): Promise<ModeloDaMeta[]> {
  if (!/^\d{5,32}$/.test(wabaId)) throw new ErroDeIntegracao("waba_id inválido na credencial.", true);
  let url: string | null =
    `https://graph.facebook.com/${versao()}/${wabaId}/message_templates` +
    "?fields=id,name,language,status,rejected_reason&limit=100";
  const todos: ModeloDaMeta[] = [];

  for (let pagina = 0; url && pagina < MAX_PAGINAS; pagina += 1) {
    const resposta = await buscarExterno(url, {
      provedor: "meta",
      cabecalhos: { authorization: `Bearer ${token}`, accept: "application/json" },
      maxBytes: 2 * 1024 * 1024,
    });
    if (resposta.status === 401 || resposta.status === 403) {
      throw new ErroDeIntegracao("A Meta recusou o token da conta. Reconecte o número.", true);
    }
    if (resposta.status < 200 || resposta.status >= 300) {
      throw new ErroDeIntegracao(`A Meta respondeu ${resposta.status} ao listar modelos.`, false);
    }
    let corpo: unknown = null;
    try {
      corpo = JSON.parse(resposta.bytes.toString("utf8"));
    } catch {
      throw new ErroDeIntegracao("A Meta respondeu num formato inesperado.", false);
    }
    const lida = lerPagina(corpo);
    todos.push(...lida.modelos);
    url = lida.proxima;
  }
  return todos;
}
