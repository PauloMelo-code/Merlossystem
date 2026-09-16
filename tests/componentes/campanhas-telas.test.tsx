import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Telas do M6 (04-ui.md §5.4): assistente de campanha, disparo com bloqueio de
 * 3 s, respostas rápidas, modelos e agendadas — os estados vazio, erro,
 * carregando e sucesso.
 */

const acoes = vi.hoisted(() => ({
  campanhas: {
    previaDeSegmento: vi.fn(),
    criarNovaCampanha: vi.fn(),
    iniciarDisparo: vi.fn(),
    retomarDisparo: vi.fn(),
    pausarDisparo: vi.fn(),
    reenviarFalhasDaCampanha: vi.fn(),
    excluirCampanhaRegistro: vi.fn(),
  },
  conteudo: {
    criarRespostaRapida: vi.fn(),
    editarRespostaRapida: vi.fn(),
    alternarRespostaRapida: vi.fn(),
    excluirRespostaRapida: vi.fn(),
    criarModeloWhatsapp: vi.fn(),
    editarModeloWhatsapp: vi.fn(),
    excluirModeloWhatsapp: vi.fn(),
    enviarModeloAprovacao: vi.fn(),
  },
  agendadas: { agendarMensagem: vi.fn(), reagendarMensagem: vi.fn(), cancelarMensagem: vi.fn() },
  push: vi.fn(),
}));

vi.mock("@/lib/actions/campanhas", () => acoes.campanhas);
vi.mock("@/lib/actions/conteudo", () => acoes.conteudo);
vi.mock("@/app/(app)/agendadas/_acoes", () => acoes.agendadas);
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: acoes.push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/x",
  useSearchParams: () => new URLSearchParams(),
}));

const { AssistenteCampanha } = await import("@/app/(app)/campanhas/_components/assistente-campanha");
const { ProgressoDisparo } = await import("@/app/(app)/campanhas/_components/progresso-disparo");
const { ListaRespostas } = await import("@/app/(app)/respostas-rapidas/_components/lista-respostas");
const { ContadorDeVariaveis, ListaModelos } = await import("@/app/(app)/modelos/_components/lista-modelos");
const { FormularioAgendamento } = await import("@/app/(app)/agendadas/_components/formulario-agendamento");

