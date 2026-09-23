import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { registrar } from "@/lib/auditoria"
import { usuarioDaSessao, semSessao } from "@/lib/sessao"
import { ehBlingError } from "@/lib/bling/cliente"
import { ehBlingConfigError } from "@/lib/bling/config"
import { enriquecerLote, PECAS_POR_RODADA } from "@/lib/bling/enriquecer"

/**
 * Busca foto e grade de tamanhos, peca a peca, pelo DETALHE do Bling.
 *
 * Um LOTE por chamada, e nao o catalogo inteiro: sao 569 pecas a 3 requisicoes
 * por segundo — tres minutos numa unica requisicao HTTP, que morre no tempo
 * limite do proxy antes de terminar. A tela chama de novo enquanto
 * `restantes > 0`, e `bling_detalhe_em` guarda por onde parou, entao recomecar
 * nao refaz trabalho.
 *
 * Admin, como o resto de `/api/integracoes` (RBAC). Daqui so sai `GET` para o
 * Bling: o `POST` e desta rota, e grava no NOSSO banco.
 */
export async function POST(req: Request) {
  const usuario = await usuarioDaSessao()
  if (!usuario) return semSessao()

  const integracao = await prisma.storeIntegracao.findFirst({
    where: { provedor: "bling", isDeleted: false },
    select: { id: true },
  })
  if (!integracao) {
    return NextResponse.json({ error: "O Bling não está conectado." }, { status: 409 })
  }

  try {
    const r = await enriquecerLote(integracao.id, PECAS_POR_RODADA)

    if (r.falhas.length > 0) {
      console.error("[Bling] detalhes que falharam:", r.falhas)
    }

    // Uma linha na trilha por rodada encheria a auditoria de ruido; so a
    // ultima, quando a fila zera, e o fato que interessa registrar.
    if (r.restantes === 0) {
      await registrar({
        storeId: null,
        userId: usuario.id,
        acao: "catalogo_sincronizado",
        entidade: "integracao",
        entidadeId: integracao.id,
        detalhes: { etapa: "detalhes", comFoto: r.comFoto, comGrade: r.comGrade },
        req,
      })
    }

    return NextResponse.json({ ...r, falhas: r.falhas.length })
  } catch (e) {
    if (ehBlingConfigError(e)) {
      return NextResponse.json({ error: (e as Error).message }, { status: 503 })
    }
    if (ehBlingError(e)) {
      const status = e.status === 401 || e.status === 403 ? 409 : 502
      return NextResponse.json({ error: "Bling: " + e.message }, { status })
    }
    console.error("[Bling] Detalhes:", e)
    return NextResponse.json({ error: "Erro ao buscar fotos e tamanhos" }, { status: 500 })
  }
}
