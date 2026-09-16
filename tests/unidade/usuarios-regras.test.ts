import { describe, expect, it } from "vitest";
import {
  conferirDestinoDePapel,
  conferirQuadro,
  acoesDisponiveis,
  conferirReativacao,
  eventoDaTroca,
  papeisConvidaveisPor,
  quadroDepois,
} from "@/lib/usuarios/regras";
import {
  FRASE_CIENCIA_ADMIN,
  alvoSchema,
  cerimoniaAdminSchema,
  convidarSchema,
  trocarPapelSchema,
} from "@/lib/validadores/usuarios";

/**
 * Regras puras da administração de acessos (02-seguranca.md §2.3, §9.2, §11.2).
 *
 * Reprova quando: uma operação deixa zero dono, três donos ou zero admin;
 * `trocarPapel` concede `admin`/`dono` por fora da cerimônia; o convite aceita
 * papel sem loja coerente ou `admin` sem ciência; e quando qualquer esquema
 * aceita campo a mais (o `...input` sobre a linha, H12).
 */

const UUID = "7b0c7f5e-2d1a-4c55-9a51-3f1f4c1c0a01";

describe("quadro de privilégio (INV-31)", () => {
  const rebaixarDono = {
    antes: { papel: "dono" as const, ativo: true },
    depois: { papel: "admin" as const, ativo: true },
  };

  it("recusa zerar os donos", () => {
    const antes = { donos: 1, admins: 1 };
    expect(() => conferirQuadro(antes, quadroDepois(antes, [rebaixarDono]))).toThrow(/um dono/);
  });

  it("aceita rebaixar um de dois donos", () => {
    const antes = { donos: 2, admins: 1 };
    expect(() => conferirQuadro(antes, quadroDepois(antes, [rebaixarDono]))).not.toThrow();
  });

  it("recusa o terceiro dono", () => {
    const antes = { donos: 2, admins: 2 };
    const promover = {
      antes: { papel: "admin" as const, ativo: true },
      depois: { papel: "dono" as const, ativo: true },
    };
    expect(() => conferirQuadro(antes, quadroDepois(antes, [promover]))).toThrow(/no máximo 2/);
  });

  it("transferir a posse não muda o número de donos", () => {
    const antes = { donos: 1, admins: 1 };
    const depois = quadroDepois(antes, [
      { antes: { papel: "admin", ativo: true }, depois: { papel: "dono", ativo: true } },
      { antes: { papel: "dono", ativo: true }, depois: { papel: "admin", ativo: true } },
    ]);
    expect(depois).toEqual({ donos: 1, admins: 1 });
    expect(() => conferirQuadro(antes, depois)).not.toThrow();
  });

  it("recusa desativar o último admin, mas não trava o sistema recém-semeado", () => {
    const antes = { donos: 1, admins: 1 };
    const desativar = {
      antes: { papel: "admin" as const, ativo: true },
      depois: { papel: "admin" as const, ativo: false },
    };
    expect(() => conferirQuadro(antes, quadroDepois(antes, [desativar]))).toThrow(/administrador/);
    // Um dono e zero admin é o estado depois da semeadura: nada piora.
    expect(() => conferirQuadro({ donos: 1, admins: 0 }, { donos: 1, admins: 0 })).not.toThrow();
  });

  it("conta desativada não entra no quadro", () => {
    const depois = quadroDepois({ donos: 1, admins: 0 }, [
      { antes: { papel: "dono", ativo: false }, depois: { papel: "dono", ativo: false } },
    ]);
    expect(depois).toEqual({ donos: 1, admins: 0 });
  });
});

describe("destino de papel", () => {
  it("dono nunca é destino", () => {
    expect(() => conferirDestinoDePapel("dono", "admin", "dono")).toThrow();
  });

  it("admin só é destino no rebaixamento de dono", () => {
    expect(() => conferirDestinoDePapel("dono", "gerente", "admin")).toThrow(/Promover/);
    expect(() => conferirDestinoDePapel("dono", "dono", "admin")).not.toThrow();
  });

  it("o destino fica estritamente abaixo do ator", () => {
    expect(() => conferirDestinoDePapel("admin", "vendedor", "gerente")).not.toThrow();
    expect(() => conferirDestinoDePapel("gerente", "vendedor", "gerente")).toThrow();
  });

  it("rebaixar admin vira `admin_rebaixado`; o resto, `papel_alterado`", () => {
    expect(eventoDaTroca("admin", "gerente")).toBe("admin_rebaixado");
    expect(eventoDaTroca("dono", "admin")).toBe("papel_alterado");
    expect(eventoDaTroca("vendedor", "viewer")).toBe("papel_alterado");
  });

  it("o convite oferece só o que está abaixo do ator, e nunca dono", () => {
    expect(papeisConvidaveisPor("dono")).toEqual(["admin", "gerente", "vendedor", "viewer"]);
    expect(papeisConvidaveisPor("admin")).toEqual(["gerente", "vendedor", "viewer"]);
    expect(papeisConvidaveisPor("vendedor")).toEqual(["viewer"]);
  });

  it("reativar exige conta inativa que já concluiu o 2º fator", () => {
    expect(() => conferirReativacao({ ativo: true, temFator: true })).toThrow(/já está ativa/);
    expect(() => conferirReativacao({ ativo: false, temFator: false })).toThrow(/primeiro acesso/);
    expect(() => conferirReativacao({ ativo: false, temFator: true })).not.toThrow();
  });
});

