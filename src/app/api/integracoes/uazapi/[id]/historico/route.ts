import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/db/prisma"
import { usuarioDaSessao, semSessao } from "@/lib/sessao"
import { escopoDaLoja, lojaAtiva } from "@/lib/loja"
import { credenciaisDaConta } from "@/lib/roteamento"
import { ehUazapiConfigError } from "@/lib/uazapi/config"
import { listarChats, pedirHistorico } from "@/lib/uazapi/instancia"

/**
 * Recupera o historico de VARIAS conversas deste numero de uma vez.
 *
 * A conversa por conversa esta em `/api/conversations/[id]/historico`; aqui e
 * a carga inicial de quem acabou de conectar um numero que ja era usado no
 * celular. O pedido vai ao aparelho e volta em lotes pelo evento `history`,
 * entao a rota responde quantas conversas foram pedidas — nunca "pronto".
 *
 * Teto de 50 conversas por chamada, com pausa entre elas: a propria
 * documentacao do uazapi pede para evitar rajada, e o WhatsApp do celular e
 * quem paga a conta.
 */

const entrada = z.object({
  /** Quantas conversas, das mais recentes para as mais antigas. */
  conversas: z.number().int().min(1).max(50).default(20),
  /** Mensagens por conversa. O uazapi documenta 100 como teto do pedido. */
  mensagens: z.number().int().min(10).max(100).default(50),
  /**
   * `contatos` (padrao): so conversas de quem JA e contato da loja.
   * `todas`: todas as conversas individuais do aparelho — inclusive as
   * pessoais da vendedora, que passam a ficar visiveis para a loja inteira.
   * Por isso e escolha explicita, nunca o padrao.
   */
  escopo: z.enum(["contatos", "todas"]).default("contatos"),
})

const PAUSA_MS = 400
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

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
    select: { id: true, status: true, storeId: true },
  })
  if (!conta) {
    return NextResponse.json({ error: "Conta uazapi nao encontrada" }, { status: 404 })
  }
  if (conta.status !== "conectado") {
    return NextResponse.json(
      { error: "O número precisa estar conectado para puxar o histórico." },
      { status: 409 }
    )
  }

  const credenciais = await credenciaisDaConta(id)
  if (!credenciais?.token) {
    return NextResponse.json({ error: "Conta sem token de instância." }, { status: 409 })
  }

  const corpo = entrada.parse(await req.json().catch(() => ({})))

  try {
    const chats = await listarChats(credenciais.token, corpo.conversas)
    if (chats.length === 0) {
      return NextResponse.json({
        pedidas: 0,
        aviso: "Nenhuma conversa individual encontrada neste número ainda.",
      })
    }

    // O numero e o celular de trabalho da vendedora: a lista do aparelho traz
    // medico, banco e familia junto. Importar tudo colocaria dado pessoal de
    // quem nunca falou com a loja no CRM, visivel para a equipe inteira. Por
    // padrao, so quem ja e contato da loja.
    let alvos = chats
    let ignorados = 0
    if (corpo.escopo === "contatos") {
      const numeros = chats.map((c) => c.replace(/@.*$/, ""))
      const conhecidos = await prisma.contact.findMany({
        where: { storeId: conta.storeId ?? undefined, whatsappId: { in: numeros } },
        select: { whatsappId: true },
      })
      const doCadastro = new Set(conhecidos.map((c) => c.whatsappId))
      alvos = chats.filter((c) => doCadastro.has(c.replace(/@.*$/, "")))
      ignorados = chats.length - alvos.length
    }

    if (alvos.length === 0) {
      return NextResponse.json({
        pedidas: 0,
        ignorados,
        aviso:
          `Nenhuma das ${chats.length} conversas do aparelho é de contato já cadastrado ` +
          `na loja. Para trazer as conversas que ainda não são contatos, escolha trazer ` +
          `todas — lembrando que isso inclui as conversas pessoais deste celular.`,
      })
    }

    let pedidas = 0
    for (const chat of alvos) {
      try {
        await pedirHistorico(credenciais.token, chat, corpo.mensagens)
        pedidas += 1
      } catch (erro) {
        // Uma conversa que o WhatsApp recusa nao pode impedir as outras.
        console.warn("[uazapi] historico recusado para um chat:", (erro as Error).message)
      }
      await dormir(PAUSA_MS)
    }

    return NextResponse.json({
      pedidas,
      ignorados,
      aviso:
        `Pedido enviado para ${pedidas} conversa(s)` +
        (ignorados > 0 ? `; ${ignorados} conversa(s) do aparelho que não são contatos da loja ficaram de fora` : "") +
        `. As mensagens antigas aparecem aos poucos; mantenha o celular do número ligado e com internet.`,
    })
  } catch (error) {
    if (ehUazapiConfigError(error)) {
      return NextResponse.json({ error: (error as Error).message }, { status: 503 })
    }
    console.error("[uazapi] Erro ao puxar historico:", error)
    return NextResponse.json({ error: "Erro ao puxar o histórico" }, { status: 500 })
  }
}
