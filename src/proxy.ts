import { NextResponse, type NextRequest } from "next/server";
import { cspDePagina, cspEndurecidaEmProva } from "@/lib/seguranca/csp";

/**
 * Proxy (o antigo middleware) — 03-arquitetura.md §3, 02-seguranca.md §14.2.
 *
 * Faz DUAS coisas e nada mais: injeta o nonce da CSP e redireciona quem nao
 * tem cookie de sessao. NAO importa `db` nem `auth`, e NAO decide acesso
 * (N1, A5, CVE-2025-29927, CVE-2026-64642, CVE-2026-45109) — a presenca de um
 * cookie nao prova nada; quem decide e o portao, dentro da page e da action.
 *
 * Por que `src/proxy.ts`: com a pasta `src/`, e ali que o Next procura.
 */

/** Prefixo de cookie do Better Auth: `merlo`, com `__Secure-` em producao. */
const COOKIES_DE_SESSAO = ["merlo.session_token", "__Secure-merlo.session_token"];

/** Area publica (04-ui.md §5.1). Nenhuma tem segmento `[token]`. */
const CAMINHOS_PUBLICOS = [
  "/entrar",
  "/primeiro-acesso",
  "/esqueci-a-senha",
  "/redefinir-senha",
];

function ehPublico(caminho: string): boolean {
  return CAMINHOS_PUBLICOS.some((p) => caminho === p || caminho.startsWith(`${p}/`));
}

function temCookieDeSessao(req: NextRequest): boolean {
  return COOKIES_DE_SESSAO.some((nome) => req.cookies.has(nome));
}

/** 16 bytes em base64: o formato que o `nonce-` da CSP espera. */
function novoNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export function proxy(req: NextRequest): NextResponse {
  const nonce = novoNonce();
  const { pathname, search } = req.nextUrl;

  const cabecalhos = new Headers(req.headers);
  // O layout le este cabecalho para carimbar o nonce no <script> do Next.
  cabecalhos.set("x-nonce", nonce);

  const resposta =
    ehPublico(pathname) || temCookieDeSessao(req)
      ? NextResponse.next({ request: { headers: cabecalhos } })
      : NextResponse.redirect(destinoDeEntrada(req, pathname, search));

  resposta.headers.set("content-security-policy", cspDePagina(nonce));
  // Em paralelo, so para endurecer (strict-dynamic e style-src sem inline).
  resposta.headers.set("content-security-policy-report-only", cspEndurecidaEmProva(nonce));
  // Toda pagina autenticada sem isto e F13.
  resposta.headers.set("cache-control", "no-store");
  return resposta;
}

/**
 * `?volta=` recebe SO o caminho relativo da requisicao — nunca host, nunca
 * URL absoluta. Quem le do outro lado passa por `destinoSeguro()` de novo
 * (CVE-2025-53535, INV-40).
 */
function destinoDeEntrada(req: NextRequest, pathname: string, search: string): URL {
  const destino = req.nextUrl.clone();
  destino.pathname = "/entrar";
  destino.search = "";
  if (pathname !== "/") destino.searchParams.set("volta", `${pathname}${search}`);
  return destino;
}

export const config = {
  /**
   * O matcher exclui as rotas de MAQUINA e os estaticos. Proxy na frente de
   * webhook e de rota de auth so acrescenta superficie: nenhuma delas tem
   * cookie para redirecionar nem HTML para receber nonce.
   */
  matcher: [
    "/((?!api/auth|api/webhooks|api/eventos|api/midias|api/saude|api/pronto|_next/static|_next/image|favicon.ico).*)",
  ],
};
