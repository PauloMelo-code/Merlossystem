import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Telas de configuração de M5 (04-ui.md §5.6, §9.1 itens 7, 8 e 9, §10).
 *
 * Ligam três itens da lista fechada do block de 3 s: desconectar integração,
 * parear novo aparelho e criar/editar/desativar loja. As provas estão aqui; o
 * inventário de `block-3s.test.tsx` é da fundação e sobe na integração.
 */

const acoesLojas = vi.hoisted(() => ({
  listarLojas: vi.fn(),
  criarLoja: vi.fn(),
  editarLoja: vi.fn(),
  desativarLoja: vi.fn(),
}));
const acoesIntegracoes = vi.hoisted(() => ({
  listarIntegracoes: vi.fn(),
  detalharIntegracao: vi.fn(),
  conectarContaPorToken: vi.fn(),
  editarIntegracao: vi.fn(),
  reautenticarIntegracao: vi.fn(),
  desconectarIntegracao: vi.fn(),
  parearAparelho: vi.fn(),
  consultarSessaoDoAparelho: vi.fn(),
  iniciarConexaoBling: vi.fn(),
}));

// O RadioGroup do Radix mede o item; o jsdom não tem ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

vi.mock("@/lib/actions/lojas", () => acoesLojas);
vi.mock("@/lib/actions/integracoes", () => acoesIntegracoes);
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const { PainelLojas } = await import("@/app/(app)/configuracoes/lojas/_components/painel-lojas");
const { resumoDaLoja } = await import("@/app/(app)/configuracoes/lojas/_components/formulario-loja");
const { PainelIntegracoes } = await import(
  "@/app/(app)/configuracoes/integracoes/_components/painel-integracoes"
);
const { FormularioConexao } = await import(
  "@/app/(app)/configuracoes/integracoes/_components/formulario-conexao"
);
const { AcoesDaConta } = await import("@/app/(app)/configuracoes/integracoes/[id]/_components/acoes-da-conta");
const { textoDaCredencial } = await import("@/app/(app)/configuracoes/integracoes/_credencial");

const LOJA = {
  id: "11111111-1111-4111-8111-111111111111",
  nome: "Centro",
  slug: "centro",
  sigla: "CEN",
  blingDepositoId: "123",
  updatedAt: "2026-09-16T09:00:00.000Z",
};
const PODE_TUDO = { criar: true, editar: true, excluir: true };

const CONTA = {
  id: "22222222-2222-4222-8222-222222222222",
  provedor: "uazapi",
  rotulo: "WhatsApp Vendas Centro",
  lojaNome: "Centro",
  status: "erro",
  expiraEm: null,
  ultimoErro: "Sessão do aparelho desconectada.",
  ultimaSincronizacao: null,
  finalDaCredencial: "token ********WXYZ",
};

