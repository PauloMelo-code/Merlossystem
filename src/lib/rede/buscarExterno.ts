import "server-only";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { env } from "@/lib/env";
import { ErroDeIntegracao } from "@/lib/erros";

/**
 * Unica porta de saida HTTP para endereco que veio de terceiro
 * (03-arquitetura.md §12.4, A-17). Trava: `fetch(` com URL nao literal fora
 * deste arquivo reprova.
 *
 * Sem isto o container alcanca Postgres 5437, Redis 6382, MinIO 9002 e a rede
 * interna do EasyPanel — e o job `baixar-de-url` recebe a URL do provedor.
 */

export type Provedor =
  | "meta"
  | "uazapi"
  | "bling"
  | "discord"
  | "mercadopago"
  | "openai"
  | "tiktok";

/**
 * Allowlist de host POR PROVEDOR. Sufixo com ponto na frente casa subdominio
 * (`scontent-gru1-1.xx.fbcdn.net`); o resto e casamento exato.
 */
const HOSTS: Record<Provedor, readonly string[]> = {
  meta: [
    "graph.facebook.com",
    "lookaside.fbsbx.com",
    // Anexo de arquivo do Messenger (ADR 0054). CONFERIR-MESSENGER no 1o download em HML.
    "cdn.fbsbx.com",
    "mmg.whatsapp.net",
    ".fbcdn.net",
  ],
  uazapi: [],
  bling: ["api.bling.com.br", "www.bling.com.br", "bling.com.br"],
  discord: ["discord.com", "discordapp.com"],
  /** Pagamentos (R2-B). */
  mercadopago: ["api.mercadopago.com"],
  /** Transcricao (R2-C). O audio sai do MinIO, nunca de URL de terceiro. */
  openai: ["api.openai.com"],
  // API e CDN de midia do TikTok (ADR 0055). CONFERIR-TIKTOK: host do CDN no 1o download em HML.
  tiktok: ["business-api.tiktok.com", ".tiktokcdn.com"],
};

/** Faixas que NUNCA sao destino: loopback, link-local, privadas e metadata. */
const INTERNAS = new BlockList();
INTERNAS.addSubnet("0.0.0.0", 8, "ipv4");
INTERNAS.addSubnet("10.0.0.0", 8, "ipv4");
INTERNAS.addSubnet("100.64.0.0", 10, "ipv4");
INTERNAS.addSubnet("127.0.0.0", 8, "ipv4");
// 169.254.169.254 (metadata de nuvem) mora aqui dentro.
INTERNAS.addSubnet("169.254.0.0", 16, "ipv4");
INTERNAS.addSubnet("172.16.0.0", 12, "ipv4");
INTERNAS.addSubnet("192.168.0.0", 16, "ipv4");
INTERNAS.addSubnet("198.18.0.0", 15, "ipv4");
INTERNAS.addSubnet("224.0.0.0", 4, "ipv4");
INTERNAS.addSubnet("::", 128, "ipv6");
INTERNAS.addSubnet("::1", 128, "ipv6");
INTERNAS.addSubnet("fc00::", 7, "ipv6");
INTERNAS.addSubnet("fe80::", 10, "ipv6");

export function ehEnderecoInterno(endereco: string): boolean {
  const limpo = endereco.replace(/^\[|\]$/g, "").replace(/^::ffff:/i, "");
  const versao = isIP(limpo);
  if (versao === 0) return true; // o que nao e endereco nao vira destino
  return INTERNAS.check(limpo, versao === 4 ? "ipv4" : "ipv6");
}

function hostsDe(provedor: Provedor): readonly string[] {
  if (provedor !== "uazapi") return HOSTS[provedor];
  const base = env.UAZAPI_BASE_URL;
  return base ? [new URL(base).hostname.toLowerCase()] : [];
}

function hostPermitido(host: string, provedor: Provedor): boolean {
  const alvo = host.toLowerCase();
  return hostsDe(provedor).some((h) => (h.startsWith(".") ? alvo.endsWith(h) : alvo === h));
}

function recusar(motivo: string): never {
  // Permanente: retentar nao muda o veredito, e a fila nao deve insistir.
  throw new ErroDeIntegracao(`Endereco externo recusado: ${motivo}.`, true);
}

/** Regras 1 a 3: esquema, allowlist e DNS sem faixa interna. */
async function conferirDestino(bruta: string, provedor: Provedor): Promise<URL> {
  let url: URL;
  try {
    url = new URL(bruta);
  } catch {
    return recusar("URL invalida");
  }
  if (url.protocol !== "https:") return recusar("somente https");
  if (!hostPermitido(url.hostname, provedor)) return recusar("host fora da allowlist");

  const literal = isIP(url.hostname.replace(/^\[|\]$/g, ""));
  const enderecos = literal
    ? [{ address: url.hostname.replace(/^\[|\]$/g, "") }]
    : await lookup(url.hostname, { all: true }).catch(() => recusar("DNS nao resolveu"));

  if (enderecos.length === 0) return recusar("DNS sem resposta");
  // TODOS os enderecos precisam ser externos: um so interno ja basta para o
  // sistema operacional escolher justamente ele.
  if (enderecos.some((e) => ehEnderecoInterno(e.address))) return recusar("endereco interno");
  return url;
}

