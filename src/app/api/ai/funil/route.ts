import { NextResponse } from "next/server"
import { verificarSegredoCron } from "@/lib/webhook-auth"
import { rodarClassificacao, CARTOES_POR_RODADA } from "@/lib/funil/automacao"

/**
 * Rodada da classificacao automatica do funil.
 *
 * Sem sessao: autentica por `Authorization: Bearer $CRON_SECRET`, como
 * `/api/alerts/check`. E preciso cadastrar o agendamento no EasyPanel — nao ha
 * agendador dentro da aplicacao, e sem o cron esta rota nunca roda.
 *
 * Por que nao no webhook da mensagem: o `POST /api/webhooks/uazapi` processa
 * tudo dentro da propria requisicao, sem fila. Uma chamada a Anthropic ali
 * penduraria o recebimento de TODA mensagem no tempo de resposta do modelo —
 * e o uazapi reentrega o que demora.
 */
export async function POST(req: Request) {
  const auth = verificarSegredoCron(req.headers)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.motivo }, { status: auth.status })
  }

  try {
    const r = await rodarClassificacao(CARTOES_POR_RODADA)

    // A falha de uma conversa nao derruba a rodada, mas tem de aparecer: sem
    // isto, "lidos: 0, movidos: 0" pareceria uma rodada sem trabalho.
    if (r.falhas.length > 0) {
      console.error("[funil] conversas que falharam:", r.falhas)
    }

    return NextResponse.json({
      ...r,
      // Contagem no corpo; o detalhe de cada falha fica no log, porque traz
      // trecho de conversa no texto do erro.
      falhas: r.falhas.length,
    })
  } catch (e) {
    console.error("[funil] rodada:", e)
    return NextResponse.json({ error: "Erro na classificação do funil" }, { status: 500 })
  }
}
