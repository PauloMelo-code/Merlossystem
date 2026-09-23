import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { registrar } from "@/lib/auditoria"
import { usuarioDaSessao, semSessao } from "@/lib/sessao"
import { ehBlingError } from "@/lib/bling/cliente"
import { ehBlingConfigError } from "@/lib/bling/config"
import { sincronizarCatalogo } from "@/lib/bling/sincronizar"

/**
 * Traz o catalogo do Bling para o banco.
 *
 * Roda sob demanda, pela tela de integracoes: a conta do Bling e da rede e a
 * acao e de configuracao, entao e admin (regra `/^\/api\/integracoes/` no
 * RBAC). O Bling continua sendo a autoridade — daqui so sai `GET`.
 *
 * Escreve em TODAS as lojas ativas, e nao so na loja do seletor: o catalogo e
 * o mesmo para a rede, e deixar uma loja de fora faria a vendedora dela nao
 * achar o produto no atendimento.
 */
export async function POST(req: Request) {
  const usuario = await usuarioDaSessao()
  if (!usuario) return semSessao()

  const integracao = await prisma.storeIntegracao.findFirst({
    where: { provedor: "bling", isDeleted: false },
    select: { id: true, status: true },
  })
  if (!integracao) {
    return NextResponse.json({ error: "O Bling não está conectado." }, { status: 409 })
  }

  const lojas = await prisma.store.findMany({
    where: { isDeleted: false, ativo: true },
    select: { id: true },
  })
  if (lojas.length === 0) {
    return NextResponse.json({ error: "Nenhuma loja ativa para receber o catálogo." }, { status: 409 })
  }

  try {
    const r = await sincronizarCatalogo(
      integracao.id,
      lojas.map((l) => l.id)
    )

    await registrar({
      storeId: null,
      userId: usuario.id,
      acao: "catalogo_sincronizado",
      entidade: "integracao",
      entidadeId: integracao.id,
      detalhes: { ...r },
      req,
    })

    return NextResponse.json({
      ...r,
      aviso:
        `${r.criados} produto(s) criado(s), ${r.atualizados} atualizado(s), ` +
        `${r.semMudanca} sem mudança, em ${r.lojas} loja(s). ` +
        `${r.comTamanho} com grade de tamanhos, ${r.comFoto} com foto, ` +
        `${r.categorias} categoria(s) do Bling` +
        (r.categoriaPeloNome > 0 ? ` (+${r.categoriaPeloNome} deduzidas do nome)` : "") +
        `. ${r.paginas} página(s) lidas, ${r.variacoes} variação(ões).` +
        // Os numeros abaixo so aparecem quando ha o que olhar: sao a diferenca
        // entre "sincronizou" e "sincronizou certo".
        (r.semPreco > 0 ? ` ${r.semPreco} peça(s) ficaram sem preço no Bling.` : "") +
        (r.tamanhoIndecifravel > 0
          ? ` ${r.tamanhoIndecifravel} variação(ões) com nome fora do padrão — o tamanho delas não entrou.`
          : "") +
        (r.ignorados > 0 ? ` ${r.ignorados} ignorada(s) por código ausente ou repetido.` : ""),
    })
  } catch (e) {
    if (ehBlingConfigError(e)) {
      return NextResponse.json({ error: (e as Error).message }, { status: 503 })
    }
    if (ehBlingError(e)) {
      // 401 = credencial: reconectar. O resto e o Bling indisponivel agora.
      const status = e.status === 401 || e.status === 403 ? 409 : 502
      return NextResponse.json({ error: "Bling: " + e.message }, { status })
    }
    console.error("[Bling] Sincronizacao:", e)
    return NextResponse.json({ error: "Erro ao sincronizar o catálogo" }, { status: 500 })
  }
}
