/**
 * Escopo de loja — o que impede o Centro de ver o Cerro Azul.
 *
 * Duas frentes:
 *   1. a logica de `escopoDaLoja` / `lojaParaGravar`;
 *   2. checagem estatica sobre o fonte das rotas — consulta sem escopo nao passa.
 */
import { describe, it, expect } from "vitest"
import { escopoDaLoja, lojaParaGravar, ehGestao } from "@/lib/loja"
import { ehApiPublica } from "@/lib/api-publica"
import { listarRotas } from "./rotas"

const vendedora = { id: "u1", role: "vendedor", storeId: "centro" }
const viewer = { id: "u2", role: "viewer", storeId: "centro" }
const admin = { id: "u3", role: "admin", storeId: null }
const gerente = { id: "u4", role: "gerente", storeId: null }

describe("quem alcanca as duas lojas", () => {
  it("admin e gerente sim; vendedor e viewer nao", () => {
    expect(ehGestao("admin")).toBe(true)
    expect(ehGestao("gerente")).toBe(true)
    expect(ehGestao("vendedor")).toBe(false)
    expect(ehGestao("viewer")).toBe(false)
    expect(ehGestao(undefined)).toBe(false)
  })
})

describe("filtro de leitura", () => {
  it("vendedor le so a loja dele", () => {
    expect(escopoDaLoja(vendedora)).toEqual({ storeId: "centro" })
    expect(escopoDaLoja(viewer)).toEqual({ storeId: "centro" })
  })

  it("vendedor NAO consegue pedir outra loja pela query", () => {
    // O parametro do cliente e ignorado — loja escolhida pelo navegador e
    // loja falsificavel, o mesmo erro da autoria.
    expect(escopoDaLoja(vendedora, "cerro-azul")).toEqual({ storeId: "centro" })
  })

  it("gestao sem parametro ve as duas", () => {
    expect(escopoDaLoja(admin)).toEqual({})
    expect(escopoDaLoja(gerente)).toEqual({})
  })

  it("gestao com parametro filtra a loja pedida", () => {
    expect(escopoDaLoja(gerente, "cerro-azul")).toEqual({ storeId: "cerro-azul" })
  })

  it("vendedor sem loja (estado impossivel) fecha, nao abre", () => {
    const quebrado = { id: "x", role: "vendedor", storeId: null }
    expect(escopoDaLoja(quebrado)).not.toEqual({})
    expect(escopoDaLoja(quebrado).storeId).toBeTruthy()
  })
})

describe("loja de gravacao", () => {
  it("vendedor grava na loja dele, ignorando o parametro", () => {
    expect(lojaParaGravar(vendedora, "cerro-azul")).toBe("centro")
  })

  it("gestao precisa dizer a loja", () => {
    expect(lojaParaGravar(admin)).toBeNull()
    expect(lojaParaGravar(admin, "centro")).toBe("centro")
  })
})

// ---------------------------------------------------------------------------
// Checagem estatica: consulta sem escopo nao entra no repositorio
// ---------------------------------------------------------------------------

const rotas = listarRotas().filter((r) => !ehApiPublica(r.caminho))

/** Models cujo dado pertence a uma loja. */
const MODELS_DA_LOJA = [
  "contact", "conversation", "message", "mediaFile", "lookbook", "product",
  "deal", "order", "return", "alert", "quickReply", "whatsappTemplate",
  "scheduledMessage", "broadcast", "satisfactionSurvey", "knowledgeArticle",
  "consentLog", "activityLog",
]

/**
 * Operacoes que alcancam dado de uma loja.
 *
 * `findUnique`, `update` e `delete` entram aqui — antes ficavam de fora, e era
 * exatamente por onde os vazamentos passavam: `update({ where: { id } })` sem
 * escopo altera o registro de qualquer loja.
 */
const OPERACAO = "(findMany|findFirst|findUnique|findUniqueOrThrow|count|aggregate|groupBy|update|updateMany|delete|deleteMany|upsert)"
const CONSULTA = new RegExp(`prisma\\.(${MODELS_DA_LOJA.join("|")})\\.${OPERACAO}`)

/**
 * Fatia o fonte da rota por handler HTTP.
 *
 * A checagem PRECISA ser por handler, nao por arquivo. Um arquivo com
 * `escopoDaLoja` no POST e sem no GET passava batido — foi assim que
 * `/api/lgpd`, `/api/products/[id]` e os pagamentos ficaram vazando entre
 * lojas com o teste verde.
 */
function handlersDe(fonte: string): { metodo: string; corpo: string }[] {
  const re = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)/g
  const marcas: { metodo: string; inicio: number }[] = []
  for (let m = re.exec(fonte); m; m = re.exec(fonte)) {
    marcas.push({ metodo: m[1], inicio: m.index })
  }
  return marcas.map((marca, i) => ({
    metodo: marca.metodo,
    corpo: fonte.slice(marca.inicio, marcas[i + 1]?.inicio ?? fonte.length),
  }))
}

/**
 * Funcoes do arquivo que resolvem escopo — o handler pode delegar para elas.
 *
 * Sem isto, extrair a checagem para um ajudante (o que e boa pratica) faria o
 * teste acusar falso positivo, e a saida seria duplicar codigo para agradar o
 * teste.
 */
const RESOLVE_LOJA = /escopoDaLoja|lojaParaGravar/

