import { listarCategorias, listarPaginaProdutos } from "./cliente"

/**
 * Categoria de cada produto — o caminho indireto, porque a API nao da atalho.
 *
 * A listagem de produtos nao traz categoria nenhuma, e o detalhe traz so
 * `categoria.id`: `ProdutosCategoriaDTO` tem UM campo. O nome legivel so existe
 * em `GET /categorias/produtos`. Perguntar o detalhe de cada peca custaria uma
 * requisicao por peca, a 3 por segundo; filtrar a listagem por `idCategoria`
 * custa uma passada a mais no catalogo e da a mesma informacao.
 */

const POR_PAGINA = 100
const PAUSA_MS = 350
/** Teto de paginas da listagem de categorias. */
const PAGINAS_DE_CATEGORIAS = 20
/** Orcamento de requisicoes do de-para. Estourou, o resto fica sem categoria. */
const REQUISICOES_DO_DE_PARA = 400

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "")

export type DeParaDeCategorias = {
  /** id do produto no Bling -> nome da categoria. */
  nomePorProduto: Map<string, string>
  /** Os nomes cadastrados no Bling, como estao la. */
  nomes: string[]
  /** Quantas requisicoes o de-para custou — aparece no resultado da sincronia. */
  requisicoes: number
}

export async function mapearCategorias(integracaoId: string): Promise<DeParaDeCategorias> {
  const categorias: { id: string; nome: string }[] = []
  let requisicoes = 0

  for (let pagina = 1; pagina <= PAGINAS_DE_CATEGORIAS; pagina++) {
    const lote = await listarCategorias(integracaoId, pagina, POR_PAGINA)
    requisicoes += 1
    if (lote.length === 0) break
    for (const c of lote) {
      const nome = c.descricao?.trim()
      if (nome) categorias.push({ id: String(c.id), nome })
    }
    if (lote.length < POR_PAGINA) break
    await dormir(PAUSA_MS)
  }

  const nomePorProduto = new Map<string, string>()
  let orcamento = REQUISICOES_DO_DE_PARA

  for (const categoria of categorias) {
    if (orcamento <= 0) break
    for (let pagina = 1; orcamento > 0; pagina++) {
      orcamento -= 1
      requisicoes += 1
      const lote = await listarPaginaProdutos(integracaoId, pagina, POR_PAGINA, {
        idCategoria: categoria.id,
      })
      // A pausa vem antes do `break` da ultima pagina de proposito: a maioria
      // das categorias resolve em UMA pagina, e sem isto a varredura dispararia
      // uma requisicao por categoria sem respiro nenhum — 429 na certa.
      await dormir(PAUSA_MS)
      if (lote.length === 0) break
      for (const p of lote) nomePorProduto.set(String(p.id), categoria.nome)
      if (lote.length < POR_PAGINA) break
    }
  }

  return { nomePorProduto, nomes: categorias.map((c) => c.nome), requisicoes }
}

/**
 * Categoria deduzida do NOME da peca, quando o Bling nao classificou o produto.
 *
 * Nao e adivinhacao de taxonomia: so casa contra as categorias que a propria
 * loja cadastrou no Bling. "VESTIDO DUDA LISO PLUS SIZE" cai em "VESTIDO"
 * porque "VESTIDO" e uma categoria dela; "BLAZER HOT PINK" fica sem categoria,
 * porque BLAZER nao e.
 *
 * Existe porque, na primeira sincronizacao (22/09/2026), so 68 das 569 pecas
 * tinham categoria no Bling — o catalogo de la esta quase todo sem classificar,
 * e a coluna Categoria da tela ficaria em "—" para 88% do catalogo.
 */
export function categoriaPeloNome(
  nomeDaPeca: string | undefined,
  nomesDeCategorias: string[]
): string | null {
  const nome = semAcento(nomeDaPeca ?? "").toUpperCase().trim()
  if (!nome) return null

  // Mais longo primeiro: senao "CAMISA" ganharia de "CAMISETA".
  const ordenadas = [...nomesDeCategorias].sort((a, b) => b.length - a.length)

  for (const categoria of ordenadas) {
    const alvo = semAcento(categoria).toUpperCase().trim()
    if (!alvo) continue
    if (nome === alvo) return categoria
    // Fronteira de palavra: sem isto "BLUSA" casaria dentro de "BLUSAO".
    if (nome.startsWith(alvo) && /[\s\-,./]/.test(nome.charAt(alvo.length))) return categoria
  }
  return null
}
