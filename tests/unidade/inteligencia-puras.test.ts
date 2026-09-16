import { describe, expect, it } from "vitest";
import { ehTranscrevivel, limparInvisiveis } from "@/lib/inteligencia";

describe("funções puras da inteligência consumidas por M1 (R2-IA-05, R2-IA-17)", () => {
  it("só ogg e mp4 são transcrevíveis, com ou sem parâmetro de codec", () => {
    expect(ehTranscrevivel("audio/ogg; codecs=opus")).toBe(true);
    expect(ehTranscrevivel("AUDIO/MP4")).toBe(true);
    expect(ehTranscrevivel("audio/mpeg")).toBe(false);
    expect(ehTranscrevivel(null)).toBe(false);
  });

  it("remove zero-width, bidi e tag chars e preserva quebra de linha e tab", () => {
    const sujo = "a​b‮c⁦d﻿e\u{E0041}f\n\tg";
    expect(limparInvisiveis(sujo)).toBe("abcdef\n\tg");
  });
});
