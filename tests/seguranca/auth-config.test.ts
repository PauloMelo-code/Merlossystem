import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OPCOES_2FA, OPCOES_PASSKEY, opcoesAuth, segredosVersionados } from "@/lib/auth/auth";
import { CAMINHOS_DESLIGADOS } from "@/lib/auth/caminhos";

/**
 * T4 (parte de configuração) — 02-seguranca.md §4.2 e §4.4.
 *
 * A parte de EFEITO está em `auth-efeito.test.ts`. Aqui ficam só as coisas que
 * um literal prova de verdade: plugin PROIBIDO registrado, `nextCookies` fora
 * do fim e opção de segurança apagada.
 */

const FONTE_AUTH = readFileSync("src/lib/auth/auth.ts", "utf8");

/** T4 reprova se qualquer um destes aparecer (02-seguranca.md §4.2). */
const PLUGINS_PROIBIDOS = [
  "admin",
  "haveIBeenPwned",
  "emailOTP",
  "magicLink",
  "apiKey",
  "organization",
  "oauthProvider",
  "oidcProvider",
  "mcp",
  "sso",
  "anonymous",
  "multiSession",
  "openAPI",
  "deviceAuthorization",
];

describe("configuração do Better Auth", () => {
  it("só registra twoFactor, passkey e nextCookies — nesta ordem", () => {
    const ids = opcoesAuth.plugins.map((p) => p.id);
    expect(ids).toEqual(["two-factor", "passkey", "next-cookies"]);
    // G28: `nextCookies()` SEMPRE por último, senão Server Action não grava
    // cookie e o login "funciona" sem sessão.
    expect(ids.at(-1)).toBe("next-cookies");
  });

  it("nenhum plugin proibido é importado nem registrado (G24, S-02)", () => {
    const ids = new Set<string>(opcoesAuth.plugins.map((p) => p.id));
    for (const proibido of PLUGINS_PROIBIDOS) {
      expect(ids.has(proibido), proibido).toBe(false);
      // Também não pode estar importado: import é o primeiro passo de voltar.
      expect(FONTE_AUTH.includes(`${proibido}(`), `${proibido} aparece no fonte`).toBe(false);
    }
  });

  it("nunca desliga CSRF nem a checagem de origem", () => {
    expect(FONTE_AUTH).not.toMatch(/disableCSRFCheck\s*:\s*true/);
    expect(FONTE_AUTH).not.toMatch(/disableOriginCheck\s*:\s*true/);
    // F1: prefixo `__Secure-` em produção. Em dev e teste o cookie precisa
    // funcionar em `http://localhost`, então a opção segue o NODE_ENV — nunca
    // um literal, que é como se entrega produção sem cookie seguro.
    expect(opcoesAuth.advanced.useSecureCookies).toBe(process.env.NODE_ENV === "production");
    expect(opcoesAuth.trustedOrigins).toEqual([opcoesAuth.baseURL]);
    expect(opcoesAuth.trustedOrigins).not.toContain("*");
  });

  it("e-mail e senha: sem auto-cadastro, sem auto-login e com KDF próprio", () => {
    const eap = opcoesAuth.emailAndPassword;
    expect(eap.enabled).toBe(true);
    expect(eap.disableSignUp).toBe(true); // C8
    expect(eap.autoSignIn).toBe(false); // G14
    expect(eap.revokeSessionsOnPasswordReset).toBe(true); // G16
    expect(eap.minPasswordLength).toBe(15); // S-05
    expect(eap.maxPasswordLength).toBe(128);
    expect(eap.resetPasswordTokenExpiresIn).toBe(60 * 30); // E2
    // G22: o scrypt padrão do BA fica abaixo do piso OWASP.
    expect(typeof eap.password.hash).toBe("function");
    expect(typeof eap.password.verify).toBe("function");
  });

  it("verificação com identificador HASHEADO (G1)", () => {
    expect(opcoesAuth.verification.storeIdentifier).toBe("hashed");
  });

  it("conta: sem vínculo de conta social (A7/C10)", () => {
    expect(opcoesAuth.account.accountLinking.enabled).toBe(false);
    expect(opcoesAuth.user.changeEmail.enabled).toBe(false);
    expect(opcoesAuth.user.deleteUser.enabled).toBe(false);
  });

  it("todo campo de privilégio entra com input: false (H12)", () => {
    for (const [nome, campo] of Object.entries(opcoesAuth.user.additionalFields)) {
      expect((campo as { input?: boolean }).input, nome).toBe(false);
    }
  });

  it("segundo fator: sem OTP, sem código de resgate, sem dispositivo confiável", () => {
    expect(OPCOES_2FA.skipVerificationOnEnable).toBe(false);
    expect(OPCOES_2FA.backupCodeOptions.amount).toBe(0); // G4
    expect(OPCOES_2FA.twoFactorCookieMaxAge).toBe(300); // D17
    expect(OPCOES_2FA.trustDeviceMaxAge).toBe(0); // G7
    expect(OPCOES_2FA.accountLockout).toEqual({
      enabled: true,
      maxFailedAttempts: 5,
      durationSeconds: 900,
    });
    // S-07: `otpOptions` tem de estar AUSENTE, não vazio.
    expect("otpOptions" in OPCOES_2FA).toBe(false);
  });

  it("passkey exige verificação do usuário e chave descobrível", () => {
    expect(OPCOES_PASSKEY.authenticatorSelection.userVerification).toBe("required");
    expect(OPCOES_PASSKEY.authenticatorSelection.residentKey).toBe("required");
  });

  it("disabledPaths usa a MESMA constante do Route Handler (§5.2)", () => {
    expect(opcoesAuth.disabledPaths).toEqual([...CAMINHOS_DESLIGADOS]);
  });

  it("limitador ligado, no Redis, com as regras por caminho (G20)", () => {
    expect(opcoesAuth.rateLimit.enabled).toBe(true);
    expect(typeof opcoesAuth.rateLimit.customStorage.consume).toBe("function");
    expect(opcoesAuth.rateLimit.customRules["/sign-in/email"]).toEqual({ window: 60, max: 20 });
    expect(opcoesAuth.rateLimit.customRules["/request-password-reset"]).toEqual({
      window: 600,
      max: 5,
    });
  });

  it("ids em uuid e IP com proxies confiáveis versionados (G21)", () => {
    expect(opcoesAuth.advanced.database.generateId).toBe("uuid");
    expect(opcoesAuth.advanced.ipAddress.ipv6Subnet).toBe(64);
    expect(opcoesAuth.advanced.ipAddress.trustedProxies.length).toBeGreaterThan(0);
    // Nenhuma faixa pública na lista: `0.0.0.0/0` devolveria o XFF forjável.
    expect(opcoesAuth.advanced.ipAddress.trustedProxies).not.toContain("0.0.0.0/0");
  });

  it("os segredos são versionados, do mais novo para o mais velho (G3)", () => {
    expect(segredosVersionados("v2:abc,v1:def")).toEqual([
      { version: 2, value: "abc" },
      { version: 1, value: "def" },
    ]);
    expect(opcoesAuth.secrets.length).toBeGreaterThan(0);
    expect(opcoesAuth.secrets[0]!.value.length).toBeGreaterThanOrEqual(32);
  });
});
