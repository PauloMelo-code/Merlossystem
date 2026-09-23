import { prisma } from "@/lib/db/prisma"
import { cifrarCredenciais, decifrarCredenciais, type Credenciais } from "@/lib/cofre"
import {
  BLING_ENDPOINTS,
  urlSaldosDoDeposito,
  MARGEM_RENOVACAO_MS,
  cabecalhoBasic,
  configDoApp,
  BlingConfigError,
} from "./config"

/**
 * Cliente do Bling — leitura apenas.
 *
 * NAO existe metodo de escrita aqui, e isso e definitivo: o Masc e o dono da
 * venda e o Bling e a autoridade de estoque, alimentado pelo vinculo
 * Masc -> Bling em tempo real (decisao 8, docs/adr/0004-fontes-da-verdade.md).
 * Escrever daqui faria a mesma peca sair duas vezes do saldo.
 */

export type TokensBling = {
  access_token: string
  refresh_token: string
  /** Momento em que expira, em ms. Calculado na troca. */
  expira_em: string
}

export class BlingError extends Error {
  constructor(
    mensagem: string,
    readonly status?: number
  ) {
    super(mensagem)
    this.name = "BlingError"
  }
}

export function ehBlingError(e: unknown): e is BlingError {
  return e instanceof Error && e.name === "BlingError"
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/**
 * Troca o authorization code por tokens.
 *
 * Credenciais do app vao em HTTP Basic — a documentacao do Bling e explicita
 * em que elas NAO podem ir no body.
 */
export async function trocarCodePorTokens(code: string): Promise<TokensBling> {
  const cfg = configDoApp()

  const res = await fetch(BLING_ENDPOINTS.token, {
    method: "POST",
    headers: {
      Authorization: cabecalhoBasic(cfg),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: cfg.redirectUri,
    }),
  })

  const dados = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new BlingError(
      dados?.error_description || dados?.error || "Falha ao trocar o code por token",
      res.status
    )
  }
  return montarTokens(dados)
}

/** Renova usando o refresh token (vale 30 dias). */
export async function renovarTokens(refreshToken: string): Promise<TokensBling> {
  const cfg = configDoApp()

  const res = await fetch(BLING_ENDPOINTS.token, {
    method: "POST",
    headers: {
      Authorization: cabecalhoBasic(cfg),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  })

  const dados = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new BlingError(
      dados?.error_description || dados?.error || "Falha ao renovar o token",
      res.status
    )
  }
  return montarTokens(dados)
}

