import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Os quatro estados de cada tela de acesso (04-ui.md §5.1 e §10).
 *
 * As actions e a porta de `/api/auth` são trocadas por dublês: o que está sob
 * teste é a TELA — que estados ela tem, o que ela diz e o que ela nunca diz.
 * O comportamento do servidor tem as travas de integração dele.
 *
 * A regra que este arquivo protege e que nenhuma revisão pega sozinha: a recusa
 * de login é UMA FRASE SÓ, sem tempo e sem motivo (U14), e nenhuma tela do
 * segundo fator oferece reenvio de código nem código de recuperação (U13).
 */

const porta = vi.hoisted(() => ({
  entrarComSenha: vi.fn(),
  entrarComPasskey: vi.fn(),
  confirmarTotpDeEntrada: vi.fn(),
  pedirLinkDeSenha: vi.fn(),
  criarPasskeyNoAparelho: vi.fn(),
  RECUSA_UNICA: "E-mail ou senha inválidos.",
}));

const acoes = vi.hoisted(() => ({
  definirSenhaDoConvite: vi.fn(),
  redefinirSenha: vi.fn(),
  prepararTotpDoPrimeiroAcesso: vi.fn(),
  confirmarTotpDoPrimeiroAcesso: vi.fn(),
  prepararPasskeyDoPrimeiroAcesso: vi.fn(),
  confirmarPasskeyDoPrimeiroAcesso: vi.fn(),
}));

vi.mock("@/app/(publico)/_components/porta-de-auth", () => porta);
vi.mock("@/app/(publico)/_acoes", () => acoes);
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const { FormularioEntrar } = await import(
  "@/app/(publico)/entrar/_components/formulario-entrar"
);
const { FormularioTotp } = await import(
  "@/app/(publico)/entrar/verificar/_components/formulario-totp"
);
const { FormularioEsqueci } = await import(
  "@/app/(publico)/esqueci-a-senha/_components/formulario-esqueci"
);
const { LeitorDeToken: LeitorDaRedefinicao } = await import(
  "@/app/(publico)/redefinir-senha/_components/leitor-de-token"
);
const { LeitorDeToken: LeitorDoConvite } = await import(
  "@/app/(publico)/primeiro-acesso/_components/leitor-de-token"
);

beforeEach(() => {
  vi.clearAllMocks();
  window.location.hash = "";
  acoes.redefinirSenha.mockResolvedValue({ ok: false, codigo: "", mensagem: "" });
  acoes.definirSenhaDoConvite.mockResolvedValue({ ok: false, codigo: "", mensagem: "" });
});

describe("/entrar", () => {
  it("a passkey é a ação primária e a senha fica em Outras opções", () => {
    render(<FormularioEntrar destino="/conversas" sessaoExpirada={false} />);
    expect(screen.getByRole("button", { name: /Entrar com passkey/ })).toBeTruthy();
    expect(screen.queryByLabelText("E-mail")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Outras opções/ }));
    expect(screen.getByLabelText("E-mail")).toBeTruthy();
  });

  it("carregando: o botão fica ocupado durante a tentativa", async () => {
    const espera: { liberar: () => void } = { liberar: () => {} };
    porta.entrarComPasskey.mockReturnValue(
      new Promise((resolver) => {
        espera.liberar = () => {
          resolver({ situacao: "entrou" });
        };
      }),
    );
    render(<FormularioEntrar destino="/conversas" sessaoExpirada={false} />);
    const botao = screen.getByRole("button", { name: /Entrar com passkey/ });
    fireEvent.click(botao);
    await waitFor(() => {
      expect(botao.hasAttribute("disabled")).toBe(true);
    });
    espera.liberar();
  });

  it("erro: uma frase só, sem tempo e sem motivo", async () => {
    porta.entrarComSenha.mockResolvedValue({
      situacao: "recusado",
      mensagem: porta.RECUSA_UNICA,
    });
    render(<FormularioEntrar destino="/conversas" sessaoExpirada={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Outras opções/ }));
    fireEvent.change(screen.getByLabelText("E-mail"), {
      target: { value: "quem@merlostore.com.br" },
    });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "seja-o-que-for" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).toBe("E-mail ou senha inválidos.");
    // Nada de "tente em X minutos", "conta bloqueada" ou "conta desativada".
    expect(alerta.textContent).not.toMatch(/minuto|bloquead|desativad|não existe/i);
  });

  it("sessão encerrada: a faixa explica por que a pessoa voltou para cá", () => {
    render(<FormularioEntrar destino="/conversas" sessaoExpirada />);
    expect(screen.getByText("Sua sessão expirou por segurança.")).toBeTruthy();
  });
});

