/**
 * Regras PURAS do atendimento (04-ui.md §5.2, §8.1; 01-dados-dominio.md §2).
 *
 * Sem I/O e sem `server-only`: o teste de unidade prova cada uma, e o servidor
 * é quem decide — a tela só recebe o veredito pronto.
 */

export const JANELA_24H_MS = 24 * 60 * 60 * 1000;

/** Tamanho das páginas (04-ui.md §5.2). */
export const PAGINA_CONVERSAS = 50;
export const PAGINA_MENSAGENS = 40;

/** Marcador que a anonimização grava no lugar do conteúdo (01-dados-dominio.md §8). */
export const MARCADOR_ANONIMIZADO = "[removido a pedido do titular]";

/**
 * Os QUATRO casos de composer bloqueado, e só quatro. Cada um explica e
 * oferece saída — nunca "Enviar" desabilitado e mudo. `sem_conexao` é
 * detectado no navegador; os outros três, aqui.
 */
export type BloqueioDoComposer =
  | { caso: "janela_24h" }
  | { caso: "desconectado"; conta: string; desde: string | null; podeReconectar: boolean }
  | { caso: "somente_leitura" }
  | { caso: "sem_conexao" };

export type EntradaDoBloqueio = {
  podeEscrever: boolean;
  provedor: string;
  statusConta: string;
  rotuloConta: string;
  contaAlteradaEm: Date | null;
  ultimaEntradaEm: Date | null;
  podeReconectar: boolean;
  agora?: Date;
};

/** A janela de 24 h só existe para quem a Meta cobra (WhatsApp oficial). */
export function janelaFechada(
  provedor: string,
  ultimaEntradaEm: Date | null,
  agora: Date = new Date(),
): boolean {
  if (provedor !== "whatsapp_oficial") return false;
  if (!ultimaEntradaEm) return true;
  return agora.getTime() - ultimaEntradaEm.getTime() > JANELA_24H_MS;
}

/**
 * Ordem de precedência: sem escrita (não há composer) → número desconectado
 * (nada sai, nem modelo) → janela fechada (só modelo). Opt-out NÃO bloqueia:
 * é de marketing, e a resposta 1:1 continua (01-dados-dominio.md §7.2).
 */
export function bloqueioDoComposer(e: EntradaDoBloqueio): BloqueioDoComposer | null {
  if (!e.podeEscrever) return { caso: "somente_leitura" };
  if (e.statusConta !== "conectado") {
    return {
      caso: "desconectado",
      conta: e.rotuloConta,
      desde: e.contaAlteradaEm ? e.contaAlteradaEm.toISOString() : null,
      podeReconectar: e.podeReconectar,
    };
  }
  if (janelaFechada(e.provedor, e.ultimaEntradaEm, e.agora)) return { caso: "janela_24h" };
  return null;
}

/** Aviso inline acima do composer (04-ui.md §5.2). */
export function avisoDoComposer(status: string, temResponsavel: boolean): string | null {
  if (status === "resolvida") return "Enviar reabre a conversa.";
  if (status === "arquivada") return "Esta conversa foi arquivada. Responder abre uma conversa nova.";
  if (!temResponsavel) return "Ao responder, a conversa fica com você.";
  return null;
}

/**
 * Cursor `(instante, id)` — o índice de cada lista (04-ui.md §8.1). Paginar
 * só pelo instante pulava mensagem do mesmo milissegundo (01/D-27).
 */
export type Cursor = { em: Date; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function codificarCursor(c: Cursor): string {
  return Buffer.from(`${c.em.toISOString()}|${c.id}`, "utf8").toString("base64url");
}

/** Cursor adulterado vira `null` (primeira página), nunca erro de banco. */
export function decodificarCursor(valor: string | null | undefined): Cursor | null {
  if (!valor) return null;
  let bruto: string;
  try {
    bruto = Buffer.from(valor, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const [iso, id] = bruto.split("|");
  if (!iso || !id || !UUID.test(id)) return null;
  const em = new Date(iso);
  return Number.isNaN(em.getTime()) ? null : { em, id };
}

/**
 * Status de entrega: escala monotônica, `falhou` terminal. Espelha o `where`
 * de `avancarStatusDeEntrega` para o teste de transição e para a tela
 * descartar evento fora de ordem.
 */
const ESCALA = ["pendente", "enviada", "entregue", "lida", "falhou"] as const;

export function podeAvancar(atual: string | null, novo: string): boolean {
  if (atual === "falhou") return false;
  const de = atual === null ? 0 : ESCALA.indexOf(atual as (typeof ESCALA)[number]) + 1;
  const para = ESCALA.indexOf(novo as (typeof ESCALA)[number]) + 1;
  return para > 0 && de < para;
}

/** Identificador de destino por provedor: WhatsApp manda telefone, Instagram o id. */
export function colunaDoCanal(provedor: string): "whatsapp_id" | "instagram_id" | null {
  if (provedor === "whatsapp_oficial" || provedor === "uazapi") return "whatsapp_id";
  if (provedor === "instagram") return "instagram_id";
  return null;
}

/** Texto do anúncio `aria-live`: só nome e 80 caracteres (04-ui.md §5.2). */
export function anuncioDeMensagem(nome: string, conteudo: string | null): string {
  const corpo = (conteudo ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  return corpo ? `Nova mensagem de ${nome}: ${corpo}` : `Nova mensagem de ${nome}`;
}

/** Prefixo da prévia na lista ("Você: ", "Nota: "). */
export function prefixoDaPrevia(direcao: string | null, notaInterna: boolean): string {
  if (notaInterna) return "Nota: ";
  return direcao === "saida" ? "Você: " : "";
}
