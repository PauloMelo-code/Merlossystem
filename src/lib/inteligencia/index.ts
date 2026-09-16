/**
 * API pública do domínio de inteligência — dono: R2-C (acrescenta o resto).
 * A fundação cria só as duas funções PURAS que M1 e a base de conhecimento
 * consomem antes do pacote (ADRs 0046 e 0049).
 */

/** Formatos que o Whisper aceita e a casa transcreve (R2-IA-17). */
const FORMATOS_TRANSCREVIVEIS = ["audio/ogg", "audio/mp4"] as const;

/** `audio/ogg; codecs=opus` conta como `audio/ogg`. */
export function ehTranscrevivel(mime: string | null | undefined): boolean {
  const base = (mime ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return (FORMATOS_TRANSCREVIVEIS as readonly string[]).includes(base);
}

/**
 * Invisíveis de R2-IA-05: zero-width (U+200B–U+200F, U+2060–U+2064, U+FEFF),
 * bidi (U+202A–U+202E, U+2066–U+2069) e tag chars (U+E0000–U+E007F).
 * Não toca `\n` nem `\t`.
 */
const INVISIVEIS = /[​-‏⁠-⁤﻿‪-‮⁦-⁩\u{E0000}-\u{E007F}]/gu;

export function limparInvisiveis(texto: string): string {
  return texto.replace(INVISIVEIS, "");
}
