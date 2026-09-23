import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { getAdapterDaConta } from "@/lib/channels"
import { saveOutgoingMessage } from "@/lib/channels/gateway"
import { contaDaConversa, credenciaisDaConta } from "@/lib/roteamento"
import type { ChannelType } from "@/lib/channels/types"
import { usuarioDaSessao, semSessao } from "@/lib/sessao"
import { escopoDaLoja, lojaAtiva } from "@/lib/loja"
import { urlAssinada } from "@/lib/media/armazenamento"
import { z } from "zod"

// `senderId` NAO entra aqui: quem enviou vem da sessao.
const sendMediaSchema = z.object({
  conversationId: z.string(),
  mediaFileIds: z.array(z.string()).min(1),
  caption: z.string().optional(),
})

/**
 * POST: Send media files from gallery to a conversation
 */
export async function POST(req: Request) {
  try {
    const usuario = await usuarioDaSessao()
    if (!usuario) return semSessao()

    const body = await req.json()
    const data = sendMediaSchema.parse(body)

    // `findFirst` + escopo: com `findUnique` bastava adivinhar um
    // conversationId para o vendedor do Centro disparar midia pelo numero do
    // Cerro Azul para a cliente da outra loja — e a mensagem ficava gravada
    // naquela conversa.
    const conversation = await prisma.conversation.findFirst({
      where: { id: data.conversationId, ...escopoDaLoja(usuario, lojaAtiva(req)) },
      include: { contact: true },
    })

    if (!conversation) {
      return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 })
    }

    const channel = conversation.channel as ChannelType
    const contact = conversation.contact
    const recipientId =
      channel === "whatsapp"
        ? contact.whatsappId || contact.phone
        : channel === "instagram"
          ? contact.instagramId
          : channel === "facebook"
            ? contact.facebookId
            : contact.tiktokId

    if (!recipientId) {
      return NextResponse.json(
        { error: `Contato sem ID para ${channel}` },
        { status: 400 }
      )
    }

    // Responde pela MESMA conta em que a mensagem entrou: a cliente que
    // escreveu para o SAC nao pode receber resposta pelo numero de vendas.
    const conta = await contaDaConversa(data.conversationId)
    const credenciais = conta ? await credenciaisDaConta(conta.id) : null
    const adapter = getAdapterDaConta(channel, credenciais, conta?.provedor)
    const sentMessages = []

    for (const mediaFileId of data.mediaFileIds) {
      // Os ids vem do corpo: sem prender o arquivo a loja DA CONVERSA, um id
      // da galeria da outra loja (tabela de precos, foto de peca que nao esta
      // nesta loja) era enviado direto para a cliente.
      const mediaFile = await prisma.mediaFile.findFirst({
        where: { id: mediaFileId, storeId: conversation.storeId },
      })

      if (!mediaFile) continue

      let result
      const caption = data.caption

      // URL ASSINADA, nao `fileUrl`: quem baixa a midia e a Meta/uazapi, do
      // lado de fora. `fileUrl` aponta para a nossa rota autenticada e eles
      // receberiam 401 — a cliente veria mensagem sem imagem (ADR 0006).
      const url = await urlAssinada(mediaFile.fileKey)

      switch (mediaFile.fileType) {
        case "image":
        // Figurinha sai como imagem: o `webp` chega como foto do outro lado, e
        // e o que os quatro adapters tem em comum. Separa-la da imagem serve
        // para ORGANIZAR a Galeria, nao para mudar o envio.
        case "sticker":
          result = await adapter.sendImage(recipientId, url, caption)
          break
        case "video":
          result = await adapter.sendVideo(recipientId, url, caption)
          break
        case "audio":
          result = await adapter.sendAudio(recipientId, url)
          break
        case "document":
          result = await adapter.sendDocument(
            recipientId,
            url,
            mediaFile.originalName || "document"
          )
          break
        default:
          result = await adapter.sendImage(recipientId, url, caption)
      }

      if (result.success) {
        const message = await saveOutgoingMessage({
          conversationId: data.conversationId,
          storeId: conversation.storeId,
          senderId: usuario.id,
          content: caption,
          contentType: mediaFile.fileType as "image" | "video" | "audio" | "document",
          externalId: result.externalId,
          mediaFileId,
          mediaCaption: caption,
        })
        sentMessages.push(message)
      }
    }

    return NextResponse.json({ sent: sentMessages.length, messages: sentMessages }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 })
    }
    console.error("[Media Send] Error:", error)
    return NextResponse.json({ error: "Erro ao enviar mídia" }, { status: 500 })
  }
}
