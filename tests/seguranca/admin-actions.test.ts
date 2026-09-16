import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { exigirAlvoPermitido, exigirPapelConvidavel, ordemDePrivilegio } from "@/lib/auth/permissoes/alvo";
import type { Sessao } from "@/lib/auth/guard";
import { PAPEIS, type Papel } from "@/lib/db/schema/_enums/auth";

/**
 * T14 — quem pode agir sobre quem (02-seguranca.md §2.3, S-17).
 *
 * Reprova quando alvo de papel IGUAL ou SUPERIOR é aceito, e quando o auto-alvo
 * passa. Sem isto, `admin` reseta, desativa, destrava, encerra sessões, troca
 * e-mail e recupera fator de outro `admin` e do `dono`.
 *
 * As partes que dependem de `src/lib/actions/usuarios.ts` — motivo obrigatório,
 * trilha ANTES do efeito, corrida de `FOR UPDATE` deixando zero dono — são do
 * pacote M7, que é dono daquele arquivo. A escada, que é o que pode ser
 * contornado em silêncio, está provada aqui.
 */

function sessao(papel: Papel, id = randomUUID()): Sessao {
  return {
    usuarioId: id,
    sessaoId: randomUUID(),
    papel,
    lojaId: papel === "vendedor" || papel === "viewer" ? randomUUID() : null,
    ativo: true,
    precisaTrocarSenha: false,
    precisaConfigurarFator: false,
  };
}

function alvo(papel: Papel) {
  return { id: randomUUID(), papel };
}

describe("guarda de alvo", () => {
  it("a ordem de privilégio é a de 01-dados.md §16.2", () => {
    expect([...PAPEIS]).toEqual(["dono", "admin", "gerente", "vendedor", "viewer"]);
    expect(ordemDePrivilegio("dono")).toBeLessThan(ordemDePrivilegio("admin"));
    expect(ordemDePrivilegio("admin")).toBeLessThan(ordemDePrivilegio("gerente"));
    expect(ordemDePrivilegio("viewer")).toBe(PAPEIS.length - 1);
  });

  it("auto-alvo é recusado em toda ação administrativa (INV-32)", () => {
    for (const papel of PAPEIS) {
      const ator = sessao(papel);
      // O caminho do próprio usuário é `/perfil/seguranca`, não a tela de
      // administração — senão `admin` se auto-reseta e escapa da escada.
      expect(() => exigirAlvoPermitido(ator, { id: ator.usuarioId, papel })).toThrow();
    }
  });

  it("admin NÃO alcança outro admin nem o dono (T14)", () => {
    const ator = sessao("admin");
    expect(() => exigirAlvoPermitido(ator, alvo("admin"))).toThrow();
    expect(() => exigirAlvoPermitido(ator, alvo("dono"))).toThrow();
  });

  it("dono alcança admin, gerente, vendedor e viewer", () => {
    const ator = sessao("dono");
    for (const papel of ["admin", "gerente", "vendedor", "viewer"] as Papel[]) {
      expect(() => exigirAlvoPermitido(ator, alvo(papel)), papel).not.toThrow();
    }
  });

  it("ninguém age sobre dono, exceto outro dono", () => {
    for (const papel of ["admin", "gerente", "vendedor", "viewer"] as Papel[]) {
      expect(() => exigirAlvoPermitido(sessao(papel), alvo("dono")), papel).toThrow();
    }
    expect(() => exigirAlvoPermitido(sessao("dono"), alvo("dono"))).not.toThrow();
  });

  it("papel igual nunca alcança papel igual", () => {
    for (const papel of ["admin", "gerente", "vendedor", "viewer"] as Papel[]) {
      expect(() => exigirAlvoPermitido(sessao(papel), alvo(papel)), papel).toThrow();
    }
  });

  it("papel inferior nunca alcança papel igual ou superior", () => {
    for (let i = 0; i < PAPEIS.length; i += 1) {
      for (let j = 0; j <= i; j += 1) {
        // A única exceção escrita é `dono -> dono`: sem ela, um dono nunca
        // poderia rebaixar o outro e a regra de "no máximo 2 donos" ficaria
        // sem saída (INV-31).
        if (PAPEIS[i] === "dono" && PAPEIS[j] === "dono") continue;
        const ator = sessao(PAPEIS[i]!);
        expect(() => exigirAlvoPermitido(ator, alvo(PAPEIS[j]!)), `${PAPEIS[i]}->${PAPEIS[j]}`)
          .toThrow();
      }
    }
  });

  it("o convite obedece à MESMA escada, e dono não é convidável", () => {
    const admin = sessao("admin");
    for (const papel of ["gerente", "vendedor", "viewer"] as Papel[]) {
      expect(() => exigirPapelConvidavel(admin, papel), papel).not.toThrow();
    }
    // Convite com papel `admin` só pelo dono, com ciência versionada.
    expect(() => exigirPapelConvidavel(admin, "admin")).toThrow();
    expect(() => exigirPapelConvidavel(sessao("dono"), "admin")).not.toThrow();
    // `dono` não é convidável nem pelo dono: posse só se transfere.
    expect(() => exigirPapelConvidavel(sessao("dono"), "dono")).toThrow();
  });

  it("a recusa é 403, não 404 nem 500", () => {
    try {
      exigirAlvoPermitido(sessao("admin"), alvo("admin"));
      throw new Error("deveria ter recusado");
    } catch (erro) {
      expect((erro as { status: number }).status).toBe(403);
      expect((erro as { codigo: string }).codigo).toBe("SEM_PERMISSAO");
    }
  });
});