function ajudantesComEscopo(fonte: string): string[] {
  const nomes: string[] = []
  const re = /(?:async\s+)?function\s+([a-zA-Z_$][\w$]*)\s*\(/g
  const marcas: { nome: string; inicio: number }[] = []
  for (let m = re.exec(fonte); m; m = re.exec(fonte)) {
    marcas.push({ nome: m[1], inicio: m.index })
  }
  marcas.forEach((marca, i) => {
    const corpo = fonte.slice(marca.inicio, marcas[i + 1]?.inicio ?? fonte.length)
    const ehHandler = /^(GET|POST|PUT|PATCH|DELETE)$/.test(marca.nome)
    if (!ehHandler && RESOLVE_LOJA.test(corpo)) nomes.push(marca.nome)
  })
  return nomes
}

/**
 * Rotas em que a LOJA e o recurso, nao o contexto.
 *
 * `/api/lojas/[id]` administra a propria loja: o `DELETE` conta usuarios e
 * pedidos por `storeId: id`, onde o id vem da URL. Isso E escopo — so nao
 * passa pelo ajudante, porque nao ha "loja do usuario" a resolver: a rota e
 * so de admin e opera sobre qualquer loja por definicao.
 *
 * A lista e curta e explicita de proposito. Uma excecao que se ve no diff e
 * melhor do que uma regra afrouxada em silencio.
 */
const LOJA_E_O_RECURSO = [/^\/api\/lojas(\/|$)/]

describe("rotas protegidas consultam com escopo", () => {
  /** Cada handler que toca dado de loja vira um caso de teste proprio. */
  const casos = rotas
    .filter((r) => !LOJA_E_O_RECURSO.some((re) => re.test(r.rota)))
    .flatMap((r) => {
      const ajudantes = ajudantesComEscopo(r.fonte)
      return handlersDe(r.fonte)
        .filter((h) => CONSULTA.test(h.corpo))
        .map((h) => [`${h.metodo} ${r.rota}`, h.corpo, ajudantes] as const)
    })

  it("encontra handlers que tocam dado de loja", () => {
    expect(casos.length).toBeGreaterThan(15)
  })

  it.each(casos)("%s resolve o escopo da loja", (_nome, corpo, ajudantes) => {
    // Duas formas validas, e as duas tiram a loja da SESSAO — nunca do corpo:
    //   `escopoDaLoja`   filtra a leitura/alteracao pela loja de quem pediu;
    //   `lojaParaGravar` resolve a loja de gravacao ao criar registro.
    // Tambem vale delegar para um ajudante do mesmo arquivo. O que nao vale e
    // o caminho nunca passar por nenhuma das duas.
    const resolve =
      RESOLVE_LOJA.test(corpo) || ajudantes.some((nome) => corpo.includes(nome + "("))
    expect(resolve).toBe(true)
  })

  it("todo handler que toca dado de loja tambem le a sessao", () => {
    // Sem sessao nao ha de quem escopar. `/api/lgpd` GET nao lia, e por isso
    // qualquer usuario logado exportava o dossie de qualquer loja.
    for (const [nome, corpo] of casos) {
      expect(corpo, nome).toMatch(/usuarioDaSessao|usuario/)
    }
  })

  // Tabelas derivadas (dealEvent, orderEvent, payment, messageMedia,
  // broadcastRecipient) nao tem `store_id`: sao escopadas pelo pai.
  const CRIA_DA_LOJA = new RegExp(`prisma\\.(${MODELS_DA_LOJA.join("|")})\\.create\\(`)

  it.each(rotas.filter((r) => CRIA_DA_LOJA.test(r.fonte)).map((r) => [r.rota, r.fonte] as const))(
    "%s define a loja ao criar",
    (_rota, fonte) => {
      // Ou grava direto (`storeId`), ou herda do pai (`contato.storeId`,
      // `conversation.storeId`).
      expect(/storeId/.test(fonte)).toBe(true)
    }
  )
})

describe("gateway de mensagem", () => {
  it("exige a loja para achar ou criar contato", async () => {
    const { readFileSync } = await import("node:fs")
    const { resolve } = await import("node:path")
    const src = readFileSync(
      resolve(__dirname, "..", "src", "lib", "channels", "gateway.ts"),
      "utf8"
    )
    // A assinatura obriga quem chama a resolver a loja antes.
    expect(src).toMatch(/processIncomingMessage\([^)]*storeId: string/)
    // E a busca de contato nao pode ser global.
    expect(src).toMatch(/findFirst\(\{\s*where: \{ storeId,/)
  })
})

describe("nome de coluna que o TypeScript nao confere", () => {
  it("filtro de conversa usa storeIntegracaoId, nunca integracaoId", async () => {
    // O `where` das rotas e `Record<string, unknown>`, entao o Prisma Client
    // nao tipa nada dentro dele: `{ integracaoId: x }` compila, passa no
    // typecheck, passa no build — e explode como erro de validacao do Prisma
    // na primeira vez que alguem usa o filtro em producao. A coluna chama
    // `storeIntegracaoId`; `integracao` e o nome da RELACAO.
    const { readFileSync } = await import("node:fs")
    const { resolve } = await import("node:path")
    const { globSync } = await import("node:fs")

    const raiz = resolve(__dirname, "..", "src")
    const arquivos = globSync("**/*.{ts,tsx}", { cwd: raiz }).map((f) => resolve(raiz, f))

    for (const arquivo of arquivos) {
      const src = readFileSync(arquivo, "utf8")
      for (const linha of src.split("\n")) {
        const achou = linha.match(/\bintegracaoId:\s*(\S+)/)
        // `integracaoId: string` e anotacao de tipo, nao chave de consulta —
        // e vem seguida de `)`, `,` ou `;` conforme o lugar.
        if (achou && !/^string\b/.test(achou[1])) {
          throw new Error(`${arquivo}: "${linha.trim()}" — a coluna e storeIntegracaoId`)
        }
      }
    }
  })
})
