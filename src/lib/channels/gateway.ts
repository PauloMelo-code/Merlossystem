import { prisma } from "@/lib/db/prisma"
import { Prisma } from "@prisma/client"
import { subirDeUrl, getFileTypeFromMime, urlInterna, urlInternaThumb } from "@/lib/media/upload"
import type {
  ChannelType,
  IncomingMessage,
  StatusUpdate,
  ContentType,
} from "./types"

/** Etiqueta de quem chegou por anúncio. Uma só, escrita num lugar só. */
export const TAG_ANUNCIO = "Anúncio"

// Maps channel sender IDs to the correct contact field
const CHANNEL_ID_FIELD: Record<ChannelType, string> = {
  whatsapp: "whatsappId",
  instagram: "instagramId",
  facebook: "facebookId",
  tiktok: "tiktokId",
}

/**
 * Process an incoming message from any channel.
 * Creates contact/conversation if needed, saves message, handles media.
 *
 * `conta` e obrigatoria: e a integracao que RECEBEU o evento. Dela sai a loja
 * (carteira isolada — decisao 5) e o vinculo da conversa, que e o que faz a
 * resposta sair pelo mesmo numero em que a mensagem entrou.
 *
 * Sem isso, mensagem que chega no numero do Cerro Azul encontraria a contato do
 * Centro e penduraria a conversa na carteira errada.
 *
 * Quem resolve a conta e a rota de webhook, por `(provedor, referencia_externa)`
 * — ver `src/lib/roteamento.ts`.
 */
