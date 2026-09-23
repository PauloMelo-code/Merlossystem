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
import { precoDeCatalogo, numeroDoBling } from "@/lib/bling/preco"

const raiz = resolve(__dirname, "..")
const ler = (...p: string[]) => readFileSync(resolve(raiz, ...p), "utf8")
/** Codigo sem comentario — para a asercao nao cair no texto que explica a regra. */
const semComentarios = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

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
    expect(lib).toMatch(/listarPaginaProdutos/)
  })

  it("a sincronizacao nao pisa no que o Bling nao sabe", () => {
    // Tamanhos, fotos, destaque, descricao e o estoque POR TAMANHO sao
    // preenchidos AQUI pela equipe, e `active:false` e como a loja exclui um
    // produto. Escrever qualquer um desses na sincronizacao apagaria o trabalho
    // delas a cada rodada (ou ressuscitaria o que foi excluido).
    // Sem os comentarios: a regra fala do que se GRAVA, e o proprio comentario
    // do arquivo cita os campos proibidos para explicar por que nao os grava.
    const lib = semComentarios(ler("src", "lib", "bling", "sincronizar.ts"))
    for (const campo of [
      "stock",
      "active",
      "sizes",
      "imageUrls",
      "featured",
      "sizeType",
      "description",
    ]) {
      expect(lib, campo).not.toMatch(new RegExp(`\\b${campo}\\s*:`))
    }
    // E a linha nunca e recriada: pedido, midia e reserva apontam para o id local.
    expect(lib).not.toMatch(/prisma\.product\.deleteMany|prisma\.product\.delete\b/)
  })

  it("categoria e a excecao, e so e escrita quando o Bling TEM uma", () => {
    // O Bling passou a ser a fonte da categoria (o usuario pediu). Mas gravar
    // o que ele devolve SEM condicao apagaria, com `null`, a categoria digitada
    // aqui para todo produto que o Bling nao classificou — e o Bling nao tem
    // como repor o que nunca soube.
    const lib = ler("src", "lib", "bling", "sincronizar.ts")
    expect(lib).toMatch(/if \(categoria && atual\.category !== categoria\)/)
    expect(lib).not.toMatch(/category:\s*(null|undefined|categoria \?\?)/)
  })

  it("a paginacao decide pela pagina CRUA — o bug que parava na primeira", () => {
    // Numa loja de roupa a maioria das linhas da listagem e variacao de tamanho.
    // Decidir "acabou" pelo tamanho da lista JA FILTRADA fazia 100 itens virarem
    // 10 pecas, e `10 < 100` encerrava o laco: a sincronizacao inteira terminava
    // na pagina 1, com 10 produtos e nenhum preco.
    const lib = ler("src", "lib", "bling", "sincronizar.ts")
    expect(lib).toMatch(/if \(bruta\.length < POR_PAGINA\) break/)
    expect(lib).not.toMatch(/pecas\.length < POR_PAGINA/)
    // E quem varre pede a pagina crua: `listarProdutos` ja vem filtrada.
    expect(lib).not.toMatch(/[^a]\blistarProdutos\(/)
  })

  it("a varredura nao confia no default de filtroSaldoEstoque", () => {
    // O parametro tem `default: 1` (so saldo positivo) e o enum — 0 zerado,
    // 1 positivo, 2 negativo — NAO tem valor para "todos". Se o Bling aplicar
    // esse default ao parametro omitido, o catalogo perde toda peca esgotada
    // sem erro nenhum, que e o tipo de falha que so aparece na reclamacao da
    // cliente. Por isso a varredura pergunta tambem as outras fatias.
    const lib = semComentarios(ler("src", "lib", "bling", "sincronizar.ts"))
    expect(lib).toMatch(/VARIANTES_DE_SALDO = \[undefined, 0, 2\]/)
    expect(lib).toMatch(/for \(const filtroSaldoEstoque of VARIANTES_DE_SALDO\)/)
  })
})

describe("preco do catalogo", () => {
  it("usa o preco do proprio produto quando ele tem", () => {
    expect(precoDeCatalogo(89.9, [10, 10])).toBe("89.90")
  })

  it("peca com variacoes: o pai vem zerado e o preco vive nos tamanhos", () => {
    // E o caso NORMAL de roupa na v3 — foi o que trouxe o catalogo a R$ 0,00.
    expect(precoDeCatalogo(0, [129.9, 129.9, 129.9])).toBe("129.90")
  })

  it("tamanhos com precos diferentes: fica com o mais repetido", () => {
    expect(precoDeCatalogo(0, [99.9, 129.9, 129.9, 129.9])).toBe("129.90")
  })

  it("empate entre tamanhos fica com o MAIOR, para nao subcotar a peca", () => {
    // Subcotar tira margem da loja sem ninguem perceber; desconto a vendedora
    // ainda pode dar na conversa.
    expect(precoDeCatalogo(0, [99.9, 129.9])).toBe("129.90")
  })

  it("aceita preco em texto — a spec promete number, o JSON nao garante", () => {
    expect(precoDeCatalogo("89.90")).toBe("89.90")
    expect(precoDeCatalogo("1.234,56")).toBe("1234.56")
  })

  it("sem preco em lugar nenhum devolve 0,00 em vez de inventar um", () => {
    expect(precoDeCatalogo(0, [])).toBe("0.00")
    expect(precoDeCatalogo(null, undefined)).toBe("0.00")
    expect(precoDeCatalogo(-5, [0, 0])).toBe("0.00")
    expect(numeroDoBling("abc")).toBe(0)
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
