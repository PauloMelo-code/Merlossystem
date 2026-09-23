import { prisma } from "@/lib/db/prisma"
import { Prisma } from "@prisma/client"
import { listarPaginaProdutos, ehProdutoDeTopo, type ProdutoBling } from "./cliente"
import { numeroDoBling, precoDeCatalogo } from "./preco"
import { mapearCategorias, categoriaPeloNome } from "./categorias"
import { tamanhoDaVariacao, ordenarTamanhos, tipoDeTamanho } from "./tamanhos"

/**
 * Espelho do catalogo do Bling no banco local — SOMENTE LEITURA do lado do
 * Bling (ADR 0004: o Bling e a autoridade de produto e estoque).
 *
 * Por que espelhar, se a rota de saldo ja le ao vivo: a tela de Produtos e o
 * seletor de produto do chat leem a tabela `products`. E o seletor monta o
 * texto que vai PARA A CLIENTE a partir de `sizes` e `stock` — com os dois
 * vazios, ele dizia "No momento sem estoque" para o catalogo inteiro.
 *
 * COMO A V3 DEVOLVE UMA LOJA DE ROUPA (confirmado na spec oficial, v3.0):
 * cada tamanho e uma VARIACAO e vem como linha propria na listagem, marcada
 * por `idProdutoPai`. O produto de topo e a peca; a variacao e o tamanho. E o
 * preco costuma viver NA VARIACAO — o pai de uma peca com variacoes vem com
 * `preco: 0`. Por isso a varredura junta as variacoes de cada peca antes de
 * decidir preco, grade e estoque.
 *
 * O QUE ESTE ARQUIVO GRAVA, e o que cada limite evita:
 *
 * 1. CASA por `(storeId, sku)` e NUNCA recria linha. `orders.items[].productId`
 *    e `media_files.product_id` apontam para o id local; recriar orfanaria o
 *    pedido, quebraria a FK da midia e zeraria a reserva — oversell silencioso.
 * 2. UMA LINHA POR LOJA para cada codigo. A conta do Bling e da rede, mas o
 *    produto e por loja (`escopoDaLoja`): uma linha so esconderia o catalogo
 *    de uma das lojas.
 * 3. `stock` e um RETRATO do momento da sincronizacao, nao a autoridade. Quem
 *    PROMETE peca e a rota de disponibilidade, que le o Bling ao vivo e
 *    desconta o reservado (ADR 0004). O retrato existe para o seletor do chat
 *    conseguir dizer quais tamanhos tem — dizer "sem estoque" em tudo, que era
 *    o comportamento anterior, perdia venda de peca que existia.
 * 4. NAO APAGA o que o Bling nao mandou. Foto e descricao so entram quando o
 *    campo daqui esta vazio (a equipe sobe foto propria pela Galeria); grade e
 *    estoque so entram quando a peca tem variacoes; categoria so quando ha uma.
 * 5. NAO mexe em `active` nem em `featured`. Excluir um produto na tela grava
 *    `active:false`; sincronizar esse campo ressuscitaria o que a loja tirou de
 *    proposito. Produto que some do Bling tambem nao e desativado: sumir da
 *    listagem nao prova que deixou de existir, e o pedido antigo aponta para ele.
 */

/** Teto para o laco nunca virar infinito se a API repetir pagina. */
const PAGINAS_MAXIMAS = 200
const POR_PAGINA = 100
/** Respiro entre paginas: o Bling limita a 3 requisicoes por segundo. */
const PAUSA_MS = 350
/** Lote do INSERT em massa — a primeira rodada cria milhares de linhas. */
const LOTE_DE_INSERCAO = 500
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