export const TIMEOUT_MS = 8_000;
export const TETO_PADRAO = 16 * 1024 * 1024;

/** Teto absoluto: so upload de audio (R2-C) passa de 8 s, e nunca de 60 s. */
export const TIMEOUT_MAXIMO_MS = 60_000;

/** Cabecalhos com credencial: nunca atravessam para outro host num salto. */
const CABECALHOS_DE_CREDENCIAL = new Set(["authorization", "access-token", "x-api-key", "cookie"]);

function semCredencial(cabecalhos: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(cabecalhos ?? {}).filter(([nome]) => !CABECALHOS_DE_CREDENCIAL.has(nome.toLowerCase())),
  );
}

export type OpcoesBusca = {
  provedor: Provedor;
  metodo?: "GET" | "POST" | "PUT";
  /**
   * JSON/texto, binário ou `FormData` (upload multipart da Graph). Com
   * `FormData`, NÃO passe `content-type`: o `fetch` escreve o boundary.
   */
  corpo?: string | Uint8Array | Blob | FormData;
  cabecalhos?: Record<string, string>;
  /** Teto de bytes do corpo lido. O padrao cobre video e audio (16 MB). */
  maxBytes?: number;
  /** Padrao TIMEOUT_MS; cortado em TIMEOUT_MAXIMO_MS. */
  timeoutMs?: number;
};

export type RespostaExterna = {
  status: number;
  tipo: string | null;
  bytes: Buffer;
};

async function uma(url: URL, opcoes: OpcoesBusca): Promise<Response> {
  return fetch(url, {
    method: opcoes.metodo ?? "GET",
    // `Uint8Array` do Node (Buffer) é aceito pelo `fetch`, mas o tipo do DOM
    // quer `BufferSource` com `ArrayBuffer` — a cópia resolve os dois.
    ...(opcoes.corpo === undefined
      ? {}
      : { body: opcoes.corpo instanceof Uint8Array ? new Uint8Array(opcoes.corpo) : opcoes.corpo }),
    headers: opcoes.cabecalhos ?? {},
    redirect: "manual",
    signal: AbortSignal.timeout(Math.min(opcoes.timeoutMs ?? TIMEOUT_MS, TIMEOUT_MAXIMO_MS)),
  });
}

async function lerComTeto(resposta: Response, maxBytes: number): Promise<Buffer> {
  const corpo = resposta.body;
  if (!corpo) return Buffer.alloc(0);
  const leitor = corpo.getReader();
  const pedacos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await leitor.cancel();
      recusar("corpo acima do teto");
    }
    pedacos.push(value);
  }
  return Buffer.concat(pedacos);
}

/**
 * Regras 4 a 6: `redirect: "manual"`, no MAXIMO 1 salto, e o destino do salto
 * passa pelas regras 1 a 3 de novo (um host permitido redirecionando para
 * `http://169.254.169.254` era o buraco classico). So GET segue salto, e
 * credencial nao atravessa para outro host. Timeout de 8 s (teto de 60 s) e
 * teto de bytes lido em streaming, abortado ao passar.
 */
export async function buscarExterno(
  urlBruta: string,
  opcoes: OpcoesBusca,
): Promise<RespostaExterna> {
  let url = await conferirDestino(urlBruta, opcoes.provedor);
  let resposta = await uma(url, opcoes);

  if (resposta.status >= 300 && resposta.status < 400) {
    const destino = resposta.headers.get("location");
    if (!destino) recusar("redirecionamento sem destino");
    await resposta.body?.cancel();
    // O corpo nao e reenviado num salto, e o salto poderia leva-lo a outro host.
    if ((opcoes.metodo ?? "GET") !== "GET") recusar("so GET segue redirecionamento");
    const proximo = await conferirDestino(new URL(destino, url).toString(), opcoes.provedor);
    // Credencial nunca atravessa para outro host, nem dentro da allowlist.
    const cabecalhos =
      proximo.hostname === url.hostname ? (opcoes.cabecalhos ?? {}) : semCredencial(opcoes.cabecalhos);
    url = proximo;
    resposta = await uma(url, { ...opcoes, cabecalhos });
    if (resposta.status >= 300 && resposta.status < 400) {
      await resposta.body?.cancel();
      recusar("mais de um redirecionamento");
    }
  }

  return {
    status: resposta.status,
    tipo: resposta.headers.get("content-type"),
    bytes: await lerComTeto(resposta, opcoes.maxBytes ?? TETO_PADRAO),
  };
}