function montarTokens(dados: Record<string, unknown>): TokensBling {
  const access = dados.access_token
  const refresh = dados.refresh_token
  if (typeof access !== "string" || typeof refresh !== "string") {
    throw new BlingError("Resposta de token sem access_token/refresh_token")
  }
  // `expires_in` vem em segundos. Sem ele, assume 1 hora e deixa a renovacao
  // por conta do 401 — melhor do que tratar como eterno.
  const segundos = typeof dados.expires_in === "number" ? dados.expires_in : 3600
  return {
    access_token: access,
    refresh_token: refresh,
    expira_em: new Date(Date.now() + segundos * 1000).toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Acesso autenticado, com renovacao
// ---------------------------------------------------------------------------

/**
 * Token valido da integracao, renovando se estiver perto de vencer.
 *
 * A renovacao grava de volta no cofre: o Bling invalida o refresh token
 * anterior a cada uso, entao perder o novo significa reconectar na mao.
 */
async function tokenValido(integracaoId: string): Promise<string> {
  const registro = await prisma.storeIntegracao.findFirst({
    where: { id: integracaoId, isDeleted: false, provedor: "bling" },
    select: { id: true, credenciaisCifradas: true },
  })
  if (!registro?.credenciaisCifradas) {
    throw new BlingError("Bling nao esta conectado")
  }

  let tokens: Credenciais
  try {
    tokens = decifrarCredenciais(registro.credenciaisCifradas)
  } catch {
    throw new BlingError("Credencial do Bling ilegivel — reconecte a integracao")
  }

  const expira = tokens.expira_em ? Date.parse(tokens.expira_em) : 0
  if (expira - MARGEM_RENOVACAO_MS > Date.now()) {
    return tokens.access_token
  }

  const novos = await renovarTokens(tokens.refresh_token)
  await prisma.storeIntegracao.update({
    where: { id: registro.id },
    data: {
      credenciaisCifradas: cifrarCredenciais({ ...novos }),
      status: "conectado",
      expiraEm: new Date(novos.expira_em),
      ultimoErro: null,
    },
  })
  return novos.access_token
}

/** GET autenticado. Sem equivalente de escrita — ver o comentario do topo. */
async function buscar<T>(
  integracaoId: string,
  url: string,
  params?: Record<string, string | number | undefined>,
  /** Pares repetidos, para parametros de array como `idsProdutos[]`. */
  repetidos?: [string, string][]
): Promise<T> {
  const token = await tokenValido(integracaoId)

  const endereco = new URL(url)
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined) endereco.searchParams.set(k, String(v))
  }
  // `append`, nao `set`: a mesma chave aparece uma vez por item.
  for (const [k, v] of repetidos ?? []) endereco.searchParams.append(k, v)

  const res = await fetch(endereco, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  })

  if (!res.ok) {
    const corpo = await res.text().catch(() => "")
    // Registra o erro na integracao para a tela mostrar sem precisar do log.
    await prisma.storeIntegracao
      .update({
        where: { id: integracaoId },
        data: {
          ultimoErro: `HTTP ${res.status} em ${endereco.pathname}`,
          status: res.status === 401 ? "expirado" : "erro",
        },
      })
      .catch(() => {})
    throw new BlingError(corpo.slice(0, 200) || `Bling respondeu ${res.status}`, res.status)
  }

  await prisma.storeIntegracao
    .update({
      where: { id: integracaoId },
      data: { ultimaSincronizacao: new Date(), ultimoErro: null, status: "conectado" },
    })
    .catch(() => {})

  return (await res.json()) as T
}

// ---------------------------------------------------------------------------
// Leituras
// ---------------------------------------------------------------------------

export type ProdutoBling = {
  id: number | string
  nome?: string
  codigo?: string
  /**
   * `number <float>` na especificacao. Tipado tambem como string porque JSON
   * nao garante o que a spec promete, e um `"89.90"` lido como nao-numero vira
   * preco zero no catalogo inteiro — falha cara e silenciosa.
   */
  preco?: number | string
  situacao?: string
  /** `S` simples, `V` variacao, `E` composicao. */
  formato?: string
  /** Descricao curta — o unico texto de produto que a LISTAGEM devolve. */
  descricaoCurta?: string
  /** Foto principal. A galeria completa so existe no detalhe, uma chamada por peca. */
  imagemURL?: string
  /**
   * `saldoVirtualTotal` e a soma de TODOS os depositos, nao a de um. Serve aqui
   * porque a Merlo Store usa um deposito so — em conta com mais de um, este
   * numero somaria lojas diferentes.
   */
  estoque?: { saldoVirtualTotal?: number }
  /**
   * Preenchido (≠ 0) quando o item e a VARIACAO de outro produto. A listagem
   * da v3 devolve cada variacao tambem como linha propria: sem descartar, cada
   * tamanho viraria um produto separado no catalogo.
   */
  idProdutoPai?: number | string
}

export type CategoriaBling = {
  id: number | string
  descricao?: string
}

/** O item e um produto de topo (simples ou pai), nao uma variacao de tamanho. */
export function ehProdutoDeTopo(p: ProdutoBling): boolean {
  return !p.idProdutoPai || String(p.idProdutoPai) === "0"
}

export type DepositoBling = {
  id: number | string
  descricao?: string
}

