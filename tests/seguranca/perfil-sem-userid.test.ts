import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CAMINHOS_DESLIGADOS, EM_USO } from "@/lib/auth/caminhos";

/**
 * T11 — "Meu perfil > Segurança" mira SEMPRE a sessão corrente
 * (02-seguranca.md §11.1, REQ-G1..G8).
 *
 * Reprova quando: uma action daquela área aceita `usuarioId`/`userId` — o alvo
 * é sempre `exigirSessao().usuarioId` — e quando aparece chamada a
 * `disableTwoFactor`, `getTOTPURI` fora do cadastro ou `generateBackupCodes`.
 *
 * `src/lib/actions/seguranca.ts` e `src/app/(app)/perfil/**` nascem em F8. A
 * parte que já existe hoje — os caminhos desligados — é conferida agora, e a
 * varredura passa a cobrir os arquivos no instante em que eles aparecem.
 */

const RAIZ = process.cwd();

const AREA_DO_PERFIL = ["src/lib/actions/seguranca.ts", "src/app/(app)/perfil"];

function arquivosDaArea(): { caminho: string; texto: string }[] {
  const achados: { caminho: string; texto: string }[] = [];
  for (const alvo of AREA_DO_PERFIL) {
    const absoluto = join(RAIZ, alvo);
    if (!existsSync(absoluto)) continue;
    const pilha = [alvo];
    while (pilha.length) {
      const atual = pilha.pop()!;
      const caminhoAbsoluto = join(RAIZ, atual);
      let entradas;
      try {
        entradas = readdirSync(caminhoAbsoluto, { withFileTypes: true });
      } catch {
        achados.push({ caminho: atual, texto: readFileSync(caminhoAbsoluto, "utf8") });
        continue;
      }
      for (const e of entradas) pilha.push(`${atual}/${e.name}`);
    }
  }
  return achados.filter((a) => /\.tsx?$/.test(a.caminho));
}

const arquivos = arquivosDaArea();

/** Rotas do BA que a área do perfil jamais pode alcançar por HTTP (G4/G5). */
const PROIBIDAS = [
  "/two-factor/disable",
  "/two-factor/get-totp-uri",
  "/two-factor/generate-backup-codes",
  "/two-factor/verify-backup-code",
];

describe("perfil > segurança", () => {
  it("as rotas de desligar 2FA e de código de resgate não existem por HTTP", () => {
    for (const caminho of PROIBIDAS) {
      expect(CAMINHOS_DESLIGADOS, caminho).toContain(caminho);
      expect(EM_USO as readonly string[], caminho).not.toContain(caminho);
    }
  });

  it.each(arquivos.map((a) => a.caminho))("%s não aceita id de outra pessoa", (caminho) => {
    const texto = arquivos.find((a) => a.caminho === caminho)!.texto;
    // O alvo é sempre a sessão corrente. Aceitar `usuarioId` no corpo é o IDOR
    // que a CVE-2025-71400 explorou no caminho de remover passkey.
    expect(texto).not.toMatch(/\busuarioId\s*:/);
    expect(texto).not.toMatch(/\buserId\s*:/);
  });

  it.each(arquivos.map((a) => a.caminho))("%s não chama caminho proibido do BA", (caminho) => {
    const texto = arquivos.find((a) => a.caminho === caminho)!.texto;
    for (const proibido of ["disableTwoFactor", "generateBackupCodes", "verifyBackupCode"]) {
      expect(texto.includes(proibido), `${caminho} chama ${proibido}`).toBe(false);
    }
  });

  it("a área do perfil existe e a varredura a alcança (piso mínimo)", () => {
    // PISO, não `Array.isArray`: a área nasceu em F8 e tem hoje a action de
    // segurança, as duas páginas e os seis componentes colocados. Sem um piso,
    // um erro de caminho faria a varredura achar ZERO arquivos e a suíte
    // continuaria verde — provando nada.
    expect(arquivos.length).toBeGreaterThanOrEqual(8);
    expect(arquivos.map((a) => a.caminho)).toContain("src/lib/actions/seguranca.ts");
  });
});
