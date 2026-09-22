import type {
  ChannelAdapter,
  SendResult,
  DownloadedMedia,
  IncomingMessage,
  ContentType,
  MediaLimits,
} from "./types"
import {
  baseDaApi,
  UAZAPI_ENDPOINTS,
  HEADER_TOKEN,
  TIPO_DE_MIDIA,
} from "@/lib/uazapi/config"

/**
 * Adapter do WhatsApp via uazapi.
 *
 * Implementa a MESMA interface `ChannelAdapter` do adapter da Meta: quem envia
 * (gateway, rotas) nao sabe por qual provedor a mensagem sai. A escolha esta na
 * conta conectada (`stores_integracoes.provedor`), nao no codigo de envio.
 *
 * Diferenca que vaza da interface: `sendTemplate` nao existe no uazapi. Ver o
 * comentario no metodo.
 */

/** Credenciais de UMA instancia — um numero de WhatsApp. */
export type ConfigUazapi = {
  /** Token da instancia. E o unico segredo; da acesso total aquele numero. */
  token: string
  /** Host da instalacao. Ausente = usa UAZAPI_BASE_URL. */
  base?: string
}

type RespostaEnvio = {
  id?: string
  messageid?: string
  key?: { id?: string }
  error?: string
  message?: string
}

/** Id da mensagem: o uazapi ja devolveu em tres formatos diferentes. */
function idDaResposta(d: RespostaEnvio): string | undefined {
  return d.id ?? d.messageid ?? d.key?.id
}

export function criarUazapiAdapter(config: ConfigUazapi): ChannelAdapter {
  const base = () => config.base ?? baseDaApi()

  async function chamar(caminho: string, corpo: unknown): Promise<SendResult> {
    let res: Response
    try {
      res = await fetch(`${base()}${caminho}`, {
        method: "POST",
        headers: {
          [HEADER_TOKEN]: config.token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(corpo),
      })
    } catch (e) {
      // Instalacao fora do ar / host errado. Vira erro de envio, nao excecao:
      // uma mensagem que nao saiu nao pode derrubar o processamento das outras.
      return { success: false, error: `uazapi inacessivel: ${(e as Error).message}` }
    }

    const data: RespostaEnvio = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { success: false, error: data.error ?? data.message ?? `HTTP ${res.status}` }
    }
    return { success: true, externalId: idDaResposta(data) }
  }

  const midia = (to: string, tipo: string, url: string, texto?: string, docName?: string) =>
    chamar(UAZAPI_ENDPOINTS.midia, { number: to, type: tipo, file: url, text: texto, docName })

  return {
    channel: "whatsapp",

    // O uazapi passa pelo WhatsApp Web, entao valem os limites do proprio
    // WhatsApp — os mesmos do adapter da Meta.
    limits: {
      image: 5 * 1024 * 1024,
      video: 16 * 1024 * 1024,
      audio: 16 * 1024 * 1024,
      document: 100 * 1024 * 1024,
    } as MediaLimits,

    sendText: (to, text) => chamar(UAZAPI_ENDPOINTS.texto, { number: to, text }),

    sendImage: (to, url, caption) => midia(to, TIPO_DE_MIDIA.image, url, caption),
    sendVideo: (to, url, caption) => midia(to, TIPO_DE_MIDIA.video, url, caption),
    sendAudio: (to, url) => midia(to, TIPO_DE_MIDIA.audio, url),
    sendDocument: (to, url, filename) =>
      midia(to, TIPO_DE_MIDIA.document, url, undefined, filename),

    /**
     * Template nao existe no uazapi — nao ha aprovacao da Meta nem janela de
     * 24h; e tudo mensagem comum.
     *
     * Falha explicita em vez de mandar o nome do template como texto: o
     * segundo caso manda "boas_vindas" para a cliente e ninguem percebe. Quem
     * precisa disparar template por este numero resolve o texto antes e chama
     * `sendText`.
     */
    async sendTemplate(_to, templateName): Promise<SendResult> {
      return {
        success: false,
        error:
          `Este numero usa uazapi, que nao tem template aprovado. ` +
          `Envie o texto de "${templateName}" como mensagem comum.`,
      }
    },

    /**
     * O webhook do uazapi NAO traz URL publica da midia recebida (conferido em
     * docs.uazapi.com, 22/09/2026): o que ele manda e o id da mensagem. A URL
     * nasce em `POST /message/download` e vale 2 dias, entao o download e
     * imediato. Quando `mediaId` ja e URL (mensagem antiga, ou outro fluxo),
     * baixa direto.
     */
    async downloadMedia(mediaId: string): Promise<DownloadedMedia> {
      let endereco = mediaId
      if (!/^https?:\/\//.test(mediaId)) {
        const r = await fetch(`${base()}${UAZAPI_ENDPOINTS.baixarMidia}`, {
          method: "POST",
          headers: { [HEADER_TOKEN]: config.token, "Content-Type": "application/json" },
          body: JSON.stringify({ id: mediaId }),
        })
        const dados: { fileURL?: string; error?: string } = await r.json().catch(() => ({}))
        if (!r.ok || !dados.fileURL) {
          throw new Error(
            `uazapi nao devolveu a midia de ${mediaId.slice(0, 20)}: ${dados.error ?? `HTTP ${r.status}`}`
          )
        }
        endereco = dados.fileURL
      }

      const res = await fetch(endereco)
      if (!res.ok) throw new Error(`Falha ao baixar midia do uazapi: ${res.status}`)

      const buffer = Buffer.from(await res.arrayBuffer())
      return {
        buffer,
        mimeType: res.headers.get("content-type") ?? "application/octet-stream",
        size: buffer.length,
      }
    },
  }
}

