/**
 * Bling — o que precisa ser verdade antes de ligar em producao:
 *   - o `state` do OAuth nao pode ser forjado nem reaproveitado;
 *   - as credenciais do app vao em Basic, nunca no body;
 *   - o cliente NAO tem caminho de escrita.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { criarState, validarState } from "@/lib/bling/estado"
import { cabecalhoBasic, configDoApp, ehBlingConfigError } from "@/lib/bling/config"

const raiz = resolve(__dirname, "..")
const ler = (...p: string[]) => readFileSync(resolve(raiz, ...p), "utf8")

const ENV = { ...process.env }
beforeEach(() => {
  process.env.NEXTAUTH_SECRET = "segredo-de-teste"
  process.env.BLING_CLIENT_ID = "id-do-app"
  process.env.BLING_CLIENT_SECRET = "segredo-do-app"
  process.env.BLING_REDIRECT_URI = "https://app.local/api/integracoes/bling/callback"
})
afterEach(() => {
  process.env = { ...ENV }
  vi.useRealTimers()
})

describe("state do OAuth", () => {
  it("ida e volta identifica quem iniciou", () => {
    const r = validarState(criarState("user-1"))
    expect(r).toEqual({ ok: true, usuarioId: "user-1" })
  })

  it("dois pedidos seguidos geram states diferentes", () => {
    expect(criarState("user-1")).not.toBe(criarState("user-1"))
  })

  it("recusa state forjado — o caso que trocaria a conta da rede inteira", () => {
    const payload = Buffer.from(JSON.stringify({ u: "invasor", t: Date.now(), n: "x" }))
      .toString("base64url")
    expect(validarState(`${payload}.assinatura-inventada`).ok).toBe(false)
  })

  it("recusa conteudo alterado depois de assinado", () => {
    const [payload, assinatura] = criarState("user-1").split(".")
    const outro = Buffer.from(JSON.stringify({ u: "invasor", t: Date.now(), n: "x" }))
      .toString("base64url")
    expect(validarState(`${outro}.${assinatura}`).ok).toBe(false)
  })

  it("recusa state assinado com outro segredo", () => {
    const state = criarState("user-1")
    process.env.NEXTAUTH_SECRET = "outro-segredo"
    expect(validarState(state).ok).toBe(false)
  })

  it("expira em 1 minuto, como o code do Bling", () => {
    vi.useFakeTimers()
    const state = criarState("user-1")
    vi.advanceTimersByTime(61_000)
    const r = validarState(state)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.motivo).toMatch(/expirado/)
  })

  it("recusa ausente e malformado", () => {
    expect(validarState(null).ok).toBe(false)
    expect(validarState("").ok).toBe(false)
    expect(validarState("sem-ponto").ok).toBe(false)
  })
})

describe("credenciais do app", () => {
  it("vao em Basic base64, como a documentacao do Bling exige", () => {
    const cabecalho = cabecalhoBasic(configDoApp())
    expect(cabecalho.startsWith("Basic ")).toBe(true)
    const decodificado = Buffer.from(cabecalho.slice(6), "base64").toString("utf8")
    expect(decodificado).toBe("id-do-app:segredo-do-app")
  })

  it("faltando configuracao, falha alto em vez de chamar sem credencial", () => {
    delete process.env.BLING_CLIENT_SECRET
    expect(() => configDoApp()).toThrow(/BLING_CLIENT_SECRET/)
    try {
      configDoApp()
    } catch (e) {
      expect(ehBlingConfigError(e)).toBe(true)
    }
  })

  it("o segredo do app NAO vai no corpo da requisicao de token", () => {
    // A doc do Bling e explicita: "nao e permitida a insercao destes
    // parametros no body".
    const src = ler("src", "lib", "bling", "cliente.ts")
    const corpos = src.match(/new URLSearchParams\(\{[\s\S]*?\}\)/g) ?? []
    expect(corpos.length).toBeGreaterThan(0)
    for (const corpo of corpos) {
      expect(corpo).not.toContain("client_id")
      expect(corpo).not.toContain("client_secret")
    }
  })
})

describe("somente leitura", () => {
  const cliente = ler("src", "lib", "bling", "cliente.ts")

  it("o cliente nao tem metodo de escrita", () => {
    // Decisao 8 fechada (ADR 0004): o Masc e o dono da venda e o Bling e a
    // autoridade de estoque, alimentado pelo vinculo Masc->Bling. Escrever
    // daqui baixaria a mesma peca duas vezes. Nao e cautela, e arquitetura.
    expect(cliente).not.toMatch(/method: "(PUT|PATCH|DELETE)"/)

    // POST existe, mas so nos dois do OAuth (trocar code, renovar token) —
    // nenhum POST de dado.
    const posts = cliente.match(/method: "POST"/g) ?? []
    expect(posts.length).toBe(2)
    for (const endpoint of ["produtos", "depositos"]) {
      const uso = new RegExp(`BLING_ENDPOINTS\\.${endpoint}[\\s\\S]{0,200}?method:`, "m")
      expect(cliente, endpoint).not.toMatch(uso)
    }
  })

  it("as rotas do Bling nao expoem escrita", () => {
    for (const rota of ["autorizar", "callback", "catalogo"]) {
      const src = ler("src", "app", "api", "integracoes", "bling", rota, "route.ts")
      expect(src, rota).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)/)
    }
  })

  it("sincronizar e a excecao: POST aqui grava no NOSSO banco, nunca no Bling", () => {
    // A rota tem POST porque a sincronizacao e uma acao, nao uma leitura de
    // tela. O que ela nao pode e mandar escrita para o Bling: do lado de la,
    // so `listarProdutos` (GET).
    const rota = ler("src", "app", "api", "integracoes", "bling", "sincronizar", "route.ts")
    expect(rota).toMatch(/export async function POST/)
    const lib = ler("src", "lib", "bling", "sincronizar.ts")
    expect(lib).not.toMatch(/method: "(POST|PUT|PATCH|DELETE)"/)
    expect(lib.match(/from "\.\/cliente"/g)?.length).toBe(1)
    expect(lib).toMatch(/listarProdutos/)
  })

  it("a sincronizacao nao pisa no que o Bling nao sabe", () => {
    // O Bling devolve id, nome, codigo, preco e situacao — mais nada. Categoria,
    // tamanhos, fotos, destaque e o estoque POR TAMANHO sao preenchidos aqui
    // pela equipe, e `active:false` e como a loja exclui um produto. Escrever
    // qualquer um desses na sincronizacao apagaria o trabalho delas a cada
    // rodada (ou ressuscitaria o que foi excluido).
    const lib = ler("src", "lib", "bling", "sincronizar.ts")
    const atualizacao = lib.slice(lib.indexOf("prisma.product.update"))
    for (const campo of ["stock", "active", "category", "sizes", "imageUrls", "featured", "sizeType"]) {
      expect(atualizacao, campo).not.toMatch(new RegExp(`\\b${campo}:`))
    }
    // E a linha nunca e recriada: pedido, midia e reserva apontam para o id local.
    expect(lib).not.toMatch(/prisma\.product\.deleteMany|prisma\.product\.delete\b/)
  })
})

describe("somente leitura no TikTok tambem", () => {
  const cliente = ler("src", "lib", "tiktok", "cliente.ts")

  it("o cliente do TikTok nao tem metodo de escrita", () => {
    expect(cliente).not.toMatch(/method: "(POST|PUT|PATCH|DELETE)"/)
  })

  it("as rotas do TikTok nao expoem escrita", () => {
    for (const rota of ["autorizar", "callback"]) {
      const src = ler("src", "app", "api", "integracoes", "tiktok", rota, "route.ts")
      expect(src, rota).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)/)
    }
  })

  it("o app_secret nao vaza para os parametros da chamada", () => {
    // Ele e chave do HMAC, nao parametro. Mandar na query entregaria o segredo
    // em qualquer log de proxy.
    expect(cliente).not.toMatch(/searchParams\.set\("app_secret"[\s\S]{0,80}TIKTOK_API_BASE/)
  })
})

describe("incerteza isolada", () => {
  it("os endpoints do Bling ficam num arquivo so, agora CONFIRMADOS na collection oficial", () => {
    const config = ler("src", "lib", "bling", "config.ts")
    // A collection OpenAPI oficial voltou a responder (antes dava 404), entao
    // os caminhos deixaram de ser palpite. O teste guarda a PROCEDENCIA: sem a
    // URL da collection ninguem sabe onde conferir de novo.
    expect(config).toContain("openapi-BvBfsn8J.json")
    expect(config).toContain("CONFIRMADO")
    // Nenhum outro arquivo pode ter URL do Bling embutida: se a doc oficial
    // mudar, e um arquivo que muda.
    for (const arq of [
      ["src", "lib", "bling", "cliente.ts"],
      ["src", "app", "api", "integracoes", "bling", "autorizar", "route.ts"],
      ["src", "app", "api", "integracoes", "bling", "callback", "route.ts"],
    ]) {
      expect(ler(...arq), arq.join("/")).not.toContain("bling.com.br")
    }
  })

  it("os endpoints do TikTok tambem, e a duvida do caminho esta declarada", () => {
    const config = ler("src", "lib", "tiktok", "config.ts")
    expect(config).toMatch(/CONFERIR/)
    // O unico ponto realmente incerto tem nome e comentario proprio.
    expect(config).toContain("ASSINATURA_INCLUI_CAMINHO")

    for (const arq of [
      ["src", "lib", "tiktok", "cliente.ts"],
      ["src", "lib", "tiktok", "assinatura.ts"],
      ["src", "app", "api", "integracoes", "tiktok", "autorizar", "route.ts"],
      ["src", "app", "api", "integracoes", "tiktok", "callback", "route.ts"],
    ]) {
      expect(ler(...arq), arq.join("/")).not.toMatch(/tiktokglobalshop\.com|tiktok-shops\.com/)
    }
  })
})
