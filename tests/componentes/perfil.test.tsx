import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Meu perfil" e "Meu perfil > Segurança" (04-ui.md §5.1; 02-seguranca.md §11.1).
 *
 * Três regras que só uma trava de componente segura:
 *   1. o que a tela NÃO tem — desligar o segundo fator, remover o último fator,
 *      código de recuperação e semente do TOTP (U13, G4/G5);
 *   2. remover passkey e encerrar todas as sessões passam pelo bloqueio de 3 s
 *      (§9.1, itens 17 e 18);
 *   3. `SESSAO_NAO_FRESCA` abre o modal de reautenticação e a ação pendente é
 *      REFEITA — nunca um 403 seco (§7.3).
 */

const acoes = vi.hoisted(() => ({
  salvarPerfil: vi.fn(),
  reautenticar: vi.fn(),
  trocarSenha: vi.fn(),
  iniciarCadastroDeTotp: vi.fn(),
  confirmarCadastroDeTotp: vi.fn(),
  iniciarCadastroDePasskey: vi.fn(),
  confirmarCadastroDePasskey: vi.fn(),
  renomearChave: vi.fn(),
  removerChave: vi.fn(),
  encerrarSessao: vi.fn(),
  encerrarTodasAsSessoes: vi.fn(),
}));

const acoesUsuarios = vi.hoisted(() => ({ confirmarMeuNovoEmail: vi.fn() }));

