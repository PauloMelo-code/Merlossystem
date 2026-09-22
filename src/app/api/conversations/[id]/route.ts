import { NextResponse } from "next/server"
import { registrar } from "@/lib/auditoria"
import { z } from "zod"
import { prisma } from "@/lib/db/prisma"
import { usuarioDaSessao, semSessao } from "@/lib/sessao"
import { escopoDaLoja, escopoDoAtendimento, lojaAtiva, foraDaLoja, type UsuarioComLoja } from "@/lib/loja"

/**
 * Os valores vem do `schema.prisma` (Conversation.status e .priority). Sem
 * este enum o PUT aceitava qualquer string: gravar `status: "banana"` fazia a
 * conversa desaparecer da caixa de entrada, que filtra por open|pending, sem
 * erro nenhum e sem como achar de volta pela interface.
 */
const STATUS = ["open", "pending", "resolved", "archived"] as const
const PRIORIDADE = ["low", "medium", "high", "urgent"] as const

const atualizacaoSchema = z.object({
  status: z.enum(STATUS).optional(),
  priority: z.enum(PRIORIDADE).optional(),
  /** id do agente, ou string vazia/null para devolver a conversa a fila. */
  assignedTo: z.string().nullable().optional(),
  markRead: z.boolean().optional(),
})

/**
 * Conversa individual.
 *
 * Os dois handlers resolvem a conversa DENTRO do escopo da loja antes de tocar
 * nela. Sem isso, um vendedor do Centro com o id de uma conversa do Cerro Azul
 * lia o historico e os dados pessoais da cliente da outra loja, e ainda puxava
 * a conversa para si gravando `assignedTo`.
 */

/**
 * Quem atende esta conversa: a responsável por ela, ou a vendedora dona do
 * número por onde ela entrou. Gestão (admin e gerente) enxerga tudo, mas não
 * "atende" — por isso abrir não marca como lida.
 */
async function ehDeQuemAtende(usuario: UsuarioComLoja, conversaId: string): Promise<boolean> {
  if (usuario.role !== "vendedor") return false
  const conversa = await prisma.conversation.findFirst({
    where: { id: conversaId },
    select: { assignedTo: true, integracao: { select: { vendedorId: true } } },
  })
  if (!conversa) return false
  return conversa.assignedTo === usuario.id || conversa.integracao?.vendedorId === usuario.id
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const usuario = await usuarioDaSessao()
  if (!usuario) return semSessao()

  const { id } = await params

  const conversation = await prisma.conversation.findFirst({
    // Conversa de outra vendedora responde como inexistente: adivinhar o id
    // não pode abrir o atendimento da colega.
    where: { id, ...escopoDaLoja(usuario, lojaAtiva(req)), ...escopoDoAtendimento(usuario) },
    include: {
      contact: true,
      agent: { select: { id: true, name: true, avatarUrl: true } },
    },
  })

  // Conversa de outra loja responde igual a inexistente: dizer "existe, mas
  // nao e sua" ja confirma que aquela cliente fala com a rede.
  if (!conversation) {
    return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 })
  }

  return NextResponse.json(conversation)
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const usuario = await usuarioDaSessao()
  if (!usuario) return semSessao()

  const { id } = await params

  const alvo = await prisma.conversation.findFirst({
    where: { id, ...escopoDaLoja(usuario, lojaAtiva(req)), ...escopoDoAtendimento(usuario) },
    select: { id: true, storeId: true },
  })
  if (!alvo) return foraDaLoja("Conversa")

  const parse = atualizacaoSchema.safeParse(await req.json())
  if (!parse.success) {
    return NextResponse.json(
      { error: "Dados inválidos", detalhes: parse.error.flatten().fieldErrors },
      { status: 400 }
    )
  }
  const body = parse.data

  const data: Record<string, unknown> = {}
  if (body.status !== undefined) data.status = body.status
  if (body.priority !== undefined) data.priority = body.priority
  // "Marcar como lida" é de quem ATENDE. Gestão abrindo para conferir não pode
  // apagar o aviso de não lida da vendedora: ela perderia a única pista de que
  // a cliente está esperando resposta.
  if (body.markRead && (await ehDeQuemAtende(usuario, id))) data.unreadCount = 0

  // Transferir exige checar a LOJA do destinatario, nao so que o id existe.
  // O id vem do corpo do request: sem esta checagem dava para atribuir a
  // conversa a um vendedor da outra loja, que ficava com o nome estampado nela
  // sem nunca poder abri-la (o escopo o barra na leitura). A conversa entrava
  // num limbo: atribuida a quem nao consegue atender.
  if (body.assignedTo !== undefined) {
    if (!body.assignedTo) {
      data.assignedTo = null
    } else {
      const destinatario = await prisma.user.findFirst({
        where: {
          id: body.assignedTo,
          isActive: true,
          // storeId nulo = admin/gerente, que alcancam as duas lojas
          // (docs/rbac.md). Vendedor e viewer tem loja obrigatoria.
          OR: [{ storeId: alvo.storeId }, { storeId: null }],
        },
        select: { id: true },
      })
      if (!destinatario) {
        return NextResponse.json(
          { error: "Destinatário não atende esta loja." },
          { status: 422 }
        )
      }
      data.assignedTo = destinatario.id
    }
  }

  if (Object.keys(data).length === 0) {
    // Gestão abriu a conversa: o pedido de "marcar como lida" foi ignorado de
    // propósito, e isso não é erro — a tela não tem nada a corrigir.
    if (body.markRead) {
      const atual = await prisma.conversation.findUnique({
        where: { id },
        include: { contact: true, agent: { select: { id: true, name: true, avatarUrl: true } } },
      })
      return NextResponse.json(atual)
    }
    return NextResponse.json({ error: "Nada a atualizar." }, { status: 400 })
  }

  const conversation = await prisma.conversation.update({
    where: { id },
    data,
    include: {
      contact: true,
      agent: { select: { id: true, name: true, avatarUrl: true } },
    },
  })

  // Resolver e transferir mudam de quem e a responsabilidade pelo
  // atendimento. Sem registro, "quem fechou essa conversa?" nao tem resposta.
  if (body.status === "resolved" || body.assignedTo !== undefined) {
    await registrar({
      storeId: alvo.storeId,
      userId: usuario.id,
      acao: body.status === "resolved" ? "conversa_resolvida" : "conversa_transferida",
      entidade: "conversa",
      entidadeId: id,
      detalhes: {
        ...(body.status ? { status: body.status } : {}),
        ...(body.assignedTo !== undefined ? { atribuidaA: data.assignedTo } : {}),
      },
      req,
    })
  }

  return NextResponse.json(conversation)
}
