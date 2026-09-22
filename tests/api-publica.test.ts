/**
 * A regra que sustenta a autenticacao da API: rota nova nasce PROTEGIDA.
 *
 * Este teste varre `src/app/api/**` no disco e exige que toda rota exija
 * sessao, exceto as cinco excecoes conhecidas. Criar uma rota nova sem pensar
 * em auth nao quebra nada; criar uma rota nova e adiciona-la a lista publica
 * sem justificar quebra aqui.
 */
import { describe, it, expect } from "vitest"
import { ehApiPublica } from "@/lib/api-publica"
import { listarRotas } from "./rotas"

const rotasNoDisco = () => listarRotas().map((r) => r.rota)

const PUBLICAS_ESPERADAS = [
  "/api/auth/[...nextauth]",
  "/api/register",
  "/api/alerts/check",
  "/api/transcription",
  "/api/webhooks/whatsapp",
  "/api/webhooks/instagram",
  "/api/webhooks/facebook",
  "/api/webhooks/tiktok",
  "/api/webhooks/uazapi",
  "/api/webhooks/payments",
  "/api/integracoes/bling/callback",
  "/api/integracoes/tiktok/callback",
]

describe("superficie publica da API", () => {
  const rotas = rotasNoDisco()

  it("encontra as 73 rotas", () => {
    expect(rotas.length).toBe(73)
  })

  it("as publicas sao exatamente as 12 esperadas", () => {
    const publicas = rotas.filter(ehApiPublica).sort()
    expect(publicas).toEqual([...PUBLICAS_ESPERADAS].sort())
  })

  it("as outras 61 exigem sessao", () => {
    const protegidas = rotas.filter((r) => !ehApiPublica(r))
    expect(protegidas.length).toBe(61)
    expect(protegidas).toContain("/api/contacts/[id]")
    expect(protegidas).toContain("/api/lgpd")
  })

  it.each([
    "/api/contacts",
    "/api/contacts/[id]",
    "/api/lgpd",
    "/api/orders",
    "/api/messages",
    "/api/analytics",
    "/api/activity-logs",
  ])("%s nao esta na lista publica", (rota) => {
    expect(ehApiPublica(rota)).toBe(false)
  })

  it("nao libera por prefixo parecido", () => {
    expect(ehApiPublica("/api/registerX")).toBe(false)
    expect(ehApiPublica("/api/alerts")).toBe(false)
    expect(ehApiPublica("/api/alerts/check/extra")).toBe(false)
    expect(ehApiPublica("/api/authorization")).toBe(false)
  })
})