const OFICIAL = { id: "c1", rotulo: "Oficial Centro", provedor: "whatsapp_oficial", status: "conectado" };
const UAZAPI = { id: "c2", rotulo: "Vendas Centro", provedor: "uazapi", status: "conectado" };
const MODELO = { id: "m1", integracaoId: "c1", nome: "cupom", corpo: "Oi {{1}}, cupom {{2}}", variaveisContagem: 2 };
const ZERO = { total: 0, naFila: 0, enviados: 0, entregues: 0, lidos: 0, respondidos: 0, falhas: 0 };

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("assistente de campanha", () => {
  function abrir() {
    render(<AssistenteCampanha contas={[OFICIAL, UAZAPI]} modelos={[MODELO]} etiquetas={[]} />);
  }

  it("não avança com variáveis faltando (modelo pede 2)", () => {
    abrir();
    fireEvent.change(screen.getByLabelText("Variável {{1}}"), { target: { value: "{nome_contato}" } });
    fireEvent.click(screen.getByRole("button", { name: "Próximo" }));
    expect(screen.getByText(/Preencha todas as variáveis/)).toBeTruthy();
    expect(screen.getByRole("listitem", { current: "step" }).textContent).toContain("Conteúdo");
  });

  it("com as 2 variáveis avança, a conta é a do modelo, e salva o rascunho", async () => {
    acoes.campanhas.criarNovaCampanha.mockResolvedValue({ ok: true, dados: { id: "novo" } });
    abrir();
    fireEvent.change(screen.getByLabelText("Variável {{1}}"), { target: { value: "{nome_contato}" } });
    fireEvent.change(screen.getByLabelText("Variável {{2}}"), { target: { value: "FRIO10" } });
    expect(screen.getByLabelText("Prévia da mensagem").textContent).toBe("Oi Maria, cupom FRIO10");
    fireEvent.click(screen.getByRole("button", { name: "Próximo" }));
    expect(screen.getByText("Oficial Centro")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Próximo" }));
    fireEvent.change(screen.getByLabelText("Nome da campanha"), { target: { value: "Inverno" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(acoes.push).toHaveBeenCalledWith("/campanhas/novo"));
    expect(acoes.campanhas.criarNovaCampanha).toHaveBeenCalledWith(
      expect.objectContaining({
        integracao_id: "c1",
        template_id: "m1",
        conteudo_texto: null,
        variaveis: [
          { indice: 1, valor: "{nome_contato}" },
          { indice: 2, valor: "FRIO10" },
        ],
      }),
    );
  });

  it("texto livre avisa do risco de banimento e mostra o erro do servidor", async () => {
    acoes.campanhas.criarNovaCampanha.mockResolvedValue({
      ok: false,
      codigo: "VALIDACAO",
      mensagem: "Confira os campos destacados.",
      erros: { nome: ["Dê um nome com ao menos 3 letras."] },
    });
    acoes.campanhas.previaDeSegmento.mockResolvedValue({ ok: true, dados: { total: 412, amostra: ["Ana"] } });
    abrir();
    fireEvent.click(screen.getByLabelText("Texto livre (uazapi)"));
    fireEvent.change(screen.getByLabelText("Texto da campanha"), { target: { value: "Chegou!" } });
    fireEvent.click(screen.getByRole("button", { name: "Próximo" }));
    expect(screen.getByText(/pode ser banido/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Próximo" }));
    fireEvent.click(screen.getByRole("button", { name: "Calcular prévia" }));
    await waitFor(() => expect(screen.getByText("Vai para 412 pessoas")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Nome da campanha"), { target: { value: "Oi!" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(screen.getByText("Confira os campos destacados.")).toBeTruthy());
  });
});

describe("disparo", () => {
  const campanha = {
    id: "k1",
    nome: "Inverno",
    status: "rascunho",
    atualizadoEm: "2026-09-16T10:00:00.000Z",
    conta: "Vendas Centro",
    provedor: "uazapi",
    iniciadaEm: null,
    concluidaEm: null,
    conteudoTexto: "Chegou!",
  };

  it("iniciar passa pelo block de 3 s com nº de pessoas, número e aviso de banimento", async () => {
    vi.useFakeTimers();
    acoes.campanhas.iniciarDisparo.mockResolvedValue({ ok: true, dados: null });
    render(
      <ProgressoDisparo
        campanha={campanha}
        metricas={ZERO}
        pessoasNoRascunho={412}
        pode={{ disparar: true, pausar: true, excluir: true }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Iniciar disparo" }));
    const modal = screen.getByRole("alertdialog");
    expect(modal.textContent).toContain('412 pessoas vão receber "Inverno" pelo número Vendas Centro');
    expect(modal.textContent).toContain("pode ser banido");
    const confirmar = screen.getAllByRole("button", { name: "Iniciar disparo" }).at(-1)!;
    fireEvent.click(confirmar);
    expect(acoes.campanhas.iniciarDisparo).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    fireEvent.click(confirmar);
    expect(acoes.campanhas.iniciarDisparo).toHaveBeenCalledWith({ id: "k1", updated_at: campanha.atualizadoEm });
  });

  it("vendedora não vê disparo nem exclusão; enviando mostra métricas do servidor", () => {
    render(
      <ProgressoDisparo
        campanha={{ ...campanha, status: "enviando" }}
        metricas={{ ...ZERO, total: 10, naFila: 5, enviados: 5, falhas: 1 }}
        pessoasNoRascunho={null}
        pode={{ disparar: false, pausar: true, excluir: false }}
      />,
    );
    expect(screen.queryByRole("button", { name: /Iniciar|Retomar|Excluir|Reenviar/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Pausar" })).toBeTruthy();
    expect(screen.getByLabelText("50% processado")).toBeTruthy();
  });
});

describe("respostas rápidas e modelos", () => {
  it("vazio orienta a criar", () => {
    render(<ListaRespostas respostas={[]} podeCriar podeEditar podeExcluir />);
    expect(screen.getByText("Nenhuma resposta rápida ainda")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Nova resposta" }));
    fireEvent.change(screen.getByLabelText("Texto"), { target: { value: "Frete grátis" } });
    expect(screen.getByLabelText("Prévia no chat").textContent).toBe("Frete grátis");
  });

  it("atalho repetido volta como erro do campo, sem limpar o formulário", async () => {
    acoes.conteudo.criarRespostaRapida.mockResolvedValue({
      ok: false,
      codigo: "VALIDACAO",
      mensagem: "Confira os campos destacados.",
      erros: { atalho: ["Já existe uma resposta com este atalho nesta loja."] },
    });
    render(<ListaRespostas respostas={[]} podeCriar podeEditar podeExcluir />);
    fireEvent.click(screen.getByRole("button", { name: "Nova resposta" }));
    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "Frete" } });
    fireEvent.change(screen.getByLabelText("Texto"), { target: { value: "Grátis" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(screen.getAllByText(/Já existe uma resposta com este atalho/).length).toBeGreaterThan(0));
    expect((screen.getByLabelText("Título") as HTMLInputElement).value).toBe("Frete");
  });

  it("contador de variáveis acompanha o corpo e acusa buraco", () => {
    const { rerender } = render(<ContadorDeVariaveis corpo="Oi {{1}} e {{2}}" />);
    expect(screen.getByRole("status").textContent).toContain("2 variáveis");
    rerender(<ContadorDeVariaveis corpo="Oi {{2}}" />);
    expect(screen.getByRole("status").textContent).toContain("sem pular número");
  });

  const base = {
    categoria: "marketing",
    cabecalho: null,
    corpo: "Oi",
    rodape: null,
    variaveisContagem: 0,
    motivoRejeicao: null,
    atualizadoEm: "2026-09-16T10:00:00.000Z",
    conta: "Oficial",
  };

  it("modelo enviado à Meta não tem Editar; rejeitado mostra o motivo", () => {
    render(
      <ListaModelos
        modelos={[
          { ...base, id: "a", nome: "em_analise", status: "enviado" },
          { ...base, id: "b", nome: "recusado", status: "rejeitado", motivoRejeicao: "Conteúdo promocional no utility" },
        ]}
        contas={[]}
        podeCriar={false}
        podeEditar
        podeExcluir={false}
        podeEnviar={false}
      />,
    );
    expect(screen.getAllByRole("button", { name: "Editar" })).toHaveLength(1);
    expect(screen.getByText("Conteúdo promocional no utility")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /aprovar|aprovação/i })).toBeNull();
  });

  it("enviar para aprovação só aparece no rascunho/rejeitado e mostra a recusa", async () => {
    acoes.conteudo.enviarModeloAprovacao.mockResolvedValue({
      ok: false,
      codigo: "INTEGRACAO",
      mensagem: "A Meta recusou a conexão.",
    });
    render(
      <ListaModelos
        modelos={[
          { ...base, id: "a", nome: "em_analise", status: "enviado" },
          { ...base, id: "b", nome: "rascunho_novo", status: "rascunho" },
        ]}
        contas={[]}
        podeCriar={false}
        podeEditar={false}
        podeExcluir={false}
        podeEnviar
      />,
    );
    const botoes = screen.getAllByRole("button", { name: "Enviar para aprovação" });
    expect(botoes).toHaveLength(1);
    fireEvent.click(botoes[0]!);
    await waitFor(() => expect(screen.getByText("A Meta recusou a conexão.")).toBeTruthy());
    expect(acoes.conteudo.enviarModeloAprovacao).toHaveBeenCalledWith({ id: "b" });
  });
});

describe("agendamento", () => {
  it("sem número conectado a tela diz por quê", () => {
    render(<FormularioAgendamento contatos={[{ id: "x", nome: "Ana", telefone: null }]} contas={[]} modelos={[]} />);
    expect(screen.getByText("Esta loja não tem número de WhatsApp conectado.")).toBeTruthy();
  });

  it("motivo promocional avisa que respeita opt-out", () => {
    render(
      <FormularioAgendamento contatos={[{ id: "x", nome: "Ana", telefone: null }]} contas={[UAZAPI]} modelos={[]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Agendar mensagem" }));
    expect(screen.getByText(/Sai mesmo para quem pediu/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "promocao" } });
    expect(screen.getByText(/Não sai para quem pediu/)).toBeTruthy();
  });
});
