/**
 * Historico do WhatsApp que nao ficava.
 *
 * O uazapi entrega o historico em webhooks PARALELOS. Tres defeitos somados
 * faziam o passado sumir sem nenhum erro visivel para a loja:
 *
 *  1. `processIncomingMessage` procurava a contato e, nao achando, criava —
 *     dois lotes da mesma cliente nova passavam juntos pelo `findFirst` e o
 *     unico (store_id, whatsapp_id) derrubava o segundo com P2002.
 *  2. O try/catch da rota de webhook cobria o LACO INTEIRO: esse P2002 no
 *     meio de um lote descartava calado todas as mensagens seguintes, e a
 *     rota ainda respondia 200 — o uazapi nunca reenviava.
 *  3. Na tela, o polling chamava a mesma `carregar()` da abertura e
 *     recalculava `temMais` pela pagina MAIS RECENTE: quando ela vinha curta
 *     o botao "carregar anteriores" sumia, com o historico ja no banco.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const raiz = resolve(__dirname, "..")
const ler = (...p: string[]) => readFileSync(resolve(raiz, ...p), "utf8")
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

describe("contato sob corrida de lotes paralelos", () => {
  const fonte = semComentarios(ler("src", "lib", "channels", "gateway.ts"))

  it("trata P2002 relendo a contato em vez de estourar", () => {
    // Sem isto, o lote inteiro morria na primeira cliente nova repetida.
    expect(fonte).toMatch(/catch[\s\S]{0,400}P2002/)
    const depoisDoCatch = fonte.slice(fonte.indexOf("P2002"))
    expect(depoisDoCatch).toMatch(/contact = await prisma\.contact\.findFirst/)
  })

  it("nao engole erro que nao seja de unicidade", () => {
    // Falha de conexao tem que continuar subindo: so a corrida e esperada.
    expect(fonte).toMatch(/!== "P2002"\) throw erro/)
  })
})

describe("webhook do uazapi", () => {
  const fonte = ler("src", "app", "api", "webhooks", "uazapi", "route.ts")

  it("isola cada mensagem do lote", () => {
    // O `try` tem que estar DENTRO do `for`, antes do processamento.
    const laco = fonte.slice(fonte.indexOf("for (const msg of mensagens)"))
    const abreTry = laco.indexOf("try {")
    const processa = laco.indexOf("processIncomingMessage")
    expect(abreTry).toBeGreaterThan(-1)
    expect(abreTry).toBeLessThan(processa)
  })

  it("registra a mensagem descartada em vez de perde-la calada", () => {
    expect(fonte).toMatch(/Mensagem descartada/)
  })
})

describe("paginacao da conversa na tela", () => {
  const fonte = semComentarios(ler("src", "components", "inbox", "ChatWindow.tsx"))

  it("so a abertura decide se ha anteriores", () => {
    // O polling le sempre a pagina mais recente: deixa-lo mexer em `temMais`
    // apagava o botao de carregar o passado.
    expect(fonte).toMatch(/if \(inicial\) setTemMais\(recentes\.length >= PAGINA\)/)
  })

  it("a abertura passa `inicial` e o polling nao", () => {
    expect(fonte).toMatch(/void carregar\(true\)\.then/)
    const laco = fonte.slice(fonte.indexOf("setInterval"))
    expect(laco).toMatch(/await carregar\(\)/)
  })
})
