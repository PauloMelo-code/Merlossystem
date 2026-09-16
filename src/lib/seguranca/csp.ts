/**
 * Politica de seguranca de conteudo e cabecalhos de borda (02-seguranca.md
 * §14.1 e §14.2).
 *
 * Fonte UNICA da politica: `src/proxy.ts` monta a versao com nonce por
 * requisicao (pagina) e `next.config.ts` aplica a versao sem script (respostas
 * de `/api`). Duas copias do texto viravam duas politicas diferentes no dia em
 * que alguem endurecesse uma so.
 *
 * Nao importa `server-only` nem `env`: e lido pelo proxy (runtime de borda) e
 * pelo carregador de configuracao do Next, fora do processo da aplicacao.
 */

/** CSP em ENFORCE desde a primeira entrega (S-13). Nunca Report-Only puro. */
export function cspDePagina(nonce: string): string {
  return [
    "default-src 'self'",
    // 'unsafe-inline' em script-src reprova no CI, sem excecao. O nonce por
    // requisicao obriga renderizacao dinamica — o app e 100% autenticado e ja
    // era dinamico, entao o custo e conhecido e aceito (ADR).
    `script-src 'self' 'nonce-${nonce}'`,
    // EXCECAO-SEG: REQ-J5 | style-src 'unsafe-inline' enquanto o Tailwind v4 injeta estilo | arquitetura de seguranca | ate 2026-12-15
    "style-src 'self' 'unsafe-inline'",
    // img-src NAO lista o host publico do MinIO: o bucket e privado e a URL
    // persistida e sempre a rota interna /api/midias/[id] (§15).
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ");
}

/**
 * Report-Only roda EM PARALELO e so para endurecer: `strict-dynamic` e a
 * remocao do `style-src 'unsafe-inline'`. O coletor e /api/csp.
 */
export function cspEndurecidaEmProva(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "report-uri /api/csp",
  ].join("; ");
}

/** Resposta de /api nao renderiza HTML nem executa script: nada e permitido. */
export const CSP_DE_API =
  "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

/** §14.1: os cabecalhos fixos, iguais em toda resposta. */
export const CABECALHOS_DE_SEGURANCA = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), publickey-credentials-get=(self)",
  },
] as const;
