import { NextResponse } from "next/server"
import { gravarConexao } from "@/lib/integracoes-conexao"
import { cifrarCredenciais, ehCofreError } from "@/lib/cofre"
import { validarState } from "@/lib/bling/estado"
import { trocarCodePorTokens, ehTikTokError } from "@/lib/tiktok/cliente"
import { ehTikTokConfigError } from "@/lib/tiktok/config"

/**
 * Callback do OAuth do TikTok Shop.
 *
 * Fora da protecao de sessao (`src/lib/api-publica.ts`): quem chama e o
 * navegador voltando do TikTok. Quem autoriza aqui e o `state` assinado.
 */
function paraTela(mensagem: string, erro = true) {
  const url = new URL("/settings/integracoes", process.env.NEXTAUTH_URL || "http://localhost:3005")
  url.searchParams.set(erro ? "erro" : "ok", mensagem)
  return NextResponse.redirect(url)
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)

  const state = validarState(searchParams.get("state"))
  if (!state.ok) {
    console.warn("[TikTok] Callback recusado:", state.motivo)
    return paraTela("state-invalido")
  }

  // O TikTok devolve `code` (as vezes `auth_code`, conforme a versao do fluxo).
  const code = searchParams.get("code") || searchParams.get("auth_code")
  if (!code) return paraTela("code-ausente")

  try {
    const tokens = await trocarCodePorTokens(code)

    // A loja do TikTok e identificada pelo shop_id/cipher que vem no token.
    // Sem ele nao da para chamar a API, entao a conexao fica como "erro" com o
    // motivo escrito, em vez de parecer conectada e falhar depois.
    const referencia = tokens.shop_id || tokens.shop_cipher
    if (!referencia) {
      console.warn("[TikTok] Token sem identificador de loja")
      return paraTela("token-sem-loja")
    }

    // Sem filtrar `isDeleted`: o indice unico (provedor, referenciaExterna)
    // NAO e parcial, entao a linha desconectada continua ocupando a chave —
    // procurar so pelas vivas e cair no `create` deixava a conta impossivel de
    // reconectar. Foi o que aconteceu com o Bling em 23/09/2026.
    await gravarConexao({
      provedor: "tiktok_shop",
      referenciaExterna: referencia,
      dados: {
        status: "conectado",
        credenciaisCifradas: cifrarCredenciais({ ...tokens }),
        expiraEm: new Date(tokens.expira_em),
        ultimoErro: null,
        modifiedBy: state.usuarioId,
      },
      // Sem loja definida aqui: quem conecta escolhe depois, na tela. Criar
      // ligado a uma loja chutada seria pior — o TikTok Shop e por loja.
      aoCriar: { storeId: null, rotulo: `TikTok Shop ${referencia}` },
    })

    return paraTela("tiktok-conectado", false)
  } catch (e) {
    if (ehCofreError(e) || ehTikTokConfigError(e)) {
      console.error("[TikTok] Configuracao:", (e as Error).message)
      return paraTela("servidor-mal-configurado")
    }
    if (ehTikTokError(e)) {
      console.error("[TikTok] Troca de token falhou:", e.message)
      return paraTela("troca-de-token-falhou")
    }
    console.error("[TikTok] Callback:", e)
    return paraTela("erro-inesperado")
  }
}
