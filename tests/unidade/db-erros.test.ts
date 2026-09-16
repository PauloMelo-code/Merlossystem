import { describe, expect, it } from "vitest";
import { ehViolacaoDeUnico } from "@/lib/db/erros";

describe("ehViolacaoDeUnico", () => {
  it("reconhece o erro do pg direto", () => {
    expect(ehViolacaoDeUnico({ code: "23505", constraint: "uq_lojas_sla_provedor" }, "uq_lojas_sla_provedor")).toBe(true);
  });

  it("reconhece o erro embrulhado pelo Drizzle em `cause`", () => {
    const embrulhado = { message: "Failed query", cause: { code: "23505", constraint: "uq_a" } };
    expect(ehViolacaoDeUnico(embrulhado, "uq_b", "uq_a")).toBe(true);
  });

  it("constraint diferente não é a violação procurada", () => {
    expect(ehViolacaoDeUnico({ code: "23505", constraint: "uq_outra" }, "uq_a")).toBe(false);
  });

  it("código diferente (FK, CHECK) não é violação de único", () => {
    expect(ehViolacaoDeUnico({ code: "23503", constraint: "uq_a" }, "uq_a")).toBe(false);
    expect(ehViolacaoDeUnico(null, "uq_a")).toBe(false);
    expect(ehViolacaoDeUnico(new Error("x"), "uq_a")).toBe(false);
  });
});
