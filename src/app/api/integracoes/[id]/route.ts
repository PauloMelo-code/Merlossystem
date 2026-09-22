import { NextResponse } from "next/server"
import { registrar } from "@/lib/auditoria"
import { prisma } from "@/lib/db/prisma"
import { usuarioDaSessao, semSessao } from "@/lib/sessao"
import { cifrarCredenciais, ehCofreError } from "@/lib/cofre"
import { atualizacaoSchema, paraApi } from "@/lib/integracoes"
import { z } from "zod"

/** Busca a integracao viva, ou null. */
async function buscar(id: string) {
  return prisma.storeIntegracao.findFirst({
    where: { id, isDeleted: false },
    include: {
      store: { select: { id: true, nome: true } },
      vendedor: { select: { id: true, name: true } },
    },
  })
}

const COM_LOJA = { store: { select: { id: true, nome: true } }, vendedor: { select: { id: true, name: true } } }

/**
 * A dona do numero precisa ser pessoa ATIVA e DA MESMA LOJA da conta (admin e
 * gerente alcancam as duas lojas, entao passam). Numero apontando para alguem
 * de outra loja penduraria a conversa na carteira errada.
 */
async function vendedorInvalido(vendedorId: string, storeId: string | null): Promise<string | null> {
  const pessoa = await prisma.user.findFirst({
    where: { id: vendedorId, isActive: true },
    select: { storeId: true, role: true },
  })
  if (!pessoa) return "Pessoa nao encontrada ou inativa."
  if (pessoa.storeId && pessoa.storeId !== storeId) return "Esta pessoa e de outra loja."
  return null
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const usuario = await usuarioDaSessao()
  if (!usuario) return semSessao()

  const { id } = await params
  const integracao = await buscar(id)
  if (!integracao) {
    return NextResponse.json({ error: "Integracao nao encontrada" }, { status: 404 })
  }
  return NextResponse.json(paraApi(integracao))
}

/** Renomear, trocar status ou substituir credencial (reconectar). */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const usuario = await usuarioDaSessao()
    if (!usuario) return semSessao()

    const { id } = await params
    const atual = await buscar(id)
    if (!atual) {
      return NextResponse.json({ error: "Integracao nao encontrada" }, { status: 404 })
    }

    const data = atualizacaoSchema.parse(await req.json())
    const trocouCredencial = data.credenciais && Object.keys(data.credenciais).length > 0

    if (data.vendedorId) {
      const motivo = await vendedorInvalido(data.vendedorId, atual.storeId)
      if (motivo) return NextResponse.json({ error: motivo }, { status: 400 })
    }

    const atualizada = await prisma.storeIntegracao.update({
      where: { id },
      data: {
        ...(data.rotulo !== undefined && { rotulo: data.rotulo }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.expiraEm !== undefined && {
          expiraEm: data.expiraEm ? new Date(data.expiraEm) : null,
        }),
        // A troca vale das PROXIMAS conversas em diante: as que ja existem
        // continuam com quem as atendeu.
        ...(data.vendedorId !== undefined && { vendedorId: data.vendedorId }),
        ...(trocouCredencial && {
          credenciaisCifradas: cifrarCredenciais(data.credenciais!),
          status: data.status ?? "conectado",
          // Reconectou: o erro anterior deixou de valer.
          ultimoErro: null,
        }),
        modifiedBy: usuario.id,
      },
      include: COM_LOJA,
    })

    return NextResponse.json(paraApi(atualizada))
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 })
    }
    if (ehCofreError(error)) {
      console.error("[Integracoes] Cofre:", error.message)
      return NextResponse.json({ error: error.message }, { status: 503 })
    }
    console.error("[Integracoes] Erro ao atualizar:", error)
    return NextResponse.json({ error: "Erro ao atualizar integracao" }, { status: 500 })
  }
}

/**
 * Desconectar.
 *
 * O registro vira soft delete (fica na trilha: quem conectou, quando, quando
 * saiu), mas a **credencial e apagada de verdade**. Guardar token de um
 * provedor desconectado nao serve para auditoria nenhuma — so aumenta o
 * estrago se o banco vazar.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const usuario = await usuarioDaSessao()
  if (!usuario) return semSessao()

  const { id } = await params
  const atual = await buscar(id)
  if (!atual) {
    return NextResponse.json({ error: "Integracao nao encontrada" }, { status: 404 })
  }

  await prisma.storeIntegracao.update({
    where: { id },
    data: {
      credenciaisCifradas: null,
      status: "desconectado",
      isDeleted: true,
      deletedAt: new Date(),
      modifiedBy: usuario.id,
    },
  })

  // Desconectar apaga a credencial de verdade: reconectar exige passar de novo
  // pelo provedor. Um canal que "parou de funcionar" tem que ter dono e hora.
  await registrar({
    storeId: atual.storeId,
    userId: usuario.id,
    acao: "integracao_desconectada",
    entidade: "integracao",
    entidadeId: id,
    detalhes: { provedor: atual.provedor, rotulo: atual.rotulo },
    req,
  })

  return NextResponse.json({ success: true })
}