export async function processIncomingMessage(
  msg: IncomingMessage,
  /**
   * `vendedorId` e a vendedora dona do numero: a conversa que nasce por esta
   * conta ja cai na mao dela, em vez de ficar sem ninguem responsavel.
   */
  conta: { id: string; storeId: string; vendedorId?: string | null },
  /**
   * Lote de historico (evento `history` do uazapi): mensagem antiga, que a
   * loja ja respondeu. Entra na conversa, mas NAO conta como nao lida, nao
   * reabre conversa resolvida e nao mexe no "ultima mensagem" mais recente.
   */
  opcoes: { historico?: boolean } = {}
) {
  const storeId = conta.storeId
  const idField = CHANNEL_ID_FIELD[msg.channel]
  const historico = opcoes.historico === true
  const daLoja = msg.fromMe === true

  // Reentrega do mesmo evento: sai antes de fazer qualquer coisa.
  //
  // Meta e uazapi REENTREGAM o webhook quando nao recebem 200 no prazo — um
  // pico de latencia nosso ja basta. Sem esta saida, a mesma mensagem virava
  // duas bolhas na conversa e o `unreadCount` subia duas vezes, sem erro
  // nenhum no log. Sair aqui tambem evita baixar a midia de novo, que e a
  // parte cara do processamento.
  if (msg.externalId) {
    const jaProcessada = await prisma.message.findFirst({
      where: { storeId, externalId: msg.externalId },
      select: { id: true },
    })
    if (jaProcessada) return null
  }

  // 1. Find or create contact — SEMPRE dentro da loja.
  let contact = await prisma.contact.findFirst({
    where: { storeId, [idField]: msg.senderId },
  })

  if (!contact) {
    contact = await prisma.contact.create({
      data: {
        storeId,
        name: msg.senderName || null,
        avatarUrl: msg.senderAvatarUrl || null,
        [idField]: msg.senderId,
        // Also set phone for WhatsApp
        ...(msg.channel === "whatsapp" && { phone: msg.senderId }),
      },
    })
  } else if ((msg.senderName && !contact.name) || (msg.senderAvatarUrl && !contact.avatarUrl)) {
    // Completa o que faltava: nome e foto chegam em mensagens diferentes.
    contact = await prisma.contact.update({
      where: { id: contact.id },
      data: {
        ...(msg.senderName && !contact.name ? { name: msg.senderName } : {}),
        ...(msg.senderAvatarUrl && !contact.avatarUrl ? { avatarUrl: msg.senderAvatarUrl } : {}),
      },
    })
  }

  // Veio de anúncio (Click to WhatsApp): a etiqueta fica no contato, que é
  // onde a equipe já procura o contexto da cliente. Quem chega por anúncio não
  // conhece a loja — merece outra conversa, e sem isto ninguém sabe qual é.
  const anuncio = (msg.metadata as { anuncio?: Record<string, unknown> } | undefined)?.anuncio
  if (anuncio && !contact.tags.includes(TAG_ANUNCIO)) {
    contact = await prisma.contact.update({
      where: { id: contact.id },
      data: { tags: { push: TAG_ANUNCIO } },
    })
  }

  // 2. Find or create conversation
  // A conversa e por CONTA, nao por canal: a mesma cliente falando com o
  // numero de vendas e com o de SAC tem duas conversas, cada uma respondendo
  // pelo seu numero.
  //
  // No HISTORICO o filtro de status sai: mensagem antiga de uma conversa que
  // a loja ja resolveu pertence AQUELA conversa. Com o filtro, a importacao
  // criava uma conversa duplicada e aberta da mesma cliente, no mesmo numero.
  let conversation = await prisma.conversation.findFirst({
    where: {
      storeId,
      contactId: contact.id,
      channel: msg.channel,
      storeIntegracaoId: conta.id,
      ...(historico ? {} : { status: { in: ["open", "pending"] } }),
    },
    orderBy: { lastMessageAt: "desc" },
  })

  // Mensagem que a cliente ainda nao viu respondida: so a dela conta como nao
  // lida. O que saiu do numero (celular da vendedora) e historico nao contam.
  const naoLida = !daLoja && !historico ? 1 : 0
  const resumo = msg.text?.slice(0, 100) || `[${msg.contentType}]`

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        storeId,
        storeIntegracaoId: conta.id,
        contactId: contact.id,
        channel: msg.channel,
        // A vendedora dona do numero ja entra como responsavel; sem ela, a
        // conversa nasce sem dono, como antes.
        assignedTo: conta.vendedorId ?? null,
        status: "open",
        priority: "medium",
        lastMessageAt: msg.timestamp,
        lastMessagePreview: resumo,
        unreadCount: naoLida,
      },
    })
  } else {
    // No historico, a mensagem e antiga: nao pode sobrescrever a ultima
    // mensagem da conversa nem reabrir o que a loja ja resolveu.
    const maisNova = !conversation.lastMessageAt || msg.timestamp > conversation.lastMessageAt
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        ...(maisNova ? { lastMessageAt: msg.timestamp, lastMessagePreview: resumo } : {}),
        ...(naoLida ? { unreadCount: { increment: naoLida }, status: "open" } : {}),
        // A vendedora respondeu pelo celular: a conversa ESTA atendida. Sem
        // isto o contador de nao lidas ficava preso e a lista cobrava resposta
        // de uma conversa ja respondida.
        ...(daLoja && !historico ? { unreadCount: 0 } : {}),
        ...(conversation.assignedTo || !conta.vendedorId ? {} : { assignedTo: conta.vendedorId }),
      },
    })
  }

  // 3. Midia: baixa do canal e guarda no MinIO (ADR 0006)
  let mediaFileId: string | undefined
  let transcriptionStatus: string | undefined

  if (msg.mediaUrl && msg.contentType !== "text") {
    try {
      const fileType = msg.mediaMimeType
        ? getFileTypeFromMime(msg.mediaMimeType)
        : (msg.contentType as "image" | "video" | "audio" | "document")

      const uploaded = await subirDeUrl(msg.mediaUrl, {
        storeId,
        pasta: msg.channel,
        mimeType: msg.mediaMimeType,
      })

      // Id gerado aqui: `fileUrl` aponta para a rota autenticada
      // `/api/media/{id}/raw`, que precisa do id antes da gravacao.
      const id = crypto.randomUUID()

      const mediaFile = await prisma.mediaFile.create({
        data: {
          id,
          storeId,
          originalName: null,
          fileKey: uploaded.chave,
          fileUrl: urlInterna(id),
          thumbnailKey: uploaded.chaveThumb || null,
          thumbnailUrl: uploaded.chaveThumb ? urlInternaThumb(id) : null,
          fileType,
          mimeType: msg.mediaMimeType || null,
          fileSize: uploaded.bytes,
          width: uploaded.width || null,
          height: uploaded.height || null,
          folder: "incoming",
        },
      })

      mediaFileId = mediaFile.id

      // Mark audio for transcription (will be processed by worker later)
      if (fileType === "audio") {
        transcriptionStatus = "pending"
      }
    } catch (error) {
      console.error(`Failed to process media from ${msg.channel}:`, error)
    }
  }

  // 4. Save message
  //
  // A checagem la em cima resolve o caso comum (reentrega minutos depois). Este
  // catch cobre o outro: duas entregas do MESMO evento chegando ao mesmo tempo,
  // em que as duas passam pela checagem antes de qualquer uma gravar. Quem
  // perde a corrida bate no indice unico `messages_store_external_id` e sai.
  let message
  try {
    message = await prisma.message.create({
      data: {
        storeId,
        conversationId: conversation.id,
        // O que saiu do numero e mensagem do atendimento, com a vendedora dona
        // do numero como autora quando ela existe.
        senderType: daLoja ? "agent" : "customer",
        senderId: daLoja ? (conta.vendedorId ?? null) : null,
        content: msg.text || null,
        contentType: msg.contentType,
        externalId: msg.externalId,
        replyToId: null,
        metadata: (msg.metadata || {}) as Prisma.InputJsonValue,
        createdAt: msg.timestamp,
      },
    })
  } catch (e) {
    if ((e as { code?: string })?.code === "P2002") return null
    throw e
  }

  // 5. Create message_media if we have media
  if (mediaFileId || msg.mediaUrl) {
    await prisma.messageMedia.create({
      data: {
        messageId: message.id,
        mediaFileId: mediaFileId || null,
        externalUrl: msg.mediaUrl || null,
        externalId: msg.mediaId || null,
        fileType: msg.contentType !== "text" ? msg.contentType : null,
        mimeType: msg.mediaMimeType || null,
        caption: msg.mediaCaption || null,
        downloaded: !!mediaFileId,
        transcriptionStatus: transcriptionStatus || null,
      },
    })
  }

  // 6. Update contact lastContactAt — no historico, so se for mais recente:
  // importar conversa velha nao pode "envelhecer" o ultimo contato.
  if (!contact.lastContactAt || msg.timestamp > contact.lastContactAt) {
    await prisma.contact.update({
      where: { id: contact.id },
      data: { lastContactAt: msg.timestamp },
    })
  }

  return { contact, conversation, message }
}

