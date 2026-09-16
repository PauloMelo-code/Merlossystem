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

export type Provedor = "meta" | "uazapi" | "bling" | "discord";

/**
 * Allowlist de host POR PROVEDOR. Sufixo com ponto na frente casa subdominio
 * (`scontent-gru1-1.xx.fbcdn.net`); o resto e casamento exato.
 */
const HOSTS: Record<Provedor, readonly string[]> = {
  meta: ["graph.facebook.com", "lookaside.fbsbx.com", "mmg.whatsapp.net", ".fbcdn.net"],
  uazapi: [],
  bling: ["api.bling.com.br", "www.bling.com.br", "bling.com.br"],
  discord: ["discord.com", "discordapp.com"],
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

export type OpcoesBusca = {
  provedor: Provedor;
  metodo?: "GET" | "POST";
  corpo?: string;
  cabecalhos?: Record<string, string>;
  /** Teto de bytes do corpo lido. O padrao cobre video e audio (16 MB). */
  maxBytes?: number;
};

export type RespostaExterna = {
  status: number;
  tipo: string | null;
  bytes: Buffer;
};

async function uma(url: URL, opcoes: OpcoesBusca): Promise<Response> {
  return fetch(url, {
    method: opcoes.metodo ?? "GET",
    ...(opcoes.corpo === undefined ? {} : { body: opcoes.corpo }),
    headers: opcoes.cabecalhos ?? {},
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
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
 * `http://169.254.169.254` era o buraco classico). Timeout de 8 s e teto de
 * bytes lido em streaming, abortado ao passar.
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
    url = await conferirDestino(new URL(destino, url).toString(), opcoes.provedor);
    resposta = await uma(url, opcoes);
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
