/**
 * uazapi — pontos de contato com o servico externo.
 *
 * O uazapi NAO e a API oficial do WhatsApp: e uma camada sobre o WhatsApp Web.
 * Isso muda tres coisas em relacao ao adapter da Meta:
 *   1. o numero pareia por QR code e a sessao CAI — precisa reconectar;
 *   2. nao existe template aprovado nem janela de 24h;
 *   3. o numero pode ser BANIDO pelo WhatsApp — e uso fora dos termos.
 * Por isso os dois provedores convivem (`whatsapp_oficial` e `uazapi`) e a loja
 * escolhe em qual numero usa cada um. Ver docs/integracoes.md.
 *
 * CONFIRMADO (docs.uazapi.com, consultado em 17/08/2026):
 *   - a instalacao tem HOST PROPRIO (cada cliente recebe um subdominio); nao ha
 *     dominio unico como no Bling ou no TikTok Shop — por isso vem de ambiente;
 *   - o acesso e por INSTANCIA: cada numero e uma instancia com token proprio;
 *   - o webhook e configurado por instancia, com eventos separados para
 *     mensagem recebida, mensagem enviada, status da conexao e QR code.
 *
 * NAO CONFIRMADO — a documentacao e Swagger renderizado por JS e nao pode ser
 * lida por fetch. Foram usados o padrao publico do uazapiGO e os SDKs:
 *   - os caminhos exatos em UAZAPI_ENDPOINTS;
 *   - o nome do header do token (`token`);
 *   - os nomes dos campos do corpo (`number`, `text`, `file`).
 *
 * A incerteza esta CONCENTRADA aqui: quando alguem abrir o Swagger da propria
 * instalacao (a URL do painel + /docs), e este arquivo que muda — o adapter,
 * o webhook e as rotas nao precisam ser tocados.
 */

export class UazapiConfigError extends Error {
  constructor(mensagem: string) {
    super(mensagem)
    this.name = "UazapiConfigError"
  }
}

/** Erro cruza o limite do bundle do Next; `instanceof` nao sobrevive. */
export function ehUazapiConfigError(e: unknown): e is UazapiConfigError {
  return e instanceof Error && e.name === "UazapiConfigError"
}

/**
 * Host da instalacao. Sem dominio fixo: cada cliente do uazapi tem o seu.
 * Sem isto configurado, conectar um numero falha de imediato — melhor do que
 * montar um adapter que erra a cada envio.
 */
export function baseDaApi(): string {
  const base = process.env.UAZAPI_BASE_URL
  if (!base) {
    throw new UazapiConfigError(
      "uazapi nao configurado: falta UAZAPI_BASE_URL (o host da sua instalacao)"
    )
  }
  return base.replace(/\/+$/, "")
}

/**
 * Token de ADMINISTRADOR do servidor uazapi (`admintoken`). So com ele da para
 * CRIAR instancia; o token de instancia nao cria nada. Fica no ambiente, nunca
 * no banco e nunca na tela: quem o tem controla todas as instancias.
 */
export function tokenDeAdmin(): string {
  const token = process.env.UAZAPI_ADMIN_TOKEN
  if (!token) {
    throw new UazapiConfigError(
      "uazapi sem UAZAPI_ADMIN_TOKEN: sem ele nao da para criar numero pela tela. " +
        "Conecte informando o token da instancia, ou configure a variavel."
    )
  }
  return token
}

/** Endereco que o uazapi chama a cada evento. O segredo vai na query porque o painel nao manda cabecalho. */
export function urlDoWebhook(): string {
  const base = process.env.NEXTAUTH_URL ?? process.env.APP_URL
  const segredo = process.env.UAZAPI_WEBHOOK_SECRET
  if (!base || !segredo) {
    throw new UazapiConfigError(
      "Falta NEXTAUTH_URL (ou APP_URL) e UAZAPI_WEBHOOK_SECRET para configurar o webhook do uazapi."
    )
  }
  return `${base.replace(/\/+$/, "")}/api/webhooks/uazapi?segredo=${encodeURIComponent(segredo)}`
}

/** Eventos que o sistema consome. `history` e o que traz as conversas antigas. */
export const EVENTOS_WEBHOOK = ["messages", "messages_update", "connection", "history"] as const

/** Caminhos conferidos em docs.uazapi.com em 22/09/2026. */
export const UAZAPI_ENDPOINTS = {
  /** Envio de texto. Corpo: `{ number, text }`. */
  texto: "/send/text",
  /** Envio de midia. Corpo: `{ number, type, file, text?, docName? }`. */
  midia: "/send/media",
  /** Estado da instancia (`connected`, `disconnected`, `connecting`). */
  status: "/instance/status",
  /** Inicia o pareamento e devolve o QR code. */
  conectar: "/instance/connect",
  /** Derruba a sessao sem apagar a instancia. */
  desconectar: "/instance/disconnect",
  /** Cria a instancia. Exige `admintoken`; devolve o token dela. */
  criarInstancia: "/instance/create",
  /** Configura o webhook da instancia: `{ enabled, url, events, excludeMessages }`. */
  webhook: "/webhook",
  /** URL publica da midia recebida, a partir do id da mensagem. Vale 2 dias. */
  baixarMidia: "/message/download",
  /** Pede ao celular as mensagens anteriores de um chat. Chegam pelo evento `history`. */
  historico: "/message/history-sync",
  /** Lista as conversas da instancia. Corpo: `{ sort, limit, offset, wa_isGroup }`. */
  chats: "/chat/find",
  /** Foto do contato. Corpo: `{ number, preview }`; devolve `url` TEMPORARIA. */
  avatar: "/chat/avatar",
} as const

/**
 * Header que carrega o token da INSTANCIA (nao um bearer de conta).
 * ⚠️ CONFERIR: e o ponto mais provavel de divergencia entre versoes.
 */
export const HEADER_TOKEN = "token"

/**
 * Tipo de midia do uazapi para cada `ContentType` que o sistema envia.
 * `sticker` e `location` nao passam por aqui: o gateway nao envia nenhum dos
 * dois hoje.
 */
export const TIPO_DE_MIDIA = {
  image: "image",
  video: "video",
  audio: "audio",
  document: "document",
} as const