// ============================================================
// Webhook do uazapi
// ============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Tipos do uazapi -> ContentType do sistema. A CHAVE E MINUSCULA: o uazapi
 * manda "Conversation", "ImageMessage", "AudioMessage" com maiuscula, e o mapa
 * anterior, sensivel a caixa, fazia foto e audio virarem texto vazio.
 */
const CONTENT_TYPE: Record<string, ContentType> = {
  text: "text",
  conversation: "text",
  extendedtextmessage: "text",
  image: "image",
  imagemessage: "image",
  video: "video",
  videomessage: "video",
  audio: "audio",
  audiomessage: "audio",
  ptt: "audio",
  document: "document",
  documentmessage: "document",
  sticker: "sticker",
  stickermessage: "sticker",
  location: "location",
  locationmessage: "location",
}

/**
 * Conversa que nasceu de ANUNCIO (Click to WhatsApp).
 *
 * O uazapi repassa o conteudo bruto da mensagem, e e dentro dele que o
 * WhatsApp manda a referencia do anuncio — em `contextInfo.externalAdReply`
 * ou, nas versoes mais novas, em `ctwaContext`. O contrato publico do uazapi
 * nao documenta esses campos, entao a leitura e TOLERANTE: procura pelas duas
 * chaves em qualquer nivel e devolve so o que encontrar. Nao achou, nao e
 * anuncio — nunca lanca.
 *
 * Vale muito para a loja: cliente que veio de anuncio precisa de resposta
 * diferente da de quem ja compra ha anos, e sem isto ninguem sabe qual e qual.
 */
export type OrigemDeAnuncio = {
  titulo?: string
  corpo?: string
  url?: string
  anuncioId?: string
}

function comoObjeto(valor: unknown): Record<string, any> | null {
  if (typeof valor === "string") {
    try {
      const lido = JSON.parse(valor)
      return typeof lido === "object" && lido !== null ? lido : null
    } catch {
      return null
    }
  }
  return typeof valor === "object" && valor !== null ? (valor as Record<string, any>) : null
}

/** Procura a referencia do anuncio em qualquer nivel do conteudo bruto. */
function acharAnuncio(bruto: unknown, profundidade = 0): Record<string, any> | null {
  const obj = comoObjeto(bruto)
  if (!obj || profundidade > 4) return null
  for (const chave of ["externalAdReply", "ctwaContext", "external_ad_reply"]) {
    const achado = comoObjeto(obj[chave])
    if (achado) return achado
  }
  for (const valor of Object.values(obj)) {
    if (typeof valor === "object" || typeof valor === "string") {
      const achado = acharAnuncio(valor, profundidade + 1)
      if (achado) return achado
    }
  }
  return null
}

export function origemDeAnuncio(mensagemBruta: unknown): OrigemDeAnuncio | null {
  const ad = acharAnuncio(mensagemBruta)
  if (!ad) return null
  const origem: OrigemDeAnuncio = {}
  const titulo = texto(ad.title ?? ad.headline)
  const corpo = texto(ad.body ?? ad.description)
  const url = texto(ad.sourceUrl ?? ad.source_url ?? ad.url)
  const id = texto(ad.sourceId ?? ad.source_id ?? ad.ctwaClid ?? ad.ctwa_clid)
  if (titulo) origem.titulo = titulo
  if (corpo) origem.corpo = corpo
  if (url) origem.url = url
  if (id) origem.anuncioId = id
  return origem
}

/** Texto nao vazio, ou `undefined`. Objeto (o `content` de midia) nao vira texto. */
function texto(valor: unknown): string | undefined {
  if (typeof valor === "number") return String(valor)
  if (typeof valor !== "string") return undefined
  const limpo = valor.trim()
  return limpo === "" ? undefined : limpo
}

