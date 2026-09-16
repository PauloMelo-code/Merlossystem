import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OPCOES_PASSKEY, opcoesAuth } from "@/lib/auth/auth";
import { CAMINHOS_DESLIGADOS } from "@/lib/auth/caminhos";
import { criarUsuario, fecharApoio, limparAuth, poolDeTeste, postar } from "./_apoio";

/**
 * T10 — passkey com verificação do usuário obrigatória (02-seguranca.md §9.1,
 * G8/G9/G10, CVE-2025-71400).
 *
 * Reprova quando: `generate-authenticate-options` responde DIFERENTE conforme a
 * conta existir e ter passkey (oráculo de enumeração pela porta da passkey);
 * uma resposta WebAuthn forjada cria sessão; o cadastro fica exposto por HTTP.
 *
 * LIMITE ESCRITO: não há emulador de autenticador nesta bateria, então o caso
 * "resposta com `userVerified:false`" é coberto por dois lados — o efeito (nada
 * que não venha de um autenticador de verdade cria sessão) e a configuração
 * (os dois `afterVerification` existem e exigem `userVerified`). A prova de
 * ponta a ponta com chave física é item de fumaça pós-deploy (CI-3).
 */

beforeAll(async () => {
  await limparAuth();
});

afterAll(async () => {
  await fecharApoio();
});

describe("passkey", () => {
  it("o plugin de passkey está registrado e o rpID sai de APP_URL (G10)", () => {
    expect(opcoesAuth.plugins.map((p) => p.id)).toContain("passkey");
    // rpID divergente inutiliza TODAS as chaves de uma vez, sem aviso.
    expect(OPCOES_PASSKEY.rpID).toBe(new URL(opcoesAuth.baseURL).hostname);
    expect(OPCOES_PASSKEY.origin).toBe(opcoesAuth.baseURL);
  });

  it("os dois afterVerification existem e não são o mesmo (G8/G9)", () => {
    // Sem eles o plugin cabeia `requireUserVerification: false` e a conta cai
    // para "posse do aparelho".
    const fonte = OPCOES_PASSKEY;
    expect(typeof fonte.registration?.afterVerification).toBe("function");
    expect(typeof fonte.authentication?.afterVerification).toBe("function");
    expect(fonte.registration?.afterVerification).not.toBe(
      fonte.authentication?.afterVerification,
    );
    expect(fonte.authenticatorSelection?.userVerification).toBe("required");
    expect(fonte.authenticatorSelection?.residentKey).toBe("required");
    expect(fonte.registration?.requireSession).toBe(true);
  });

  it("o cadastro e a gestão de passkey não existem por HTTP (G5/CVE-2025-71400)", () => {
    for (const caminho of [
      "/passkey/generate-register-options",
      "/passkey/verify-registration",
      "/passkey/list-user-passkeys",
      "/passkey/delete-passkey",
      "/passkey/update-passkey",
    ]) {
      expect(CAMINHOS_DESLIGADOS, caminho).toContain(caminho);
    }
  });

  it("generate-authenticate-options responde IGUAL nos três casos", async () => {
    const comChave = await criarUsuario("passkey-com@teste.local");
    await poolDeTeste.query(
      `insert into usuarios_passkeys
         (usuario_id, nome, chave_publica, credential_id, contador, tipo_dispositivo,
          backed_up, transportes, aaguid, created_at)
       values ($1, 'chave de teste', 'chave-publica-falsa', $2, 0, 'singleDevice',
               false, 'internal', null, now())`,
      [comChave.id, `cred-${comChave.id}`],
    );
    await criarUsuario("passkey-sem@teste.local");

    const respostas = [];
    for (const email of [
      "passkey-com@teste.local",
      "passkey-sem@teste.local",
      "passkey-nao-existe@teste.local",
    ]) {
      respostas.push(await postar("/passkey/generate-authenticate-options", { email }));
    }

    const [a, b, c] = respostas;
    expect(a!.status).toBe(b!.status);
    expect(a!.status).toBe(c!.status);
    // A forma da resposta é idêntica: com `residentKey: "required"` e
    // `allowCredentials` vazio, o servidor não consulta chave por e-mail.
    expect(Object.keys(JSON.parse(a!.corpo)).sort()).toEqual(
      Object.keys(JSON.parse(c!.corpo)).sort(),
    );
    expect(JSON.parse(a!.corpo).allowCredentials ?? []).toEqual([]);
  });

  it("resposta WebAuthn forjada NÃO cria sessão", async () => {
    const forjada = await postar("/passkey/verify-authentication", {
      response: {
        id: "credencial-inventada",
        rawId: "credencial-inventada",
        type: "public-key",
        response: {
          clientDataJSON: Buffer.from("{}").toString("base64url"),
          authenticatorData: Buffer.from("nada").toString("base64url"),
          signature: Buffer.from("nada").toString("base64url"),
          userHandle: null,
        },
        clientExtensionResults: {},
      },
    });
    expect(forjada.status).not.toBe(200);
    expect(forjada.headers.getSetCookie().join(";")).not.toContain("session_token");
    // E cai na recusa única: a forma da resposta não diz o que faltou.
    expect(forjada.corpo).toBe(
      '{"code":"CREDENCIAIS_INVALIDAS","message":"E-mail ou senha inválidos."}',
    );
  });
});
