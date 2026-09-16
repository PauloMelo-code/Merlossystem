import { describe, expect, it } from "vitest";
import { interpretarInstagram } from "@/lib/canais/instagram";
import { interpretarUazapi } from "@/lib/canais/uazapi";
import { criarWhatsappOficial, interpretarWhatsappOficial } from "@/lib/canais/whatsapp-oficial";
import { criarUazapi } from "@/lib/canais/uazapi";
import type { ClienteHttp } from "@/lib/canais/tipos";

/**
 * Parser de webhook dos 3 provedores com payload FIXO (pacote M1). O parser
 * recebe o corpo cru, nunca lança, grava `deMim`, registra descarte e junta
 * vários anexos numa mensagem só.
 */

const WHATSAPP = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WABA1",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "5551999990000", phone_number_id: "PN-CENTRO" },
            contacts: [{ wa_id: "5551988887777", profile: { name: "Maria" } }],
            messages: [
              {
                from: "5551988887777",
                id: "wamid.TEXTO",
                timestamp: "1757000000",
                type: "text",
                text: { body: "Tem o vestido no P?" },
                context: { id: "wamid.CITADA" },
              },
              {
                from: "5551988887777",
                id: "wamid.FOTO",
                timestamp: "1757000001",
                type: "image",
                image: { id: "MIDIA-1", mime_type: "image/jpeg", caption: "esse aqui" },
              },
              { from: "5551988887777", id: "wamid.REACAO", timestamp: "1757000002", type: "reaction", reaction: {} },
            ],
            statuses: [
              { id: "wamid.SAIDA", status: "delivered", timestamp: "1757000003" },
              {
                id: "wamid.RUIM",
                status: "failed",
                timestamp: "1757000004",
                errors: [{ code: 131047, title: "Re-engagement message", error_data: { details: "Mais de 24h" } }],
              },
            ],
          },
        },
        {
          field: "messages",
          value: {
            metadata: { phone_number_id: "PN-SHOPPING" },
            messages: [{ from: "5551977776666", id: "wamid.OUTRA", timestamp: "1757000005", type: "text", text: { body: "oi" } }],
          },
        },
      ],
    },
  ],
});

describe("WhatsApp oficial", () => {
  const r = interpretarWhatsappOficial(WHATSAPP);

  it("normaliza texto com nome, citação e instante do provedor", () => {
    expect(r.mensagens[0]).toMatchObject({
      contaExterna: "PN-CENTRO",
      externoId: "wamid.TEXTO",
      remetenteId: "5551988887777",
      remetenteNome: "Maria",
      tipo: "texto",
      texto: "Tem o vestido no P?",
      respondendoA: "wamid.CITADA",
      deMim: false,
    });
    expect(r.mensagens[0]!.ocorridoEm.toISOString()).toBe(new Date(1757000000 * 1000).toISOString());
  });

  it("mídia chega como id do provedor (nunca URL) com legenda", () => {
    expect(r.mensagens[1]).toMatchObject({
      tipo: "imagem",
      texto: "esse aqui",
      midias: [{ idExterno: "MIDIA-1", mime: "image/jpeg", legenda: "esse aqui" }],
    });
  });

  it("lote com contas diferentes: cada mensagem com a SUA conta", () => {
    expect(r.mensagens.map((m) => m.contaExterna)).toEqual(["PN-CENTRO", "PN-CENTRO", "PN-SHOPPING"]);
  });

  it("reação é descarte registrado, com o tipo original", () => {
    expect(r.descartados).toEqual([{ motivo: "tipo_nao_suportado", tipoOriginal: "reaction" }]);
  });

  it("recibos: delivered → entregue; failed → falhou com motivo", () => {
    expect(r.status).toEqual([
      expect.objectContaining({ externoId: "wamid.SAIDA", status: "entregue" }),
      expect.objectContaining({ externoId: "wamid.RUIM", status: "falhou", motivo: "Mais de 24h" }),
    ]);
  });

  it("corpo ilegível devolve listas vazias sem lançar", () => {
    for (const lixo of ["", "não é json", "[]", "null", '{"entry":"x"}']) {
      expect(interpretarWhatsappOficial(lixo)).toEqual({ mensagens: [], status: [], descartados: [] });
    }
  });
});

