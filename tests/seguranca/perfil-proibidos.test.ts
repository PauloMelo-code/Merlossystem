import { describe, expect, it } from "vitest";
import { CAMINHOS_DESLIGADOS, EM_USO } from "@/lib/auth/caminhos";
import { arquivosDe, lerFonte, linhasCom, semComentarios } from "./_fonte";

/**
 * T11, segunda metade — chamadas proibidas da biblioteca, no REPOSITORIO
 * INTEIRO (02-seguranca.md §11.1, §20).
 *
 * `perfil-sem-userid.test.ts` cobre a AREA do perfil. Esta trava cobre o resto:
 * o defeito que ela impede e alguem chamar `disableTwoFactor` de dentro de uma
 * action administrativa, de um script ou de um job — onde a varredura da area
 * do perfil nao chega e onde ninguem procuraria.
 *
 * Por que essas tres chamadas em particular:
 *
 *   `disableTwoFactor`      desligar o segundo fator e proibido. Quem troca de
 *                           aparelho usa `substituirFator`, que exige o fator
 *                           atual e mantem o piso de UM fator (REQ-D10/D11).
 *                           Uma conta sem fator e uma conta que volta a ser so
 *                           senha, sem ninguem perceber.
 *   `generateBackupCodes`   codigos de resgate NAO existem (S-07). O caminho de
 *                           quem perde os dois fatores e a recuperacao
 *                           assistida, com motivo, identidade registrada e
 *                           trilha antes do efeito (REQ-E7).
 *   `getTOTPURI`            a semente do TOTP so pode sair no CADASTRO do
 *                           fator, com sessao fresca. Em qualquer outro lugar,
 *                           e uma porta para copiar o segundo fator de alguem.
 */

const FONTES = [...arquivosDe("src", [".ts", ".tsx"]), ...arquivosDe("scripts", [".ts", ".mjs"])];

/** O cadastro de TOTP e o unico lugar legitimo de `getTOTPURI`. */
const PODEM_LER_URI_DO_TOTP = ["src/lib/auth/fatores.ts"];

describe("T11 chamadas proibidas da biblioteca de autenticacao", () => {
  it("varre um repositorio de verdade (piso minimo)", () => {
    expect(FONTES.length).toBeGreaterThanOrEqual(80);
  });

  it.each(["disableTwoFactor", "generateBackupCodes", "verifyBackupCode"])(
    "%s nao aparece em lugar nenhum",
    (proibida) => {
      const achados = FONTES.flatMap((f) =>
        linhasCom(semComentarios(lerFonte(f)), new RegExp(`\\b${proibida}\\s*\\(`)).map(
          (l) => `${f} ${l}`,
        ),
      );
      expect(achados).toEqual([]);
    },
  );

  it("getTOTPURI so aparece no cadastro do fator", () => {
    const achados = FONTES.filter((f) => !PODEM_LER_URI_DO_TOTP.includes(f)).filter((f) =>
      /\bgetTOTPURI\s*\(/.test(semComentarios(lerFonte(f))),
    );
    expect(achados).toEqual([]);
  });
});

describe("T11 os caminhos correspondentes estao desligados por HTTP", () => {
  /**
   * Nao basta nao chamar: a rota instalada pela biblioteca responde a qualquer
   * um com um cookie valido. Desligar por HTTP e o que fecha.
   */
  const PROIBIDOS = [
    "/two-factor/disable",
    "/two-factor/get-totp-uri",
    "/two-factor/generate-backup-codes",
    "/two-factor/verify-backup-code",
  ];

  it.each(PROIBIDOS)("%s esta em CAMINHOS_DESLIGADOS e fora de EM_USO", (caminho) => {
    expect(CAMINHOS_DESLIGADOS).toContain(caminho);
    expect(EM_USO as readonly string[]).not.toContain(caminho);
  });

  it("a lista de desligados nao encolheu sem ninguem ver", () => {
    expect(CAMINHOS_DESLIGADOS.length).toBeGreaterThanOrEqual(PROIBIDOS.length);
  });
});
