import { createHash, createHmac, randomBytes } from "node:crypto";

/**
 * Geração e hash dos segredos de uso único (02-seguranca.md §9.2, §13, §17).
 *
 * Módulo PURO de propósito — sem `server-only`, sem `db`, sem `env`. É o que
 * permite `scripts/primeiro-dono.ts` usar exatamente o mesmo token e o mesmo
 * hash que a aplicação, sem arrastar o runtime do Next para dentro de um
 * script de linha de comando.
 *
 * Nada de valor fica em claro no banco (K3): convite, reset e troca de e-mail
 * guardam SHA-256; o e-mail na trilha guarda HMAC.
 */

export const VALIDADE_CONVITE_HORAS = 24;
export const CIENCIA_ADMIN_V1 = "CIENCIA_ADMIN_V1";

/** 32 bytes de CSPRNG. É o token que vai no link, uma vez, e some. */
export function novoToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * FRAGMENTO (`#t=`), nunca query nem segmento de rota: scanner de e-mail
 * corporativo abre o link com GET, e o que está depois do `#` não sai do
 * navegador (F12/G15).
 */
export function linkComToken(appUrl: string, caminho: string, token: string): string {
  return `${appUrl}${caminho}#t=${token}`;
}

/** O e-mail NUNCA é gravado em claro em `auth_eventos` (01-dados.md §7.1). */
export function hashEmailCom(chave: string, email: string | null | undefined): string | null {
  if (!email) return null;
  return createHmac("sha256", chave).update(email.trim().toLowerCase()).digest("hex");
}