describe("esquemas", () => {
  const convite = { email: "Nova@Loja.COM", papel: "vendedor", lojaId: UUID, motivo: "entrou hoje na loja" };

  it("normaliza o e-mail e exige loja para vendedora", () => {
    const ok = convidarSchema.safeParse(convite);
    expect(ok.success && ok.data.email).toBe("nova@loja.com");
    expect(convidarSchema.safeParse({ ...convite, lojaId: "" }).success).toBe(false);
  });

  it("gestão não tem loja", () => {
    expect(convidarSchema.safeParse({ ...convite, papel: "gerente" }).success).toBe(false);
    expect(convidarSchema.safeParse({ ...convite, papel: "gerente", lojaId: "" }).success).toBe(true);
  });

  it("convite de admin só com a ciência digitada", () => {
    const admin = { ...convite, papel: "admin", lojaId: "" };
    expect(convidarSchema.safeParse(admin).success).toBe(false);
    expect(convidarSchema.safeParse({ ...admin, ciencia: "sim" }).success).toBe(false);
    expect(convidarSchema.safeParse({ ...admin, ciencia: FRASE_CIENCIA_ADMIN }).success).toBe(true);
  });

  it("dono não é convidável nem pelo esquema", () => {
    expect(convidarSchema.safeParse({ ...convite, papel: "dono", lojaId: "" }).success).toBe(false);
  });

  it("motivo tem de 8 a 255 caracteres", () => {
    expect(alvoSchema.safeParse({ alvoId: UUID, motivo: "curto" }).success).toBe(false);
    expect(alvoSchema.safeParse({ alvoId: UUID, motivo: "x".repeat(256) }).success).toBe(false);
    expect(alvoSchema.safeParse({ alvoId: UUID, motivo: "saiu da empresa" }).success).toBe(true);
  });

  it("nenhum esquema aceita campo de privilégio a mais (H12) nem senha (E8)", () => {
    const base = { alvoId: UUID, motivo: "saiu da empresa" };
    for (const extra of [{ ativo: true }, { papel: "dono" }, { novaSenha: "x".repeat(20) }]) {
      expect(alvoSchema.safeParse({ ...base, ...extra }).success).toBe(false);
    }
    const troca = { ...base, updatedAt: new Date().toISOString(), papel: "gerente", lojaId: "" };
    expect(trocarPapelSchema.safeParse(troca).success).toBe(true);
    expect(trocarPapelSchema.safeParse({ ...troca, two_factor_enabled: false }).success).toBe(false);
    expect(trocarPapelSchema.safeParse({ ...troca, papel: "dono" }).success).toBe(false);
  });

  it("a cerimônia de admin exige a frase exata", () => {
    const base = { alvoId: UUID, updatedAt: new Date().toISOString(), motivo: "assume a operação" };
    expect(cerimoniaAdminSchema.safeParse({ ...base, ciencia: "concordo" }).success).toBe(false);
    expect(
      cerimoniaAdminSchema.safeParse({ ...base, ciencia: FRASE_CIENCIA_ADMIN.toLowerCase() }).success,
    ).toBe(true);
  });
});

describe("ações oferecidas na linha", () => {
  const ator = (papel: "dono" | "admin" | "gerente", id = "a") => ({
    usuarioId: id,
    sessaoId: "s",
    papel,
    lojaId: null,
    ativo: true as const,
    precisaTrocarSenha: false,
    precisaConfigurarFator: false,
  });
  const alvo = (papel: "dono" | "admin" | "gerente" | "vendedor", extra = {}) => ({
    id: "b",
    papel,
    ativo: true,
    emProvisionamento: false,
    bloqueado: false,
    ...extra,
  });

  it("admin não vê nada sobre admin nem sobre dono; gerente não vê nada", () => {
    expect(acoesDisponiveis(ator("admin"), alvo("admin"))).toEqual([]);
    expect(acoesDisponiveis(ator("admin"), alvo("dono"))).toEqual([]);
    expect(acoesDisponiveis(ator("gerente"), alvo("vendedor"))).toEqual([]);
  });

  it("a própria linha não oferece nada (INV-32)", () => {
    expect(acoesDisponiveis(ator("dono", "b"), alvo("dono"))).toEqual([]);
  });

  it("admin sobre vendedora: tudo menos promover e transferir", () => {
    const lista = acoesDisponiveis(ator("admin"), alvo("vendedor", { bloqueado: true }));
    expect(lista).toEqual(
      expect.arrayContaining(["papel", "desativar", "destravar", "reset", "recuperar", "sessoes", "email"]),
    );
    expect(lista).not.toContain("promover");
    expect(lista).not.toContain("transferir");
    expect(lista).not.toContain("reativar");
  });

  it("dono promove quem está abaixo e transfere só para admin", () => {
    expect(acoesDisponiveis(ator("dono"), alvo("gerente"))).toContain("promover");
    expect(acoesDisponiveis(ator("dono"), alvo("gerente"))).not.toContain("transferir");
    expect(acoesDisponiveis(ator("dono"), alvo("admin"))).toContain("transferir");
    expect(acoesDisponiveis(ator("dono"), alvo("gerente", { ativo: false }))).toContain("reativar");
  });
});
