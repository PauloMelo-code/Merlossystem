import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CAMINHOS_DESLIGADOS, EM_USO } from "@/lib/auth/caminhos";

/**
 * T3 — nenhum caminho do Better Auth fica sem decisão (02-seguranca.md §5.2,
 * REQ-A2).
 *
 * Varre o pacote INSTALADO por `createAuthEndpoint("/...")` e reprova qualquer
 * caminho fora de `EM_USO ∪ CAMINHOS_DESLIGADOS`. Um upgrade que instale rota
 * nova quebra este teste — que é o ponto: rota nova ligada em silêncio é
 * superfície que ninguém pediu.
 *
 * A varredura cobre SÓ o que a nossa configuração serve: o núcleo
 * (`dist/api/routes/**`) e os dois plugins registrados (`two-factor` e
 * `passkey`). Endpoint de plugin NÃO registrado não existe em runtime — listar
 * `/organization/*` e `/admin/*` como "desligado" seria inventário falso.
 */

const RAIZ = join(process.cwd(), "node_modules");

const PASTAS = [
  "better-auth/dist/api/routes",
  "better-auth/dist/plugins/two-factor",
  "@better-auth/passkey/dist",
];

function varrer(dir: string): string[] {
  let entradas;
  try {
    entradas = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entradas.flatMap((e) => {
    const caminho = join(dir, e.name);
    if (e.isDirectory()) return varrer(caminho);
    return e.name.endsWith(".mjs") ? [caminho] : [];
  });
}

function caminhosInstalados(): string[] {
  const achados = new Set<string>();
  for (const pasta of PASTAS) {
    for (const arquivo of varrer(join(RAIZ, pasta))) {
      const texto = readFileSync(arquivo, "utf8");
      for (const m of texto.matchAll(/createAuthEndpoint\(\s*"([^"]+)"/g)) {
        achados.add(m[1]!);
      }
    }
  }
  return [...achados].sort();
}

const INSTALADOS = caminhosInstalados();
const DECIDIDOS = new Set<string>([...EM_USO, ...CAMINHOS_DESLIGADOS]);

describe("caminhos do Better Auth instalado", () => {
  it("a varredura encontrou o pacote de verdade (piso mínimo)", () => {
    expect(INSTALADOS.length).toBeGreaterThanOrEqual(30);
    expect(INSTALADOS).toContain("/sign-in/email");
    expect(INSTALADOS).toContain("/get-session");
  });

  it("todo caminho instalado está EM USO ou DESLIGADO", () => {
    const semDecisao = INSTALADOS.filter((c) => !DECIDIDOS.has(c));
    expect(semDecisao).toEqual([]);
  });

  it("todo caminho EM USO existe mesmo no pacote (menos o nomeado)", () => {
    const instalados = new Set(INSTALADOS);
    // `/sign-in/passkey` não é registrado pela 1.7.5 — quem cria a sessão é
    // `/passkey/verify-authentication`. Fica em EM_USO porque a régua o nomeia
    // e porque uma minor pode reintroduzi-lo (caminhos.ts explica).
    const conhecidos = ["/sign-in/passkey"];
    const fantasmas = EM_USO.filter((c) => !instalados.has(c) && !conhecidos.includes(c));
    expect(fantasmas).toEqual([]);
  });

  it("os caminhos que o desenho nomeia como desligados estão desligados", () => {
    for (const caminho of [
      "/sign-up/email",
      "/update-user",
      "/delete-user",
      "/change-password",
      "/verify-password",
      "/reset-password/:token",
      "/two-factor/enable",
      "/two-factor/disable",
      "/two-factor/get-totp-uri",
      "/two-factor/generate-backup-codes",
      "/two-factor/verify-backup-code",
      "/two-factor/send-otp",
      "/two-factor/verify-otp",
      "/list-sessions",
      "/revoke-session",
      "/revoke-sessions",
      "/revoke-other-sessions",
      "/link-social",
      "/unlink-account",
      "/list-accounts",
      "/account-info",
      "/error",
    ]) {
      expect(CAMINHOS_DESLIGADOS, caminho).toContain(caminho);
    }
  });
});
