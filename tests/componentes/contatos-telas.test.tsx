import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Telas de contatos e LGPD (04-ui.md §5.3, §9.1 itens 5, 19 e 20; §10).
 *
 * Provas de tela que a trava de block (`block-3s.test.tsx`) cobra por item:
 *   - excluir contato, exportar dossiê e eliminar dados passam por
 *     `ModalConfirmacaoBlock` com resumo, foco inicial em Cancelar, Esc inerte
 *     nos 3 primeiros segundos e erro que NÃO fecha o modal;
 *   - o filtro "Todos" nunca manda `all`;
 *   - não existe exclusão em massa.
 */

const contatos = vi.hoisted(() => ({
  excluirContato: vi.fn(),
  etiquetarContatos: vi.fn(),
  exportarContatosCsv: vi.fn(),
  definirEtiquetasDoContato: vi.fn(),
  criarContato: vi.fn(),
  salvarContato: vi.fn(),
}));
const lgpd = vi.hoisted(() => ({
  eliminarDadosDoTitular: vi.fn(),
  iniciarExportacaoDoDossie: vi.fn(),
  lerPaginaDoDossie: vi.fn(),
  registrarPedidoDeCorrecao: vi.fn(),
  registrarConsentimentoDoContato: vi.fn(),
}));
const navegacao = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  busca: "optOut=sim&cursor=abc",
}));

vi.mock("@/lib/actions/contatos", () => contatos);
vi.mock("@/lib/actions/lgpd", () => lgpd);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navegacao.push, replace: navegacao.replace, refresh: navegacao.refresh }),
  usePathname: () => "/contatos",
  useSearchParams: () => new URLSearchParams(navegacao.busca),
}));

const { ExcluirContato } = await import("@/app/(app)/contatos/_components/excluir-contato");
const { AcoesLgpd } = await import("@/app/(app)/contatos/_components/acoes-lgpd");
const { FiltrosContatos } = await import("@/app/(app)/contatos/_components/filtros-contatos");
const { ListaContatos } = await import("@/app/(app)/contatos/_components/lista-contatos");
const { ConsentimentoContato } = await import("@/app/(app)/contatos/_components/consentimento-contato");
const { FormularioContato } = await import("@/app/(app)/contatos/_components/formulario-contato");

const CONTATO = "11111111-1111-4111-8111-111111111111";
const LOJA = "22222222-2222-4222-8222-222222222222";
const VERSAO = "2026-09-16T09:00:00.000Z";
const TODAS = { exportar: true, anonimizar: true, registrarSolicitacao: true };

function liberarBlock() {
  act(() => {
    vi.advanceTimersByTime(3000);
  });
}

