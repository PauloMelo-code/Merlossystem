import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Assinaturas e segredos da superficie de maquina (02-seguranca.md §12, §14).
 *
 * Mora na FUNDACAO de proposito: e o que permite ao pacote de webhooks (M5)
 * verificar HMAC sem depender do adaptador de canal (M1).
 *
 * Nenhuma comparacao de segredo usa `===` ou `!==` (a trava T17 varre por
 * `(SECRET|TOKEN).*(===|!==)`): tudo passa por `timingSafeEqual` sobre o
 * SHA-256 dos dois lados, o que tambem resolve o vazamento de tamanho — dois
 * digests tem sempre 32 bytes, entao a comparacao nunca aborta por tamanho
 * diferente antes de comparar byte a byte.
 */

/** SHA-256 em hex. E tambem o formato de `lojas_integracoes.segredo_webhook_hash`. */
export function hashDeSegredo(valor: string): string {
  return createHash("sha256").update(valor, "utf8").digest("hex");
}

/**
 * Hash fixo, gerado uma vez por processo. E contra ele que a comparacao roda
 * quando NAO existe segredo carregado (integracao inexistente ou revogada):
 * sem isso da para descobrir quais UUIDs existem comparando forma e tempo das
 * respostas (§12, isonomia da recusa de maquina).
 */
const HASH_INEXISTENTE = hashDeSegredo(randomBytes(32).toString("hex"));

/** Compara dois valores em tempo constante, via digest de tamanho fixo. */
export function compararEmTempoConstante(a: string | null, b: string | null): boolean {
  const esquerda = createHash("sha256").update(a ?? "", "utf8").digest();
  const direita = createHash("sha256").update(b ?? "", "utf8").digest();
  const iguais = timingSafeEqual(esquerda, direita);
  // Valor ausente nunca autentica, mesmo que os dois lados sejam nulos.
  return iguais && a !== null && b !== null && a.length > 0;
}

/**
 * Segredo por integracao (uazapi): o cliente manda o segredo em CABECALHO e o
 * banco guarda o SHA-256. Compara hash com hash, nunca segredo com segredo.
 *
 * `hashGravado` nulo cai no hash inexistente: a comparacao roda igual, gasta o
 * mesmo tempo e devolve falso.
 */
export function conferirSegredoPorHash(
  fornecido: string | null,
  hashGravado: string | null,
): boolean {
  const alvo = hashGravado ?? HASH_INEXISTENTE;
  const calculado = fornecido === null ? HASH_INEXISTENTE : hashDeSegredo(fornecido);
  return compararEmTempoConstante(calculado, alvo) && hashGravado !== null;
}

/**
 * HMAC-SHA256 do CORPO CRU com `META_APP_SECRET`, cabecalho
 * `X-Hub-Signature-256: sha256=<hex>` (INV-44/45).
 *
 * Segredo ausente no ambiente => RECUSA, nunca "aceita porque nao configurou"
 * (INV-43). A comparacao roda mesmo assim, para a recusa custar o mesmo tempo.
 */
export function conferirAssinaturaMeta(corpoCru: string, cabecalho: string | null): boolean {
  const segredo = env.META_APP_SECRET;
  const enviada = (cabecalho ?? "").replace(/^sha256=/i, "");
  const esperada = createHmac("sha256", segredo ?? HASH_INEXISTENTE)
    .update(corpoCru, "utf8")
    .digest("hex");
  return compararEmTempoConstante(enviada, esperada) && segredo !== undefined;
}

/** Token de challenge do GET de verificacao, POR CANAL (nunca compartilhado). */
export function conferirTokenDeChallenge(
  recebido: string | null,
  esperado: string | undefined,
): boolean {
  return compararEmTempoConstante(recebido, esperado ?? null) && esperado !== undefined;
}

/**
 * `state` do OAuth Bling (§12, D-11): HMAC(`INTEGRATIONS_STATE_KEY`,
 * `nonce.expira.usuarioId`), validade de 5 minutos.
 *
 * Mora aqui, e nao no modulo de integracoes, pelo mesmo motivo do HMAC de
 * webhook: e borda, e a fundacao e quem prova que ele recusa reuso, expirado,
 * adulterado e de outra sessao. O USO UNICO e do chamador, com
 * `marcarUmaVez()` (Redis), e a amarra com o cookie `__Host-merlo.oauth_nonce`
 * tambem.
 */
export const VALIDADE_ESTADO_MS = 5 * 60 * 1000;

export type Estado = { nonce: string; expira: number; usuarioId: string };

function assinar(carga: string): string {
  return createHmac("sha256", env.INTEGRATIONS_STATE_KEY).update(carga, "utf8").digest("hex");
}

export function assinarEstado(usuarioId: string, agora = Date.now()): { state: string; nonce: string } {
  const nonce = randomBytes(16).toString("hex");
  const expira = agora + VALIDADE_ESTADO_MS;
  const carga = `${nonce}.${expira}.${usuarioId}`;
  return { state: `${carga}.${assinar(carga)}`, nonce };
}

/** Devolve `null` para adulterado, expirado ou malformado — sem dizer qual. */
export function conferirEstado(state: string | null, agora = Date.now()): Estado | null {
  if (!state) return null;
  const partes = state.split(".");
  if (partes.length !== 4) return null;
  const [nonce = "", expiraTexto = "", usuarioId = "", assinatura = ""] = partes;
  const carga = `${nonce}.${expiraTexto}.${usuarioId}`;
  if (!compararEmTempoConstante(assinatura, assinar(carga))) return null;
  const expira = Number(expiraTexto);
  if (!Number.isFinite(expira) || expira <= agora) return null;
  if (nonce.length === 0 || usuarioId.length === 0) return null;
  return { nonce, expira, usuarioId };
}
