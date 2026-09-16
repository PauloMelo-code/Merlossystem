import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A busca da barra acompanha a URL: "Limpar filtros" apaga o parâmetro por
 * fora, e o debounce NÃO pode devolver o termo antigo para a URL.
 */

const navegacao = vi.hoisted(() => ({
  parametros: new URLSearchParams(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/contatos",
  useSearchParams: () => navegacao.parametros,
  useRouter: () => ({ replace: navegacao.replace, push: vi.fn(), refresh: vi.fn() }),
}));

const { BarraFerramentas } = await import("@/components/comum/barra-ferramentas");

const BUSCA = { parametro: "busca", placeholder: "Buscar contato" };

beforeEach(() => {
  vi.useFakeTimers();
  navegacao.replace.mockReset();
  navegacao.parametros = new URLSearchParams();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("BarraFerramentas — busca", () => {
  it("a limpeza externa esvazia o campo e não volta para a URL", () => {
    navegacao.parametros = new URLSearchParams("busca=ana");
    const { rerender } = render(<BarraFerramentas busca={BUSCA} />);
    const campo = screen.getByLabelText("Buscar contato") as HTMLInputElement;
    expect(campo.value).toBe("ana");

    navegacao.parametros = new URLSearchParams();
    rerender(<BarraFerramentas busca={BUSCA} />);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(campo.value).toBe("");
    expect(navegacao.replace).not.toHaveBeenCalled();
  });

  it("o que a pessoa digita depois do envio não é apagado pela URL atrasada", () => {
    const { rerender } = render(<BarraFerramentas busca={BUSCA} />);
    const campo = screen.getByLabelText("Buscar contato") as HTMLInputElement;

    fireEvent.change(campo, { target: { value: "an" } });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(navegacao.replace).toHaveBeenLastCalledWith("/contatos?busca=an");

    fireEvent.change(campo, { target: { value: "ana" } });
    navegacao.parametros = new URLSearchParams("busca=an");
    rerender(<BarraFerramentas busca={BUSCA} />);
    expect(campo.value).toBe("ana");

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(navegacao.replace).toHaveBeenLastCalledWith("/contatos?busca=ana");
  });
});