describe("/entrar/verificar", () => {
  it("não oferece reenviar código nem código de recuperação (U13)", () => {
    const { baseElement } = render(<FormularioTotp destino="/conversas" />);
    expect(baseElement.textContent).not.toMatch(/reenviar|recupera(ç|c)(ã|a)o de c(ó|o)digo/i);
  });

  it("envia sozinho ao completar os 6 dígitos e mostra a frase única no erro", async () => {
    porta.confirmarTotpDeEntrada.mockResolvedValue({
      situacao: "recusado",
      mensagem: "Código incorreto ou expirado. Entre de novo.",
    });
    render(<FormularioTotp destino="/conversas" />);
    const campo = screen.getByLabelText("Código de 6 dígitos");
    fireEvent.change(campo, { target: { value: "123456" } });

    await waitFor(() => {
      expect(porta.confirmarTotpDeEntrada).toHaveBeenCalledWith("123456");
    });
    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).toBe("Código incorreto ou expirado. Entre de novo.");
  });
});

describe("/esqueci-a-senha", () => {
  it("a resposta é a mesma, exista ou não a conta (E1)", async () => {
    porta.pedirLinkDeSenha.mockResolvedValue(undefined);
    render(<FormularioEsqueci />);
    fireEvent.change(screen.getByLabelText("E-mail"), {
      target: { value: "ninguem@merlostore.com.br" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enviar o link" }));

    const aviso = await screen.findByRole("status");
    expect(aviso.textContent).toContain("Se existir conta com esse e-mail, enviamos o link.");
  });
});

describe("/redefinir-senha", () => {
  it("vazio: sem token no fragmento, diz o que fazer em vez de mostrar campo", async () => {
    render(<LeitorDaRedefinicao />);
    expect(await screen.findByText("Este link não vale mais.")).toBeTruthy();
    expect(screen.queryByLabelText("Nova senha")).toBeNull();
  });

  it("com token: o valor viaja em campo oculto e some da barra de endereço", async () => {
    window.location.hash = `#t=${"a".repeat(43)}`;
    const { container } = render(<LeitorDaRedefinicao />);

    const oculto = await waitFor(() => {
      const achado = container.querySelector('input[name="token"]');
      expect(achado).not.toBeNull();
      return achado as HTMLInputElement;
    });
    expect(oculto.value).toBe("a".repeat(43));
    expect(oculto.getAttribute("type")).toBe("hidden");
    expect(window.location.hash).toBe("");
  });

  it("os requisitos de senha vêm do mesmo módulo do servidor", async () => {
    window.location.hash = `#t=${"b".repeat(43)}`;
    render(<LeitorDaRedefinicao />);
    const campo = await screen.findByLabelText("Nova senha");
    fireEvent.change(campo, { target: { value: "curta" } });
    expect(
      await screen.findByText(/Use ao menos 15 caracteres/),
    ).toBeTruthy();
  });
});

describe("/primeiro-acesso", () => {
  it("carregando: a primeira pintura é esqueleto, não formulário", async () => {
    // O estado "lendo o convite" só existe ANTES do efeito de montagem, que o
    // `render` do RTL já descarrega. A pintura inicial é a do servidor, e é ela
    // que se mede aqui.
    const { renderToStaticMarkup } = await import("react-dom/server");
    const html = renderToStaticMarkup(<LeitorDoConvite retomando={false} />);
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('name="token"');
  });

  it("vazio: convite ausente tem texto próprio, sem jargão", async () => {
    render(<LeitorDoConvite retomando={false} />);
    expect(await screen.findByText("Este convite não vale mais.")).toBeTruthy();
    expect(screen.queryByText(/token|expirado/i)).toBeNull();
  });

  it("passo 1: pede nome e senha, e o token vai oculto", async () => {
    window.location.hash = `#t=${"c".repeat(43)}`;
    const { container } = render(<LeitorDoConvite retomando={false} />);
    expect(await screen.findByLabelText("Seu nome")).toBeTruthy();
    expect(screen.getByLabelText("Crie a sua senha")).toBeTruthy();
    expect(container.querySelector('input[name="token"]')).not.toBeNull();
  });
});