function preencherProtocolo() {
  fireEvent.change(screen.getByLabelText("Protocolo do pedido"), { target: { value: "LGPD-2026-9" } });
  fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Pedido da titular por e-mail" } });
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("excluir contato (item 5)", () => {
  it("block de 3 s com o nome, Cancelar em foco e Esc inerte", () => {
    contatos.excluirContato.mockResolvedValue({ ok: true, dados: { id: CONTATO } });
    render(<ExcluirContato contatoId={CONTATO} lojaId={LOJA} nome="Maria Silva" atualizadoEm={VERSAO} />);
    fireEvent.click(screen.getByRole("button", { name: /Excluir/ }));

    const dialogo = screen.getByRole("alertdialog");
    expect(dialogo.textContent).toContain("o contato Maria Silva");
    expect(document.activeElement?.textContent).toBe("Cancelar");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Excluir" }));
    expect(contatos.excluirContato).not.toHaveBeenCalled();

    liberarBlock();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Excluir" }));
    expect(contatos.excluirContato).toHaveBeenCalledWith({ id: CONTATO, loja: LOJA, updatedAt: VERSAO });
  });

  it("erro do servidor aparece no modal, que continua aberto", async () => {
    contatos.excluirContato.mockResolvedValue({ ok: false, codigo: "COLISAO", mensagem: "Registro alterado." });
    render(<ExcluirContato contatoId={CONTATO} lojaId={LOJA} nome="Maria" atualizadoEm={VERSAO} />);
    fireEvent.click(screen.getByRole("button", { name: /Excluir/ }));
    liberarBlock();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Excluir" }));
    vi.useRealTimers();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Registro alterado."));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(navegacao.push).not.toHaveBeenCalled();
  });
});

describe("eliminar dados do titular (item 20)", () => {
  it("pede protocolo e motivo, avisa escopo de loja e pedidos, e só executa após 3 s", async () => {
    lgpd.eliminarDadosDoTitular.mockResolvedValue({ ok: true, dados: { solicitacaoId: "x", resultado: {} } });
    render(
      <AcoesLgpd contatoId={CONTATO} lojaId={LOJA} lojaNome="Centro" nome="Maria" atualizadoEm={VERSAO} anonimizado={false} permissoes={TODAS} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Eliminar dados/ }));
    const aviso = screen.getByRole("dialog").textContent ?? "";
    expect(aviso).toMatch(/Vale só nesta loja/);
    expect(aviso).toMatch(/pedidos permanecem/);

    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.getByText("O protocolo tem ao menos 4 caracteres.")).toBeTruthy();

    preencherProtocolo();
    const dialogo = screen.getByRole("alertdialog");
    expect(dialogo.textContent).toContain("Maria");
    expect(dialogo.textContent).toContain("Centro");
    expect(dialogo.textContent).toContain("LGPD-2026-9");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Eliminar dados" }));
    expect(lgpd.eliminarDadosDoTitular).not.toHaveBeenCalled();

    liberarBlock();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Eliminar dados" }));
    vi.useRealTimers();
    await waitFor(() =>
      expect(lgpd.eliminarDadosDoTitular).toHaveBeenCalledWith({
        contatoId: CONTATO,
        loja: LOJA,
        updatedAt: VERSAO,
        protocolo: "LGPD-2026-9",
        motivo: "Pedido da titular por e-mail",
      }),
    );
  });

  it("protocolo repetido volta como erro dentro do modal", async () => {
    lgpd.eliminarDadosDoTitular.mockResolvedValue({
      ok: false,
      codigo: "VALIDACAO",
      mensagem: "Confira os campos destacados.",
      erros: { protocolo: ["Este protocolo já foi usado nesta loja."] },
    });
    render(
      <AcoesLgpd contatoId={CONTATO} lojaId={LOJA} lojaNome="Centro" nome="Maria" atualizadoEm={VERSAO} anonimizado={false} permissoes={TODAS} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Eliminar dados/ }));
    preencherProtocolo();
    liberarBlock();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Eliminar dados" }));
    vi.useRealTimers();
    await waitFor(() =>
      expect(within(screen.getByRole("alertdialog")).getByRole("alert").textContent).toBe(
        "Este protocolo já foi usado nesta loja.",
      ),
    );
  });

  it("contato já anonimizado não oferece eliminar de novo; sem permissão, nada aparece", () => {
    const { rerender } = render(
      <AcoesLgpd contatoId={CONTATO} lojaId={LOJA} lojaNome="Centro" nome="Titular" atualizadoEm={VERSAO} anonimizado permissoes={TODAS} />,
    );
    expect(screen.queryByRole("button", { name: /Eliminar dados/ })).toBeNull();
    rerender(
      <AcoesLgpd
        contatoId={CONTATO}
        lojaId={LOJA}
        lojaNome="Centro"
        nome="Titular"
        atualizadoEm={VERSAO}
        anonimizado={false}
        permissoes={{ exportar: false, anonimizar: false, registrarSolicitacao: false }}
      />,
    );
    expect(screen.queryByText(/Direitos do titular/)).toBeNull();
  });
});

describe("exportar dossiê (item 19)", () => {
  it("abre a solicitação, lê seção por seção e só então entrega o arquivo", async () => {
    lgpd.iniciarExportacaoDoDossie.mockResolvedValue({
      ok: true,
      dados: { solicitacaoId: "s1", secoes: ["contato", "mensagens"] },
    });
    lgpd.lerPaginaDoDossie
      .mockResolvedValueOnce({ ok: true, dados: { secao: "contato", linhas: [{ id: "c" }], proximoCursor: null } })
      .mockResolvedValueOnce({ ok: true, dados: { secao: "mensagens", linhas: [{ id: "m1" }], proximoCursor: "k" } })
      .mockResolvedValueOnce({ ok: true, dados: { secao: "mensagens", linhas: [{ id: "m2" }], proximoCursor: null } });
    const criarUrl = vi.fn(() => "blob:x");
    Object.assign(URL, { createObjectURL: criarUrl, revokeObjectURL: vi.fn() });

    render(
      <AcoesLgpd contatoId={CONTATO} lojaId={LOJA} lojaNome="Centro" nome="Maria" atualizadoEm={VERSAO} anonimizado={false} permissoes={TODAS} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Exportar dossiê/ }));
    preencherProtocolo();
    const dialogo = screen.getByRole("alertdialog");
    expect(dialogo.textContent).toContain("todos os dados de Maria");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Exportar" }));
    expect(lgpd.iniciarExportacaoDoDossie).not.toHaveBeenCalled();

    liberarBlock();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Exportar" }));
    vi.useRealTimers();
    await waitFor(() => expect(criarUrl).toHaveBeenCalledTimes(1));
    expect(lgpd.lerPaginaDoDossie).toHaveBeenCalledTimes(3);
    expect(lgpd.lerPaginaDoDossie).toHaveBeenLastCalledWith({ solicitacaoId: "s1", loja: LOJA, secao: "mensagens", cursor: "k" });
  });

  it("página recusada no meio NÃO entrega dossiê pela metade", async () => {
    lgpd.iniciarExportacaoDoDossie.mockResolvedValue({ ok: true, dados: { solicitacaoId: "s1", secoes: ["contato"] } });
    lgpd.lerPaginaDoDossie.mockResolvedValue({ ok: false, codigo: "NAO_ENCONTRADO", mensagem: "Registro não encontrado." });
    const criarUrl = vi.fn(() => "blob:x");
    Object.assign(URL, { createObjectURL: criarUrl, revokeObjectURL: vi.fn() });

    render(
      <AcoesLgpd contatoId={CONTATO} lojaId={LOJA} lojaNome="Centro" nome="Maria" atualizadoEm={VERSAO} anonimizado={false} permissoes={TODAS} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Exportar dossiê/ }));
    preencherProtocolo();
    liberarBlock();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Exportar" }));
    vi.useRealTimers();
    await waitFor(() => expect(screen.getByText("Registro não encontrado.")).toBeTruthy());
    expect(criarUrl).not.toHaveBeenCalled();
  });
});