const primeiro = (...valores: unknown[]): string | undefined => {
  for (const v of valores) {
    const t = texto(v)
    if (t !== undefined) return t
  }
  return undefined
}

/**
 * Normaliza o evento do uazapi para `IncomingMessage`.
 *
 * ⚠️ O formato exato do payload nao pode ser confirmado sem o Swagger da
 * instalacao. O parser e TOLERANTE de proposito: le os nomes de campo mais
 * comuns e devolve `[]` no que nao reconhece, em vez de estourar. Um evento
 * ignorado aparece no log; uma excecao derrubaria o webhook inteiro.
 *
 * `contaExterna` sai do id da instancia — e a chave que liga o numero a loja
 * (`stores_integracoes.referencia_externa`), igual ao `phone_number_id` da Meta.
 */
export function parseUazapiMessages(body: any): IncomingMessage[] {
  // `messages[]` e o lote do evento `history`; `message` e a entrega ao vivo.
  const eventos: any[] = Array.isArray(body?.messages)
    ? body.messages
    : body?.message
      ? [body.message]
      : body?.data
        ? [body.data]
        : []

  // O uazapi manda `instanceName` (o nome da instancia) e `owner` (o numero
  // conectado). O roteamento tenta os dois contra `referencia_externa`.
  const contaExterna = primeiro(body?.instanceName, body?.instance, body?.owner)

  const mensagens: IncomingMessage[] = []
  for (const e of eventos) {
    // Eco do que o PROPRIO sistema enviou pela API: o envio ja gravou.
    if (e?.wasSentByApi === true) continue

    const chat = primeiro(e?.chatid, e?.key?.remoteJid, e?.sender)
    if (e?.isGroup === true || chat?.endsWith("@g.us")) continue

    const fromMe = e?.fromMe === true || e?.key?.fromMe === true
    // `sender` pode vir como LID (`…@lid`), que nao e telefone: o numero do
    // contato esta em `sender_pn` ou no `chatid` da conversa. Na mensagem que
    // a vendedora mandou do celular, o contato e o proprio chat.
    const contato = fromMe ? chat : primeiro(e?.sender_pn, chat, e?.sender)
    const senderId = contato?.replace(/@.*$/, "")
    // O recibo de entrega cita o id CURTO; guardar o longo ("dono:ID") faria
    // o status nunca encontrar a mensagem.
    const externalId = primeiro(e?.messageid, e?.key?.id, e?.id)
    if (!externalId || !senderId) continue

    const bruto = typeof e?.content === "object" && e?.content !== null ? e.content : {}
    // Só na mensagem da cliente: o anúncio é a porta por onde ELA entrou.
    const anuncio = fromMe ? null : origemDeAnuncio(e)
    const contentType =
      CONTENT_TYPE[String(primeiro(e?.messageType, e?.mediaType, e?.type) ?? "text").toLowerCase()] ??
      "text"
    const mediaUrl = primeiro(e?.fileURL, e?.fileUrl, e?.mediaUrl, e?.file, e?.url)
    const temMidia = contentType !== "text" && contentType !== "location"

    mensagens.push({
      channel: "whatsapp",
      externalId,
      contaExterna,
      senderId,
      fromMe,
      ...(fromMe ? {} : { senderName: primeiro(e?.senderName, e?.pushName) }),
      contentType,
      text: primeiro(e?.text, e?.caption, contentType === "text" ? e?.body : undefined),
      // Sem URL publica no webhook, o id da mensagem e a referencia: quem
      // resolve e `downloadMedia`, por `/message/download`.
      ...(temMidia ? { mediaId: mediaUrl ?? externalId } : {}),
      ...(temMidia && mediaUrl ? { mediaUrl } : {}),
      mediaMimeType: primeiro(e?.mimetype, e?.mimeType, bruto?.mimetype),
      mediaCaption: primeiro(e?.caption),
      latitude: e?.latitude ?? bruto?.degreesLatitude,
      longitude: e?.longitude ?? bruto?.degreesLongitude,
      timestamp: paraData(e?.messageTimestamp ?? e?.timestamp),
      ...(anuncio ? { metadata: { anuncio } } : {}),
    })
  }

  return mensagens
}

/** O lote de mensagens antigas vem no evento `history` (`event: "messages"`). */
export function ehLoteDeHistorico(body: any): boolean {
  return String(body?.EventType ?? "").toLowerCase() === "history" && Array.isArray(body?.messages)
}

/** O uazapi manda timestamp em segundos, em milissegundos ou em ISO. */
function paraData(valor: unknown): Date {
  if (typeof valor === "number") {
    return new Date(valor < 1e12 ? valor * 1000 : valor)
  }
  const d = valor ? new Date(String(valor)) : new Date()
  return Number.isNaN(d.getTime()) ? new Date() : d
}
