import { NextResponse } from "next/server"
import { suggestResponse } from "@/lib/ai/suggest"
import { prisma } from "@/lib/db/prisma"
import { usuarioDaSessao, semSessao } from "@/lib/sessao"
import { escopoDaLoja, lojaAtiva } from "@/lib/loja"
import { z } from "zod"

const schema = z.object({
  conversationId: z.string(),
})

export async function POST(req: Request) {
  try {
    const usuario = await usuarioDaSessao()
    if (!usuario) return semSessao()

    const body = await req.json()
    const { conversationId } = schema.parse(body)

    // Get contact info for context — dentro do escopo da loja. A sugestao e
    // montada com as ultimas 20 mensagens da conversa, entao sem esta conferencia
    // um vendedor do Centro lia o historico de uma cliente do Cerro Azul
    // embrulhado no texto sugerido.
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, ...escopoDaLoja(usuario, lojaAtiva(req)) },
      include: {
        contact: { select: { name: true, preferredSize: true } },
      },
    })

    // Conversa de outra loja responde igual a inexistente: 403 com mensagem
    // propria ja confirmaria que aquele id existe.
    if (!conversation) {
      return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 })
    }

    const suggestion = await suggestResponse({
      conversationId,
      // O catálogo é por loja: a sugestão nunca pode citar peça da outra.
      storeId: conversation.storeId,
      contactName: conversation.contact.name || undefined,
      preferredSize: conversation.contact.preferredSize || undefined,
    })

    return NextResponse.json({ suggestion })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 })
    }
    console.error("[AI Suggest] Error:", error)
    return NextResponse.json({ error: "Erro ao gerar sugestão" }, { status: 500 })
  }
}
