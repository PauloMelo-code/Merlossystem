// ============================================================
// Channel Types — Merlos Store
// ============================================================

export type ChannelType = "whatsapp" | "instagram" | "facebook" | "tiktok"

export type ContentType =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "location"
  | "sticker"
  | "product"
  | "payment"

export type MessageDirection = "incoming" | "outgoing"

export type DeliveryStatus = "sent" | "delivered" | "read" | "failed"

// Normalized incoming message from any channel
export interface IncomingMessage {
  channel: ChannelType
  externalId: string
  /**
   * Conta que RECEBEU a mensagem — qual numero de WhatsApp, qual perfil do
   * Instagram. E a chave de roteamento: casa com
   * `stores_integracoes.referencia_externa`, e dali sai a loja.
   *
   * Sem isto, com dois numeros na mesma loja nao da para saber por onde
   * responder, nem a qual carteira o contato pertence.
   */
  contaExterna?: string
  // Sender identification (channel-specific ID)
  senderId: string
  /**
   * Mensagem que saiu do numero conectado, e nao da cliente — tipicamente a
   * vendedora respondendo pelo celular, e tudo o que vem do historico dela.
   * Entra na conversa como mensagem do atendimento, nunca como da cliente.
   */
  fromMe?: boolean
  senderName?: string
  senderAvatarUrl?: string
  // Content
  contentType: ContentType
  text?: string
  // Media
  mediaId?: string // platform-specific media ID for download
  mediaUrl?: string // direct URL if available
  mediaMimeType?: string
  mediaCaption?: string
  // Location
  latitude?: number
  longitude?: number
  // Metadata
  timestamp: Date
  replyToExternalId?: string
  metadata?: Record<string, unknown>
}

// Outgoing message to send via channel
export interface OutgoingMessage {
  to: string // recipient channel-specific ID
  contentType: ContentType
  text?: string
  mediaUrl?: string
  mediaCaption?: string
  filename?: string
  templateName?: string
  templateVars?: string[]
  templateLanguage?: string
}

// Media limits per channel (in bytes)
export interface MediaLimits {
  image: number
  video: number
  audio: number
  document: number
}

// Result of sending a message
export interface SendResult {
  success: boolean
  externalId?: string
  error?: string
}

// Result of downloading media
export interface DownloadedMedia {
  buffer: Buffer
  mimeType: string
  filename?: string
  size: number
}

// Channel adapter interface
export interface ChannelAdapter {
  channel: ChannelType
  limits: MediaLimits

  sendText(to: string, text: string): Promise<SendResult>
  sendImage(to: string, url: string, caption?: string): Promise<SendResult>
  sendVideo(to: string, url: string, caption?: string): Promise<SendResult>
  sendAudio(to: string, url: string): Promise<SendResult>
  sendDocument(to: string, url: string, filename: string): Promise<SendResult>
  sendTemplate(
    to: string,
    templateName: string,
    vars: string[],
    language?: string
  ): Promise<SendResult>
  downloadMedia(mediaId: string): Promise<DownloadedMedia>
}

// Status update from channel (delivery receipts)
export interface StatusUpdate {
  channel: ChannelType
  externalMessageId: string
  status: DeliveryStatus
  timestamp: Date
}

// Channel-specific config
export interface WhatsAppConfig {
  phoneId: string
  accessToken: string
  verifyToken: string
  businessAccountId?: string
}

export interface MetaGraphConfig {
  appId: string
  appSecret: string
  pageAccessToken: string
  verifyToken: string
}

export interface InstagramConfig extends MetaGraphConfig {
  instagramAccountId: string
}

export interface TikTokConfig {
  clientKey: string
  clientSecret: string
}
