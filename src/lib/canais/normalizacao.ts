import type {
  ClienteHttp,
  InterpretacaoDeWebhook,
  MidiaParaEnvio,
  ResultadoEnvio,
  TipoNormalizado,
} from "./tipos";

/**
 * Peças PURAS que os três adaptadores dividem (03-arquitetura.md §10.1).
 *
 * Sem `server-only` e sem `env`: os parsers de webhook são testados com payload
 * fixo, em Node puro. Nada aqui lança — o payload vem de terceiro, e um parser
 * que lança derruba a ingestão inteira (risco escrito do pacote M1).
 */

/** Objeto qualquer lido de JSON: acesso seguro, sem `any`. */
export type Bruto = Record<string, unknown>;

export function vazio(): InterpretacaoDeWebhook {
  return { mensagens: [], status: [], descartados: [] };
}

/** `JSON.parse` que nunca lança. Corpo ilegível = `null`. */
export function lerJson(corpoCru: string): Bruto | null {
  try {
    const valor: unknown = JSON.parse(corpoCru);
    return comoObjeto(valor);
  } catch {
    return null;
  }
}

export function comoObjeto(valor: unknown): Bruto | null {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor)
    ? (valor as Bruto)
    : null;
}

export function comoLista(valor: unknown): unknown[] {
  return Array.isArray(valor) ? valor : [];
}

/** Texto não vazio, ou `undefined`. Número vira texto (ids do provedor). */
export function texto(valor: unknown): string | undefined {
  if (typeof valor === "number" && Number.isFinite(valor)) return String(valor);
  if (typeof valor !== "string") return undefined;
  const limpo = valor.trim();
  return limpo === "" ? undefined : limpo;
}

/** Primeiro texto presente entre vários caminhos possíveis do mesmo campo. */
export function primeiro(...valores: unknown[]): string | undefined {
  for (const v of valores) {
    const t = texto(v);
    if (t !== undefined) return t;
  }
  return undefined;
}

/**
 * O provedor manda o instante em segundos, milissegundos ou ISO. Ilegível vira
 * "agora": perder a mensagem por causa do relógio seria pior que a ordem
 * aproximada.
 */
export function paraData(valor: unknown, agora: Date = new Date()): Date {
  if (typeof valor === "string" && /^\d+$/.test(valor)) return paraData(Number(valor), agora);
  if (typeof valor === "number" && Number.isFinite(valor) && valor > 0) {
    return new Date(valor < 1e12 ? valor * 1000 : valor);
  }
  if (typeof valor === "string") {
    const d = new Date(valor);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return agora;
}

/** Telefone canônico: E.164 só dígitos, o mesmo CHECK de `contatos.telefone`. */
export const REGEX_E164 = /^[1-9][0-9]{9,14}$/;

/**
 * O id de remetente do WhatsApp é o telefone com sufixo (`@s.whatsapp.net`).
 * Só vira `telefone` quando casa com o CHECK — senão o insert do contato
 * falharia e a mensagem se perderia.
 */
export function telefoneDoRemetente(id: string): string | undefined {
  const digitos = id.replace(/@.*$/, "").replace(/\D/g, "");
  return REGEX_E164.test(digitos) ? digitos : undefined;
}

/** Tamanho da prévia da lista (`conversas.ultima_mensagem_previa`). */
export const TAMANHO_PREVIA = 100;

const ROTULO_DE_TIPO: Record<string, string> = {
  imagem: "Foto",
  video: "Vídeo",
  audio: "Áudio",
  documento: "Documento",
  sticker: "Figurinha",
  localizacao: "Localização",
  template: "Modelo",
};

/** "Foto", "Áudio"… quando não há texto; o texto cortado em 100 quando há. */
export function previa(tipo: string, conteudo: string | null | undefined): string {
  const base = conteudo?.replace(/\s+/g, " ").trim();
  const texto_ = base && base !== "" ? base : (ROTULO_DE_TIPO[tipo] ?? "Mensagem");
  return texto_.length > TAMANHO_PREVIA ? `${texto_.slice(0, TAMANHO_PREVIA - 1)}…` : texto_;
}

/** Tipo de arquivo da linha de mídia a partir do tipo da mensagem. */
export function tipoDeArquivo(
  tipo: TipoNormalizado,
  mime?: string,
): "imagem" | "video" | "audio" | "documento" | "sticker" {
  if (tipo === "imagem" || tipo === "video" || tipo === "audio" || tipo === "sticker") return tipo;
  if (tipo === "documento") return "documento";
  if (mime?.startsWith("image/")) return "imagem";
  if (mime?.startsWith("video/")) return "video";
  if (mime?.startsWith("audio/")) return "audio";
  return "documento";
}

/** MIME padrão quando o provedor não diz (a coluna é NOT NULL). */
export function mimePadrao(tipo: string): string {
  switch (tipo) {
    case "imagem":
      return "image/jpeg";
    case "sticker":
      return "image/webp";
    case "video":
      return "video/mp4";
    case "audio":
      return "audio/ogg";
    default:
      return "application/octet-stream";
  }
}

/** Resposta HTTP como objeto, sem lançar. */
export function jsonDaResposta(bytes: Buffer): Bruto {
  return lerJson(bytes.toString("utf8")) ?? {};
}

/**
 * 4xx de credencial/destino é permanente; 429 e 5xx são transitórios. A fila
 * só retenta o transitório (03-arquitetura.md §8.2).
 */
export function ehPermanente(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/**
 * Erro de rede vira RESULTADO, não exceção (§10.1). `buscarExterno` lança
 * `ErroDeIntegracao` (com `permanente`) na recusa de endereço; o resto é
 * transitório.
 */
export async function chamar(
  http: ClienteHttp,
  url: string,
  opcoes: Parameters<ClienteHttp>[1],
): Promise<{ ok: true; status: number; corpo: Bruto } | { ok: false; resultado: ResultadoEnvio }> {
  try {
    const r = await http(url, opcoes);
    return { ok: true, status: r.status, corpo: jsonDaResposta(r.bytes) };
  } catch (erro) {
    const permanente =
      typeof erro === "object" && erro !== null && "permanente" in erro
        ? Boolean((erro as { permanente: unknown }).permanente)
        : false;
    const motivo = erro instanceof Error ? erro.message : "falha de rede";
    return { ok: false, resultado: { ok: false, motivo, permanente } };
  }
}

/** Limite em MB por tipo de mídia; o composer e o envio conferem antes. */
export function cabeNoLimite(
  m: Pick<MidiaParaEnvio, "tipo" | "bytes">,
  limites: { imagemMb: number; videoMb: number; audioMb: number; documentoMb: number },
): boolean {
  const mb =
    m.tipo === "imagem" || m.tipo === "sticker"
      ? limites.imagemMb
      : m.tipo === "video"
        ? limites.videoMb
        : m.tipo === "audio"
          ? limites.audioMb
          : limites.documentoMb;
  return m.bytes.byteLength <= mb * 1024 * 1024;
}
