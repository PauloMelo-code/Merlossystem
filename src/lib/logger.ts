import pino from "pino";
import { env } from "@/lib/env";
import type { OrigemDeAcao } from "@/types/comum";

/**
 * Log estruturado do app e do worker (03-arquitetura.md §14.3).
 *
 * Nunca logar corpo cru de webhook — só `{ provedor, contaId, eventoId, tamanho }`.
 * Nenhum segredo em URL, query, nome de arquivo de backup ou `argv`.
 */

/**
 * Campos que nunca podem sair no log. `code` está na lista porque é o nome do
 * campo do código TOTP do Better Auth: logar a requisição inteira de
 * `/two-factor/verify-totp` gravaria o segundo fator em texto plano.
 */
const CAMPOS_SENSIVEIS = [
  "password",
  "newPassword",
  "currentPassword",
  "token",
  "code",
  "secret",
  "authorization",
  "cookie",
  "credenciais",
  // R2 (pagamentos, IA, canais extras). Nunca nome com hífen: quebra o redact no boot.
  "accessToken",
  "segredoWebhook",
  "pagadorCpf",
  "pagadorEmail",
  "cpf",
  "apiKey",
  "api_key",
  "access_token",
  "refresh_token",
  "page_access_token",
  "client_secret",
  "auth_code",
] as const;

// Três níveis de profundidade cobrem `campo`, `corpo.campo` e `req.headers.campo`,
// que são as formas em que esses valores chegam ao log.
const CAMINHOS_REDIGIDOS = CAMPOS_SENSIVEIS.flatMap((campo) => [
  campo,
  `*.${campo}`,
  `*.*.${campo}`,
]);

export const logger = pino({
  level: env.LOG_NIVEL,
  redact: { paths: CAMINHOS_REDIGIDOS, censor: "[redigido]" },
});

/** Campos fixos de todo log de requisição, job ou webhook. */
export type ContextoDeLog = {
  requisicaoId: string;
  origem: OrigemDeAcao;
  lojaId?: string | null;
  usuarioId?: string | null;
};

/**
 * Logger filho com os campos fixos já presos. Use um por requisição ou por job:
 * é o que permite seguir uma conversa inteira pelo `requisicaoId`.
 */
export function logComContexto(contexto: ContextoDeLog) {
  return logger.child(contexto);
}
