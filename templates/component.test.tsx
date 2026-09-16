// TEMPLATE — copie para `tests/componentes/<dominio>-<assunto>.test.tsx`.
// Projeto `componentes` do Vitest: jsdom, `globals: true`, setup em
// `config/vitest.setup.ts` (cleanup do RTL e stub de matchMedia).
//
// O que um teste de componente prova aqui: os QUATRO estados, o teclado, a
// acessibilidade e o comportamento do modal de bloqueio. O que ele NAO prova:
// permissao e escopo de loja — isso e do portao, e o teste e de integracao.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { matchers } from "vitest-axe/matchers";
import { CartaoExemplo } from "@/app/(app)/exemplo/_components/cartao-exemplo";

expect.extend(matchers);

const props = {
  id: "11111111-1111-4111-8111-111111111111",
  nome: "Vestido midi",
  status: "ativo",
  valor: "259.90",
  aoSalvar: async () => {},
};

describe("CartaoExemplo", () => {
  it("mostra o estado vazio com o proximo passo, nao so 'sem dados'", () => {
    render(<CartaoExemplo {...props} nome="" />);
    expect(screen.getByText(/nada por aqui/i)).toBeDefined();
    expect(screen.getByText(/cadastre o primeiro/i)).toBeDefined();
  });

  it("formata dinheiro pelo modulo unico, sem toFixed na tela", () => {
    render(<CartaoExemplo {...props} />);
    expect(screen.getByText(/R\$\s?259,90/)).toBeDefined();
  });

  it("associa o rotulo ao campo (o defeito mais repetido do sistema antigo)", () => {
    render(<CartaoExemplo {...props} />);
    // `getByLabelText` so acha se `label` e `input` estiverem ligados.
    expect(screen.getByLabelText("Nome")).toBeDefined();
  });

  it("chega ao botao de salvar so com o teclado", async () => {
    const usuario = userEvent.setup();
    render(<CartaoExemplo {...props} />);
    await usuario.tab();
    await usuario.tab();
    expect(screen.getByRole("button", { name: /salvar/i })).toBe(document.activeElement);
  });

  it("nao tem violacao seria de acessibilidade", async () => {
    const { container } = render(<CartaoExemplo {...props} />);
    // A regra `color-contrast` fica INCOMPLETA no jsdom (falta canvas); o
    // contraste dos tokens e provado por calculo em tokens.test.ts.
    const resultado = await axe(container);
    const serias = resultado.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact ?? ""),
    );
    expect(serias).toEqual([]);
  });
});

/**
 * Para acao critica, o teste do modal de bloqueio usa TIMERS FALSOS:
 *
 *   vi.useFakeTimers();
 *   ... render ...
 *   expect(botaoConfirmar).toHaveAttribute("aria-disabled", "true");
 *   await vi.advanceTimersByTimeAsync(3000);
 *   expect(botaoConfirmar).not.toHaveAttribute("aria-disabled", "true");
 *
 * E ACRESCENTE o identificador da tela a `telasLigadas` em
 * `tests/componentes/block-3s.test.tsx`, subindo o piso. Sem isso a trava
 * continua verde com zero telas ligadas — ou seja, e decoracao.
 */
