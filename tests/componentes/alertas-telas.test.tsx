import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";

/**
 * `/alertas` e `/relatorios` (04-ui.md §5.5), no componente:
 *   - cada alerta abre o objeto; "Reconhecer" só aparece quando pode E quando a
 *     gravação existe (a action decide `podeReconhecer`);
 *   - reconhecer manda o `updated_at` visto (trava de colisão) e mostra o erro;
 *   - relatórios: tabela alternativa com caption, exportar chama a action.
 */

const acoes = vi.hoisted(() => ({ reconhecerAlerta: vi.fn(), exportarRelatorioCsv: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const refresh = vi.hoisted(() => vi.fn());

vi.mock("@/lib/actions/alertas", () => ({ reconhecerAlerta: acoes.reconhecerAlerta }));
vi.mock("@/lib/actions/relatorios", () => ({ exportarRelatorioCsv: acoes.exportarRelatorioCsv }));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));

const { ListaAlertas } = await import("@/app/(app)/alertas/_components/lista-alertas");
const { TabelaDiaria } = await import("@/app/(app)/relatorios/_components/tabela-diaria");
const { BotaoExportar } = await import("@/app/(app)/relatorios/_components/botao-exportar");

const alerta = {
  id: "a1",
  tipo: "sla_estourado",
  severidade: "alta",
  mensagem: "Conversa sem resposta há mais de 5 min.",
  rota: "/conversas/c1",
  criadoEm: "2026-09-10T15:00:00.000Z",
  updatedAt: "2026-09-10T15:00:00.123Z",
  reconhecidoEm: null,
  reconhecidoPor: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("central de alertas", () => {
  it("vazio com e sem filtro", () => {
    const { rerender } = render(<ListaAlertas alertas={[]} podeReconhecer comFiltro={false} />);
    expect(screen.getByText("Nenhum alerta aberto.")).toBeTruthy();
    rerender(<ListaAlertas alertas={[]} podeReconhecer comFiltro />);
    expect(screen.getByText("Nenhum alerta com esses filtros.")).toBeTruthy();
  });

  it("com itens: severidade, tipo em PT-BR e link para o objeto", async () => {
    const { container } = render(<ListaAlertas alertas={[alerta]} podeReconhecer={false} comFiltro={false} />);
    expect(screen.getAllByText("SLA estourado").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Alta").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: alerta.mensagem })[0]?.getAttribute("href")).toBe("/conversas/c1");
    // Sem permissão (ou sem gravação): nada de botão de fachada.
    expect(screen.queryByRole("button", { name: /reconhecer/i })).toBeNull();
    expect(screen.getAllByText("Aguardando").length).toBeGreaterThan(0);
    const r = await axe(container);
    expect(r.violations.filter((v) => ["serious", "critical"].includes(String(v.impact)))).toEqual([]);
  });

  it("reconhecido mostra quem e quando", () => {
    render(
      <ListaAlertas
        alertas={[{ ...alerta, reconhecidoEm: "2026-09-10T16:00:00.000Z", reconhecidoPor: "Bia" }]}
        podeReconhecer
        comFiltro={false}
      />,
    );
    expect(screen.getAllByText(/Reconhecido por Bia/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /reconhecer/i })).toBeNull();
  });

  it("reconhecer envia o updated_at visto e mostra o erro de colisão", async () => {
    acoes.reconhecerAlerta.mockResolvedValue({ ok: false, codigo: "COLISAO", mensagem: "Alterado por outra pessoa." });
    render(<ListaAlertas alertas={[alerta]} podeReconhecer comFiltro={false} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Reconhecer" })[0]!);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Alterado por outra pessoa."));
    expect(acoes.reconhecerAlerta).toHaveBeenCalledWith({ id: "a1", updated_at: alerta.updatedAt });
    expect(refresh).toHaveBeenCalled();
  });
});

describe("relatórios", () => {
  it("tabela alternativa tem legenda e cabeçalhos de linha", () => {
    render(<TabelaDiaria legenda="Receita e conversas por dia" linhas={[{ dia: "01/09/2026", receita: "R$ 10,00", conversas: "3" }]} />);
    expect(screen.getByRole("table", { name: "Receita e conversas por dia" })).toBeTruthy();
    expect(screen.getByRole("rowheader", { name: "01/09/2026" })).toBeTruthy();
  });

  it("exportar chama a action com o mesmo período e avisa o erro", async () => {
    acoes.exportarRelatorioCsv.mockResolvedValue({ ok: false, codigo: "SEM_PERMISSAO", mensagem: "Sem acesso." });
    render(<BotaoExportar de="2026-09-01" ate="2026-09-30" />);
    fireEvent.click(screen.getByRole("button", { name: /exportar csv/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Sem acesso."));
    expect(acoes.exportarRelatorioCsv).toHaveBeenCalledWith({ de: "2026-09-01", ate: "2026-09-30" });
  });
});
