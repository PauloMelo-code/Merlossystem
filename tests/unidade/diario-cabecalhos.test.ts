import { describe, expect, it } from "vitest";
import { cabecalhosDoDiario } from "@/lib/integracoes";

describe("cabecalhosDoDiario", () => {
  it("guarda a lista branca e só a PRESENÇA das assinaturas (Meta e TikTok)", () => {
    const h = new Headers({
      "content-type": "application/json",
      authorization: "Bearer segredo",
      cookie: "sessao=1",
      "x-hub-signature-256": "sha256=abc",
      "tiktok-signature": "t=1,s=def",
    });
    expect(cabecalhosDoDiario(h)).toEqual({
      "content-type": "application/json",
      "x-hub-signature-256": "presente",
      "tiktok-signature": "presente",
    });
  });

  it("sem assinatura, nenhuma marca de presença", () => {
    expect(cabecalhosDoDiario(new Headers({ "user-agent": "x" }))).toEqual({ "user-agent": "x" });
  });
});
