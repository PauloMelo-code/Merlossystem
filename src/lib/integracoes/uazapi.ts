import "server-only";
import { env } from "@/lib/env";
import { ErroDeConfiguracao, ErroDeIntegracao } from "@/lib/erros";
import { buscarExterno } from "@/lib/rede/buscarExterno";
import { qrDeDataUrl } from "@/lib/qr";

/**
 * Sessão do número não oficial (03-arquitetura.md §8.1, 04-ui.md §5.6).
 *
 * Só o CICLO DE VIDA da sessão mora aqui (estado e pareamento): é o que a tela
 * de integrações e o job `conferir-sessao-uazapi` precisam. Enviar e receber
 * mensagem é do adaptador de canal (pacote M1).
 *
 * Caminhos e cabeçalho vêm do padrão público do uazapiGO e NÃO foram
 * conferidos no Swagger da instalação (a documentação é renderizada por JS). A
 * incerteza fica concentrada nestas três constantes.
 */
const CAMINHO_ESTADO = "/instance/status";
const CAMINHO_PAREAR = "/instance/connect";
const CABECALHO_TOKEN = "token";

/** O QR do uazapi vale poucos segundos; a tela conta até aqui e pede outro. */
export const VALIDADE_QR_S = 45;

export type EstadoDaSessao = {
  estado: "conectada" | "conectando" | "desconectada";
  /** Data URL pronta para `<img>`, gerada no servidor. */
  qr?: string;
};

function base(): string {
  const url = env.UAZAPI_BASE_URL;
  if (!url) throw new ErroDeConfiguracao("uazapi sem UAZAPI_BASE_URL configurada. Avise o administrador.");
  return url.replace(/\/+$/, "");
}

type Objeto = Record<string, unknown>;
const ehObjeto = (v: unknown): v is Objeto => typeof v === "object" && v !== null;

export function normalizarEstado(bruto: unknown): EstadoDaSessao["estado"] {
  switch (String(bruto ?? "").toLowerCase()) {
    case "connected":
    case "open":
      return "conectada";
    case "connecting":
    case "qrcode":
    case "pairing":
      return "conectando";
    default:
      return "desconectada";
  }
}

/** O uazapi já devolveu o QR como imagem pronta e como texto cru. */
export function qrParaTela(bruto: unknown): string | undefined {
  if (typeof bruto !== "string" || bruto.length === 0) return undefined;
  if (/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(bruto)) return bruto;
  // Texto cru do QR: a imagem nasce aqui, nunca num serviço de QR de fora.
  return qrDeDataUrl(bruto);
}

export function lerEstado(corpo: unknown): EstadoDaSessao {
  const d = ehObjeto(corpo) ? corpo : {};
  const instancia = ehObjeto(d.instance) ? d.instance : d;
  const status = instancia.status ?? d.status ?? d.state;
  const qr = qrParaTela(instancia.qrcode ?? d.qrcode ?? d.qr);
  return { estado: normalizarEstado(status), ...(qr ? { qr } : {}) };
}

async function chamar(caminho: string, token: string, metodo: "GET" | "POST"): Promise<EstadoDaSessao> {
  const resposta = await buscarExterno(`${base()}${caminho}`, {
    provedor: "uazapi",
    metodo,
    cabecalhos: { [CABECALHO_TOKEN]: token, accept: "application/json" },
    maxBytes: 512 * 1024,
  });
  if (resposta.status === 401 || resposta.status === 403) {
    throw new ErroDeIntegracao("O uazapi recusou o token da instância. Confira o token e conecte de novo.", true);
  }
  if (resposta.status < 200 || resposta.status >= 300) {
    throw new ErroDeIntegracao(`O uazapi respondeu ${resposta.status}. Tente de novo em instantes.`, false);
  }
  let corpo: unknown = null;
  try {
    corpo = JSON.parse(resposta.bytes.toString("utf8"));
  } catch {
    throw new ErroDeIntegracao("O uazapi respondeu num formato inesperado.", false);
  }
  return lerEstado(corpo);
}

export function estadoDaSessao(token: string): Promise<EstadoDaSessao> {
  return chamar(CAMINHO_ESTADO, token, "GET");
}

/** Pede um QR novo. A sessão atual do aparelho cai: por isso é ação com block. */
export function iniciarPareamento(token: string): Promise<EstadoDaSessao> {
  return chamar(CAMINHO_PAREAR, token, "POST");
}
