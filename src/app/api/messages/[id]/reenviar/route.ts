import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { entregarNoCanal } from "@/lib/chat/enviar"
import type { ContentType } from "@/lib/channels/types"
import { usuarioDaSessao, semSessao } from "@/lib/sessao"
import { escopoDaLoja, escopoDoAtendimento, lojaAtiva } from "@/lib/loja"

/**
 * Reenvia uma mensagem que o canal recusou.
 *
 * Reenviar EDITA a mensagem existente em vez de criar outra: se criasse, a
 * conversa acumularia uma bolha por tentativa e a atendente nao saberia quais
 * a cliente recebeu. Uma mensagem, um estado.
 *
 * Idempotente na pratica: so mensagem com `externalStatus = "failed"` e
 * reenviavel. Dois cliques no botao levam a segunda chamada a um 409, e
 * mensagem ja entregue nunca e reenviada por engano.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const usuario = await usuarioDaSessao()
  if (!usuario) return semSessao()

  const { id } = await params

  // `findFirst` + escopo, nunca `findUnique`: o id vem da URL. Sem o escopo
  // bastava adivinhar um id para disparar um envio pela conta da outra loja.
  const mensagem = await prisma.message.findFirst({
    where: { id, ...escopoDaLoja(usuario, lojaAtiva(req)), conversation: escopoDoAtendimento(usuario) },
    include: {
      media: { select: { mediaFileId: true, caption: true } },
      conversation: { include: { contact: true } },
    },
  })

  if (!mensagem) {
    return NextResponse.json({ error: "Mensagem não encontrada" }, { status: 404 })
  }

  if (mensagem.externalStatus !== "failed") {
    return NextResponse.json(
      { error: "Só mensagem com falha de envio pode ser reenviada." },
      { status: 409 }
    )
  }

  // Nota interna nunca foi para canal nenhum, entao nao ha o que reenviar.
  if (mensagem.isInternalNote) {
    return NextResponse.json(
      { error: "Nota interna não vai para o canal." },
      { status: 409 }
    )
  }

  const midia = mensagem.media[0]

  const entrega = await entregarNoCanal({
    conversa: mensagem.conversation,
    contentType: mensagem.contentType as ContentType,
    content: mensagem.content ?? undefined,
    mediaFileId: midia?.mediaFileId ?? undefined,
    mediaCaption: midia?.caption ?? undefined,
  })

  const atualizada = await prisma.message.update({
    where: { id },
    data: entrega.ok
      ? {
          externalStatus: "sent",
          externalId: entrega.externalId || null,
          // Limpa o motivo antigo: manter o erro numa mensagem que ja saiu
          // faria a bolha continuar mostrando a falha resolvida.
          metadata: {},
        }
      : {
          externalStatus: "failed",
          metadata: { erroDeEnvio: entrega.erro, tentadoNovamenteEm: new Date().toISOString() },
        },
  })

  return NextResponse.json(atualizada)
}
