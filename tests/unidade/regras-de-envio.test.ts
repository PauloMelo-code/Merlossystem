import { describe, expect, it } from "vitest";
import {
  mensagemDaJanela,
  recusaDeMidia,
  recusaDeTexto,
  situacaoDaJanela,
  type OrigemDoEnvio,
  type SituacaoDaJanela,
} from "@/lib/canais/regras-de-envio";

/** Regras de envio por provedor (ADR 0056): fonte única da janela e dos tetos. */
const AGORA = new Date("2026-09-16T12:00:00Z");
const horasAtras = (h: number) => new Date(AGORA.getTime() - h * 3_600_000);

describe("situacaoDaJanela", () => {
  const casos: [string, number | null, OrigemDoEnvio, SituacaoDaJanela][] = [
    ["whatsapp_oficial", 2, "pessoa", "aberta"],
    ["whatsapp_oficial", 30, "pessoa", "so_modelo"],
    ["whatsapp_oficial", null, "automatica", "so_modelo"],
    ["uazapi", 500, "automatica", "aberta"],
    ["uazapi", null, "pessoa", "aberta"],
    ["instagram", 2, "pessoa", "aberta"],
    ["instagram", 30, "pessoa", "fechada"],
    ["facebook", 2, "pessoa", "aberta"],
    ["facebook", 2, "automatica", "aberta"],
    ["facebook", 30, "pessoa", "so_agente_humano"],
    ["facebook", 30, "automatica", "fechada"],
    ["facebook", 24 * 8, "pessoa", "fechada"],
    ["facebook", 24 * 8, "automatica", "fechada"],
    ["tiktok", 47, "pessoa", "aberta"],
    ["tiktok", 49, "pessoa", "fechada"],
    ["tiktok", null, "pessoa", "fechada"],
    ["bling", 1, "pessoa", "fechada"],
    ["tiktok_shop", 1, "pessoa", "fechada"],
    ["x", 1, "automatica", "fechada"],
  ];

  it.each(casos)("%s há %s h (%s) -> %s", (provedor, horas, origem, esperado) => {
    const entrada = horas === null ? null : horasAtras(horas);
    expect(situacaoDaJanela(provedor, entrada, origem, AGORA)).toBe(esperado);
  });
});

describe("mensagemDaJanela (microcopia exata do composer)", () => {
  it("janela aberta não tem texto", () => {
    expect(mensagemDaJanela("instagram", horasAtras(1), "pessoa", AGORA)).toBeNull();
  });

  it.each([
    [
      "whatsapp_oficial",
      30,
      "pessoa",
      "Passaram 24h desde a última mensagem da cliente. Só dá para enviar um modelo aprovado.",
    ],
    [
      "facebook",
      30,
      "pessoa",
      "Passaram 24 horas desde a última mensagem da cliente. Sua resposta vai marcada como atendimento humano e só vale até 7 dias depois dela.",
    ],
    [
      "facebook",
      30,
      "automatica",
      "Passaram 24 horas desde a última mensagem da cliente. Agora o Messenger só aceita resposta digitada por alguém da equipe.",
    ],
    [
      "facebook",
      24 * 8,
      "pessoa",
      "Passaram 7 dias desde a última mensagem da cliente. O Messenger só deixa responder quando ela escrever de novo.",
    ],
    [
      "tiktok",
      49,
      "pessoa",
      "Passaram 48 horas desde a última mensagem da cliente. O TikTok só deixa responder quando ela escrever de novo.",
    ],
    [
      "instagram",
      30,
      "pessoa",
      "Passaram 24 horas desde a última mensagem da cliente. O Instagram só deixa responder quando ela escrever de novo.",
    ],
  ] as const)("%s há %s h (%s)", (provedor, horas, origem, texto) => {
    expect(mensagemDaJanela(provedor, horasAtras(horas), origem, AGORA)).toBe(texto);
  });

  it("sem entrada da cliente", () => {
    expect(mensagemDaJanela("tiktok", null, "pessoa", AGORA)).toBe(
      "A cliente ainda não escreveu por este canal. O TikTok só deixa responder depois que ela escrever.",
    );
  });

  it("provedor sem regra", () => {
    expect(mensagemDaJanela("bling", horasAtras(1), "pessoa", AGORA)).toBe("Este canal não permite enviar mensagem.");
  });
});

describe("recusaDeMidia", () => {
  const MB = 1024 * 1024;
  const recusaTiktok = "O TikTok só aceita uma imagem JPG ou PNG de até 3 MB por mensagem, sem texto junto.";

  it("TikTok aceita um PNG de 2 MB sem legenda", () => {
    expect(recusaDeMidia("tiktok", [{ mime: "image/png", bytes: 2 * MB }], false)).toBeNull();
  });

  it.each([
    ["MP4", [{ mime: "video/mp4", bytes: MB }], false],
    ["PNG de 4 MB", [{ mime: "image/png", bytes: 4 * MB }], false],
    ["duas imagens", [{ mime: "image/png", bytes: MB }, { mime: "image/jpeg", bytes: MB }], false],
    ["imagem com legenda", [{ mime: "image/jpeg", bytes: MB }], true],
  ] as const)("TikTok recusa %s", (_nome, anexos, legenda) => {
    expect(recusaDeMidia("tiktok", anexos, legenda)).toBe(recusaTiktok);
  });

  it("Messenger recusa 26 MB", () => {
    expect(recusaDeMidia("facebook", [{ mime: "video/mp4", bytes: 26 * MB }], true)).toBe(
      "O Messenger aceita anexos de até 25 MB.",
    );
  });

  it("provedor fora da tabela: só o teto da casa", () => {
    expect(recusaDeMidia("uazapi", [{ mime: "video/mp4", bytes: 90 * MB }], true)).toBeNull();
  });
});

describe("recusaDeTexto", () => {
  it("Messenger recusa 2.001 caracteres", () => {
    expect(recusaDeTexto("facebook", "a".repeat(2001))).toBe("O Messenger aceita até 2.000 caracteres por mensagem.");
    expect(recusaDeTexto("facebook", "a".repeat(2000))).toBeNull();
  });

  it("TikTok recusa 1.001 caracteres", () => {
    expect(recusaDeTexto("tiktok", "a".repeat(1001))).toBe("O TikTok aceita até 1.000 caracteres por mensagem.");
  });

  it("uazapi não tem teto aqui", () => {
    expect(recusaDeTexto("uazapi", "a".repeat(50_000))).toBeNull();
  });
});
