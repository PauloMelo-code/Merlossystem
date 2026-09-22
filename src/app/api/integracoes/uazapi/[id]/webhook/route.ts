import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { usuarioDaSessao, semSessao } from "@/lib/sessao"
import { escopoDaLoja, lojaAtiva } from "@/lib/loja"
import { credenciaisDaConta } from "@/lib/roteamento"
import { ehUazapiConfigError } from "@/lib/uazapi/config"
import { configurarWebhook } from "@/lib/uazapi/instancia"

/**
 * Aponta o webhook de uma conta uazapi JA conectada para este sistema.
 *
 * Numero criado a mao no painel do uazapi costuma ficar sem webhook, e o
 * sintoma e silencioso: a mensagem chega no WhatsApp da vendedora e nunca
 * aparece na tela. Numero criado por `POST /api/integracoes/uazapi` ja nasce
 * configurado; este endpoint e para os que vieram de antes.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const usuario = await usuarioDaSessao()
  if (!usuario) return semSessao()

  const { id } = await params
  // A loja sai da SESSAO: conta de outra loja responde como inexistente.
  const loja = escopoDaLoja(usuario, lojaAtiva(req))
  const conta = await prisma.storeIntegracao.findFirst({
    where: {
      id,
      provedor: "uazapi",
      isDeleted: false,
      ...(loja.storeId ? { storeId: loja.storeId } : {}),
    },
    select: { id: true },
  })
  if (!conta) {
    return NextResponse.json({ error: "Conta uazapi nao encontrada" }, { status: 404 })
  }

  const credenciais = await credenciaisDaConta(id)
  if (!credenciais?.token) {
    return NextResponse.json({ error: "Conta sem token de instância." }, { status: 409 })
  }

  try {
    await configurarWebhook(credenciais.token)
    return NextResponse.json({
      ok: true,
      aviso: "Webhook apontado para este sistema. As próximas mensagens entram na tela.",
    })
  } catch (error) {
    if (ehUazapiConfigError(error)) {
      return NextResponse.json({ error: (error as Error).message }, { status: 503 })
    }
    console.error("[uazapi] Erro ao configurar webhook:", error)
    return NextResponse.json({ error: "Erro ao configurar o webhook" }, { status: 500 })
  }
}
