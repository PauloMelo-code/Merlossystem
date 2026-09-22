/**
 * WhatsApp via uazapi (etapa 7).
 *
 * O que estes testes travam:
 *   1. dois provedores servem o canal `whatsapp`, e o webhook de cada um
 *      resolve pelo SEU provedor — resolver pelo errado descarta a mensagem
 *      em silencio (foi o bug da etapa 3);
 *   2. o adapter do uazapi cumpre a mesma interface do da Meta;
 *   3. o token de cada instancia nunca vaza para outra;
 *   4. a incerteza da API fica confinada em src/lib/uazapi/config.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fonteEfetiva } from "./rotas"
import { getAdapter, getAdapterDaConta } from "@/lib/channels"
import { criarUazapiAdapter, ehLoteDeHistorico, parseUazapiMessages } from "@/lib/channels/uazapi"
import { verificarWebhookUazapi } from "@/lib/webhook-auth"
import {
  PROVEDORES,
  PROVEDORES_DE_CANAL,
  CANAL_DO_PROVEDOR,
  CHAVES_ESPERADAS,
} from "@/lib/integracoes"
import { whatsappAdapter } from "@/lib/channels/whatsapp"

const raiz = resolve(__dirname, "..")
const ler = (...p: string[]) => readFileSync(resolve(raiz, ...p), "utf8")

const ENV = { ...process.env }
afterEach(() => {
  process.env = { ...ENV }
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Provedor x canal
// ---------------------------------------------------------------------------

describe("dois provedores para o canal whatsapp", () => {
  it("whatsapp_oficial e uazapi convivem", () => {
    expect(PROVEDORES).toContain("whatsapp_oficial")
    expect(PROVEDORES).toContain("uazapi")
    expect(CANAL_DO_PROVEDOR.whatsapp_oficial).toBe("whatsapp")
    expect(CANAL_DO_PROVEDOR.uazapi).toBe("whatsapp")
  })

  it("os dois entregam mensagem de cliente", () => {
    expect(PROVEDORES_DE_CANAL).toContain("whatsapp_oficial")
    expect(PROVEDORES_DE_CANAL).toContain("uazapi")
  })

  it("cada um pede a sua credencial", () => {
    // Trocar as chaves entre os dois grava token de instancia como se fosse
    // token da Meta — e so falha no primeiro envio.
    expect(CHAVES_ESPERADAS.whatsapp_oficial).toEqual(["phone_id", "access_token"])
    expect(CHAVES_ESPERADAS.uazapi).toEqual(["token"])
  })

  it("o webhook da Meta resolve por whatsapp_oficial, nao por uazapi", () => {
    // Regressao da etapa 3: a rota da Meta procurava a conta como se fosse
    // uazapi, e nunca achava.
    const src = ler("src", "app", "api", "webhooks", "whatsapp", "route.ts")
    expect(src).toContain('contaDoEvento("whatsapp_oficial"')
    expect(src).not.toContain('contaDoEvento("uazapi"')
  })

  it("o webhook do uazapi resolve por uazapi", () => {
    const src = ler("src", "app", "api", "webhooks", "uazapi", "route.ts")
    expect(src).toContain('contaPorIdentificadores("uazapi"')
  })
})

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

describe("adapter do uazapi", () => {
  const adapter = criarUazapiAdapter({ token: "tk", base: "https://x.uazapi.com" })

  it("cumpre a mesma interface do adapter da Meta", () => {
    // Se faltar um metodo, o envio quebra so no tipo de midia que ninguem
    // testou a mao.
    for (const metodo of Object.keys(whatsappAdapter)) {
      expect(adapter, metodo).toHaveProperty(metodo)
    }
    expect(adapter.channel).toBe("whatsapp")
  })

  it("manda o token da instancia no header e nao no corpo", () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "m1" }), { status: 200 })
    )
    vi.stubGlobal("fetch", fetchMock)

    return adapter.sendText("5551999", "oi").then((r) => {
      expect(r).toEqual({ success: true, externalId: "m1" })
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe("https://x.uazapi.com/send/text")
      expect(init.headers.token).toBe("tk")
      // O token no corpo apareceria em log de aplicacao do lado do uazapi.
      expect(init.body).not.toContain("tk")
      expect(JSON.parse(init.body)).toEqual({ number: "5551999", text: "oi" })
    })
  })

  it("duas instancias nao compartilham token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    const centro = criarUazapiAdapter({ token: "TK-CENTRO", base: "https://x" })
    const cerro = criarUazapiAdapter({ token: "TK-CERRO", base: "https://x" })
    await centro.sendText("a", "1")
    await cerro.sendText("b", "2")

    expect(fetchMock.mock.calls[0][1].headers.token).toBe("TK-CENTRO")
    expect(fetchMock.mock.calls[1][1].headers.token).toBe("TK-CERRO")
  })

  it("uazapi fora do ar vira erro de envio, nao excecao", async () => {
    // Uma mensagem que nao saiu nao pode derrubar o processamento das outras.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")))
    const r = await adapter.sendText("a", "oi")
    expect(r.success).toBe(false)
    expect(r.error).toContain("inacessivel")
  })

  it("sendTemplate falha explicitamente em vez de mandar o nome do template", async () => {
    // O uazapi nao tem template aprovado. Mandar "boas_vindas" como texto
    // chegaria na cliente assim.
    const r = await adapter.sendTemplate("a", "boas_vindas", [])
    expect(r.success).toBe(false)
    expect(r.error).toContain("boas_vindas")
    expect(r.error).toMatch(/template/i)
  })

  it("getAdapterDaConta so usa o uazapi quando o provedor e uazapi", () => {
    const cred = { token: "tk" }
    expect(getAdapterDaConta("whatsapp", cred, "uazapi")).not.toBe(getAdapter("whatsapp"))
    // Sem provedor, WhatsApp continua caindo na Meta — comportamento de antes.
    expect(getAdapterDaConta("whatsapp", cred)).toBe(getAdapter("whatsapp"))
    expect(getAdapterDaConta("whatsapp", {}, "uazapi")).toBe(getAdapter("whatsapp"))
  })

  it("as duas rotas de envio passam o provedor da conta", () => {
    for (const rota of [
      ["src", "app", "api", "messages", "route.ts"],
      ["src", "app", "api", "media", "send", "route.ts"],
    ]) {
      expect(fonteEfetiva(...rota), rota.join("/")).toContain("conta?.provedor")
    }
  })
})

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

describe("autenticacao do webhook do uazapi", () => {
  beforeEach(() => {
    process.env.UAZAPI_WEBHOOK_SECRET = "segredo-forte"
  })

  const url = "https://app.local/api/webhooks/uazapi"
  const comHeader = (v: string) => new Headers({ "x-uazapi-secret": v })

  it("sem segredo no servidor RECUSA — nunca aceita", () => {
    delete process.env.UAZAPI_WEBHOOK_SECRET
    const r = verificarWebhookUazapi(comHeader("qualquer"), url)
    expect(r).toMatchObject({ ok: false, status: 403 })
  })

  it("aceita pelo header", () => {
    expect(verificarWebhookUazapi(comHeader("segredo-forte"), url).ok).toBe(true)
  })

  it("aceita pela query quando o painel nao permite header", () => {
    expect(verificarWebhookUazapi(new Headers(), `${url}?segredo=segredo-forte`).ok).toBe(true)
  })

  it("recusa segredo errado e ausente", () => {
    expect(verificarWebhookUazapi(comHeader("errado"), url).ok).toBe(false)
    expect(verificarWebhookUazapi(new Headers(), url).ok).toBe(false)
  })

  it("a rota verifica ANTES de ler o corpo", () => {
    const src = ler("src", "app", "api", "webhooks", "uazapi", "route.ts")
    expect(src.indexOf("verificarWebhookUazapi")).toBeLessThan(src.indexOf("req.json()"))
  })
})

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

describe("parseUazapiMessages", () => {
  it("le a instancia como conta externa — e o que liga o numero a loja", () => {
    const [m] = parseUazapiMessages({
      instance: "inst-centro",
      messages: [{ id: "m1", sender: "5551999@s.whatsapp.net", text: "oi", type: "text" }],
    })
    expect(m.contaExterna).toBe("inst-centro")
    expect(m.senderId).toBe("5551999")
    expect(m.channel).toBe("whatsapp")
    expect(m.text).toBe("oi")
  })

  it("ignora o eco do que o sistema enviou, mas guarda o que saiu do celular", () => {
    // O eco do envio pela API duplicaria a bolha: o envio ja gravou. Ja o que a
    // vendedora responde pelo CELULAR so existe no WhatsApp — sem isto, a
    // conversa na tela fica so com um lado.
    const msgs = parseUazapiMessages({
      instanceName: "i",
      messages: [
        { messageid: "m1", chatid: "555@s.whatsapp.net", sender: "555@s.whatsapp.net", text: "do cliente" },
        { messageid: "m2", chatid: "555@s.whatsapp.net", text: "pela API", fromMe: true, wasSentByApi: true },
        { messageid: "m3", chatid: "555@s.whatsapp.net", text: "do celular", fromMe: true },
      ],
    })
    expect(msgs.map((m) => [m.text, m.fromMe === true])).toEqual([
      ["do cliente", false],
      ["do celular", true],
    ])
    // Nos dois casos o contato da conversa e a cliente, nunca o proprio numero.
    expect(msgs.map((m) => m.senderId)).toEqual(["555", "555"])
  })

  it("acha a conta pelo nome da instancia, como o uazapi manda de verdade", () => {
    // O payload real traz `instanceName` e `owner`; procurar por `instance`
    // fazia toda mensagem ser descartada por "instancia nao conectada".
    const [msg] = parseUazapiMessages({
      EventType: "messages",
      instanceName: "vendas-ana",
      owner: "5541999990000",
      message: { messageid: "m1", chatid: "555@s.whatsapp.net", text: "oi" },
    })
    expect(msg?.contaExterna).toBe("vendas-ana")
  })

  it("foto e audio nao viram texto vazio, e a midia vai pelo id da mensagem", () => {
    // O uazapi escreve o tipo com maiuscula ("ImageMessage") e NAO manda URL
    // publica: quem resolve e `downloadMedia`, por /message/download.
    const [foto] = parseUazapiMessages({
      instanceName: "i",
      message: {
        messageid: "F1",
        chatid: "555@s.whatsapp.net",
        messageType: "ImageMessage",
        content: { mimetype: "image/jpeg" },
      },
    })
    expect(foto?.contentType).toBe("image")
    expect(foto?.mediaId).toBe("F1")
    expect(foto?.mediaMimeType).toBe("image/jpeg")
    expect(foto?.text).toBeUndefined()
  })

  it("remetente em LID responde pelo telefone, nunca pelo LID", () => {
    const [msg] = parseUazapiMessages({
      instanceName: "i",
      message: {
        messageid: "L1",
        chatid: "5541999990000@s.whatsapp.net",
        sender: "123456789012345@lid",
        sender_pn: "5541999990000@s.whatsapp.net",
        text: "oi",
      },
    })
    expect(msg?.senderId).toBe("5541999990000")
  })

  it("mensagem de grupo fica de fora", () => {
    expect(
      parseUazapiMessages({
        instanceName: "i",
        message: { messageid: "G1", chatid: "12036@g.us", isGroup: true, text: "oi" },
      })
    ).toEqual([])
  })

  it("reconhece o lote de historico", () => {
    expect(ehLoteDeHistorico({ EventType: "history", event: "messages", messages: [] })).toBe(true)
    expect(ehLoteDeHistorico({ EventType: "messages", message: {} })).toBe(false)
  })

  it("nao estoura em payload desconhecido — devolve vazio", () => {
    // Uma excecao aqui derrubaria o webhook inteiro por causa de um evento.
    expect(parseUazapiMessages({})).toEqual([])
    expect(parseUazapiMessages({ event: "connection", status: "close" })).toEqual([])
    expect(parseUazapiMessages({ messages: [{ semNada: true }] })).toEqual([])
  })

  it("aceita timestamp em segundos, milissegundos e ISO", () => {
    const em = (t: unknown) =>
      parseUazapiMessages({ instance: "i", messages: [{ id: "m", sender: "5@x", timestamp: t }] })[0]
        .timestamp
    expect(em(1755388800).getFullYear()).toBe(2025)
    expect(em(1755388800000).getFullYear()).toBe(2025)
    expect(em("2026-08-17T10:00:00Z").getFullYear()).toBe(2026)
    // Lixo nao vira Invalid Date gravado no banco.
    expect(Number.isNaN(em("nao e data").getTime())).toBe(false)
  })

  it("trata a URL da midia como o mediaId — o uazapi nao tem id para buscar", () => {
    const [m] = parseUazapiMessages({
      instance: "i",
      messages: [{ id: "m", sender: "5@x", type: "image", file: "https://cdn/x.jpg" }],
    })
    expect(m.mediaUrl).toBe("https://cdn/x.jpg")
    expect(m.mediaId).toBe("https://cdn/x.jpg")
    expect(m.contentType).toBe("image")
  })
})

// ---------------------------------------------------------------------------
// A incerteza fica confinada
// ---------------------------------------------------------------------------

describe("os pontos incertos da API ficam em um arquivo so", () => {
  it("config.ts marca o que nao foi confirmado", () => {
    const src = ler("src", "lib", "uazapi", "config.ts")
    expect(src).toContain("NAO CONFIRMADO")
    expect(src).toContain("CONFERIR")
  })

  it("nenhum caminho do uazapi esta escrito fora do config", () => {
    // Se um "/send/text" aparecer no adapter, conferir a documentacao deixa de
    // ser mudar um arquivo e vira cacar string pelo projeto.
    for (const arquivo of [
      ["src", "lib", "channels", "uazapi.ts"],
      ["src", "lib", "uazapi", "instancia.ts"],
      ["src", "app", "api", "webhooks", "uazapi", "route.ts"],
    ]) {
      expect(ler(...arquivo), arquivo.join("/")).not.toMatch(/["'`]\/(send|instance)\//)
    }
  })

  it("a base vem de ambiente — cada instalacao tem o proprio host", () => {
    const src = ler("src", "lib", "uazapi", "config.ts")
    expect(src).toContain("UAZAPI_BASE_URL")
  })

  it("o risco de banimento esta escrito onde quem configura ve", () => {
    // Decisao de negocio, nao detalhe tecnico: quem liga um numero no uazapi
    // precisa saber que ele pode ser banido.
    expect(ler("src", "lib", "uazapi", "config.ts")).toMatch(/BANIDO|banido/)
    expect(ler(".env.example")).toMatch(/BANIDO|banido/)
    expect(
      ler("src", "app", "(dashboard)", "settings", "integracoes", "page.tsx")
    ).toMatch(/banido/)
  })
})
