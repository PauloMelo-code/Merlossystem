import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Operação do pedido e seletor de produto (04-ui.md §5.2, §5.3, §9.1).
 *
 *   - lançar no Masc, dispensar e cancelar passam pelo block de 3 s com
 *     resumo concreto, e nada é gravado antes dos 3 s;
 *   - erro mantém o modal aberto, com a mensagem;
 *   - botão sem permissão não aparece (o botão nem deveria estar lá);
 *   - o seletor trata os estados: curto, vazio e erro.
 */

const acoes = vi.hoisted(() => ({
  cancelarPedido: vi.fn(),
  dispensarDoMasc: vi.fn(),
  lancarNoMasc: vi.fn(),
  mudarStatusDoPedido: vi.fn(),
  salvarRastreio: vi.fn(),
  voltarParaFilaMasc: vi.fn(),
}));
const catalogo = vi.hoisted(() => ({ buscarProdutosParaVenda: vi.fn() }));

vi.mock("@/lib/actions/pedidos", () => acoes);
vi.mock("@/lib/actions/catalogo", () => catalogo);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const { AcoesDoPedido } = await import("@/app/(app)/pedidos/[id]/_components/acoes-do-pedido");
const { SeletorProduto } = await import("@/app/(app)/conversas/_components/seletor-produto");

const PEDIDO = {
  id: "11111111-1111-4111-8111-111111111111",
  lojaId: "22222222-2222-4222-8222-222222222222",
  numero: "MS2609-CEN-0042",
  total: "395.00",
  status: "confirmado",
  mascStatus: "pendente",
  rastreioCodigo: null,
  rastreioUrl: null,
  entregaMetodo: null,
  atualizadoEm: "2026-09-16T12:00:00.000Z",
};
const TUDO = { editar: true, lancarMasc: true, dispensarMasc: true, cancelar: true };

function liberar() {
  act(() => {
    vi.advanceTimersByTime(3000);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("AcoesDoPedido", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("lançar no Masc exige o número e passa pelo block com o resumo", async () => {
    acoes.lancarNoMasc.mockResolvedValue({ ok: true, dados: { id: PEDIDO.id, atualizadoEm: new Date() } });
    render(<AcoesDoPedido pedido={PEDIDO} pode={TUDO} />);
    const botao = screen.getByRole("button", { name: "Marcar como lançado" });
    expect(botao.hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByLabelText("Número da venda no Masc"), { target: { value: "V-100" } });
    fireEvent.click(screen.getByRole("button", { name: "Marcar como lançado" }));

    const modal = screen.getByRole("alertdialog");
    expect(modal.textContent).toContain("MS2609-CEN-0042");
    expect(modal.textContent).toContain("V-100");

    const confirmar = within(modal).getByRole("button", { name: "Marcar como lançado" });
    fireEvent.click(confirmar);
    expect(acoes.lancarNoMasc).not.toHaveBeenCalled();

    liberar();
    await act(async () => {
      fireEvent.click(confirmar);
    });
    expect(acoes.lancarNoMasc).toHaveBeenCalledWith({
      id: PEDIDO.id,
      updatedAt: PEDIDO.atualizadoEm,
      loja: PEDIDO.lojaId,
      mascVendaId: "V-100",
    });
  });

  it("cancelar é destrutivo, pede motivo e o erro mantém o modal aberto", async () => {
    acoes.cancelarPedido.mockResolvedValue({
      ok: false,
      codigo: "COLISAO",
      mensagem: "Este registro foi alterado por outra pessoa.",
    });
    render(<AcoesDoPedido pedido={PEDIDO} pode={TUDO} />);
    fireEvent.change(screen.getByLabelText("Motivo do cancelamento"), {
      target: { value: "cliente desistiu da compra" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar pedido" }));
    const modal = screen.getByRole("alertdialog");
    expect(modal.textContent).toContain("cliente desistiu da compra");

    liberar();
    await act(async () => {
      fireEvent.click(within(modal).getByRole("button", { name: "Cancelar pedido" }));
    });
    expect(acoes.cancelarPedido).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alertdialog").textContent).toContain("alterado por outra pessoa");
  });

  it("sem permissão, o botão não existe; pedido cancelado não oferece operação", () => {
    const { unmount } = render(
      <AcoesDoPedido pedido={PEDIDO} pode={{ editar: true, lancarMasc: true, dispensarMasc: false, cancelar: false }} />,
    );
    expect(screen.queryByRole("button", { name: "Dispensar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancelar pedido" })).toBeNull();
    unmount();

    render(<AcoesDoPedido pedido={{ ...PEDIDO, status: "cancelado" }} pode={TUDO} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("pedido já lançado oferece voltar para a fila, sem block", async () => {
    acoes.voltarParaFilaMasc.mockResolvedValue({ ok: true, dados: { id: PEDIDO.id, atualizadoEm: new Date() } });
    render(<AcoesDoPedido pedido={{ ...PEDIDO, mascStatus: "lancado" }} pode={TUDO} />);
    expect(screen.queryByRole("button", { name: "Marcar como lançado" })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Voltar para a fila do Masc" }));
    });
    expect(acoes.voltarParaFilaMasc).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("SeletorProduto", () => {
  it("pede 2 letras, busca depois da espera e mostra o vazio com dica", async () => {
    vi.useFakeTimers();
    catalogo.buscarProdutosParaVenda.mockResolvedValue({ ok: true, dados: [] });
    render(<SeletorProduto onEscolher={vi.fn()} />);
    expect(screen.getByText("Digite ao menos 2 letras.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Buscar produto"), { target: { value: "ve" } });
    expect(catalogo.buscarProdutosParaVenda).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(260);
    });
    expect(catalogo.buscarProdutosParaVenda).toHaveBeenCalledWith({ termo: "ve" });
    expect(screen.getByText(/Nenhum produto para "ve"/)).toBeTruthy();
  });

  it("escolher devolve o SKU; erro aparece como alerta", async () => {
    vi.useFakeTimers();
    const escolher = vi.fn();
    catalogo.buscarProdutosParaVenda.mockResolvedValueOnce({
      ok: true,
      dados: [{ id: "p1", nome: "Vestido Midi", sku: "VEST-1", preco: "129.90" }],
    });
    render(<SeletorProduto onEscolher={escolher} lojaId="loja-1" />);
    fireEvent.change(screen.getByLabelText("Buscar produto"), { target: { value: "vestido" } });
    await act(async () => {
      vi.advanceTimersByTime(260);
    });
    expect(catalogo.buscarProdutosParaVenda).toHaveBeenCalledWith({ termo: "vestido", loja: "loja-1" });
    fireEvent.click(screen.getByRole("button", { name: /Vestido Midi/ }));
    expect(escolher).toHaveBeenCalledWith("VEST-1");

    catalogo.buscarProdutosParaVenda.mockResolvedValueOnce({
      ok: false,
      codigo: "INESPERADO",
      mensagem: "Não foi possível concluir.",
    });
    fireEvent.change(screen.getByLabelText("Buscar produto"), { target: { value: "vestid" } });
    await act(async () => {
      vi.advanceTimersByTime(260);
    });
    expect(screen.getByRole("alert").textContent).toContain("Não foi possível concluir.");
  });
});
