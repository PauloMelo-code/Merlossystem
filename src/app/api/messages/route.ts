import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { saveOutgoingMessage } from "@/lib/channels/gateway"
import { entregarNoCanal } from "@/lib/chat/enviar"
import type { ContentType } from "@/lib/channels/types"
import { usuarioDaSessao, semSessao } from "@/lib/sessao"
import { escopoDaLoja, escopoDoAtendimento, lojaAtiva } from "@/lib/loja"
import { z } from "zod"
import { limiteDaPagina } from "@/lib/paginacao"

// `senderId` NAO entra aqui: quem enviou vem da sessao.
const sendSchema = z.object({
  conversationId: z.string(),
  content: z.string().optional(),
  contentType: z.string().default("text"),
  mediaFileId: z.string().optional(),
  mediaCaption: z.string().optional(),
  isInternalNote: z.boolean().default(false),
})

/**
 * GET: List messages for a conversation
 */
export async function GET(req: Request) {
  const usuario = await usuarioDaSessao()
  if (!usuario) return semSessao()

  const { searchParams } = new URL(req.url)
  const conversationId = searchParams.get("conversationId")
  const limit = limiteDaPagina(searchParams.get("limit"), 50)
  const before = searchParams.get("before") // cursor-based pagination

  if (!conversationId) {
    return NextResponse.json(
      { error: "conversationId is required" },
      { status: 400 }
    )
  }

  // O escopo entra aqui tambem: sem ele bastava adivinhar um conversationId
  // para ler a conversa da outra loja.
  const messages = await prisma.message.findMany({
    where: {
      conversationId,
      ...escopoDaLoja(usuario, lojaAtiva(req)),
      // E a conversa precisa ser do atendimento dela, não só da loja.
      conversation: escopoDoAtendimento(usuario),
      ...(before && { createdAt: { lt: new Date(before) } }),
    },
    include: {
      media: {
        include: { mediaFile: true },
      },
      sender: {
        select: { id: true, name: true, avatarUrl: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  })

  // Return in chronological order
  return NextResponse.json(messages.reverse())
}

/**
 * POST: Send a message via the appropriate channel
 */
export async function POST(req: Request) {
  try {
    const usuario = await usuarioDaSessao()
    if (!usuario) return semSessao()

    const body = await req.json()
    const data = sendSchema.parse(body)

    // Get the conversation to determine channel and recipient.
    // `findFirst` + escopo em vez de `findUnique`: a conversa tem que estar na
    // loja de quem esta enviando. A mensagem herda a loja dela.
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: data.conversationId,
        ...escopoDaLoja(usuario, lojaAtiva(req)),
        ...escopoDoAtendimento(usuario),
      },
      include: { contact: true },
    })

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversa não encontrada" },
        { status: 404 }
      )
    }

    // Internal notes don't get sent to the channel
    if (data.isInternalNote) {
      const message = await prisma.message.create({
        data: {
          storeId: conversation.storeId,
          conversationId: data.conversationId,
          senderType: "agent",
          senderId: usuario.id,
          content: data.content || null,
          contentType: "text",
          isInternalNote: true,
        },
      })
      return NextResponse.json(message, { status: 201 })
    }

    const entrega = await entregarNoCanal({
      conversa: conversation,
      contentType: data.contentType as ContentType,
      content: data.content,
      mediaFileId: data.mediaFileId,
      mediaCaption: data.mediaCaption,
    })

    // A mensagem e gravada NOS DOIS casos. Quando o canal recusa, ela vira uma
    // bolha `failed` na conversa, com o motivo, e a atendente pode reenviar.
    // Antes daqui saia um 500 antes de gravar: a tentativa nao deixava rastro
    // nenhum e o trabalho da atendente se perdia em silencio.
    const message = await saveOutgoingMessage({
      conversationId: data.conversationId,
      storeId: conversation.storeId,
      senderId: usuario.id,
      content: data.content,
      contentType: data.contentType as ContentType,
      externalId: entrega.ok ? entrega.externalId : undefined,
      mediaFileId: data.mediaFileId,
      mediaCaption: data.mediaCaption,
      erroDeEnvio: entrega.ok ? undefined : entrega.erro,
    })

    // 201 mesmo na recusa do canal: o pedido foi processado e a mensagem
    // existe. Quem chama distingue pelo `externalStatus` do corpo, nao pelo
    // codigo HTTP — precisa da mensagem gravada para desenhar a bolha.
    return NextResponse.json(message, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 })
    }
    console.error("[Messages API] Error:", error)
    return NextResponse.json(
      { error: "Erro ao enviar mensagem" },
      { status: 500 }
    )
  }
}
