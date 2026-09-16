import "server-only";
import { betterAuth, APIError, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { db } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { CAMPOS_BA } from "@/lib/db/schema/_ba-fields";
import { armazenamentoLimiteRedis } from "@/lib/seguranca/limite";
import { PROXIES_CONFIAVEIS } from "@/lib/seguranca/ip";
import { CAMINHOS_DESLIGADOS } from "./caminhos";
import { enfileirarEmailSeguranca } from "./emails";
import { kdf } from "./kdf";
import { politicaDeSenha } from "./politica-senha";
import { aposSenhaGravada } from "./senha-gravada";
import { aposCriarSessao, consumirMarcaPre2fa, podeCriarSessao } from "./sessoes";
import { registrarEventoAuth } from "./trilha";

/**
 * Better Auth 1.7.5 endurecido (02-seguranca.md §4).
 *
 * TODA opção aqui foi conferida no pacote instalado antes de ser escrita:
 * docs/seguranca/conferencia-ba-1.7.5.md. `auth.options` devolve o objeto que
 * NÓS escrevemos — opção com nome errado passa em qualquer comparação de
 * literais e é ignorada em runtime, por isso as travas são de EFEITO (S-18).
 *
 * Nenhum nome de coluna é redigitado: tudo sai de `CAMPOS_BA`
 * (01-dados.md §5.10), porque divergência de schema derruba TODO
 * `/api/auth/**` no boot (G27).
 */

/**
 * `env.BETTER_AUTH_SECRETS` é a string `"v2:segredo,v1:segredo"` (convenção
 * nossa, validada no `env.ts`). O pacote quer
 * `Array<{ version: number; value: string }>`, do mais novo para o mais velho —
 * o primeiro é o que cifra, os demais só decifram. É isto que permite girar o
 * segredo sem perder a semente TOTP de ninguém (G3).
 */
export function segredosVersionados(
  bruto: string,
): { version: number; value: string }[] {
  return bruto.split(",").map((parte) => {
    const [rotulo = "", ...resto] = parte.trim().split(":");
    return {
      version: Number(rotulo.replace(/^v/i, "")),
      value: resto.join(":"),
    };
  });
}

type CorpoComSenha =
  { newPassword?: unknown; trustDevice?: unknown } | undefined;

/**
 * As opções dos dois plugins ficam em constantes EXPORTADAS de propósito: as
 * travas T4 e T10 conferem a configuração REAL, e não um literal copiado para
 * dentro do teste — que passaria mesmo se alguém apagasse a opção daqui.
 */
export const OPCOES_2FA = {
  issuer: "MerloStore Chat",
  skipVerificationOnEnable: false,
  totpOptions: { digits: 6, period: 30 },
  // `otpOptions` AUSENTE: sem OTP por e-mail (S-07). Reabrir exige
  // storeOTP:"hashed" e period <= 5 (MINUTOS, G2).
  backupCodeOptions: { amount: 0 }, // G4: nenhum código de resgate emitido
  // Conta falha do SEGUNDO fator — não substitui o bloqueio por conta (§7.1).
  accountLockout: { enabled: true, maxFailedAttempts: 5, durationSeconds: 900 },
  twoFactorCookieMaxAge: 300, // D17: desafio de 10 -> 5 min
  trustDeviceMaxAge: 0, // G7: defesa primária; o hooks.before é a segunda
  schema: {
    twoFactor: CAMPOS_BA.twoFactor,
    user: { fields: { twoFactorEnabled: "two_factor_enabled" } },
  },
} satisfies Parameters<typeof twoFactor>[0];

export const OPCOES_PASSKEY = {
  // G10: rpID divergente inutiliza TODAS as chaves de uma vez.
  rpID: new URL(env.APP_URL).hostname,
  rpName: "MerloStore Chat",
  origin: env.APP_URL,
  // §9.1: com passkey criando sessão sem passar pelo 2FA, o UV É o 2º fator.
  authenticatorSelection: {
    userVerification: "required",
    residentKey: "required",
  },
  registration: {
    requireSession: true,
    afterVerification: async ({ verification }) => {
      // G9: sem isto o plugin cabeia `requireUserVerification: false` e a
      // conta cai para "posse do aparelho".
      if (!verification.registrationInfo?.userVerified) {
        throw new APIError("FORBIDDEN", {
          message: "Verificação do usuário obrigatória.",
        });
      }
    },
  },
  authentication: {
    afterVerification: async ({ verification }) => {
      // G8: passkey cria sessão sem 2FA; sem o UV, entrar seria só ter o
      // aparelho na mão.
      if (!verification.authenticationInfo?.userVerified) {
        throw new APIError("UNAUTHORIZED", {
          message: "Não foi possível entrar.",
        });
      }
    },
  },
  schema: { passkey: CAMPOS_BA.passkey },
} satisfies Parameters<typeof passkey>[0];

export const opcoesAuth = {
  appName: "MerloStore Chat",
  // J1: uma origem só para baseURL, rpID, links de e-mail e trustedOrigins.
  baseURL: env.APP_URL,
  secrets: segredosVersionados(env.BETTER_AUTH_SECRETS),
  // J2: nunca "*", nunca curinga.
  trustedOrigins: [env.APP_URL],
  database: drizzleAdapter(db, { provider: "pg", schema }),

  user: {
    ...CAMPOS_BA.user,
    // `input: false` => `/update-user` não aceita estes campos no corpo (H12).
    additionalFields: {
      papel: {
        type: "string",
        input: false,
        required: true,
        defaultValue: "viewer",
      },
      lojaId: {
        type: "string",
        input: false,
        required: false,
        fieldName: "loja_id",
      },
      ativo: {
        type: "boolean",
        input: false,
        required: true,
        defaultValue: false,
      },
      precisaTrocarSenha: {
        type: "boolean",
        input: false,
        defaultValue: false,
        fieldName: "precisa_trocar_senha",
      },
      precisaConfigurarFator: {
        type: "boolean",
        input: false,
        defaultValue: true,
        fieldName: "precisa_configurar_fator",
      },
      falhasLogin: {
        type: "number",
        input: false,
        defaultValue: 0,
        fieldName: "falhas_login",
      },
      ultimaFalhaEm: {
        type: "date",
        input: false,
        required: false,
        fieldName: "ultima_falha_em",
      },
      bloqueadoAte: {
        type: "date",
        input: false,
        required: false,
        fieldName: "bloqueado_ate",
      },
      ultimoLoginEm: {
        type: "date",
        input: false,
        required: false,
        fieldName: "ultimo_login_em",
      },
    },
    // E12: troca de e-mail é fluxo próprio, com confirmação do dono da conta.
    changeEmail: { enabled: false },
    // INV-33: usuário nunca é apagado. Desativar é `ativo = false`.
    deleteUser: { enabled: false },
  },

  session: {
    ...CAMPOS_BA.session,
    // S-04 / F2: teto ABSOLUTO de 12 h.
    expiresIn: 60 * 60 * 12,
    // O único teto absoluto real: sem isto o uso renova a sessão para sempre.
    disableSessionRefresh: true,
    // G11: o default era 1 DIA — e é o frescor que protege cadastro de passkey.
    freshAge: 60 * 15,
    // H6 + CVE-2026-67337: cache de sessão em cookie vira bypass de 2FA, e
    // papel/`ativo`/gates precisam vir do banco a CADA requisição.
    cookieCache: { enabled: false },
    additionalFields: {
      ultimoUsoEm: {
        type: "date",
        input: false,
        required: false,
        fieldName: "ultimo_uso_em",
      },
      reautenticadaEm: {
        type: "date",
        input: false,
        required: false,
        fieldName: "reautenticada_em",
      },
    },
  },

  // A7/C10: não existe login social; vincular conta externa não é caminho.
  account: { ...CAMPOS_BA.account, accountLinking: { enabled: false } },
  // G1: o default era PLAIN — identificador de verificação em claro no banco.
  verification: { ...CAMPOS_BA.verification, storeIdentifier: "hashed" },

  emailAndPassword: {
    enabled: true,
    disableSignUp: true, // C8
    autoSignIn: false, // G14: reset não pode criar sessão, pularia o 2º fator
    requireEmailVerification: false, // a posse do e-mail já foi provada no convite
    minPasswordLength: 15, // S-05; a política real roda em hooks.before (B9)
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true, // G16: default false
    resetPasswordTokenExpiresIn: 60 * 30, // E2
    // G22: ATENÇÃO — só KDF aqui. Política de senha neste ponto viraria oráculo,
    // porque `verify` roda em todo login.
    password: {
      hash: (senha: string) => kdf.hash(senha),
      verify: ({ hash, password }: { hash: string; password: string }) =>
        kdf.verify(hash, password),
    },
    sendResetPassword: async ({
      user,
      token,
    }: {
      user: { id: string };
      token: string;
    }) => {
      // G15: a `url` do BA leva o token em path/query, que vaza em log e
      // Referer. Fragmento + fila, e nunca `await` de SMTP na resposta (E1).
      enfileirarEmailSeguranca(
        "reset",
        user.id,
        `${env.APP_URL}/redefinir-senha#t=${token}`,
      );
    },
    onPasswordReset: async ({ user }: { user: { id: string } }) => {
      await aposSenhaGravada(user.id, "reset"); // E5
    },
  },

  rateLimit: {
    // O default desliga fora de produção. Ligar sempre: senão o teste que prova
    // o 429 passaria vazio.
    enabled: true,
    // G20: o default é um Map em memória — some no restart e não é compartilhado.
    customStorage: armazenamentoLimiteRedis,
    // Balde geral por IP, largo de propósito: a loja inteira sai por um NAT.
    window: 60,
    max: 300,
    customRules: {
      "/sign-in/email": { window: 60, max: 20 },
      "/sign-in/passkey": { window: 60, max: 20 },
      "/request-password-reset": { window: 600, max: 5 },
      "/reset-password": { window: 600, max: 10 },
      "/two-factor/*": { window: 60, max: 10 },
      "/passkey/*": { window: 60, max: 30 },
    },
  },

  advanced: {
    useSecureCookies: env.NODE_ENV === "production", // F1: prefixo __Secure-
    cookiePrefix: "merlo",
    // G21 + CVE-2026-45364. A lista é constante versionada, nunca env (§7.3).
    ipAddress: { trustedProxies: [...PROXIES_CONFIAVEIS], ipv6Subnet: 64 },
    database: { generateId: "uuid" }, // 01-dados.md §4.2
    // NUNCA: disableCSRFCheck, disableOriginCheck.
  },

  // Defesa em DUAS camadas com uma fonte só: o Route Handler responde 404 sem
  // corpo antes, e esta opção é a segunda linha (§5.2).
  disabledPaths: [...CAMINHOS_DESLIGADOS],

  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      const corpo = ctx.body as CorpoComSenha;

      // B9/E9: a política roda só onde a senha é GRAVADA, e ANTES do consumo do
      // token de reset — senha fraca não pode queimar o link (T8).
      if (ctx.path === "/reset-password" || ctx.path === "/change-password") {
        const sessao = ctx.context.session as
          { user?: { id?: string } } | undefined;
        await politicaDeSenha(corpo?.newPassword, {
          usuarioId: sessao?.user?.id,
          conferirHibp: env.AUTH_HIBP_HABILITADO,
        });
      }

      // G7/D15: segunda linha. A primeira é `trustDeviceMaxAge: 0` abaixo.
      if (ctx.path.startsWith("/two-factor/") && corpo?.trustDevice) {
        throw new APIError("BAD_REQUEST", {
          message: "Operação não permitida.",
        });
      }
    }),
  },

  databaseHooks: {
    session: {
      create: {
        before: async (sessao, contexto) => podeCriarSessao(sessao, contexto),
        after: async (sessao, contexto) => {
          await aposCriarSessao(sessao, contexto);
        },
      },
      delete: {
        before: async (sessao, contexto) => {
          // G25: a prova tem de existir ANTES do delete físico da biblioteca.
          // `try/catch` explícito porque hook `before` que lança ABORTA a
          // operação — e "sair" tem de sair sempre.
          // A sessão pré-2FA não é entrada nem saída: já virou
          // `senha_aceita_aguardando_2fa` (§17.2, L2).
          if (consumirMarcaPre2fa(sessao.id)) return;
          try {
            await registrarEventoAuth({
              tipo: "sessao_encerrada",
              usuarioId: sessao.userId,
              sessaoId: sessao.id,
              detalhes: { rota: contexto?.path ?? "" },
            });
          } catch (erro) {
            logger.fatal(
              { erro: String(erro) },
              "trilha de sessao_encerrada falhou",
            );
          }
        },
      },
    },
    account: {
      update: {
        before: async (conta, contexto) => {
          // E5/B7: `/change-password` NÃO dispara `onPasswordReset`. Este é o
          // único lugar por onde a troca autenticada passa, e é aqui que o
          // histórico de senha entra.
          if (contexto?.path !== "/change-password") return;
          const usuarioId = (conta as { userId?: string }).userId;
          if (usuarioId) await aposSenhaGravada(usuarioId, "troca");
        },
      },
    },
  },

  plugins: [
    twoFactor(OPCOES_2FA),
    passkey(OPCOES_PASSKEY),
    // G28: SEMPRE o último — senão Server Action não grava cookie.
    nextCookies(),
  ],
  // S-18: chave desconhecida vira erro de compilação, não bug silencioso.
} satisfies BetterAuthOptions;

export const auth = betterAuth(opcoesAuth);
