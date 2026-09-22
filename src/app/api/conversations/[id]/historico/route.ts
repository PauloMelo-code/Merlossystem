import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { usuarioDaSessao, semSessao } from "@/lib/sessao"
import { escopoDaLoja, lojaAtiva } from "@/lib/loja"
import { contaDaConversa, credenciaisDaConta } from "@/lib/roteamento"
import { ehUazapiConfigError } from "@/lib/uazapi/config"
import { pedirHistorico } from "@/lib/uazapi/instancia"

/**
 * Pede ao WhatsApp as mensagens anteriores desta conversa.
 *
 * O uazapi guarda so 7 dias do lado dele e repassa o pedido ao CELULAR: a
 * resposta nao e imediata nem garantida, e chega em lotes pelo evento
 * `history` — que o webhook ja ingere. Por isso a rota responde "pedido
 * enviado" (202) e nunca promete a conversa inteira.
 *
 * So no uazapi: o WhatsApp oficial nao entrega historico anterior a conexao.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const usuario = await usuarioDaSessao()
  if (!usuario) return semSessao()

  const { id } = await params

  // A loja sai da SESSAO, nunca do corpo: conversa de outra loja responde como
  // inexistente.
  const loja = escopoDaLoja(usuario, lojaAtiva(req))
  const conversa = await prisma.conversation.findFirst({
    where: { id, ...(loja.storeId ? { storeId: loja.storeId } : {}) },
    select: { storeId: true, contact: { select: { whatsappId: true, phone: true } } },
  })
  if (!conversa) {
    return NextResponse.json({ error: "Conversa nao encontrada" }, { status: 404 })
  }

  const conta = await contaDaConversa(id)
  if (!conta || conta.provedor !== "uazapi") {
    return NextResponse.json(
      { error: "Só dá para puxar histórico em número conectado pelo uazapi." },
      { status: 409 }
    )
  }

  const numero = conversa.contact.whatsappId ?? conversa.contact.phone
  if (!numero) {
    return NextResponse.json({ error: "Contato sem número de WhatsApp." }, { status: 409 })
  }

  const credenciais = await credenciaisDaConta(conta.id)
  if (!credenciais?.token) {
    return NextResponse.json({ error: "Conta sem token de instância." }, { status: 409 })
  }

  try {
    await pedirHistorico(credenciais.token, numero)
    return NextResponse.json(
      {
        pedido: true,
        aviso:
          "Pedido enviado ao WhatsApp. As mensagens antigas aparecem aos poucos; " +
          "mantenha o celular do número ligado e com internet.",
      },
      { status: 202 }
    )
  } catch (error) {
    if (ehUazapiConfigError(error)) {
      return NextResponse.json({ error: (error as Error).message }, { status: 503 })
    }
    console.error("[uazapi] Erro ao pedir historico:", error)
    return NextResponse.json({ error: "Erro ao pedir o histórico" }, { status: 500 })
  }
}
