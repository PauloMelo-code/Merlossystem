import {
  baseDaApi,
  EVENTOS_WEBHOOK,
  UAZAPI_ENDPOINTS,
  HEADER_TOKEN,
  UazapiConfigError,
  tokenDeAdmin,
  urlDoWebhook,
} from "./config"

/**
 * Ciclo de vida da sessao de um numero no uazapi.
 *
 * Isto nao existe na API oficial da Meta e e a diferenca operacional que mais
 * pesa: a sessao do WhatsApp Web CAI (celular sem bateria, sem internet, sessao
 * derrubada pelo proprio WhatsApp) e alguem precisa ler o QR code de novo. Sem
 * uma tela para isso, o numero fica mudo e ninguem descobre ate um cliente
 * reclamar.
 */

export type EstadoInstancia = {
  /** Estado bruto do uazapi, normalizado. */
  status: "conectado" | "desconectado" | "conectando" | "desconhecido"
  /** Base64 ou data URL do QR, quando esta esperando pareamento. */
  qrcode?: string
  /** Numero pareado, quando conectado. */
  numero?: string
}

/** Estados do uazapi -> os nossos. ⚠️ CONFERIR os nomes na instalacao. */
function normalizar(bruto: unknown): EstadoInstancia["status"] {
  switch (String(bruto ?? "").toLowerCase()) {
    case "connected":
    case "open":
      return "conectado"
    case "connecting":
    case "qrcode":
    case "pairing":
      return "conectando"
    case "disconnected":
    case "close":
    case "closed":
      return "desconectado"
    default:
      return "desconhecido"
  }
}

async function chamar(
  caminho: string,
  token: string,
  metodo: "GET" | "POST",
  corpo?: unknown,
  cabecalhoDoToken: string = HEADER_TOKEN
): Promise<Record<string, unknown>> {
  let res: Response
  try {
    res = await fetch(`${baseDaApi()}${caminho}`, {
      method: metodo,
      headers: {
        [cabecalhoDoToken]: token,
        ...(corpo === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
    })
  } catch (e) {
    throw new UazapiConfigError(`uazapi inacessivel: ${(e as Error).message}`)
  }

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new UazapiConfigError(
      `uazapi respondeu ${res.status}: ${data?.error ?? data?.message ?? "sem detalhe"}`
    )
  }
  return data
}

function ler(d: Record<string, unknown>): EstadoInstancia {
  const instancia = (d.instance ?? d) as Record<string, unknown>
  return {
    status: normalizar(instancia.status ?? d.status ?? d.state),
    qrcode: (d.qrcode ?? instancia.qrcode ?? d.qr) as string | undefined,
    numero: (instancia.owner ?? d.owner ?? d.number) as string | undefined,
  }
}

/** Estado atual, sem mexer na sessao. */
export async function estadoDaInstancia(token: string): Promise<EstadoInstancia> {
  return ler(await chamar(UAZAPI_ENDPOINTS.status, token, "GET"))
}

/**
 * Inicia o pareamento e devolve o QR code para a tela exibir.
 *
 * O QR expira em segundos e o uazapi gera outro; a tela precisa reconsultar.
 */
export async function iniciarPareamento(token: string): Promise<EstadoInstancia> {
  return ler(await chamar(UAZAPI_ENDPOINTS.conectar, token, "POST"))
}

/**
 * Cria uma instancia no servidor uazapi e devolve o token dela.
 *
 * E o que tira o vai-e-volta do painel: antes era preciso criar a instancia la,
 * copiar o token, voltar e colar aqui. Exige `admintoken` (ambiente), nasce
 * DESCONECTADA e so vira numero depois do QR.
 */
export async function criarInstancia(nome: string): Promise<{ token: string; nome: string }> {
  const d = await chamar(
    UAZAPI_ENDPOINTS.criarInstancia,
    tokenDeAdmin(),
    "POST",
    { name: nome },
    "admintoken"
  )
  const instancia = (d.instance ?? d) as Record<string, unknown>
  const token = (d.token ?? instancia.token) as string | undefined
  if (!token) {
    throw new UazapiConfigError("O uazapi criou a instancia mas nao devolveu o token dela.")
  }
  return { token, nome: ((instancia.name ?? nome) as string) || nome }
}

/**
 * Aponta o webhook da instancia para este sistema, com os eventos que ele
 * consome. Feito na criacao: webhook esquecido e numero mudo — a mensagem
 * chega no WhatsApp e nunca aparece na tela.
 *
 * `wasSentByApi` fica de fora: o eco do que o proprio sistema enviou ja esta
 * gravado, e regrava-lo duplicaria a bolha.
 */
export async function configurarWebhook(token: string): Promise<void> {
  await chamar(UAZAPI_ENDPOINTS.webhook, token, "POST", {
    enabled: true,
    url: urlDoWebhook(),
    events: [...EVENTOS_WEBHOOK],
    excludeMessages: ["wasSentByApi"],
    addUrlEvents: false,
    addUrlTypesMessages: false,
  })
}

/**
 * Pede ao celular as mensagens anteriores de uma conversa. O WhatsApp responde
 * quando quer e em lotes, pelo evento `history` — por isso nao devolve as
 * mensagens aqui, so registra o pedido.
 */
export async function pedirHistorico(
  token: string,
  numero: string,
  quantidade = 50
): Promise<void> {
  const jid = numero.includes("@") ? numero : `${numero}@s.whatsapp.net`
  await chamar(UAZAPI_ENDPOINTS.historico, token, "POST", {
    number: jid,
    mode: "history",
    count: quantidade,
  })
}
