/**
 * Bling API v3 — pontos de contato com o servico externo.
 *
 * CONFIRMADO na collection OpenAPI OFICIAL (baixada em 17/08/2026 de
 * https://developer.bling.com.br/build/assets/openapi-BvBfsn8J.json —
 * HTTP 200, 1.076.091 bytes, `info.version` 3.0, 162 caminhos):
 *   - `servers[0].url` = https://api.bling.com.br/Api/v3 — o prefixo `/Api/v3`
 *     que antes era suposicao esta certo
 *   - `GET /produtos`, `GET /depositos`, `GET /estoques/saldos` existem
 *   - `GET /estoques/saldos/{idDeposito}` — o deposito e **path param**, nao
 *     query; e `idsProdutos[]` e **obrigatorio** nas duas variantes
 *   - a resposta traz `saldoFisicoTotal`/`saldoVirtualTotal` (a soma da REDE) e
 *     um array `depositos[]` com `{ id, saldoFisico, saldoVirtual }` por deposito
 *   - existe ambiente de teste: https://developer.bling.com.br/api/bling
 *
 * CONFIRMADO na documentacao em prosa (a collection nao cobre o OAuth):
 *   - fluxo Authorization Code
 *   - na troca do code, `client_id:client_secret` vao em HTTP Basic (base64);
 *     "nao e permitida a insercao destes parametros no body"
 *   - o authorization code expira em 1 minuto
 *   - o refresh token vale 30 dias
 *   - chamadas de API usam `Authorization: Bearer <token>`
 *
 * NAO ha idempotencia na API v3: nenhum header de idempotencia em nenhum dos
 * 162 caminhos, nenhum 409 declarado. Irrelevante hoje — este sistema NAO
 * escreve no Bling (ADR 0004) — mas e a razao de a protecao contra duplicata
 * ter de morar no nosso Postgres se um dia escrever.
 *
 * Limites: 3 req/s e 120.000/dia por conta (429). Bloqueio de IP em 600 req/10s
 * ou 300 erros/10s. Nao ha `Retry-After`: qualquer backoff e cego.
 */

export const BLING_API_BASE = "https://api.bling.com.br"

/**
 * Header que pede token JWT em vez do token opaco.
 *
 * O Bling DESCONTINUOU o token opaco e ja anunciou bloqueio, com data "em
 * definicao" — ou seja, pode cair sem aviso util. Sem este header a API
 * continua devolvendo token opaco, que funciona ate o bloqueio e para de
 * funcionar de uma vez.
 *
 * Tem de ir em TODAS as tres situacoes, e nao so na primeira:
 *   1. ao trocar o code por token;
 *   2. ao RENOVAR pelo refresh token — sem ele, a renovacao seguinte devolve
 *      token opaco de novo e a migracao se desfaz sozinha na primeira renovacao;
 *   3. em toda requisicao autenticada a API.
 *
 * O JWT tem de 1.500 a 3.000 caracteres, contra poucas dezenas do opaco. Cabe
 * em `stores_integracoes.credenciais_cifradas`, que e `text` — mas e a razao
 * de isto estar escrito aqui e nao ser "so mais um header".
 */
export const CABECALHO_JWT = { "enable-jwt": "1" } as const

/** Prefixo confirmado em `servers[0].url` da collection oficial. */
const V3 = `${BLING_API_BASE}/Api/v3`

export const BLING_ENDPOINTS = {
  /** Tela onde o lojista autoriza o app. */
  autorizar: `${V3}/oauth/authorize`,
  /** Troca de code por token e refresh. Credenciais em Basic, nunca no body. */
  token: `${V3}/oauth/token`,
  /** Listagem de produtos. */
  produtos: `${V3}/produtos`,
  /** Depositos cadastrados — de-para com as lojas daqui. */
  depositos: `${V3}/depositos`,
  /**
   * Categorias de produto.
   *
   * O produto NAO carrega o nome da categoria em lugar nenhum: a listagem nao
   * traz categoria, e o detalhe traz so `categoria.id` (CONFIRMADO em
   * `components.schemas.ProdutosDadosDTO.properties.categoria`, que tem apenas
   * `id`). O nome legivel so existe aqui.
   */
  categorias: `${V3}/categorias/produtos`,
} as const

/**
 * Saldo dos produtos indicados, no deposito indicado.
 *
 * O deposito e path param — nao query. Chamar `/estoques/saldos` sem ele
 * devolve o saldo somado da REDE, que e exatamente o numero que a decisao 6
 * proibe mostrar: Centro + Cerro Azul juntos nao serve para atender ninguem.
 */
export function urlSaldosDoDeposito(depositoId: string | number): string {
  return `${V3}/estoques/saldos/${encodeURIComponent(String(depositoId))}`
}

/**
 * Margem para renovar o token antes de ele vencer. Renovar em cima da hora
 * perde a corrida com a requisicao em andamento.
 */
export const MARGEM_RENOVACAO_MS = 5 * 60 * 1000

/** O code do Bling expira em 1 minuto — o callback nao pode ficar esperando. */
export const VALIDADE_STATE_MS = 60 * 1000

export type ConfigApp = {
  clientId: string
  clientSecret: string
  redirectUri: string
}

export class BlingConfigError extends Error {
  constructor(mensagem: string) {
    super(mensagem)
    this.name = "BlingConfigError"
  }
}

export function ehBlingConfigError(e: unknown): e is BlingConfigError {
  return e instanceof Error && e.name === "BlingConfigError"
}

/**
 * Credenciais do APP (nao da loja). Ficam em ambiente porque sao unicas da
 * instalacao; o token do lojista e que vai cifrado no cofre.
 */
export function configDoApp(): ConfigApp {
  const clientId = process.env.BLING_CLIENT_ID
  const clientSecret = process.env.BLING_CLIENT_SECRET
  const redirectUri = process.env.BLING_REDIRECT_URI

  if (!clientId || !clientSecret || !redirectUri) {
    throw new BlingConfigError(
      "Bling nao configurado: faltam BLING_CLIENT_ID, BLING_CLIENT_SECRET ou BLING_REDIRECT_URI"
    )
  }
  return { clientId, clientSecret, redirectUri }
}

/** Cabecalho Basic exigido na troca do code e na renovacao. */
export function cabecalhoBasic(cfg: ConfigApp): string {
  const par = `${cfg.clientId}:${cfg.clientSecret}`
  return "Basic " + Buffer.from(par, "utf8").toString("base64")
}
