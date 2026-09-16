import { describe, expect, it } from "vitest";
import { valoresDoFormulario } from "@/lib/actions/_base";

/**
 * O que volta em `valores` depois de um erro de validação vai ao navegador.
 * Segredo e documento nunca voltam (R2: pagamentos, IA e canais extras).
 */
describe("valoresDoFormulario", () => {
  it("devolve só o campo comum; segredo, documento e assinatura ficam de fora", () => {
    const form = new FormData();
    for (const campo of ["senha", "accessToken", "segredoWebhook", "pagadorCpf", "cnpj", "assinaturaSecreta"]) {
      form.set(campo, "valor-sensivel");
    }
    form.set("nome", "Maria");
    expect(valoresDoFormulario(form)).toEqual({ nome: "Maria" });
  });

  it("entrada que não é FormData não tem valores", () => {
    expect(valoresDoFormulario({ nome: "Maria" })).toBeUndefined();
  });
});