describe("carteira", () => {
  const ITEM = {
    id: CONTATO,
    lojaId: LOJA,
    lojaNome: "Centro",
    nome: "Maria",
    telefone: "5551999990000",
    email: null,
    canal: "whatsapp",
    optOut: true,
    ultimoContatoEm: VERSAO,
    pedidosContagem: 2,
    anonimizado: false,
  };

  it('"Todos" apaga o filtro da URL e nunca manda `all`', () => {
    navegacao.busca = "optOut=sim&cursor=abc&busca=ana";
    render(<FiltrosContatos etiquetas={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
    expect(navegacao.replace).toHaveBeenCalledWith("/contatos?busca=ana");
    expect(String(navegacao.replace.mock.calls[0]?.[0])).not.toContain("all");
  });

  it("selo de opt-out visível, e seleção em massa só etiqueta — não existe excluir em massa", () => {
    render(
      <ListaContatos
        itens={[ITEM]}
        variasLojas={false}
        etiquetas={[{ id: "e1", nome: "VIP" }]}
        podeEtiquetar
        vazio={<p>vazio</p>}
      />,
    );
    expect(screen.getAllByText("Não quer promoções").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("checkbox", { name: "Selecionar linha" }));
    expect(screen.getByRole("button", { name: /Etiquetar/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Excluir/ })).toBeNull();
  });

  it("em 'Todas as lojas' não há seleção em massa; lista vazia mostra o estado vazio", () => {
    const { rerender } = render(
      <ListaContatos itens={[ITEM]} variasLojas etiquetas={[]} podeEtiquetar vazio={<p>vazio</p>} />,
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
    rerender(<ListaContatos itens={[]} variasLojas={false} etiquetas={[]} podeEtiquetar vazio={<p>Nada aqui</p>} />);
    expect(screen.getByText("Nada aqui")).toBeTruthy();
  });

  it("CSV: o erro do servidor vira toast, sem arquivo", async () => {
    const { toast } = await import("sonner");
    contatos.exportarContatosCsv.mockResolvedValue({ ok: false, codigo: "SEM_PERMISSAO", mensagem: "Sem acesso." });
    vi.useRealTimers();
    render(<ListaContatos itens={[ITEM]} variasLojas={false} etiquetas={[]} podeEtiquetar={false} vazio={null} />);
    fireEvent.click(screen.getByRole("button", { name: /Exportar CSV/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Sem acesso."));
  });
});

describe("consentimento e formulário", () => {
  it("opt-out explica que não bloqueia o atendimento e registra marketing recusado", () => {
    lgpd.registrarConsentimentoDoContato.mockResolvedValue({ ok: true, dados: { optOut: true, espelhoMudou: true } });
    render(
      <ConsentimentoContato contatoId={CONTATO} lojaId={LOJA} optOut={false} optOutEm={null} historico={[]} podeRegistrar />,
    );
    expect(screen.getByText(/a equipe responde normalmente/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Registrar que não quer promoções" }));
    expect(lgpd.registrarConsentimentoDoContato).toHaveBeenCalledWith({
      contatoId: CONTATO,
      loja: LOJA,
      tipo: "marketing",
      concedido: "false",
    });
    // A prova de IP é do servidor: o corpo não tem o campo.
    expect(Object.keys(lgpd.registrarConsentimentoDoContato.mock.calls[0]?.[0] ?? {})).not.toContain("ip");
  });

  it("edição leva updatedAt e loja do contato em campo oculto; telefone é type=tel", () => {
    const { container } = render(
      <FormularioContato
        contato={{
          id: CONTATO,
          lojaId: LOJA,
          nome: "Maria",
          telefone: "5551999990000",
          email: null,
          tamanhoPreferido: null,
          observacoes: null,
          aniversario: null,
          endereco: null,
          atualizadoEm: VERSAO,
        }}
      />,
    );
    expect((container.querySelector('input[name="updatedAt"]') as HTMLInputElement).value).toBe(VERSAO);
    expect((container.querySelector('input[name="loja"]') as HTMLInputElement).value).toBe(LOJA);
    const telefone = screen.getByLabelText(/Telefone/) as HTMLInputElement;
    expect(telefone.type).toBe("tel");
    expect(telefone.value).toBe("(51) 99999-0000");
  });
});
