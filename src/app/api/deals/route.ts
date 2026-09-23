import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { usuarioDaSessao, semSessao } from "@/lib/sessao"
import { escopoDaLoja, lojaAtiva, foraDaLoja } from "@/lib/loja"
import { z } from "zod"
import { VALORES_DE_ETAPA, ETAPAS } from "@/lib/funil/etapas"

const dealSchema = z.object({
  contactId: z.string(),
  conversationId: z.string().optional().nullable(),
  assignedTo: z.string().optional().nullable(),
  // Lista fechada: `deals.stage` e `text` sem CHECK, entao a unica barreira
  // entre um texto qualquer e a coluna e este enum. Etapa desconhecida some da
  // tela do pipeline, que so monta as colunas que conhece.
  stage: z.enum(VALORES_DE_ETAPA as [string, ...string[]]).default("lead"),
  value: z.number().default(0),
  products: z.array(z.record(z.string(), z.unknown())).default([]),
  notes: z.string().optional().nullable(),
  expectedCloseDate: z.string().optional().nullable(),
})

export async function GET(req: Request) {
  const usuario = await usuarioDaSessao()
  if (!usuario) return semSessao()

  const { searchParams } = new URL(req.url)
  const stage = searchParams.get("stage") || ""
  const assignedTo = searchParams.get("assignedTo") || ""

  const where: Record<string, unknown> = { ...escopoDaLoja(usuario, lojaAtiva(req)) }
  if (stage && stage !== "all") where.stage = stage
  if (assignedTo && assignedTo !== "all") where.assignedTo = assignedTo

  const deals = await prisma.deal.findMany({
    where,
    include: {
      contact: {
        select: { id: true, name: true, phone: true, avatarUrl: true, preferredSize: true, tags: true },
      },
      conversation: { select: { id: true, channel: true } },
      assignee: { select: { id: true, name: true } },
    },
    orderBy: { lastActivityAt: "desc" },
  })

  // As colunas do pipeline, na ordem da esteira — de `@/lib/funil/etapas`,
  // que e a unica lista de etapas do sistema.
  const pipeline = ETAPAS.map(({ valor: s }) => ({
    stage: s,
    deals: deals.filter((d) => d.stage === s),
    totalValue: deals
      .filter((d) => d.stage === s)
      .reduce((sum, d) => sum + Number(d.value), 0),
    count: deals.filter((d) => d.stage === s).length,
  }))

  return NextResponse.json({ deals, pipeline })
}

export async function POST(req: Request) {
  try {
    const usuario = await usuarioDaSessao()
    if (!usuario) return semSessao()


    const body = await req.json()
    const data = dealSchema.parse(body)

    // A loja vem do contato, nao de um parametro: se o contato nao esta no
    // escopo de quem pediu, a busca nao acha e o registro nao nasce.
    const contato = await prisma.contact.findFirst({
      where: { id: data.contactId, ...escopoDaLoja(usuario, lojaAtiva(req)) },
      select: { storeId: true },
    })
    if (!contato) return foraDaLoja("Contato")
    const storeId = contato.storeId

    const deal = await prisma.deal.create({
      data: {
        storeId,
        contactId: data.contactId,
        conversationId: data.conversationId || null,
        assignedTo: data.assignedTo || null,
        stage: data.stage,
        value: data.value,
        products: data.products as Prisma.InputJsonValue,
        notes: data.notes || null,
        expectedCloseDate: data.expectedCloseDate ? new Date(data.expectedCloseDate) : null,
      },
      include: {
        contact: { select: { id: true, name: true, phone: true, avatarUrl: true, tags: true } },
      },
    })

    // Create initial event
    await prisma.dealEvent.create({
      data: {
        dealId: deal.id,
        toStage: data.stage,
        notes: "Deal criado",
      },
    })

    return NextResponse.json(deal, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 })
    }
    return NextResponse.json({ error: "Erro ao criar deal" }, { status: 500 })
  }
}