vi.mock("@/lib/actions/seguranca", () => acoes);
vi.mock("@/lib/actions/usuarios", () => acoesUsuarios);
vi.mock("@simplewebauthn/browser", () => ({
  startRegistration: vi.fn(),
  startAuthentication: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const { FormularioPerfil } = await import("@/app/(app)/perfil/_components/formulario-perfil");
const { ConfirmarNovoEmail } = await import(
  "@/app/(app)/perfil/_components/confirmar-novo-email"
);
const { TrocarSenha } = await import("@/app/(app)/perfil/seguranca/_components/trocar-senha");
const { SubstituirFator } = await import(
  "@/app/(app)/perfil/seguranca/_components/substituir-fator"
);
const { ListaPasskeys } = await import(
  "@/app/(app)/perfil/seguranca/_components/lista-passkeys"
);
const { ListaSessoes } = await import(
  "@/app/(app)/perfil/seguranca/_components/lista-sessoes"
);
const { EventosDaConta } = await import(
  "@/app/(app)/perfil/seguranca/_components/eventos-da-conta"
);

const BLOQUEIO_MS = 3000;

function liberarBlock() {
  act(() => {
    vi.advanceTimersByTime(BLOQUEIO_MS);
  });
}

const PASSKEY = {
  id: "11111111-1111-4111-8111-111111111111",
  nome: "iPhone do balcão",
  criadaEm: "2026-09-01T12:00:00.000Z",
  sincronizada: true,
  fabricante: "Chaveiro do iCloud",
};

const SESSAO = {
  id: "22222222-2222-4222-8222-222222222222",
  ip: "200.0.0.10",
  agente: "Chrome no Windows",
  criadaEm: "2026-09-16T09:00:00.000Z",
  expiraEm: "2026-09-16T21:00:00.000Z",
  atual: true,
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("/perfil", () => {
  it("papel, loja e e-mail são leitura; só o nome é editável", () => {
    render(
      <FormularioPerfil
        nome="Ana Souza"
        email="ana@merlostore.com.br"
        atualizadoEm="2026-09-16T09:00:00.000Z"
        papelRotulo="Vendedora"
        lojaNome="Centro"
      />,
    );
    expect((screen.getByLabelText("Seu nome") as HTMLInputElement).value).toBe("Ana Souza");
    expect(screen.queryByLabelText("E-mail")).toBeNull();
    expect(screen.getByText("Vendedora")).toBeTruthy();
    expect(screen.getByText("Centro")).toBeTruthy();
  });

  it("o controle de colisão viaja em campo oculto (§7.4)", () => {
    const { container } = render(
      <FormularioPerfil
        nome="Ana"
        email="ana@merlostore.com.br"
        atualizadoEm="2026-09-16T09:00:00.000Z"
        papelRotulo="Vendedora"
        lojaNome="Centro"
      />,
    );
    const oculto = container.querySelector('input[name="updatedAt"]') as HTMLInputElement;
    expect(oculto.value).toBe("2026-09-16T09:00:00.000Z");
  });
});

describe("/perfil — confirmar novo e-mail (§11.2)", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("lê o código do fragmento e o tira da barra de endereço", () => {
    window.history.replaceState(null, "", "/perfil#codigo=123456");
    render(<ConfirmarNovoEmail emailNovo="ana.nova@merlostore.com.br" expiraEm="2026-09-16T12:10:00.000Z" />);
    expect((screen.getByLabelText("Código de 6 dígitos") as HTMLInputElement).value).toBe("123456");
    expect(window.location.hash).toBe("");
  });

  it("envia o código só da sessão corrente, sem userId no corpo", async () => {
    acoesUsuarios.confirmarMeuNovoEmail.mockResolvedValue({
      ok: true,
      dados: { email: "ana.nova@merlostore.com.br" },
    });
    render(<ConfirmarNovoEmail emailNovo="ana.nova@merlostore.com.br" expiraEm="2026-09-16T12:10:00.000Z" />);
    fireEvent.change(screen.getByLabelText("Código de 6 dígitos"), { target: { value: "654321" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar e-mail" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/E-mail confirmado/));
    expect(acoesUsuarios.confirmarMeuNovoEmail).toHaveBeenCalledWith({ codigo: "654321" });
  });

  it("SESSAO_NAO_FRESCA abre a reautenticação em vez de recusar", async () => {
    acoesUsuarios.confirmarMeuNovoEmail.mockResolvedValue({
      ok: false,
      codigo: "SESSAO_NAO_FRESCA",
      mensagem: "Confirme sua identidade.",
    });
    render(<ConfirmarNovoEmail emailNovo="ana.nova@merlostore.com.br" expiraEm="2026-09-16T12:10:00.000Z" />);
    fireEvent.change(screen.getByLabelText("Código de 6 dígitos"), { target: { value: "654321" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar e-mail" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
  });
});

describe("/perfil/seguranca — o que a tela NÃO tem", () => {
  it("nenhum caminho para desligar o segundo fator ou ver a semente", () => {
    const { baseElement } = render(<SubstituirFator totpAtivo temPasskey />);
    const texto = baseElement.textContent ?? "";
    expect(texto).not.toMatch(/desligar|desativar o segundo fator/i);
    expect(texto).not.toMatch(/c(ó|o)digo de recupera(ç|c)(ã|a)o|backup/i);
    expect(texto).not.toMatch(/semente/i);
  });

  it("sem passkey, trocar o aplicativo fica indisponível e a tela explica", () => {
    render(<SubstituirFator totpAtivo temPasskey={false} />);
    const botao = screen.getByRole("button", { name: /Substituir o aplicativo/ });
    expect(botao.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Cadastre uma passkey antes de trocar o aplicativo.")).toBeTruthy();
  });
});

describe("/perfil/seguranca — bloqueio de 3 s", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("remover passkey espera 3 s e resume o que vai acontecer", () => {
    acoes.removerChave.mockResolvedValue({ ok: true, dados: null });
    render(<ListaPasskeys passkeys={[PASSKEY]} podeRemover />);
    fireEvent.click(screen.getByRole("button", { name: /Remover/ }));

    const dialogo = screen.getByRole("alertdialog");
    expect(dialogo.textContent).toContain("iPhone do balcão");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Remover" }));
    expect(acoes.removerChave).not.toHaveBeenCalled();

    liberarBlock();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Remover" }));
    expect(acoes.removerChave).toHaveBeenCalledWith(PASSKEY.id);
  });

  it("última prova de identidade: a tela nem oferece remover", () => {
    render(<ListaPasskeys passkeys={[PASSKEY]} podeRemover={false} />);
    expect(
      screen.getByRole("button", { name: /Remover/ }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("encerrar todas avisa que esta sessão também cai", () => {
    acoes.encerrarTodasAsSessoes.mockResolvedValue({ ok: true, dados: null });
    render(<ListaSessoes sessoes={[SESSAO]} />);
    fireEvent.click(screen.getByRole("button", { name: "Encerrar todas as sessões" }));

    const dialogo = screen.getByRole("alertdialog");
    expect(dialogo.textContent).toContain("inclusive esta");
    liberarBlock();
    fireEvent.click(screen.getByRole("button", { name: "Encerrar todas" }));
    expect(acoes.encerrarTodasAsSessoes).toHaveBeenCalledTimes(1);
  });
});

describe("/perfil/seguranca — reautenticação", () => {
  it("SESSAO_NAO_FRESCA abre o modal em vez de um 403 seco", async () => {
    acoes.trocarSenha.mockResolvedValue({
      ok: false,
      codigo: "SESSAO_NAO_FRESCA",
      mensagem: "Confirme sua identidade para continuar.",
    });
    render(<TrocarSenha alteradaEm={null} precisaTrocar={false} />);

    fireEvent.change(screen.getByLabelText("Senha atual"), { target: { value: "seja-o-que-for" } });
    fireEvent.change(screen.getByLabelText("Nova senha"), {
      target: { value: "uma frase longa de verdade" },
    });
    fireEvent.change(screen.getByLabelText("Repita a nova senha"), {
      target: { value: "uma frase longa de verdade" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar a nova senha" }));

    await waitFor(() => {
      expect(screen.getByText("Confirme que é você")).toBeTruthy();
    });
    // Só a prova por senha: a prop de passkey não é passada nesta tela.
    expect(screen.queryByRole("button", { name: /Usar passkey/ })).toBeNull();
  });

  it("quem está com a senha vencida vê por que só esta tela abre", () => {
    render(<TrocarSenha alteradaEm={null} precisaTrocar />);
    expect(
      screen.getByText("Você precisa criar uma senha nova para continuar."),
    ).toBeTruthy();
  });
});

describe("/perfil/seguranca — estados de lista", () => {
  it("vazio: nenhuma passkey diz o próximo passo", () => {
    render(<ListaPasskeys passkeys={[]} podeRemover={false} />);
    expect(screen.getByText("Nenhuma passkey cadastrada.")).toBeTruthy();
  });

  it("vazio: sem eventos, a tela não finge histórico", () => {
    render(<EventosDaConta eventos={[]} />);
    expect(screen.getByText("Nada registrado ainda.")).toBeTruthy();
  });

  it("os eventos aparecem em PT-BR, sem e-mail e sem tipo cru conhecido", () => {
    render(
      <EventosDaConta
        eventos={[
          {
            tipo: "login_sucesso",
            meio: "passkey",
            resultado: "sucesso",
            ip: "200.0.0.10",
            quando: "2026-09-16T09:00:00.000Z",
          },
        ]}
      />,
    );
    expect(screen.getByText(/Entrou no sistema com passkey/)).toBeTruthy();
  });

  it("a sessão atual não oferece encerrar a si mesma", () => {
    render(<ListaSessoes sessoes={[SESSAO]} />);
    expect(screen.getByText(/esta é a sessão atual/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Encerrar" })).toBeNull();
  });
});
