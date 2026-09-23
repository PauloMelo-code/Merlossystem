import { NextResponse } from "next/server"
import { cifrarCredenciais, ehCofreError } from "@/lib/cofre"
import { validarState } from "@/lib/bling/estado"
import { trocarCodePorTokens, ehBlingError } from "@/lib/bling/cliente"
import { ehBlingConfigError } from "@/lib/bling/config"
import { gravarConexao } from "@/lib/integracoes-conexao"

/**
 * Callback do OAuth do Bling.
 *
 * Fica FORA da protecao de sessao do middleware (src/lib/api-publica.ts):
 * quem chama e o navegador voltando do Bling, e nem sempre com a sessao no
 * contexto. Quem autoriza aqui e o `state` assinado, nao o cookie — por isso
 * ele carrega quem iniciou e vale so 1 minuto.
 */
function paraTela(mensagem: string, erro = true) {
  const url = new URL("/settings/integracoes", process.env.NEXTAUTH_URL || "http://localhost:3005")
  url.searchParams.set(erro ? "erro" : "ok", mensagem)
  return NextResponse.redirect(url)
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)

  // O Bling avisa recusa pelo proprio callback.
  const erroDoProvedor = searchParams.get("error")
  if (erroDoProvedor) {
    console.warn("[Bling] Autorizacao recusada:", erroDoProvedor)
    return paraTela("autorizacao-recusada")
  }

  const state = validarState(searchParams.get("state"))
  if (!state.ok) {
    // Nao dizer QUAL parte do state falhou: so ajudaria quem esta tentando.
    console.warn("[Bling] Callback recusado:", state.motivo)
    return paraTela("state-invalido")
  }

  const code = searchParams.get("code")
  if (!code) return paraTela("code-ausente")

  try {
    const tokens = await trocarCodePorTokens(code)

    // Bling e conta unica da rede: storeId nulo, e uma linha so.
    //
    // `gravarConexao` procura a linha SEM filtrar `isDeleted` de proposito.
    // Filtrar aqui era o bug que deixou a conta impossivel de reconectar:
    // desconectar grava `is_deleted = true`, mas o indice unico
    // (provedor, referenciaExterna) NAO e parcial e a linha apagada continua
    // ocupando a chave — o `create` seguinte estourava e virava
    // `?erro=erro-inesperado` na tela.
    await gravarConexao({
      provedor: "bling",
      // Sem multiplas contas de Bling, a referencia externa e fixa. Quando
      // houver mais de uma empresa, aqui entra o id dela.
      referenciaExterna: "rede",
      dados: {
        rotulo: "Bling da rede",
        status: "conectado",
        credenciaisCifradas: cifrarCredenciais({ ...tokens }),
        expiraEm: new Date(tokens.expira_em),
        ultimoErro: null,
        modifiedBy: state.usuarioId,
      },
      aoCriar: { storeId: null },
    })

    return paraTela("bling-conectado", false)
  } catch (e) {
    if (ehCofreError(e) || ehBlingConfigError(e)) {
      console.error("[Bling] Configuracao:", (e as Error).message)
      return paraTela("servidor-mal-configurado")
    }
    if (ehBlingError(e)) {
      console.error("[Bling] Troca de token falhou:", e.message)
      return paraTela("troca-de-token-falhou")
    }
    console.error("[Bling] Callback:", e)
    return paraTela("erro-inesperado")
  }
}