export type ResultadoSincronizacao = {
  criados: number
  atualizados: number
  semMudanca: number
  /** Sem `codigo`, ou codigo repetido: sem SKU nao ha como casar sem duplicar. */
  ignorados: number
  /** Total de paginas pedidas ao Bling na varredura do catalogo. */
  paginas: number
  lojas: number
  /** Linhas de variacao lidas — viram preco, grade e estoque da peca. */
  variacoes: number
  /** Pecas que ficaram em R$ 0,00: nem o pai nem as variacoes tinham preco. */
  semPreco: number
  /** Categorias cadastradas no Bling. */
  categorias: number
  /** Pecas que o Bling nao classificou e cuja categoria saiu do nome. */
  categoriaPeloNome: number
  /** Pecas que ganharam grade de tamanhos. */
  comTamanho: number
  /** Pecas que ganharam foto. */
  comFoto: number
  /** Variacoes cujo nome nao permitiu dizer o tamanho — o retrato fica incompleto. */
  tamanhoIndecifravel: number
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Varre o catalogo inteiro, separando peca de tamanho.
 *
 * A decisao de continuar paginando e pelo tamanho da pagina CRUA. Decidir pela
 * lista ja filtrada foi o bug que parava tudo na primeira pagina: 100 linhas
 * das quais 90 eram tamanhos viravam 10 pecas, e 10 < 100 encerrava o laco.
 */
async function varrerCatalogo(integracaoId: string) {
  const pecas: ProdutoBling[] = []
  const variacoesPorPai = new Map<string, ProdutoBling[]>()
  const vistos = new Set<string>()
  let paginas = 0
  let variacoes = 0

  /** Guarda o item e diz se ele era novo. */
  const guardar = (item: ProdutoBling): boolean => {
    const id = String(item.id)
    if (vistos.has(id)) return false
    vistos.add(id)

    if (ehProdutoDeTopo(item)) {
      pecas.push(item)
      return true
    }
    variacoes += 1
    const pai = String(item.idProdutoPai)
    const lista = variacoesPorPai.get(pai)
    if (lista) lista.push(item)
    else variacoesPorPai.set(pai, [item])
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

  return { pecas, variacoesPorPai, paginas, variacoes }
}

type Grade = {
  tamanhos: string[]
  /** Tamanho -> saldo somado das variacoes daquele tamanho. */
  retratoDoEstoque: Record<string, number>
  precos: number[]
  indecifraveis: number
}

/** Grade de tamanhos e retrato do estoque, a partir das variacoes da peca. */
function gradeDaPeca(peca: ProdutoBling, variacoes: ProdutoBling[]): Grade {
  const retratoDoEstoque: Record<string, number> = {}
  const precos: number[] = []
  const tamanhos: string[] = []
  let indecifraveis = 0

  for (const v of variacoes) {
    const preco = numeroDoBling(v.preco)
    if (preco > 0) precos.push(preco)

    const tamanho = tamanhoDaVariacao(peca.nome, v.nome)
    if (!tamanho) {
      indecifraveis += 1
      continue
    }
    tamanhos.push(tamanho)
    const saldo = Math.max(0, Math.trunc(v.estoque?.saldoVirtualTotal ?? 0))
    retratoDoEstoque[tamanho] = (retratoDoEstoque[tamanho] ?? 0) + saldo
  }

  return { tamanhos: ordenarTamanhos(tamanhos), retratoDoEstoque, precos, indecifraveis }
}

/** O que a sincronizacao quer que a linha do produto contenha. */
type Desejado = {
  name: string
  price: string
  category?: string
  description?: string
  sizes?: string[]
  stock?: Record<string, number>
  sizeType?: string
  imageUrls?: string[]
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
    categoriaPeloNome: 0,
    comTamanho: 0,
    comFoto: 0,
    tamanhoIndecifravel: 0,
  }
  if (lojaIds.length === 0) return total

  const { pecas, variacoesPorPai, paginas, variacoes } = await varrerCatalogo(integracaoId)
  total.paginas = paginas
  total.variacoes = variacoes

  const deParaDeCategorias = await mapearCategorias(integracaoId)
  total.categorias = deParaDeCategorias.nomes.length

  // Uma consulta em vez de uma por peca por loja: a primeira rodada olharia
  // milhares de vezes o mesmo indice.
  const existentes = new Map<string, ProdutoLocal>()
  const jaNoBanco = await prisma.product.findMany({
    where: { storeId: { in: lojaIds } },
    select: {
      id: true,
      storeId: true,
      sku: true,
      name: true,
      price: true,
      category: true,
      description: true,
      sizes: true,
      sizeType: true,
      imageUrls: true,
      stock: true,
    },
  })
  for (const p of jaNoBanco) {
    if (p.sku) existentes.set(`${p.storeId}|${p.sku}`, p)
  }

  const paraCriar: (Desejado & { storeId: string; sku: string })[] = []
  const skusVistos = new Set<string>()

  for (const peca of pecas) {
    const sku = peca.codigo?.trim()
    const nome = peca.nome?.trim()
    if (!sku || !nome || skusVistos.has(sku)) {
      total.ignorados += 1
      continue
    }
    skusVistos.add(sku)

    const grade = gradeDaPeca(peca, variacoesPorPai.get(String(peca.id)) ?? [])
    total.tamanhoIndecifravel += grade.indecifraveis

    const preco = precoDeCatalogo(peca.preco, grade.precos)
    if (preco === "0.00") total.semPreco += 1
    if (grade.tamanhos.length > 0) total.comTamanho += 1

    let categoria = deParaDeCategorias.nomePorProduto.get(String(peca.id)) ?? null
    if (!categoria) {
      categoria = categoriaPeloNome(nome, deParaDeCategorias.nomes)
      if (categoria) total.categoriaPeloNome += 1
    }

    const foto = peca.imagemURL?.trim()
    if (foto) total.comFoto += 1
    const descricao = peca.descricaoCurta?.trim()
    const plusSize = tipoDeTamanho(nome)

    for (const storeId of lojaIds) {
      const atual = existentes.get(`${storeId}|${sku}`)

      if (!atual) {
        paraCriar.push({
          storeId,
          sku,
          name: nome,
          price: preco,
          ...(categoria ? { category: categoria } : {}),
          ...(descricao ? { description: descricao } : {}),
          ...(foto ? { imageUrls: [foto] } : {}),
          ...(grade.tamanhos.length > 0
            ? { sizes: grade.tamanhos, stock: grade.retratoDoEstoque }
            : {}),
          ...(plusSize ? { sizeType: plusSize } : {}),
        })
        total.criados += 1
        continue
      }

      const dados = oQueMudou(atual, {
        name: nome,
        price: preco,
        ...(categoria ? { category: categoria } : {}),
        ...(descricao ? { description: descricao } : {}),
        ...(foto ? { imageUrls: [foto] } : {}),
        ...(grade.tamanhos.length > 0
          ? { sizes: grade.tamanhos, stock: grade.retratoDoEstoque }
          : {}),
        ...(plusSize ? { sizeType: plusSize } : {}),
      })

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
      data: paraCriar.slice(i, i + LOTE_DE_INSERCAO).map((p) => ({
        ...p,
        ...(p.stock ? { stock: p.stock as Prisma.InputJsonValue } : {}),
      })),
      skipDuplicates: true,
    })
  }

  return total
}