/**
 * Resposta de `/estoques/saldos/{idDeposito}`.
 *
 * ATENCAO ao que cada campo significa — errar aqui mostra estoque da rede
 * inteira como se fosse o da loja:
 *   - `saldoFisicoTotal` / `saldoVirtualTotal`: soma de TODOS os depositos
 *   - `depositos[].saldoFisico`: o saldo daquele deposito — e este que serve
 */
export type SaldoBling = {
  produto?: { id: number | string; codigo?: string }
  saldoFisicoTotal?: number
  saldoVirtualTotal?: number
  depositos?: { id: number | string; saldoFisico?: number; saldoVirtual?: number }[]
}

/**
 * Uma pagina do catalogo, CRUA — do jeito que o Bling devolve, variacoes
 * incluidas. `pagina` comeca em 1 (CONFIRMADO: `default: 1` na spec).
 *
 * Quem pagina TEM de decidir pelo tamanho desta lista, nao pela lista filtrada
 * depois: numa loja de roupa a maioria das linhas e variacao de tamanho, entao
 * uma pagina de 100 itens pode render 10 produtos. Parar por causa desses 10 e
 * o que fazia a sincronizacao terminar na primeira pagina.
 *
 * `criterio: 2` = so produtos ATIVOS (CONFIRMADO no enum da spec: 1 ultimos
 * incluidos, 2 ativos, 3 inativos, 4 excluidos, 5 todos). Sem ele vinha tambem
 * o que a loja ja tirou de linha, e o catalogo do atendimento enchia de peca
 * morta.
 */
export async function listarPaginaProdutos(
  integracaoId: string,
  pagina = 1,
  limite = 100,
  filtros?: {
    /** `idCategoria` e o unico jeito barato de saber a categoria de cada produto. */
    idCategoria?: string | number
    /**
     * `0` zerado, `1` positivo, `2` negativo — e NAO existe valor para "todos".
     * A spec declara `default: 1`, entao pode ser que omitir signifique "so o
     * que tem saldo", o que esconderia toda peca esgotada do catalogo. Omitir e
     * a unica forma de pedir sem filtro; quem varre confere na pratica se
     * precisa pedir as outras fatias.
     */
    filtroSaldoEstoque?: 0 | 1 | 2
  }
) {
  const r = await buscar<{ data?: ProdutoBling[] }>(integracaoId, BLING_ENDPOINTS.produtos, {
    pagina,
    limite,
    criterio: 2,
    idCategoria: filtros?.idCategoria === undefined ? undefined : String(filtros.idCategoria),
    filtroSaldoEstoque: filtros?.filtroSaldoEstoque,
  })
  return r.data ?? []
}

/**
 * Catalogo sem as variacoes — e o que a tela de saldo ao vivo lista.
 *
 * A variacao ja entra pelo produto pai; como linha propria, duplicaria a peca
 * uma vez por tamanho.
 */
export async function listarProdutos(integracaoId: string, pagina = 1, limite = 100) {
  return (await listarPaginaProdutos(integracaoId, pagina, limite)).filter(ehProdutoDeTopo)
}

/**
 * Uma imagem do produto, do jeito que o detalhe devolve.
 *
 * As internas sao as hospedadas pelo Bling e vem com URL ASSINADA que expira —
 * guardar o link significa foto quebrada semanas depois. Quem usa isto tem de
 * baixar o arquivo, nao guardar o endereco.
 */
export type ImagemBling = { link?: string }

export type VariacaoDetalhada = {
  id?: number | string
  nome?: string
  codigo?: string
  preco?: number | string
  estoque?: { saldoVirtualTotal?: number }
  /** `variacao.nome` vem como `"Tamanho:G;Cor:Verde"`. */
  variacao?: { nome?: string }
}

export type ProdutoDetalhado = {
  id: number | string
  nome?: string
  codigo?: string
  preco?: number | string
  descricaoCurta?: string
  imagemURL?: string
  categoria?: { id?: number | string }
  estoque?: { saldoVirtualTotal?: number }
  midia?: {
    imagens?: {
      internas?: ImagemBling[]
      externas?: ImagemBling[]
      imagensURL?: ImagemBling[]
    }
  }
  variacoes?: VariacaoDetalhada[]
}

