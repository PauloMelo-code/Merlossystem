import { describe, expect, it } from "vitest";
import { FASE_R2, MATRIZ, MATRIZ_R1, pode, podeChave } from "@/lib/auth/permissoes";
import { PAPEIS, type Papel } from "@/lib/db/schema/_enums/auth";
import { lerFonte } from "./_fonte";

/**
 * T12 — invariantes da matriz de permissão (02-seguranca.md §2.2).
 *
 * Reprova quando: `dono` deixa de conter `admin`; `viewer` escreve (INV-19);
 * `vendedor` exclui ou cancela fora de `agendamentos:cancelar` (INV-20);
 * `gerente` alcança `configuracao:*`, `integracoes:*`, `usuarios:*` ou
 * `seguranca:ler_eventos` (INV-21/22); papel inventado passa em algo (INV-26);
 * algum papel perde a PRÓPRIA conta, ou `conta:*` ganha chave além de
 * `conta:gerir` sem passar por aqui (ADR 0030).
 */

const CHAVES = Object.keys(MATRIZ) as `${string}:${string}`[];

/** Ações que ESCREVEM, pelo verbo. Leitura tem verbo próprio. */
const ESCRITA = /^(criar|editar|excluir|gerir|escrever|enviar|disparar|cancelar|optout|conectar|desconectar|convidar|desativar|destravar|promover|rebaixar|transferir|restaurar|anonimizar|exportar|registrar|reconhecer|lancar|dispensar|recuperar|encerrar|trocar|marcar|aprovar|negar|concluir)/;

function acaoDe(chave: string): string {
  return chave.split(":")[1] ?? "";
}

describe("matriz de permissão", () => {
  it("cobre as famílias do R1 e não está vazia", () => {
    expect(CHAVES.length).toBeGreaterThan(50);
    for (const prefixo of [
      "conversas:",
      "contatos:",
      "pedidos:",
      "produtos:",
      "campanhas:",
      "usuarios:",
      "lojas:",
      "integracoes:",
      "configuracao:",
      "trilha:",
      "lgpd:",
      "seguranca:",
      "conta:",
    ]) {
      expect(CHAVES.some((c) => c.startsWith(prefixo)), prefixo).toBe(true);
    }
  });

  it("dono contém tudo o que admin tem (dono ⊇ admin)", () => {
    for (const chave of CHAVES) {
      if (podeChave("admin", chave)) {
        expect(podeChave("dono", chave), chave).toBe(true);
      }
    }
  });

  it("viewer NUNCA escreve (INV-19) — fora da PRÓPRIA conta", () => {
    for (const chave of CHAVES) {
      if (!podeChave("viewer", chave)) continue;
      // INV-19 é sobre dado de negócio. `conta:*` só alcança a sessão corrente
      // (T11) e tem o seu próprio teste abaixo.
      if (chave.startsWith("conta:")) continue;
      expect(ESCRITA.test(acaoDe(chave)), `viewer alcança ${chave}`).toBe(false);
    }
  });

  it("vendedor só cancela/exclui em agendamentos:cancelar (INV-20)", () => {
    const destrutivas = CHAVES.filter(
      (c) => /^(excluir|cancelar)$/.test(acaoDe(c)) && podeChave("vendedor", c),
    );
    expect(destrutivas).toEqual(["agendamentos:cancelar"]);
  });

  it("gerente nunca alcança configuração, integrações nem usuários (INV-21/22)", () => {
    for (const chave of CHAVES) {
      if (!podeChave("gerente", chave)) continue;
      expect(chave.startsWith("configuracao:"), chave).toBe(false);
      expect(chave.startsWith("integracoes:"), chave).toBe(false);
      if (chave.startsWith("usuarios:")) {
        expect(chave, "gerente só pode listar colegas").toBe("usuarios:listar_colegas");
      }
    }
  });

  it("gerente NÃO lê a trilha de auth, mas lê a de negócio", () => {
    // `auth_eventos` carrega IP, agente, meio e alvo de dono e admin.
    expect(pode("gerente", "seguranca", "ler_eventos")).toBe(false);
    // `trilha:ler` é a trilha de NEGÓCIO, que DN-07 pediu para o gerente.
    expect(pode("gerente", "trilha", "ler")).toBe(true);
  });

  it("só o dono promove, rebaixa e transfere a posse (REQ-H1)", () => {
    for (const chave of [
      "usuarios:promover_admin",
      "usuarios:rebaixar_admin",
      "usuarios:transferir_posse",
    ] as const) {
      expect(podeChave("dono", chave), chave).toBe(true);
      for (const papel of ["admin", "gerente", "vendedor", "viewer"] as Papel[]) {
        expect(podeChave(papel, chave), `${papel} em ${chave}`).toBe(false);
      }
    }
  });

  it("toda sessão ativa alcança a PRÓPRIA conta, e a família é uma chave só", () => {
    const familia = CHAVES.filter((c) => c.startsWith("conta:"));
    expect(familia).toEqual(["conta:gerir"]);
    for (const papel of PAPEIS) {
      expect(pode(papel, "conta", "gerir"), papel).toBe(true);
    }
  });

  it("as actions da conta usam conta:gerir, não o remendo lojas:ler", () => {
    for (const arquivo of [
      "src/lib/actions/seguranca.ts",
      "src/app/(app)/_acoes.ts",
      "src/app/(publico)/_acoes.ts",
    ]) {
      const fonte = lerFonte(arquivo);
      expect(fonte, arquivo).toContain('"conta:gerir"');
      expect(fonte, arquivo).not.toContain('"lojas:ler"');
    }
  });

  it("papel inventado não passa em NADA (INV-26)", () => {
    for (const chave of CHAVES) {
      expect(podeChave("root" as Papel, chave), chave).toBe(false);
      expect(podeChave("" as Papel, chave), chave).toBe(false);
    }
  });

  it("chave que não existe é negada, não é erro (negação por padrão)", () => {
    for (const papel of PAPEIS) {
      expect(pode(papel, "inventado", "qualquer")).toBe(false);
      expect(pode(papel, "conversas", "explodir")).toBe(false);
    }
  });

  it("o catálogo NÃO tem produtos:criar|editar|excluir (catálogo é leitura)", () => {
    for (const acao of ["criar", "editar", "excluir"]) {
      expect(CHAVES).not.toContain(`produtos:${acao}`);
    }
  });

  it("as chaves da fase R2 estão SEPARADAS do R1 (INV-27)", () => {
    // INV-27 ("toda entrada é usada por alguma tela") vale sobre MATRIZ_R1. As
    // chaves de R2 nascem antes da tela de propósito, para o estorno não nascer
    // sem dono no dia em que a tela ligar.
    for (const chave of Object.keys(FASE_R2)) {
      expect(Object.keys(MATRIZ_R1), chave).not.toContain(chave);
    }
    for (const chave of ["devolucoes:concluir_estorno", "pagamentos:marcar_pago"] as const) {
      expect(podeChave("gerente", chave), chave).toBe(true);
      expect(podeChave("vendedor", chave), chave).toBe(false);
    }
  });

  it("toda entrada da matriz aponta para ao menos um papel", () => {
    for (const chave of CHAVES) {
      expect(MATRIZ[chave]!.length, chave).toBeGreaterThan(0);
    }
  });
});
