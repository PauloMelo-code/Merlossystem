import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { usuarioDaSessao, semSessao } from "@/lib/sessao"
import { escopoDaLoja, lojaAtiva } from "@/lib/loja"
import { limiteDaPagina, paginaAtual } from "@/lib/paginacao"

/**
 * GET: List conversations with filters
 */
export async function GET(req: Request) {
  const usuario = await usuarioDaSessao()
  if (!usuario) return semSessao()

  const { searchParams } = new URL(req.url)
  const channel = searchParams.get("channel") || ""
  const status = searchParams.get("status") || ""
  const assignedTo = searchParams.get("assignedTo") || ""
  const search = searchParams.get("search") || ""
  const priority = searchParams.get("priority") || ""
  /** Numero conectado (`stores_integracoes.id`): cada numero tem o seu atendimento. */
  const integracaoId = searchParams.get("integracaoId") || ""
  const page = paginaAtual(searchParams.get("page"))
  const limit = limiteDaPagina(searchParams.get("limit"), 30)

  const where: Record<string, unknown> = { ...escopoDaLoja(usuario, lojaAtiva(req)) }

  if (channel && channel !== "all") where.channel = channel
  if (status && status !== "all") where.status = status
  else where.status = { in: ["open", "pending"] }
  if (assignedTo && assignedTo !== "all") where.assignedTo = assignedTo
  if (priority && priority !== "all") where.priority = priority
  // O escopo de loja continua valendo por cima: pedir o numero de outra loja
  // simplesmente nao devolve nada, em vez de vazar a conversa dela.
  if (integracaoId && integracaoId !== "all") where.storeIntegracaoId = integracaoId
  if (search) {
    where.contact = {
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { phone: { contains: search } },
        { email: { contains: search, mode: "insensitive" } },
      ],
    }
  }

  const [conversations, total] = await Promise.all([
    prisma.conversation.findMany({
      where,
      include: {
        contact: {
          select: {
            id: true,
            name: true,
            phone: true,
            avatarUrl: true,
            preferredSize: true,
            tags: true,
          },
        },
        agent: {
          select: { id: true, name: true, avatarUrl: true },
        },
        // Por qual numero a conversa entrou: na visao geral de todos, e o que
        // diz de quem e o atendimento sem precisar abrir a conversa.
        integracao: {
          select: { id: true, rotulo: true, provedor: true },
        },
      },
      orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.conversation.count({ where }),
  ])

  return NextResponse.json({ conversations, total, page, limit })
}