const INSTAGRAM = JSON.stringify({
  object: "instagram",
  entry: [
    {
      id: "IG-LOJA",
      time: 1757000000000,
      messaging: [
        { sender: { id: "IGSID-1" }, recipient: { id: "IG-LOJA" }, timestamp: 1757000000000, message: { mid: "mid.T", text: "Oi!" } },
        {
          sender: { id: "IGSID-1" },
          recipient: { id: "IG-LOJA" },
          timestamp: 1757000001000,
          message: {
            mid: "mid.FOTOS",
            attachments: [
              { type: "image", payload: { url: "https://lookaside.fbsbx.com/a.jpg" } },
              { type: "image", payload: { url: "https://lookaside.fbsbx.com/b.jpg" } },
            ],
          },
        },
        { sender: { id: "IG-LOJA" }, recipient: { id: "IGSID-1" }, timestamp: 1757000002000, message: { mid: "mid.ECO", text: "oi", is_echo: true } },
        { sender: { id: "IGSID-1" }, recipient: { id: "IG-LOJA" }, timestamp: 1757000003000, read: { mid: "mid.SAIDA" } },
        { sender: { id: "IGSID-1" }, recipient: { id: "IG-LOJA" }, timestamp: 1757000004000, reaction: { mid: "mid.T" } },
      ],
    },
  ],
});

describe("Instagram", () => {
  const r = interpretarInstagram(INSTAGRAM);

  it("texto com a conta que recebeu (entry.id)", () => {
    expect(r.mensagens[0]).toMatchObject({ contaExterna: "IG-LOJA", externoId: "mid.T", remetenteId: "IGSID-1", texto: "Oi!" });
  });

  it("vários anexos no mesmo mid = UMA mensagem com N mídias", () => {
    expect(r.mensagens).toHaveLength(2);
    expect(r.mensagens[1]!.tipo).toBe("imagem");
    expect(r.mensagens[1]!.midias).toHaveLength(2);
  });

  it("eco de página e reação são descartes registrados; leitura vira status", () => {
    expect(r.descartados).toEqual([
      { motivo: "eco_de_pagina" },
      { motivo: "tipo_nao_suportado", tipoOriginal: "reaction" },
    ]);
    expect(r.status).toEqual([expect.objectContaining({ externoId: "mid.SAIDA", status: "lida" })]);
  });

  it("ilegível não lança", () => {
    expect(interpretarInstagram("{")).toEqual({ mensagens: [], status: [], descartados: [] });
  });
});

describe("uazapi", () => {
  const base = { EventType: "messages", instanceName: "vendas-centro" };

  it("mensagem recebida", () => {
    const r = interpretarUazapi(
      JSON.stringify({
        ...base,
        message: {
          id: "5551999990000:ABC123",
          messageid: "ABC123",
          chatid: "5551988887777@s.whatsapp.net",
          sender: "5551988887777@s.whatsapp.net",
          senderName: "Maria",
          fromMe: false,
          messageType: "Conversation",
          text: "tem no P?",
          messageTimestamp: 1757000000000,
        },
      }),
    );
    expect(r.mensagens[0]).toMatchObject({
      contaExterna: "vendas-centro",
      externoId: "ABC123",
      remetenteId: "5551988887777",
      remetenteNome: "Maria",
      tipo: "texto",
      deMim: false,
    });
  });

  it("deMim (enviada pelo aparelho) é GRAVADA, com o contato como destino", () => {
    const r = interpretarUazapi(
      JSON.stringify({
        ...base,
        message: {
          messageid: "EU1",
          chatid: "5551988887777@s.whatsapp.net",
          sender: "5551999990000@s.whatsapp.net",
          fromMe: true,
          messageType: "Conversation",
          text: "já separei",
        },
      }),
    );
    expect(r.mensagens[0]).toMatchObject({ deMim: true, remetenteId: "5551988887777" });
    expect(r.mensagens[0]!.remetenteNome).toBeUndefined();
  });

  it("eco do envio pela API e grupo são descartes registrados", () => {
    const eco = interpretarUazapi(
      JSON.stringify({ ...base, message: { messageid: "API1", chatid: "5551@s.whatsapp.net", fromMe: true, wasSentByApi: true, text: "x" } }),
    );
    expect(eco.descartados).toEqual([{ motivo: "eco_de_pagina", tipoOriginal: "eco_da_api" }]);
    const grupo = interpretarUazapi(
      JSON.stringify({ ...base, message: { messageid: "G1", chatid: "120363@g.us", isGroup: true, text: "oi" } }),
    );
    expect(grupo.descartados).toEqual([{ motivo: "grupo" }]);
    expect(grupo.mensagens).toHaveLength(0);
  });

  it("mídia chega por URL; tipo desconhecido é descarte", () => {
    const foto = interpretarUazapi(
      JSON.stringify({
        ...base,
        message: {
          messageid: "F1",
          chatid: "5551988887777@s.whatsapp.net",
          messageType: "ImageMessage",
          fileURL: "https://mmg.whatsapp.net/f.jpg",
          mimetype: "image/jpeg",
        },
      }),
    );
    expect(foto.mensagens[0]).toMatchObject({ tipo: "imagem", midias: [{ url: "https://mmg.whatsapp.net/f.jpg", mime: "image/jpeg" }] });
    const enquete = interpretarUazapi(
      JSON.stringify({ ...base, message: { messageid: "P1", chatid: "5551988887777@s.whatsapp.net", messageType: "PollCreationMessage" } }),
    );
    expect(enquete.descartados).toEqual([{ motivo: "tipo_nao_suportado", tipoOriginal: "PollCreationMessage" }]);
  });

  it("recibo de leitura e sessão do aparelho", () => {
    const lido = interpretarUazapi(
      JSON.stringify({ EventType: "messages_update", event: { Type: "Read", MessageIDs: ["ABC", "owner:DEF"] } }),
    );
    expect(lido.status.map((s) => [s.externoId, s.status])).toEqual([
      ["ABC", "lida"],
      ["DEF", "lida"],
    ]);
    const sessao = interpretarUazapi(JSON.stringify({ EventType: "connection", instance: { status: "disconnected" } }));
    expect(sessao.sessao).toEqual({ estado: "desconectada" });
  });

  it("ilegível não lança", () => {
    expect(interpretarUazapi("<html>")).toEqual({ mensagens: [], status: [], descartados: [] });
  });
});

