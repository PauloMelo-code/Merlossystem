import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { usuarioDaSessao, semSessao } from "@/lib/sessao"
import { escopoDaLoja, lojaAtiva } from "@/lib/loja"
import { limiteDaPagina, paginaAtual } from "@/lib/paginacao"
import { PASTA_DE_AVATAR } from "@/lib/media/pastas"

/**
 * GET: List media files with filters
 * Query params: folder, fileType, tags, productId, search, page, limit
 */
export async function GET(req: Request) {
  const usuario = await usuarioDaSessao()
  if (!usuario) return semSessao()

  const { searchParams } = new URL(req.url)
  const folder = searchParams.get("folder") || ""
  const fileType = searchParams.get("fileType") || ""
  const tag = searchParams.get("tag") || ""
  const productId = searchParams.get("productId") || ""
  const search = searchParams.get("search") || ""
  const page = paginaAtual(searchParams.get("page"))
  const limit = limiteDaPagina(searchParams.get("limit"), 30)

  const where: Record<string, unknown> = { ...escopoDaLoja(usuario, lojaAtiva(req)) }

  // Foto de perfil de contato fica FORA da Galeria, sempre — inclusive se
  // alguem pedir a pasta pelo nome na URL. Ver `PASTA_DE_AVATAR`: excluir de
  // dentro da Galeria apagaria o objeto e a ficha do contato amanheceria com a
  // imagem quebrada, sem ninguem ligar uma coisa na outra.
  const pastaPedida = folder && folder !== "all" && folder !== PASTA_DE_AVATAR ? folder : null
  where.folder = pastaPedida ?? { not: PASTA_DE_AVATAR }

  if (fileType && fileType !== "all") where.fileType = fileType
  if (tag) where.tags = { has: tag }
  if (productId) where.productId = productId
  if (search) {
    where.OR = [
      { originalName: { contains: search, mode: "insensitive" } },
      { tags: { has: search } },
    ]
  }

  const [files, total, pastas, tipos] = await Promise.all([
    prisma.mediaFile.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        product: { select: { id: true, name: true } },
      },
    }),
    prisma.mediaFile.count({ where }),
    // As pastas e os tipos que EXISTEM, para a tela nao oferecer filtro que
    // nao leva a lugar nenhum. Escopo de loja apenas, sem os filtros da busca:
    // derivar as opcoes do resultado filtrado deixaria so a opcao ja escolhida.
    prisma.mediaFile.findMany({
      where: { ...escopoDaLoja(usuario, lojaAtiva(req)), folder: { not: PASTA_DE_AVATAR } },
      distinct: ["folder"],
      select: { folder: true },
      orderBy: { folder: "asc" },
    }),
    prisma.mediaFile.findMany({
      where: { ...escopoDaLoja(usuario, lojaAtiva(req)), folder: { not: PASTA_DE_AVATAR } },
      distinct: ["fileType"],
      select: { fileType: true },
      orderBy: { fileType: "asc" },
    }),
  ])

  return NextResponse.json({
    files,
    total,
    page,
    limit,
    pastas: pastas.map((p) => p.folder).filter((p): p is string => !!p),
    tipos: tipos.map((t) => t.fileType).filter((t): t is string => !!t),
  })
}
