import { prisma } from "@/lib/db/prisma"
import {
  listarPaginaProdutos,
  listarCategorias,
  ehProdutoDeTopo,
  type ProdutoBling,
} from "./cliente"
import { numeroDoBling, precoDeCatalogo } from "./preco"

/**
 * Espelho do catalogo do Bling no banco local — SOMENTE LEITURA do lado do
 * Bling (ADR 0004: o Bling e a autoridade de produto e estoque).
 *
 * Por que espelhar, se a rota de saldo ja le ao vivo: a tela de Produtos, o
 * seletor de produto do chat e a reserva de estoque leem a tabela `products`.
 * Sem o espelho, o catalogo aparece vazio para quem atende.
 *
 * COMO A V3 DEVOLVE UMA LOJA DE ROUPA (confirmado na spec oficial, v3.0):
 * cada tamanho e uma VARIACAO e vem como linha propria na listagem, marcada
 * por `idProdutoPai`. O produto de topo e a peca; a variacao e o tamanho. E o
 * preco costuma viver NA VARIACAO — o pai de uma peca com variacoes vem com
 * `preco: 0`. Por isso este arquivo varre a pagina inteira, guarda os precos
 * das variacoes e so entao decide o preco da peca.
 *
 * As cinco regras que este arquivo cumpre, e o que cada uma evita:
 *
 * 1. CASA por `(storeId, sku)` e NUNCA recria linha. `orders.items[].productId`
 *    e `media_files.product_id` apontam para o id local; recriar orfanaria o
 *    pedido, quebraria a FK da midia e zeraria a reserva — oversell silencioso.
 * 2. UMA LINHA POR LOJA para cada codigo. A conta do Bling e da rede, mas o
 *    produto e por loja (`escopoDaLoja`): uma linha so esconderia o catalogo
 *    de uma das lojas.
 * 3. NAO escreve `stock`. O Bling da saldo por SKU; `products.stock` e por
 *    TAMANHO e e o que o seletor do chat usa para oferecer tamanho. Escrever
 *    ali faria a tela dizer "sem estoque" no catalogo inteiro.
 * 4. NAO APAGA o que o Bling nao tem. Tamanhos, fotos, destaque e descricao
 *    sao preenchidos AQUI pela equipe; um upsert cego zeraria o trabalho delas
 *    a cada rodada. Categoria e o unico campo que o Bling manda — e mesmo ela
 *    so e gravada quando o Bling TEM uma: sem categoria la, a daqui fica.
 * 5. NAO mexe em `active`. Excluir um produto na tela grava `active:false`;
 *    sincronizar esse campo ressuscitaria o que a loja tirou de proposito.
 *    Produto que some do Bling tambem nao e desativado: sumir da listagem nao
 *    prova que deixou de existir, e o pedido antigo ainda aponta para ele.
 */

/** Teto para o laco nunca virar infinito se a API repetir pagina. */
const PAGINAS_MAXIMAS = 200
const POR_PAGINA = 100
/** Respiro entre paginas: o Bling limita a 3 requisicoes por segundo. */
const PAUSA_MS = 350
/** Teto de paginas da listagem de categorias. */
const PAGINAS_DE_CATEGORIAS = 20
/**
 * Fatias de saldo a varrer, em ordem.
 *
 * `undefined` e o pedido SEM filtro. As outras duas existem porque a spec
 * declara `filtroSaldoEstoque` com `default: 1` (so saldo positivo) e o enum
 * nao tem valor para "todos": se o Bling aplicar esse default ao parametro
 * omitido, a varredura sem filtro traria so o que esta em estoque e o catalogo
 * perderia toda peca esgotada — em silencio. Nao da para decidir isso pela
 * documentacao, entao `varrerCatalogo` pergunta uma pagina de cada fatia e
 * desiste dela assim que a resposta prova que ja tinha vindo tudo.
 *
 * `1` (positivo) nao entra: ou ele e o default do pedido omitido, ou o pedido
 * omitido ja o contem. Nos dois casos, pedi-lo seria repetir.
 */
const VARIANTES_DE_SALDO = [undefined, 0, 2] as const
/** Lote do INSERT em massa — a primeira rodada cria milhares de linhas. */
const LOTE_DE_INSERCAO = 500

