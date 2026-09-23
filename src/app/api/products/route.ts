import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { usuarioDaSessao, semSessao } from "@/lib/sessao"
import { escopoDaLoja, lojaAtiva, lojaParaGravar, faltaLoja } from "@/lib/loja"
import { z } from "zod"
import { limiteDaPagina, paginaAtual } from "@/lib/paginacao"

const productSchema = z.object({
  name: z.string().min(1),
  sku: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  sizeType: z.string().default("both"),
  sizes: z.array(z.string()).default([]),
  price: z.number().min(0),
  compareAtPrice: z.number().optional().nullable(),
  costPrice: z.number().optional().nullable(),
  stock: z.record(z.string(), z.number()).default({}),
  weightGrams: z.number().optional().nullable(),
  imageUrls: z.array(z.string()).default([]),
  active: z.boolean().default(true),
  featured: z.boolean().default(false),
})

export async function GET(req: Request) {
  const usuario = await usuarioDaSessao()
  if (!usuario) return semSessao()

  const { searchParams } = new URL(req.url)
  const search = searchParams.get("search") || ""
  const category = searchParams.get("category") || ""
  const sizeType = searchParams.get("sizeType") || ""
  const page = paginaAtual(searchParams.get("page"))
  const limit = limiteDaPagina(searchParams.get("limit"), 20)

  const where: Record<string, unknown> = { ...escopoDaLoja(usuario, lojaAtiva(req)) }

  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { sku: { contains: search, mode: "insensitive" } },
    ]
  }
  if (category) where.category = category
  if (sizeType) where.sizeType = sizeType

  // O catalogo e o MESMO nas duas lojas — o Bling e uma conta so da rede e a
  // sincronizacao grava uma linha por loja porque `products.store_id` e
  // obrigatorio e o pedido aponta para o id local. Sem escopo de loja (gestao
  // em "Todas as lojas"), listar as duas linhas mostrava cada peca duas vezes.
  // Limite conhecido: produto criado a mao SEM sku colapsa com os outros sem
  // sku; com sku, cada codigo aparece uma vez.
  const semEscopoDeLoja = !where.storeId
  const distinto: { distinct?: Prisma.ProductScalarFieldEnum[] } = semEscopoDeLoja
    ? { distinct: ["sku"] }
    : {}

  const [products, chaves] = await Promise.all([
    prisma.product.findMany({
      ...distinto,
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    // `count` nao aceita `distinct`, entao o total sai da contagem das chaves.
    prisma.product.findMany({ ...distinto, where, select: { id: true } }),
  ])

  return NextResponse.json({ products, total: chaves.length, page, limit })
}

export async function POST(req: Request) {
  try {
    const usuario = await usuarioDaSessao()
    if (!usuario) return semSessao()

    const storeId = lojaParaGravar(usuario, lojaAtiva(req))
    if (!storeId) return faltaLoja()

    const body = await req.json()
    const data = productSchema.parse(body)

    const product = await prisma.product.create({
      data: {
        storeId,
        ...data,
        price: data.price,
        compareAtPrice: data.compareAtPrice ?? undefined,
        costPrice: data.costPrice ?? undefined,
        stock: data.stock as Prisma.InputJsonValue,
      },
    })

    return NextResponse.json(product, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 })
    }
    return NextResponse.json({ error: "Erro ao criar produto" }, { status: 500 })
  }
}
