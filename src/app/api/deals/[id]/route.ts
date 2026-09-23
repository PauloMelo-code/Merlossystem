import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { usuarioDaSessao, semSessao } from "@/lib/sessao"
import { escopoDaLoja, lojaAtiva, foraDaLoja, type UsuarioComLoja } from "@/lib/loja"
import { z } from "zod"
import { VALORES_DE_ETAPA } from "@/lib/funil/etapas"

/**
 * Deal individual.
 *
 * Os tres handlers resolvem o deal DENTRO do escopo da loja antes de tocar
 * nele. Sem isso, um vendedor do Centro com o id de um deal do Cerro Azul lia
 * nome e telefone do cliente da outra loja, movia o estagio do funil dela e
 * apagava o deal junto com o historico de eventos.
 */

const updateSchema = z.object({
  value: z.number().optional(),
  products: z.array(z.record(z.string(), z.unknown())).optional(),
  notes: z.string().optional().nullable(),
  // `assignedTo` e atribuicao (a quem o deal pertence), nao autoria — continua
  // vindo do body. `changedBy` (quem mudou) saiu: vem da sessao.
  assignedTo: z.string().optional().nullable(),
  expectedCloseDate: z.string().optional().nullable(),
  // Lista fechada: a coluna e `text` sem CHECK, e etapa desconhecida some da
  // tela do pipeline sem erro nenhum.
  stage: z.enum(VALORES_DE_ETAPA as [string, ...string[]]).optional(),
  lossReason: z.string().optional(),
  lossNotes: z.string().optional(),
})

/** O deal, se pertencer a uma loja que quem pediu alcanca. */
function noEscopo(req: Request, id: string, usuario: UsuarioComLoja) {
  return prisma.deal.findFirst({
    where: { id, ...escopoDaLoja(usuario, lojaAtiva(req)) },
    select: { id: true, stage: true },
  })
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const usuario = await usuarioDaSessao()
  if (!usuario) return semSessao()

  const { id } = await params

  const deal = await prisma.deal.findFirst({
    where: { id, ...escopoDaLoja(usuario, lojaAtiva(req)) },
    include: {
      contact: true,
      conversation: { select: { id: true, channel: true } },
      assignee: { select: { id: true, name: true } },
      events: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { changer: { select: { id: true, name: true } } },
      },
    },
  })

  // Deal de outra loja responde igual a inexistente: dizer "existe, mas nao e
  // sua" ja entrega que aquele cliente comprou na rede.
  if (!deal) {
    return NextResponse.json({ error: "Deal não encontrado" }, { status: 404 })
  }

  return NextResponse.json(deal)
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const usuario = await usuarioDaSessao()
    if (!usuario) return semSessao()

    const { id } = await params
    const body = await req.json()
    const data = updateSchema.parse(body)

    // Resolver o deal pelo escopo e o que impede o vendedor do Centro de
    // arrastar para "ganho" (e de anotar motivo de perda em) um deal do Cerro
    // Azul so com o id em maos.
    const current = await noEscopo(req, id, usuario)
    if (!current) return foraDaLoja("Deal")

    // Build update data
    const updateData: Record<string, unknown> = {
      lastActivityAt: new Date(),
    }

    if (data.value !== undefined) updateData.value = data.value
    if (data.products !== undefined) updateData.products = data.products as Prisma.InputJsonValue
    if (data.notes !== undefined) updateData.notes = data.notes
    if (data.assignedTo !== undefined) updateData.assignedTo = data.assignedTo || null
    if (data.expectedCloseDate !== undefined) {
      updateData.expectedCloseDate = data.expectedCloseDate ? new Date(data.expectedCloseDate) : null
    }

    // Stage change
    if (data.stage && data.stage !== current.stage) {
      updateData.stage = data.stage

      if (data.stage === "lost") {
        updateData.lossReason = data.lossReason || null
        updateData.lossNotes = data.lossNotes || null
      }

      // Record event
      await prisma.dealEvent.create({
        data: {
          dealId: id,
          fromStage: current.stage,
          toStage: data.stage,
          changedBy: usuario.id,
          notes: data.stage === "lost"
            ? `Motivo: ${data.lossReason || "não informado"}`
            : data.notes || null,
        },
      })
    }

    const deal = await prisma.deal.update({
      where: { id },
      data: updateData,
      include: {
        contact: { select: { id: true, name: true, phone: true, avatarUrl: true, tags: true } },
        assignee: { select: { id: true, name: true } },
      },
    })

    return NextResponse.json(deal)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 })
    }
    return NextResponse.json({ error: "Erro ao atualizar deal" }, { status: 500 })
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const usuario = await usuarioDaSessao()
  if (!usuario) return semSessao()

  const { id } = await params
  // O delete e fisico e leva os eventos junto: sem escopo, um id vazado
  // apagava o funil do Cerro Azul sem deixar rastro para reconstruir.
  if (!(await noEscopo(req, id, usuario))) return foraDaLoja("Deal")

  // Soft delete (ADR 0005). Os eventos NAO sao apagados: `deal_events` nao tem
  // `store_id` nem `is_deleted` — eles sao alcancados pelo pai, que agora esta
  // marcado, e sao justamente o rastro de como o funil andou.
  await prisma.deal.update({
    where: { id },
    data: { isDeleted: true, deletedAt: new Date(), modifiedBy: usuario.id },
  })

  return NextResponse.json({ success: true })
}
