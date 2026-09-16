import { describe, expect, it } from "vitest";
import {
  MAX_SENHA,
  MIN_SENHA,
  motivosDeSenha,
} from "@/lib/auth/politica-senha";
import { SENHAS_COMUNS, ehSenhaComum } from "@/lib/auth/senhas-comuns";
import { chaveDeIp, ehProxyConfiavel, resolverIp } from "@/lib/seguranca/ip";
import { canonizarCaminho } from "@/lib/auth/caminhos";

/**
 * Regras PURAS de segurança (02-seguranca.md §6 e §7.3).
 *
 * São as que a tela e o servidor executam do mesmo módulo: se a lista de
 * motivos divergir entre os dois lados, a pessoa recebe "senha fraca" sem saber
 * o que corrigir (B6).
 */

describe("política de senha", () => {
  it("o piso é 15 e o teto 128 (S-05)", () => {
    expect(MIN_SENHA).toBe(15);
    expect(MAX_SENHA).toBe(128);
    expect(motivosDeSenha("curta demais")).not.toEqual([]);
    expect(motivosDeSenha("a".repeat(200))).not.toEqual([]);
  });

  it("uma frase curta passa — sem exigir símbolo nem maiúscula (B4)", () => {
    expect(motivosDeSenha("bolo de fuba da tia rosa")).toEqual([]);
    expect(motivosDeSenha("guarda-chuva vermelho na porta")).toEqual([]);
  });

  it("recusa sequência de teclado, alfabeto e número", () => {
    expect(motivosDeSenha("qwertyuiop e mais coisa")).not.toEqual([]);
    expect(motivosDeSenha("abcdefghij e mais coisa")).not.toEqual([]);
    expect(motivosDeSenha("012345 mais alguma coisa")).not.toEqual([]);
  });

  it("recusa repetição do mesmo bloco do começo ao fim", () => {
    expect(motivosDeSenha("abababababababababab")).not.toEqual([]);
    expect(motivosDeSenha("aaaaaaaaaaaaaaaaaaaa")).not.toEqual([]);
  });

  it("recusa nome, e-mail, loja e marca (B6)", () => {
    const contexto = { nome: "Mariana Silva", email: "mariana@merlostore.com.br", loja: "Centro" };
    expect(motivosDeSenha("mariana no portao de casa", contexto)).not.toEqual([]);
    expect(motivosDeSenha("a loja do centro fica ali", contexto)).not.toEqual([]);
    // A marca vale mesmo sem contexto: é a primeira tentativa de qualquer um.
    expect(motivosDeSenha("merlostore abre as nove")).not.toEqual([]);
  });

  it("NUNCA normaliza a senha: espaço e caixa contam (B5)", () => {
    // Se houvesse `trim()`, estas duas teriam a mesma avaliação e o mesmo hash.
    const comEspaco = " bolo de fuba da tia rosa ";
    expect(comEspaco.length).not.toBe(comEspaco.trim().length);
    expect(motivosDeSenha(comEspaco)).toEqual([]);
  });

  it("devolve TODOS os motivos de uma vez, não um por vez", () => {
    const motivos = motivosDeSenha("abc123");
    expect(motivos.length).toBeGreaterThan(1);
  });

  it("nenhuma mensagem fala em token, link, inválido ou expirado (E10)", () => {
    const todas = [
      ...motivosDeSenha("abc123"),
      ...motivosDeSenha("senha123"),
      ...motivosDeSenha("a".repeat(200)),
    ].join(" ");
    expect(todas).not.toMatch(/token|link|inv[áa]lid|expirad/i);
  });
});

describe("lista local de senhas comuns", () => {
  it("tem ao menos 3.000 entradas (a régua de §6)", () => {
    expect(SENHAS_COMUNS.size).toBeGreaterThanOrEqual(3_000);
  });

  it("pega as campeãs e as variantes que as pessoas fazem de verdade", () => {
    for (const senha of ["123456", "senha123", "Brasil2024", "merlostore@123", "admin123"]) {
      expect(ehSenhaComum(senha), senha).toBe(true);
    }
  });

  it("ignora acento e caixa na comparação", () => {
    expect(ehSenhaComum("SENHA")).toBe(true);
    expect(ehSenhaComum("Gremio")).toBe(true);
  });

  it("não recusa frase legítima", () => {
    expect(ehSenhaComum("bolo de fuba da tia rosa")).toBe(false);
  });
});

describe("IP canônico", () => {
  function cabecalhos(xff?: string): Headers {
    const h = new Headers();
    if (xff) h.set("x-forwarded-for", xff);
    return h;
  }

  it("um salto confiável: pega o primeiro não confiável da direita", () => {
    const r = resolverIp(cabecalhos("203.0.113.9, 10.0.0.5"), "10.0.0.5");
    expect(r.ip).toBe("203.0.113.9");
    expect(r.cadeiaInesperada).toBe(false);
  });

  it("cadeia inesperada cai para o socket e sinaliza (§7.3)", () => {
    const r = resolverIp(cabecalhos("203.0.113.9, 10.0.0.5, 10.0.0.6"), "10.0.0.6");
    expect(r.ip).toBe("10.0.0.6");
    expect(r.cadeiaInesperada).toBe(true);
  });

  it("sem XFF usa o socket", () => {
    expect(resolverIp(cabecalhos(), "198.51.100.1").ip).toBe("198.51.100.1");
  });

  it("XFF forjado por trás de um proxy não vira o IP gravado", () => {
    // O cliente manda um XFF inteiro de mentira; o Traefik acrescenta o real.
    const r = resolverIp(cabecalhos("1.2.3.4, 203.0.113.77, 10.0.0.5"), "10.0.0.5");
    expect(r.ip).toBe("203.0.113.77");
  });

  it("nenhuma faixa confiável é pública", () => {
    expect(ehProxyConfiavel("10.0.0.1")).toBe(true);
    expect(ehProxyConfiavel("127.0.0.1")).toBe(true);
    expect(ehProxyConfiavel("203.0.113.9")).toBe(false);
    expect(ehProxyConfiavel("8.8.8.8")).toBe(false);
  });

  it("o limitador agrupa IPv6 em /64 (CVE-2026-45364)", () => {
    const a = chaveDeIp("2001:db8:0:1:aaaa:bbbb:cccc:dddd");
    const b = chaveDeIp("2001:db8:0:1:1111:2222:3333:4444");
    expect(a).toBe(b);
    expect(chaveDeIp("2001:db8:0:2::1")).not.toBe(a);
    // IPv4 não é agrupado: a trilha e o balde usam o endereço inteiro.
    expect(chaveDeIp("203.0.113.9")).toBe("203.0.113.9");
  });
});

describe("canonização de caminho", () => {
  it("colapsa as 5 escritas em uma só (CVE-2025-71399)", () => {
    for (const escrita of [
      "/sign-up/email",
      "//sign-up//email",
      "/SIGN-UP/EMAIL",
      "/sign-up/email/",
      "/sign-up/./email",
      "/sign-up%2Femail",
    ]) {
      expect(canonizarCaminho(escrita), escrita).toBe("/sign-up/email");
    }
  });
});
