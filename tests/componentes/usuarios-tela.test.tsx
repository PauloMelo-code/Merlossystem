import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/configuracoes/usuarios` (04-ui.md §5.6, §7.3, §9.1 itens 10 a 17).
 *
 * Reprova quando: o convite oferece `admin` a quem não é dono ou sai sem a
 * ciência digitada; o convite pede senha; uma ação da lista de bloqueio chama o
 * servidor antes dos 3 s; ação fora da lista ganha bloqueio; `SESSAO_NAO_FRESCA`
 * vira erro seco em vez de reautenticação com a MESMA chamada refeita; e a
 * própria linha oferece ação administrativa (INV-32).
 */

// O jsdom não tem ResizeObserver, e o RadioGroup do Radix o usa para medir.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const convites = vi.hoisted(() => ({ convidarUsuario: vi.fn(), reenviarConvite: vi.fn() }));
const usuarios = vi.hoisted(() => ({
  trocarPapel: vi.fn(),
  promoverAAdmin: vi.fn(),
  transferirPosse: vi.fn(),
  desativarUsuario: vi.fn(),
  reativarUsuario: vi.fn(),
  destravarUsuario: vi.fn(),
  iniciarResetDeAcesso: vi.fn(),
  recuperarAcesso: vi.fn(),
  encerrarSessoesDoUsuario: vi.fn(),
  trocarEmail: vi.fn(),
  confirmarMeuNovoEmail: vi.fn(),
}));
const seguranca = vi.hoisted(() => ({ reautenticar: vi.fn() }));

vi.mock("@/lib/actions/convites", () => convites);
vi.mock("@/lib/actions/usuarios", () => usuarios);
vi.mock("@/lib/actions/seguranca", () => seguranca);
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const { FormularioConvite } = await import(
  "@/app/(app)/configuracoes/usuarios/_components/formulario-convite"
);
const { AcoesUsuario } = await import("@/app/(app)/configuracoes/usuarios/_components/acoes-usuario");
const { ListaUsuarios } = await import(
  "@/app/(app)/configuracoes/usuarios/_components/lista-usuarios"
);
const { FRASE_CIENCIA_ADMIN } = await import("@/lib/validadores/usuarios");

const LOJAS = [{ id: "33333333-3333-4333-8333-333333333333", nome: "Centro", sigla: "CEN" }];
const ALVO = {
  id: "44444444-4444-4444-8444-444444444444",
  nome: "Bia Lima",
  papel: "vendedor" as const,
  lojaId: LOJAS[0]!.id,
  updatedAt: "2026-09-16T09:00:00.000Z",
};
const MOTIVO = "saiu da empresa ontem";

function liberar() {
  act(() => {
    vi.advanceTimersByTime(3000);
  });
}

async function soltarPromessas() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("convite", () => {
  it("admin não vê a opção de convidar administrador; o dono vê", () => {
    const { unmount } = render(
      <FormularioConvite papeis={["gerente", "vendedor", "viewer"]} lojas={LOJAS} />,
    );
    expect(screen.queryByLabelText("Administrador")).toBeNull();
    expect(screen.queryByLabelText("Dono")).toBeNull();
    unmount();
    render(<FormularioConvite papeis={["admin", "gerente", "vendedor", "viewer"]} lojas={LOJAS} />);
    expect(screen.getByLabelText("Administrador")).toBeTruthy();
  });

  it("não pede senha de ninguém (E8)", () => {
    const { container } = render(<FormularioConvite papeis={["gerente"]} lojas={LOJAS} />);
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(container.textContent ?? "").not.toMatch(/senha do convidado|defina a senha/i);
  });

  it("admin só sai com a ciência digitada; depois, bloqueio de 3 s", async () => {
    vi.useFakeTimers();
    convites.convidarUsuario.mockResolvedValue({
      ok: true,
      dados: { link: "http://x/primeiro-acesso#t=abc", expiraEm: new Date() },
    });
    render(<FormularioConvite papeis={["admin", "gerente"]} lojas={LOJAS} />);
    fireEvent.click(screen.getByLabelText("Administrador"));
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "nova@loja.com" } });
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: MOTIVO } });
    fireEvent.click(screen.getByRole("button", { name: "Convidar" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByText(new RegExp(`Digite exatamente: ${FRASE_CIENCIA_ADMIN}`))).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Ciência"), { target: { value: FRASE_CIENCIA_ADMIN } });
    fireEvent.click(screen.getByRole("button", { name: "Convidar" }));
    const dialogo = screen.getByRole("alertdialog");
    expect(dialogo.textContent).toContain("nova@loja.com");
    expect(dialogo.textContent).toContain("Administrador");

    fireEvent.click(within(dialogo).getByRole("button", { name: "Emitir convite" }));
    expect(convites.convidarUsuario).not.toHaveBeenCalled();
    liberar();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Emitir convite" }));
    await soltarPromessas();
    expect(convites.convidarUsuario).toHaveBeenCalledWith(
      expect.objectContaining({ email: "nova@loja.com", papel: "admin", ciencia: FRASE_CIENCIA_ADMIN }),
    );
    // Sucesso: o link aparece uma vez, para quem emitiu.
    expect(screen.getByText("http://x/primeiro-acesso#t=abc")).toBeTruthy();
  });

  it("erro do servidor mantém o modal aberto e o que foi digitado", async () => {
    vi.useFakeTimers();
    convites.convidarUsuario.mockResolvedValue({
      ok: false,
      codigo: "VALIDACAO",
      mensagem: "Já existe uma conta com este e-mail.",
    });
    render(<FormularioConvite papeis={["gerente"]} lojas={LOJAS} />);
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "ja@loja.com" } });
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: MOTIVO } });
    fireEvent.click(screen.getByRole("button", { name: "Convidar" }));
    liberar();
    fireEvent.click(screen.getByRole("button", { name: "Emitir convite" }));
    await soltarPromessas();
    expect(screen.getByRole("alertdialog").textContent).toContain("Já existe uma conta");
    expect((screen.getByLabelText("E-mail") as HTMLInputElement).value).toBe("ja@loja.com");
  });
});

function abrirMenu(item: string) {
  fireEvent.keyDown(screen.getByRole("button", { name: `Ações para ${ALVO.nome}` }), {
    key: "Enter",
  });
  fireEvent.click(screen.getByRole("menuitem", { name: item }));
}

describe("ações da linha", () => {
  it("desativar: motivo, bloqueio de 3 s e só então o servidor", async () => {
    vi.useFakeTimers();
    usuarios.desativarUsuario.mockResolvedValue({ ok: true, dados: { updatedAt: new Date() } });
    render(<AcoesUsuario usuario={ALVO} disponiveis={["desativar", "reset"]} lojas={LOJAS} />);
    abrirMenu("Desativar acesso");

    fireEvent.click(screen.getByRole("button", { name: "Desativar" }));
    expect(screen.getByText(/ao menos 8 caracteres/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: MOTIVO } });
    fireEvent.click(screen.getByRole("button", { name: "Desativar" }));
    const dialogo = screen.getByRole("alertdialog");
    expect(dialogo.textContent).toContain(ALVO.nome);
    expect(dialogo.textContent).toContain(MOTIVO);
    fireEvent.click(within(dialogo).getByRole("button", { name: "Desativar" }));
    expect(usuarios.desativarUsuario).not.toHaveBeenCalled();

    liberar();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Desativar" }));
    await soltarPromessas();
    expect(usuarios.desativarUsuario).toHaveBeenCalledWith({
      alvoId: ALVO.id,
      motivo: MOTIVO,
      updatedAt: ALVO.updatedAt,
    });
  });

  it("destravar não está na lista de bloqueio: chama direto", async () => {
    usuarios.destravarUsuario.mockResolvedValue({ ok: true, dados: null });
    render(<AcoesUsuario usuario={ALVO} disponiveis={["destravar"]} lojas={LOJAS} />);
    abrirMenu("Destravar conta");
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: MOTIVO } });
    fireEvent.click(screen.getByRole("button", { name: "Destravar" }));
    await waitFor(() => expect(usuarios.destravarUsuario).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("SESSAO_NAO_FRESCA abre a reautenticação e REFAZ a mesma chamada", async () => {
    usuarios.iniciarResetDeAcesso
      .mockResolvedValueOnce({ ok: false, codigo: "SESSAO_NAO_FRESCA", mensagem: "Confirme." })
      .mockResolvedValueOnce({ ok: true, dados: null });
    seguranca.reautenticar.mockResolvedValue({ ok: true, dados: null });
    vi.useFakeTimers();
    render(<AcoesUsuario usuario={ALVO} disponiveis={["reset"]} lojas={LOJAS} />);
    abrirMenu("Iniciar redefinição de senha");
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: MOTIVO } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar redefinição" }));
    liberar();
    fireEvent.click(screen.getByRole("button", { name: "Enviar redefinição" }));
    await soltarPromessas();
    vi.useRealTimers();

    await waitFor(() => expect(screen.getByText("Confirme que é você")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Sua senha"), { target: { value: "minha senha" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(usuarios.iniciarResetDeAcesso).toHaveBeenCalledTimes(2));
    expect(usuarios.iniciarResetDeAcesso.mock.calls[1]![0]).toEqual({
      alvoId: ALVO.id,
      motivo: MOTIVO,
    });
  });

  it("sem ação disponível, não há menu", () => {
    const { container } = render(<AcoesUsuario usuario={ALVO} disponiveis={[]} lojas={LOJAS} />);
    expect(container.textContent).toBe("");
  });
});

describe("lista", () => {
  const linha = {
    ...ALVO,
    email: "bia@loja.com",
    lojaNome: "Centro",
    ativo: true,
    emProvisionamento: false,
    bloqueadoAte: null,
    ultimoLoginEm: null,
    trocaDeEmailAberta: false,
    disponiveis: ["desativar" as const],
    voce: false,
  };

  it("vazia mostra a próxima ação", () => {
    render(<ListaUsuarios usuarios={[]} lojas={LOJAS} />);
    expect(screen.getByText("Ninguém cadastrado ainda.")).toBeTruthy();
  });

  it("a própria linha manda para Meu perfil, sem ação administrativa (INV-32)", () => {
    render(<ListaUsuarios usuarios={[{ ...linha, voce: true }]} lojas={LOJAS} />);
    expect(screen.getAllByText("Você · use Meu perfil").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Ações para/ })).toBeNull();
  });

  it("situação é texto, não só cor", () => {
    render(
      <ListaUsuarios
        usuarios={[{ ...linha, emProvisionamento: true, bloqueadoAte: "2026-09-16T10:00:00Z" }]}
        lojas={LOJAS}
      />,
    );
    expect(screen.getAllByText("Primeiro acesso pendente").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Bloqueada").length).toBeGreaterThan(0);
  });
});
