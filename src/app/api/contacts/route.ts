import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { usuarioDaSessao, semSessao } from "@/lib/sessao"
import { escopoDaLoja, lojaAtiva, lojaParaGravar, faltaLoja } from "@/lib/loja"
import { z } from "zod"
import { limiteDaPagina, paginaAtual } from "@/lib/paginacao"

const contactSchema = z.object({
  name: z.string().min(1).optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  instagramId: z.string().optional().nullable(),
  facebookId: z.string().optional().nullable(),
  tiktokId: z.string().optional().nullable(),
  whatsappId: z.string().optional().nullable(),
  preferredSize: z.string().optional().nullable(),
  tags: z.array(z.string()).default([]),
  notes: z.string().optional().nullable(),
  birthday: z.string().optional().nullable(),
})

export async function GET(req: Request) {
  const usuario = await usuarioDaSessao()
  if (!usuario) return semSessao()

  const { searchParams } = new URL(req.url)
  const search = searchParams.get("search") || ""
  const tag = searchParams.get("tag") || ""
  const preferredSize = searchParams.get("preferredSize") || ""
  const page = paginaAtual(searchParams.get("page"))
  const limit = limiteDaPagina(searchParams.get("limit"), 20)

  // Carteira isolada por loja: vendedor so ve a dele; gestao ve as duas.
  const where: Record<string, unknown> = { ...escopoDaLoja(usuario, lojaAtiva(req)) }

  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { phone: { contains: search } },
      { email: { contains: search, mode: "insensitive" } },
    ]
  }
  if (tag) where.tags = { has: tag }
  if (preferredSize) where.preferredSize = preferredSize

  // Filtrar por numero e por vendedora passa pelas CONVERSAS: o contato nao
  // guarda por onde falou nem com quem. Sao dois filtros independentes que se
  // somam no mesmo `some` — pedir os dois quer dizer "atendida por ela, por
  // este numero", e nao "por ela em qualquer numero mais qualquer uma neste".
  const numero = searchParams.get("numero") || ""
  const vendedor = searchParams.get("vendedor") || ""
  const daConversa: Record<string, unknown>[] = []

  if (numero) daConversa.push({ integracaoId: numero })
  if (vendedor) {
    // Mesma definicao de `escopoDoAtendimento`: e dela o que esta atribuido a
    // ela OU o que entra pelo numero dela. Só `assignedTo` deixaria de fora a
    // conversa que ninguem assumiu ainda no numero que e dela.
    daConversa.push({
      OR: [{ assignedTo: vendedor }, { integracao: { vendedorId: vendedor } }],
    })
  }
  if (daConversa.length > 0) where.conversations = { some: { AND: daConversa } }

  const [contacts, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      orderBy: { lastContactAt: { sort: "desc", nulls: "last" } },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.contact.count({ where }),
  ])

  return NextResponse.json({ contacts, total, page, limit })
}

export async function POST(req: Request) {
  try {
    const usuario = await usuarioDaSessao()
    if (!usuario) return semSessao()

    const storeId = lojaParaGravar(usuario, lojaAtiva(req))
    if (!storeId) return faltaLoja()

    const body = await req.json()
    const data = contactSchema.parse(body)

    const contact = await prisma.contact.create({
      data: {
        ...data,
        storeId,
        birthday: data.birthday ? new Date(data.birthday) : undefined,
      },
    })

    return NextResponse.json(contact, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 })
    }
    return NextResponse.json({ error: "Erro ao criar contato" }, { status: 500 })
  }
}