type ProdutoLocal = {
  id: string
  storeId: string
  sku: string | null
  name: string
  price: unknown
  category: string | null
  description: string | null
  sizes: string[]
  sizeType: string
  imageUrls: string[]
  stock: unknown
}

/**
 * So o que mudou — gravar igual enche a trilha de ruido e mexe em `updated_at`
 * sem motivo.
 *
 * Os campos que a EQUIPE preenche (foto, descricao) so entram quando o campo
 * daqui esta vazio: a Galeria existe para a loja subir foto propria, melhor do
 * que a miniatura do ERP, e a sincronizacao nao pode desfazer isso toda rodada.
 */
/** Comparavel a ordem das chaves: o jsonb volta do Postgres na ordem dele. */
function estavel(valor: unknown): string {
  const obj = (valor ?? {}) as Record<string, unknown>
  return JSON.stringify(
    Object.keys(obj)
      .sort()
      .map((k) => [k, obj[k]])
  )
}

function oQueMudou(atual: ProdutoLocal, desejado: Desejado): Record<string, unknown> {
  const dados: Record<string, unknown> = {}

  if (atual.name !== desejado.name) dados.name = desejado.name
  if (String(atual.price) !== desejado.price) dados.price = desejado.price
  if (desejado.category && atual.category !== desejado.category) {
    dados.category = desejado.category
  }
  if (desejado.description && !atual.description) dados.description = desejado.description
  if (desejado.imageUrls && atual.imageUrls.length === 0) dados.imageUrls = desejado.imageUrls
  if (desejado.sizeType && atual.sizeType === "both") dados.sizeType = desejado.sizeType

  if (desejado.sizes && desejado.sizes.join("|") !== atual.sizes.join("|")) {
    dados.sizes = desejado.sizes
  }
  // O retrato do estoque so e regravado quando mudou de verdade: sem a
  // comparacao, toda peca com grade viraria um UPDATE em cada rodada, nas duas
  // lojas, e a trilha de alteracao perderia o sentido.
  if (desejado.stock && desejado.sizes && desejado.sizes.length > 0) {
    if (estavel(atual.stock) !== estavel(desejado.stock)) {
      dados.stock = desejado.stock as Prisma.InputJsonValue
    }
  }

  return dados
}