function liberarBlock() {
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

describe("lojas", () => {
  it("o resumo do block mostra o diff 'de X para Y', sigla incluída", () => {
    const antes = { nome: "Centro", slug: "centro", sigla: "CEN", blingDepositoId: "123" };
    const resumo = resumoDaLoja(antes, { ...antes, sigla: "CTR" });
    expect(resumo).toBe('Sigla: de "CEN" para "CTR".');
    expect(resumoDaLoja(null, { ...antes, blingDepositoId: "" })).toContain("sem depósito do Bling");
  });

  it("desativar espera 3 s; erro mantém o modal aberto com o motivo", async () => {
    vi.useFakeTimers();
    acoesLojas.desativarLoja.mockResolvedValue({
      ok: false,
      codigo: "VALIDACAO",
      mensagem: "Esta loja ainda está em uso.",
      erros: { _: ["2 pessoa(s) ativa(s) nesta loja — mude a loja delas antes"] },
    });
    render(<PainelLojas lojas={[LOJA]} pode={PODE_TUDO} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Desativar" })[0]!);

    const dialogo = screen.getByRole("alertdialog");
    expect(dialogo.textContent).toContain('"Centro" (CEN)');
    fireEvent.click(within(dialogo).getByRole("button", { name: "Desativar loja" }));
    expect(acoesLojas.desativarLoja).not.toHaveBeenCalled();

    liberarBlock();
    await act(async () => {
      fireEvent.click(within(dialogo).getByRole("button", { name: "Desativar loja" }));
    });
    expect(acoesLojas.desativarLoja).toHaveBeenCalledWith({ id: LOJA.id, updatedAt: LOJA.updatedAt });
    expect(screen.getByRole("alertdialog").textContent).toContain("2 pessoa(s) ativa(s)");
  });

  it("quem só lê não vê botão de escrita", () => {
    render(<PainelLojas lojas={[LOJA]} pode={{ criar: false, editar: false, excluir: false }} />);
    expect(screen.queryByRole("button", { name: /Nova loja|Editar|Desativar/ })).toBeNull();
  });

  it("depósito: com a lista do Bling escolhe; sem ela, digita o número", () => {
    const depositos = [
      { id: "123", descricao: "Centro", padrao: true, ativo: true },
      { id: "456", descricao: "Antigo", padrao: false, ativo: false },
      { id: "789", descricao: "Praia", padrao: false, ativo: true },
    ];
    const comLista = render(<PainelLojas lojas={[{ ...LOJA, blingDepositoId: "999" }]} pode={PODE_TUDO} depositos={depositos} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Editar" })[0]!);
    const lista = screen.getByLabelText(/Depósito do Bling/) as HTMLSelectElement;
    expect(lista.tagName).toBe("SELECT");
    const opcoes = [...lista.options].map((o) => o.textContent);
    // O inativo some; o atual que o Bling não tem mais continua, marcado.
    expect(opcoes).toEqual([
      "Sem depósito",
      "Centro (nº 123) · padrão",
      "Praia (nº 789)",
      "não encontrado no Bling (nº 999) · inativo",
    ]);
    expect(lista.value).toBe("999");
    comLista.unmount();

    render(<PainelLojas lojas={[LOJA]} pode={PODE_TUDO} depositos={null} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Editar" })[0]!);
    const digitado = screen.getByLabelText(/Depósito do Bling/) as HTMLInputElement;
    expect(digitado.tagName).toBe("INPUT");
    expect(digitado.value).toBe("123");
    expect(screen.getByText(/A lista do Bling não está disponível agora/)).toBeTruthy();
  });

  it("sem loja: estado vazio com a próxima ação", () => {
    render(<PainelLojas lojas={[]} pode={PODE_TUDO} />);
    expect(screen.getByText("Nenhuma loja cadastrada.")).toBeTruthy();
  });
});

describe("integrações — lista", () => {
  const props = { lojas: [{ id: LOJA.id, nome: "Centro" }], blingConfigurado: true, retornoBling: null };

  it("vazio com ação para quem conecta; 'fale com o administrador' para os demais", () => {
    const { unmount } = render(<PainelIntegracoes contas={[]} podeConectar {...props} />);
    expect(screen.getByText("Nenhum número conectado nesta loja.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Conectar número" })).toBeTruthy();
    unmount();
    render(<PainelIntegracoes contas={[]} podeConectar={false} {...props} />);
    expect(screen.getByText("Fale com o administrador.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Conectar/ })).toBeNull();
  });

  it("mostra status, último erro e só o final da credencial", () => {
    const { baseElement } = render(<PainelIntegracoes contas={[CONTA]} podeConectar {...props} />);
    expect(screen.getAllByText("Com erro").length).toBeGreaterThan(0);
    expect(baseElement.textContent).toContain("********WXYZ");
    expect(baseElement.textContent).toContain("Sessão do aparelho desconectada.");
  });

  it("retorno do OAuth expirado vira faixa que diz o que fazer", () => {
    render(<PainelIntegracoes contas={[]} podeConectar {...props} retornoBling="expirado" />);
    expect(screen.getByText(/Clique em Conectar Bling de novo/)).toBeTruthy();
  });

  it("credencial ilegível tem texto próprio e não derruba a lista", () => {
    expect(textoDaCredencial({ erro: "ilegivel" })).toBe("não foi possível ler esta credencial");
    expect(textoDaCredencial({ token: "****WXYZ" })).toBe("token ****WXYZ");
  });
});

describe("integrações — conectar por token", () => {
  it("campo por chave do provedor escolhido, com aviso do uazapi", () => {
    render(<FormularioConexao lojas={[{ id: LOJA.id, nome: "Centro" }]} onConcluido={vi.fn()} />);
    expect(screen.getByLabelText("access_token")).toBeTruthy();
    expect(screen.getByLabelText("waba_id")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("WhatsApp não oficial (uazapi)"));
    expect(screen.getByLabelText("token")).toBeTruthy();
    expect(screen.queryByLabelText("access_token")).toBeNull();
    expect(screen.getByText(/pode ser banido/)).toBeTruthy();
    expect((screen.getByLabelText("token") as HTMLInputElement).type).toBe("password");
  });

  it("o segredo do webhook aparece uma vez, depois do sucesso", async () => {
    acoesIntegracoes.conectarContaPorToken.mockResolvedValue({
      ok: true,
      dados: { id: CONTA.id, segredoWebhook: "segredo-mostrado-uma-vez", urlDoWebhook: "http://x/api/webhooks/uazapi/abc" },
    });
    render(<FormularioConexao lojas={[{ id: LOJA.id, nome: "Centro" }]} onConcluido={vi.fn()} />);
    await act(async () => {
      fireEvent.submit(screen.getByRole("button", { name: "Conectar conta" }).closest("form")!);
    });
    await waitFor(() => expect(screen.getByText("segredo-mostrado-uma-vez")).toBeTruthy());
    expect(screen.getByText(/aparece só agora/)).toBeTruthy();
  });
});

describe("acessibilidade (sem violação séria nem crítica)", () => {
  const GRAVES = new Set(["serious", "critical"]);
  async function conferir(no: HTMLElement) {
    const { axe } = await import("vitest-axe");
    const r = await axe(no);
    expect(r.violations.filter((v) => GRAVES.has(String(v.impact))).map((v) => v.id)).toEqual([]);
  }

  it("lista de integrações, formulário de conexão e lista de lojas", async () => {
    const lista = render(
      <PainelIntegracoes contas={[CONTA]} podeConectar lojas={[{ id: LOJA.id, nome: "Centro" }]} blingConfigurado retornoBling={null} />,
    );
    await conferir(lista.container);
    lista.unmount();
    const form = render(<FormularioConexao lojas={[{ id: LOJA.id, nome: "Centro" }]} onConcluido={vi.fn()} />);
    await conferir(form.container);
    form.unmount();
    const lojas = render(<PainelLojas lojas={[LOJA]} pode={PODE_TUDO} />);
    await conferir(lojas.container);
  });
});

describe("integrações — desconectar e parear (block 3 s)", () => {
  it("desconectar resume o efeito e só chama o servidor depois dos 3 s", async () => {
    vi.useFakeTimers();
    acoesIntegracoes.desconectarIntegracao.mockResolvedValue({ ok: true, dados: null });
    render(
      <AcoesDaConta id={CONTA.id} rotulo={CONTA.rotulo} lojaNome="Centro" provedor="uazapi"
        updatedAt={LOJA.updatedAt} podeDesconectar podeParear />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Desconectar" }));
    const dialogo = screen.getByRole("alertdialog");
    expect(dialogo.textContent).toContain("credencial guardada é apagada");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Desconectar" }));
    expect(acoesIntegracoes.desconectarIntegracao).not.toHaveBeenCalled();
    liberarBlock();
    await act(async () => {
      fireEvent.click(within(dialogo).getByRole("button", { name: "Desconectar" }));
    });
    expect(acoesIntegracoes.desconectarIntegracao).toHaveBeenCalledWith({ id: CONTA.id, updatedAt: LOJA.updatedAt });
  });

  it("parear novo aparelho passa pelo block e só existe no uazapi", async () => {
    vi.useFakeTimers();
    acoesIntegracoes.parearAparelho.mockResolvedValue({
      ok: true,
      dados: { estado: "conectando", qr: "data:image/png;base64,AAAA", validadeS: 45, updatedAt: new Date() },
    });
    const { unmount } = render(
      <AcoesDaConta id={CONTA.id} rotulo={CONTA.rotulo} lojaNome="Centro" provedor="uazapi"
        updatedAt={LOJA.updatedAt} podeDesconectar podeParear />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Parear novo aparelho" }));
    const dialogo = screen.getByRole("alertdialog");
    expect(dialogo.textContent).toContain("desconectado e um QR novo é gerado");
    liberarBlock();
    await act(async () => {
      fireEvent.click(within(dialogo).getByRole("button", { name: "Gerar QR" }));
    });
    expect(acoesIntegracoes.parearAparelho).toHaveBeenCalledTimes(1);
    expect(screen.getByAltText(/QR code para parear/)).toBeTruthy();
    expect(screen.getByText("Este QR vale por mais 45 s.")).toBeTruthy();
    unmount();

    render(
      <AcoesDaConta id={CONTA.id} rotulo="Oficial" lojaNome="Centro" provedor="whatsapp_oficial"
        updatedAt={LOJA.updatedAt} podeDesconectar podeParear />,
    );
    expect(screen.queryByRole("button", { name: "Parear novo aparelho" })).toBeNull();
  });
});
