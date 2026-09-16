/**
 * Superfície do Better Auth: o que está EM USO por HTTP e o que responde
 * 404 sem corpo (02-seguranca.md §5.2, REQ-A2).
 *
 * As duas constantes são consumidas por TRÊS lugares — o Route Handler
 * (`src/app/api/auth/[...all]/route.ts`), a opção `disabledPaths` do
 * `auth.ts` e as travas T3/T7. Defesa em duas camadas com uma fonte só.
 *
 * Módulo PURO de propósito (sem `server-only`, sem import): as travas de fonte
 * e a tela de login precisam dele.
 */

/** Caminhos que o app serve de verdade por HTTP. Tudo o mais é 404. */
export const EM_USO = [
  "/sign-in/email",
  "/sign-out",
  "/get-session",
  "/request-password-reset",
  // Token no CORPO. A variante `/reset-password/:token` está desligada (G15).
  "/reset-password",
  "/two-factor/verify-totp",
  "/passkey/generate-authenticate-options",
  "/passkey/verify-authentication",
  /**
   * A 1.7.5 instalada NÃO registra `/sign-in/passkey`: quem cria a sessão é
   * `/passkey/verify-authentication`. A entrada fica aqui porque a régua a
   * nomeia e porque uma minor pode reintroduzi-la — deixar de fora faria a
   * rota nascer ligada sem ninguém perceber.
   */
  "/sign-in/passkey",
] as const;

/**
 * Desligados. Cada um responde `new Response(null, { status: 404 })` ANTES de
 * o BA ser chamado: `disabledPaths` sozinho responde 404 COM corpo
 * `"Not Found"`, e caminho inexistente responde 404 SEM corpo — a diferença de
 * bytes é um oráculo (G19, REQ-L9).
 *
 * `:param` é segmento curinga, casado por regex.
 */
export const CAMINHOS_DESLIGADOS = [
  // -- conta e identidade ---------------------------------------------------
  "/sign-up/email", // C8: não existe auto-cadastro; o caminho é o convite
  "/sign-in/social", // A7/C10: sem login social
  "/callback/:id", // idem: não há provedor social para voltar
  "/verify-email",
  "/send-verification-email", // G17: GET que cria sessão
  "/change-email", // E12: troca de e-mail é fluxo próprio (§11.2)
  "/update-user", // H12: campo de privilégio só por action dedicada
  "/delete-user",
  "/delete-user/callback",
  "/set-password",
  "/verify-password",
  "/change-password", // G12: vai por action, com frescor
  "/reset-password/:token", // G15: token em path vaza em log e Referer

  // -- segundo fator --------------------------------------------------------
  // G5: `/two-factor/enable` pede só sessão + senha, sem frescor. O cadastro
  // real passa por `auth.api.*` dentro de action com `exigirSessaoFresca()`.
  "/two-factor/enable",
  "/two-factor/disable", // D10: não existe "desligar 2FA" por HTTP
  "/two-factor/get-totp-uri",
  "/two-factor/generate-backup-codes", // G4: sem código de resgate
  "/two-factor/verify-backup-code",
  "/two-factor/send-otp", // S-07: sem OTP por e-mail
  "/two-factor/verify-otp",

  // -- passkey --------------------------------------------------------------
  // O cadastro vai por action com sessão fresca, como o do TOTP.
  "/passkey/generate-register-options",
  "/passkey/verify-registration",
  "/passkey/list-user-passkeys",
  "/passkey/delete-passkey", // CVE-2025-71400: IDOR neste caminho
  "/passkey/update-passkey",

  // -- sessão ---------------------------------------------------------------
  // G13: devolvem e recebem o TOKEN da sessão. A tela usa a projeção de §10.
  "/list-sessions",
  "/revoke-session",
  "/revoke-sessions",
  "/revoke-other-sessions",
  "/update-session",

  // -- contas vinculadas e diagnóstico --------------------------------------
  "/link-social",
  "/unlink-account",
  "/list-accounts",
  "/refresh-token",
  "/get-access-token",
  "/account-info",
  "/error",
  "/reference",
  "/ok", // sonda do BA: a nossa é /api/saude, sem revelar a biblioteca
] as const;

/**
 * Canoniza ANTES de comparar: decodifica `%XX`, minúsculas, colapsa barras
 * repetidas, remove barra final e segmento `.`.
 *
 * A normalização de barra dupla feita à mão já foi CVE (CVE-2025-71399), então
 * ela acontece uma vez só, aqui, e o resultado é o que o roteador compara.
 */
export function canonizarCaminho(caminho: string): string {
  let bruto = caminho;
  // Decodifica até estabilizar: `%252F` vira `%2F` e depois `/`.
  for (let i = 0; i < 3; i += 1) {
    let decodificado: string;
    try {
      decodificado = decodeURIComponent(bruto);
    } catch {
      break;
    }
    if (decodificado === bruto) break;
    bruto = decodificado;
  }

  const segmentos = bruto
    .toLowerCase()
    .split("/")
    .filter((s) => s !== "" && s !== ".");

  return `/${segmentos.join("/")}`;
}

function paraRegex(padrao: string): RegExp {
  const corpo = padrao
    .split("/")
    .filter(Boolean)
    .map((s) => (s.startsWith(":") ? "[^/]+" : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  return new RegExp(`^/${corpo}$`);
}

const DESLIGADOS_REGEX = CAMINHOS_DESLIGADOS.map(paraRegex);

/** Recebe o caminho JÁ canonizado. */
export function estaDesligado(caminhoCanonico: string): boolean {
  return DESLIGADOS_REGEX.some((r) => r.test(caminhoCanonico));
}

/** Recebe o caminho JÁ canonizado. */
export function estaEmUso(caminhoCanonico: string): boolean {
  return (EM_USO as readonly string[]).includes(caminhoCanonico);
}