/**
 * O detalhe de UM produto — a unica forma de obter foto e o atributo de
 * tamanho.
 *
 * A listagem nao traz nada disso: `imagemURL` vem vazio na maioria das pecas e
 * o tamanho so existe dentro de `variacoes[].variacao.nome`. Custa uma
 * requisicao por peca, a 3 por segundo — por isso quem chama trabalha em lote
 * e guarda por onde parou.
 */
export async function buscarProduto(integracaoId: string, produtoId: string | number) {
  const r = await buscar<{ data?: ProdutoDetalhado }>(
    integracaoId,
    `${BLING_ENDPOINTS.produtos}/${encodeURIComponent(String(produtoId))}`
  )
  return r.data ?? null
}

/** Categorias cadastradas — o de-para que transforma `categoria.id` em nome. */
export async function listarCategorias(integracaoId: string, pagina = 1, limite = 100) {
  const r = await buscar<{ data?: CategoriaBling[] }>(integracaoId, BLING_ENDPOINTS.categorias, {
    pagina,
    limite,
  })
  return r.data ?? []
}

/**
 * Produtos do Bling correspondentes a estes codigos (= nosso `products.sku`).
 *
 * Existe porque o saldo exige `idsProdutos[]` e nao aceita codigo: para saber o
 * estoque de um SKU nosso, primeiro e preciso descobrir o id dele la.
 */
export async function listarProdutosPorCodigo(integracaoId: string, codigos: string[]) {
  if (codigos.length === 0) return []

  const r = await buscar<{ data?: ProdutoBling[] }>(
    integracaoId,
    BLING_ENDPOINTS.produtos,
    { limite: Math.min(codigos.length, 100) },
    codigos.map((c) => ["codigos[]", c])
  )
  return r.data ?? []
}

/** Depositos cadastrados — e o que casa com `stores.blingDepositoId`. */
export async function listarDepositos(integracaoId: string) {
  const r = await buscar<{ data?: DepositoBling[] }>(integracaoId, BLING_ENDPOINTS.depositos)
  return r.data ?? []
}

/**
 * Saldo de produtos especificos, num deposito especifico.
 *
 * O deposito e o que separa Centro de Cerro Azul dentro da conta unica
 * (decisao 6). Saldo lido sem deposito seria a soma das duas lojas — numero que
 * nao serve para atender ninguem.
 *
 * `idsProdutos` e OBRIGATORIO na API (nao ha "listar todos os saldos"): quem
 * chama busca a pagina de produtos primeiro e pergunta o saldo daqueles ids.
 * Lista vazia devolve `[]` sem chamar o Bling — sem isso a chamada volta 400.
 */
export async function listarSaldos(
  integracaoId: string,
  depositoId: string,
  idsProdutos: (string | number)[]
) {
  if (idsProdutos.length === 0) return []

  const r = await buscar<{ data?: SaldoBling[] }>(
    integracaoId,
    urlSaldosDoDeposito(depositoId),
    undefined,
    // `idsProdutos[]` repetido, um por produto — e assim que a API espera.
    idsProdutos.map((id) => ["idsProdutos[]", String(id)])
  )
  return r.data ?? []
}

/**
 * Saldo de UM produto naquele deposito, ou `null` se o Bling nao informou.
 *
 * `null` e diferente de zero de proposito: zero diz "nao tem em estoque" e
 * trava a venda; nao saber tem que aparecer como nao saber.
 */
export function saldoNoDeposito(saldo: SaldoBling, depositoId: string): number | null {
  const d = saldo.depositos?.find((x) => String(x.id) === String(depositoId))
  if (!d) return null
  return d.saldoFisico ?? d.saldoVirtual ?? null
}

export { BlingConfigError }