describe("adaptadores: envio pela porta HTTP injetada", () => {
  const chamadas: { url: string; corpo?: string; cabecalhos?: Record<string, string> }[] = [];
  const http =
    (status: number, corpo: unknown): ClienteHttp =>
    async (url, opcoes) => {
      chamadas.push({ url, ...(opcoes.corpo ? { corpo: opcoes.corpo } : {}), ...(opcoes.cabecalhos ? { cabecalhos: opcoes.cabecalhos } : {}) });
      return { status, tipo: "application/json", bytes: Buffer.from(JSON.stringify(corpo)) };
    };

  it("oficial: texto pela conta, versão da Graph vinda de fora, id devolvido", async () => {
    const a = criarWhatsappOficial({
      accessToken: "tk",
      phoneNumberId: "PN-CENTRO",
      versaoGraph: "v23.0",
      http: http(200, { messages: [{ id: "wamid.NOVO" }] }),
      conferirAssinatura: () => true,
    });
    expect(await a.enviarTexto("5551988887777", "oi")).toEqual({ ok: true, externoId: "wamid.NOVO" });
    expect(chamadas.at(-1)!.url).toBe("https://graph.facebook.com/v23.0/PN-CENTRO/messages");
    expect(chamadas.at(-1)!.cabecalhos!.authorization).toBe("Bearer tk");
    expect(a.exigeJanela24h).toBe(true);
    expect(a.enviarModelo).toBeDefined();
  });

  it("oficial: 400 é permanente, 503 é transitório", async () => {
    const base = { accessToken: "tk", phoneNumberId: "PN", versaoGraph: "v23.0", conferirAssinatura: () => true };
    const recusa = criarWhatsappOficial({ ...base, http: http(400, { error: { message: "inválido" } }) });
    expect(await recusa.enviarTexto("1", "x")).toEqual({ ok: false, motivo: "inválido", permanente: true });
    const fora = criarWhatsappOficial({ ...base, http: http(503, {}) });
    expect(await fora.enviarTexto("1", "x")).toMatchObject({ ok: false, permanente: false });
  });

  it("erro de rede vira resultado, não exceção", async () => {
    const a = criarWhatsappOficial({
      accessToken: "tk",
      phoneNumberId: "PN",
      versaoGraph: "v23.0",
      http: async () => {
        throw new Error("ECONNRESET");
      },
      conferirAssinatura: () => true,
    });
    expect(await a.enviarTexto("1", "x")).toEqual({ ok: false, motivo: "ECONNRESET", permanente: false });
  });

  it("uazapi: sem enviarModelo (capacidade = presença do método) e sem janela", async () => {
    const a = criarUazapi({ token: "tk", base: "https://uazapi.exemplo.com/", http: http(200, { messageid: "U1" }), conferirAssinatura: () => true });
    expect(a.enviarModelo).toBeUndefined();
    expect(a.exigeJanela24h).toBe(false);
    expect(await a.enviarTexto("5551988887777", "oi")).toEqual({ ok: true, externoId: "U1" });
    expect(chamadas.at(-1)!.url).toBe("https://uazapi.exemplo.com/send/text");
    expect(chamadas.at(-1)!.cabecalhos!.token).toBe("tk");
  });
});