/**
 * Process a delivery status update from any channel.
 */
export async function processStatusUpdate(update: StatusUpdate) {
  const message = await prisma.message.findFirst({
    where: { externalId: update.externalMessageId },
  })

  if (!message) return

  await prisma.message.update({
    where: { id: message.id },
    data: {
      externalStatus: update.status,
      ...(update.status === "read" && { readAt: update.timestamp }),
    },
  })
}

/**
 * Save an outgoing message sent by an agent.
 *
 * A mensagem e gravada TAMBEM quando o canal recusa o envio (`erroDeEnvio`).
 * Antes o route handler retornava 500 antes de chegar aqui, e a mensagem nao
 * existia em lugar nenhum: a atendente via um toast e o texto sumia da tela,
 * sem registro do que tentou mandar e sem como reenviar. Token vencido ou
 * janela de 24h fechada viravam trabalho perdido em silencio.
 */
export async function saveOutgoingMessage(opts: {
  conversationId: string
  /** Loja da conversa — a mensagem herda dela, nunca de um parametro solto. */
  storeId: string
  senderId: string
  content?: string
  contentType: ContentType
  externalId?: string
  mediaFileId?: string
  mediaCaption?: string
  /** Motivo da recusa do canal. Presente => grava a mensagem como `failed`. */
  erroDeEnvio?: string
}) {
  const falhou = Boolean(opts.erroDeEnvio)

  const message = await prisma.message.create({
    data: {
      storeId: opts.storeId,
      conversationId: opts.conversationId,
      senderType: "agent",
      senderId: opts.senderId,
      content: opts.content || null,
      contentType: opts.contentType,
      externalId: opts.externalId || null,
      externalStatus: falhou ? "failed" : opts.externalId ? "sent" : null,
      // O motivo fica na mensagem para a atendente ler no tooltip da bolha
      // vermelha ("numero nao tem WhatsApp", "janela de 24h fechada"), em vez
      // de um "erro ao enviar" que nao diz o que fazer.
      metadata: falhou ? { erroDeEnvio: opts.erroDeEnvio } : {},
    },
  })

  if (opts.mediaFileId) {
    await prisma.messageMedia.create({
      data: {
        messageId: message.id,
        mediaFileId: opts.mediaFileId,
        caption: opts.mediaCaption || null,
        downloaded: true,
      },
    })
  }

  // Update conversation
  await prisma.conversation.update({
    where: { id: opts.conversationId },
    data: {
      lastMessageAt: new Date(),
      lastMessagePreview: opts.content?.slice(0, 100) || `[${opts.contentType}]`,
      unreadCount: 0,
    },
  })

  return message
}
