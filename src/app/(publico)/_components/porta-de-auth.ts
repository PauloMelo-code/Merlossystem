"use client";

import { startAuthentication, startRegistration } from "@simplewebauthn/browser";

/**
 * A porta do navegador para `/api/auth/**` (02-seguranca.md §5.1 e §8).
 *
 * POR QUE `fetch` E NÃO SERVER ACTION: a recusa única de login — mesmo corpo,
 * mesmos cabeçalhos, mesmo piso de tempo para conta inexistente, senha errada,
 * conta desativada, bloqueada e 429 — mora no Route Handler
 * (`src/app/api/auth/[...all]/route.ts`), junto com o contador de bloqueio por
 * conta e a trilha. Uma Server Action chamando `auth.api.*` passaria por fora
 * de tudo isso. É a exceção consciente ao padrão de formulário de 04-ui.md §7.1,
 * pelo mesmo motivo que o composer do chat também é exceção.
 *
 * ponytail: `@simplewebauthn/browser` entra como dependência transitiva de
 * `@better-auth/passkey` (a versão está travada no lockfile). O cliente oficial
 * do plugin não serve aqui porque ele fala com os caminhos de CADASTRO de
 * passkey, que respondem 404 de propósito (G5, CVE-2025-71400) — o cadastro é
 * server-side, dentro de action com sessão fresca.
 */

/** Uma frase só, sem tempo e sem motivo (U14, REQ-C4). */
export const RECUSA_UNICA = "E-mail ou senha inválidos.";

export type RespostaDeAuth = {
  ok: boolean;
  status: number;
  dados: Record<string, unknown>;
};

/**
 * `clientExtensionResults` não é enviado ao servidor: o cliente oficial do
 * plugin também o descarta, e o verificador do `@simplewebauthn/server` não o
 * usa.
 */
function semExtensoes(prova: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(prova).filter(([campo]) => campo !== "clientExtensionResults"),
  );
}

async function chamar(caminho: string, corpo?: unknown): Promise<RespostaDeAuth> {
  const comCorpo =
    corpo === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(corpo),
        };

  const resposta = await fetch(`/api/auth${caminho}`, {
    method: corpo === undefined ? "GET" : "POST",
    ...comCorpo,
    credentials: "same-origin",
    cache: "no-store",
  });

  let dados: Record<string, unknown> = {};
  try {
    const texto = await resposta.text();
    if (texto) dados = JSON.parse(texto) as Record<string, unknown>;
  } catch {
    dados = {};
  }
  return { ok: resposta.ok, status: resposta.status, dados };
}

export type ResultadoDeEntrada =
  | { situacao: "entrou" }
  | { situacao: "precisa-totp" }
  | { situacao: "recusado"; mensagem: string };

/** Senha. O 200 pode ser sessão criada OU desafio de 2º fator aberto. */
export async function entrarComSenha(
  email: string,
  senha: string,
): Promise<ResultadoDeEntrada> {
  const resposta = await chamar("/sign-in/email", { email, password: senha });
  if (!resposta.ok) return { situacao: "recusado", mensagem: RECUSA_UNICA };
  if (resposta.dados["twoFactorRedirect"] === true) return { situacao: "precisa-totp" };
  return { situacao: "entrou" };
}

/** TOTP de 6 dígitos, sobre o desafio de 5 minutos aberto pela senha. */
export async function confirmarTotpDeEntrada(codigo: string): Promise<ResultadoDeEntrada> {
  const resposta = await chamar("/two-factor/verify-totp", { code: codigo });
  if (!resposta.ok) {
    return {
      situacao: "recusado",
      mensagem: "Código incorreto ou expirado. Entre de novo.",
    };
  }
  return { situacao: "entrou" };
}

/**
 * Passkey. Sem identificação prévia: `residentKey: "required"` e
 * `allowCredentials` vazio, então a resposta das opções é sempre da mesma forma
 * — não existe oráculo "esta conta tem chave" (§9.1).
 */
export async function entrarComPasskey(): Promise<ResultadoDeEntrada> {
  const opcoes = await chamar("/passkey/generate-authenticate-options");
  if (!opcoes.ok) return { situacao: "recusado", mensagem: RECUSA_UNICA };

  let prova;
  try {
    prova = await startAuthentication({
      optionsJSON: opcoes.dados as never,
    });
  } catch {
    // Cancelar no aparelho não é recusa de credencial: nada a dizer.
    return { situacao: "recusado", mensagem: "" };
  }

  const verificada = await chamar("/passkey/verify-authentication", {
    response: semExtensoes(prova),
  });
  if (!verificada.ok) return { situacao: "recusado", mensagem: RECUSA_UNICA };
  return { situacao: "entrou" };
}

/**
 * Cria a credencial no aparelho a partir das opções que a action devolveu. O
 * `userVerification: "required"` está nas opções do servidor; quem recusa uma
 * prova sem verificação do usuário é o `afterVerification` de `auth.ts` (G9).
 */
export async function criarPasskeyNoAparelho(
  opcoes: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const prova = await startRegistration({ optionsJSON: opcoes as never });
  return semExtensoes(prova);
}

/**
 * Pedido de link de recuperação. Vai pelo Route Handler, e não por action,
 * porque é lá que mora o `200 {"status":true}` byte a byte com o mesmo piso de
 * tempo, exista ou não a conta (E1).
 *
 * A REDEFINIÇÃO, ao contrário, vai por Server Action (`_acoes.ts`): o motivo da
 * senha recusada precisa chegar ao campo, e a exceção da política só sobrevive
 * na chamada direta a `auth.api.*`.
 */
export async function pedirLinkDeSenha(email: string): Promise<void> {
  await chamar("/request-password-reset", { email });
}