export type ResultadoSincronizacao = {
  criados: number
  atualizados: number
  semMudanca: number
  /** Sem `codigo`, ou codigo repetido: sem SKU nao ha como casar sem duplicar. */
  ignorados: number
  /** Total de paginas pedidas ao Bling na varredura do catalogo. */
  paginas: number
  lojas: number
  /** Linhas de variacao lidas — entram no preco da peca, nao viram produto. */
  variacoes: number
  /** Pecas que ficaram em R$ 0,00: nem o pai nem as variacoes tinham preco. */
  semPreco: number
  /** Categorias do Bling que viraram de-para. */
  categorias: number
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Varre o catalogo inteiro UMA vez, separando peca de tamanho.
 *
 * A decisao de continuar paginando e pelo tamanho da pagina CRUA. Decidir pela
 * lista ja filtrada foi o bug que parava tudo na primeira pagina: 100 linhas
 * das quais 90 eram tamanhos viravam 10 pecas, e 10 < 100 encerrava o laco.
 */
async function varrerCatalogo(integracaoId: string) {
  const pecas: ProdutoBling[] = []
  const precosDosTamanhos = new Map<string, number[]>()
  const vistos = new Set<string>()
  let paginas = 0
  let variacoes = 0

  /** Guarda o item e diz se ele era novo. Peca vira produto; tamanho vira preco. */
  const guardar = (item: ProdutoBling): boolean => {
    const id = String(item.id)
    if (vistos.has(id)) return false
    vistos.add(id)

    if (ehProdutoDeTopo(item)) {
      pecas.push(item)
      return true
    }
    variacoes += 1
    const preco = numeroDoBling(item.preco)
    if (preco > 0) {
      const pai = String(item.idProdutoPai)
      const lista = precosDosTamanhos.get(pai)
      if (lista) lista.push(preco)
      else precosDosTamanhos.set(pai, [preco])
    }
    return true
  }

  for (const filtroSaldoEstoque of VARIANTES_DE_SALDO) {
    for (let pagina = 1; pagina <= PAGINAS_MAXIMAS; pagina++) {
      const bruta = await listarPaginaProdutos(integracaoId, pagina, POR_PAGINA, {
        filtroSaldoEstoque,
      })
      paginas += 1
      if (bruta.length === 0) break

      let novos = 0
      for (const item of bruta) if (guardar(item)) novos += 1

      // A sonda: se a primeira pagina de uma fatia de saldo nao trouxe NADA
      // novo, a varredura sem filtro ja a continha — nao ha default escondido
      // e o resto desta fatia e trabalho jogado fora.
      if (filtroSaldoEstoque !== undefined && pagina === 1 && novos === 0) break

      if (bruta.length < POR_PAGINA) break
      await dormir(PAUSA_MS)
    }
  }

  return { pecas, precosDosTamanhos, paginas, variacoes }
}

/**
 * De-para produto -> nome da categoria.
 *
 * O caminho e indireto porque a API nao da atalho: a listagem de produtos nao
 * traz categoria nenhuma e o detalhe traz so `categoria.id`. Perguntar o
 * detalhe de cada produto custaria uma requisicao por peca — milhares, a 3 por
 * segundo. Filtrar a listagem por `idCategoria` custa uma passada a mais no
 * catalogo inteiro, e e a mesma informacao.
 */
async function mapearCategorias(integracaoId: string) {
  const categorias: { id: string; nome: string }[] = []

  for (let pagina = 1; pagina <= PAGINAS_DE_CATEGORIAS; pagina++) {
    const lote = await listarCategorias(integracaoId, pagina, POR_PAGINA)
    if (lote.length === 0) break
    for (const c of lote) {
      const nome = c.descricao?.trim()
      if (nome) categorias.push({ id: String(c.id), nome })
    }
    if (lote.length < POR_PAGINA) break
    await dormir(PAUSA_MS)
  }

  const nomePorProduto = new Map<string, string>()
  // Orcamento comum: catalogo grande demais fica SEM categoria em vez de
  // segurar a requisicao ate o proxy derrubar a sincronizacao inteira.
  let orcamento = PAGINAS_MAXIMAS

  for (const categoria of categorias) {
    if (orcamento <= 0) break
    for (let pagina = 1; pagina <= PAGINAS_MAXIMAS && orcamento > 0; pagina++) {
      orcamento -= 1
      const lote = await listarPaginaProdutos(integracaoId, pagina, POR_PAGINA, {
        idCategoria: categoria.id,
      })
      if (lote.length === 0) break
      for (const p of lote) nomePorProduto.set(String(p.id), categoria.nome)
      if (lote.length < POR_PAGINA) break
      await dormir(PAUSA_MS)
    }
  }

  return { nomePorProduto, categorias: categorias.length }
}

/**
 * Traz o catalogo para as lojas informadas.
 *
 * A leitura do Bling acontece UMA vez e e gravada em cada loja: a conta e da
 * rede, entao ler por loja so multiplicaria requisicao no mesmo balde de
 * 3 req/s.
 */
export async function sincronizarCatalogo(
  integracaoId: string,
  lojaIds: string[]
): Promise<ResultadoSincronizacao> {
  const total: ResultadoSincronizacao = {
    criados: 0,
    atualizados: 0,
    semMudanca: 0,
    ignorados: 0,
    paginas: 0,
    lojas: lojaIds.length,
    variacoes: 0,
    semPreco: 0,
    categorias: 0,
  }
  if (lojaIds.length === 0) return total

  const { pecas, precosDosTamanhos, paginas, variacoes } = await varrerCatalogo(integracaoId)
  total.paginas = paginas
  total.variacoes = variacoes

  const { nomePorProduto, categorias } = await mapearCategorias(integracaoId)
  total.categorias = categorias

  // Uma consulta em vez de uma por peca por loja: a primeira rodada olharia
  // milhares de vezes o mesmo indice.
  const existentes = new Map<string, { id: string; name: string; price: unknown; category: string | null }>()
  const jaNoBanco = await prisma.product.findMany({
    where: { storeId: { in: lojaIds } },
    select: { id: true, storeId: true, sku: true, name: true, price: true, category: true },
  })
  for (const p of jaNoBanco) {
    if (p.sku) existentes.set(`${p.storeId}|${p.sku}`, p)
  }

  const paraCriar: { storeId: string; sku: string; name: string; price: string; category?: string }[] = []
  const skusVistos = new Set<string>()

  for (const item of pecas) {
    const sku = item.codigo?.trim()
    const nome = item.nome?.trim()
    if (!sku || !nome || skusVistos.has(sku)) {
      total.ignorados += 1
      continue
    }
    skusVistos.add(sku)

    const preco = precoDeCatalogo(item.preco, precosDosTamanhos.get(String(item.id)))
    if (preco === "0.00") total.semPreco += 1
    const categoria = nomePorProduto.get(String(item.id))

    for (const storeId of lojaIds) {
      const atual = existentes.get(`${storeId}|${sku}`)

      if (!atual) {
        paraCriar.push({ storeId, sku, name: nome, price: preco, ...(categoria ? { category: categoria } : {}) })
        total.criados += 1
        continue
      }

      // So escreve o que mudou: gravar igual enche a trilha de ruido e mexe em
      // `updated_at` sem motivo.
      const dados: { name?: string; price?: string; category?: string } = {}
      if (atual.name !== nome) dados.name = nome
      if (String(atual.price) !== preco) dados.price = preco
      // Categoria so quando o Bling tem uma — ver a regra 4 no topo.
      if (categoria && atual.category !== categoria) dados.category = categoria

      if (Object.keys(dados).length === 0) {
        total.semMudanca += 1
        continue
      }
      await prisma.product.update({ where: { id: atual.id }, data: dados })
      total.atualizados += 1
    }
  }

  for (let i = 0; i < paraCriar.length; i += LOTE_DE_INSERCAO) {
    // `skipDuplicates` porque `(storeId, sku)` e unico e duas rodadas
    // simultaneas nao podem derrubar a sincronizacao inteira.
    await prisma.product.createMany({
      data: paraCriar.slice(i, i + LOTE_DE_INSERCAO),
      skipDuplicates: true,
    })
  }

  return total
}
