import "server-only";
import { env } from "@/lib/env";
import { ErroDePermissao } from "@/lib/erros";

/**
 * Origem e CSRF (02-seguranca.md §14.3, REQ-J1/J3/J7).
 *
 * A origem esperada sai SEMPRE de `env.APP_URL` — nunca de `request.url`,
 * `nextUrl.host`, `Host` ou `X-Forwarded-Host`: atrás do Traefik esses valores
 * são do proxy, não do cliente (trava T21).
 */

export function origemEsperada(): string {
  return new URL(env.APP_URL).origin;
}

/**
 * Exige `Origin` igual à esperada OU `Sec-Fetch-Site: same-origin`.
 * `Origin` **ausente** recusa: o Next deixa passar requisição sem `Origin` só
 * com um aviso (N2) e `Origin: null` já burlou a proteção nativa
 * (CVE-2026-27978).
 */
export function conferirOrigem(cabecalhos: Headers): void {
  const origem = cabecalhos.get("origin");
  if (origem !== null && origem !== "null" && origem === origemEsperada()) return;
  if (origem === null && cabecalhos.get("sec-fetch-site") === "same-origin") return;
  throw new ErroDePermissao("Requisição recusada: origem inválida.");
}

/**
 * `callbackURL`, `redirectTo` e `?volta=` só aceitam caminho relativo interno.
 * `https://evil.example`, `//evil.example` e `/\evil.example` caem em `/`
 * (CVE-2025-53535, INV-40).
 */
const CAMINHO_INTERNO = /^\/(?!\/)[\w\-/]*$/;

export function destinoSeguro(pedido: string | null | undefined, padrao = "/"): string {
  if (!pedido) return padrao;
  if (pedido.includes("\\") || pedido.startsWith("//")) return padrao;
  return CAMINHO_INTERNO.test(pedido) ? pedido : padrao;
}
