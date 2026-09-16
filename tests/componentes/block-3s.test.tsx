import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModalConfirmacaoBlock } from "@/components/comum/modal-confirmacao-block";
import { ConfirmarExclusao } from "@/components/comum/confirmar-exclusao";

// O jsdom não tem ResizeObserver, e o RadioGroup do Radix o usa para medir.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const usuarios = vi.hoisted(() => ({
  trocarPapel: vi.fn(),
  promoverAAdmin: vi.fn(),
  transferirPosse: vi.fn(),
  recuperarAcesso: vi.fn(),
}));
vi.mock("@/lib/actions/usuarios", () => usuarios);
vi.mock("@/lib/actions/seguranca", () => ({ reautenticar: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const { AcoesUsuario } = await import("@/app/(app)/configuracoes/usuarios/_components/acoes-usuario");
const { FRASE_CIENCIA_ADMIN } = await import("@/lib/validadores/usuarios");

/**
 * Trava do bloqueio de 3 segundos (04-ui.md §9.1).
 *
 * A lista de ações que passam por aqui é FECHADA: está em `ACOES_COM_BLOCK` e
 * é a fonte única. Fora dela, nada usa block — e dentro dela, nada escapa.
 *
 * As telas nascem em F8 e nos oito pacotes da onda 2, então o piso de telas
 * ligadas é zero HOJE. Subir `PISO_DE_TELAS_LIGADAS` junto com cada tela é o
 * que impede esta trava de virar decoração; o que já dá para provar agora é o
 * CONTRATO do componente, que é o que toda tela vai herdar.
 */

/** §9.1, na ordem do documento. Vinte itens, nem um a mais. */
export const ACOES_COM_BLOCK = [
  "fechar-venda",
  "marcar-lancado-no-masc",
  "dispensar-pedido-do-masc",
  "cancelar-pedido",
  "excluir-registro",
  "iniciar-ou-retomar-disparo",
  "desconectar-integracao",
  "parear-novo-aparelho",
  "criar-editar-ou-desativar-loja",
  "convidar-usuario",
  "trocar-papel",
  "promover-a-admin",
  "transferir-posse",
  "desativar-ou-reativar-usuario",
  "iniciar-reset-de-acesso",
  "recuperacao-assistida",
  "encerrar-todas-as-sessoes",
  "substituir-fator-ou-remover-passkey",
  "exportar-dossie-do-titular",
  "eliminar-dados-do-titular",
] as const;

/**
 * Cada tela que liga uma das ações acima ACRESCENTA o identificador aqui e sobe
 * o piso — é o que impede esta trava de virar decoração. A prova de cada uma
 * vive no arquivo de teste da tela; aqui ficam o inventário e o piso.
 *
 * Cada linha diz ONDE está a prova. `excluir-registro` é um item só, provado
 * por mais de uma tela.
 */
const PISO_DE_TELAS_LIGADAS = 18;
const telasLigadas: readonly string[] = [
  // F8 — tests/componentes/perfil.test.tsx
  "substituir-fator-ou-remover-passkey",
  "encerrar-todas-as-sessoes",
  // M2 — contatos-telas.test.tsx; M3 — midias-galeria.test.tsx
  "excluir-registro",
  "exportar-dossie-do-titular",
  "eliminar-dados-do-titular",
  // M4 — pedidos-acoes.test.tsx
  "marcar-lancado-no-masc",
  "cancelar-pedido",
  // M5 — integracoes-telas.test.tsx
  "desconectar-integracao",
  "parear-novo-aparelho",
  "criar-editar-ou-desativar-loja",
  // M6 — campanhas-telas.test.tsx
  "iniciar-ou-retomar-disparo",
  // M7 — usuarios-tela.test.tsx
  "convidar-usuario",
  "desativar-ou-reativar-usuario",
  "iniciar-reset-de-acesso",
  // M7 — provados neste arquivo, abaixo
  "trocar-papel",
  "promover-a-admin",
  "transferir-posse",
  "recuperacao-assistida",
];

const BLOQUEIO_MS = 3000;

function abrir(extra: Partial<Parameters<typeof ModalConfirmacaoBlock>[0]> = {}) {
  const onConfirmar = vi.fn();
  const onCancelar = vi.fn();
  const resultado = render(
    <ModalConfirmacaoBlock
      aberto
      titulo="Fechar venda"
      resumo="3 peças, R$ 480,00, loja Centro, cliente Maria Silva."
      textoConfirmar="Fechar venda"
      onConfirmar={onConfirmar}
      onCancelar={onCancelar}
      {...extra}
    />,
  );
  return { ...resultado, onConfirmar, onCancelar };
}

function liberar() {
  act(() => {
    vi.advanceTimersByTime(BLOQUEIO_MS);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ModalConfirmacaoBlock: os 3 segundos", () => {
  it("abre como alertdialog, com o resumo concreto no corpo", () => {
    abrir();
    const dialogo = screen.getByRole("alertdialog");
    expect(dialogo).toBeTruthy();
    expect(dialogo.textContent).toContain("3 peças, R$ 480,00");
  });

  it("o foco inicial é Cancelar, não Confirmar", () => {
    abrir();
    expect(document.activeElement?.textContent).toBe("Cancelar");
  });

  it("mostra o rótulo de espera e marca Confirmar como aria-disabled", () => {
    abrir();
    expect(screen.getByText("Aguarde 3s")).toBeTruthy();
    const confirmar = screen.getByRole("button", { name: "Fechar venda" });
    expect(confirmar.getAttribute("aria-disabled")).toBe("true");
    // `aria-disabled`, NUNCA `disabled`: o botão continua tabulável e anunciado.
    expect(confirmar.hasAttribute("disabled")).toBe(false);
  });

  it("clicar em Confirmar antes dos 3 s não faz nada", () => {
    const { onConfirmar } = abrir();
    fireEvent.click(screen.getByRole("button", { name: "Fechar venda" }));
    expect(onConfirmar).not.toHaveBeenCalled();
  });

  it("Esc não fecha nos 3 primeiros segundos", () => {
    const { onCancelar } = abrir();
    act(() => {
      vi.advanceTimersByTime(BLOQUEIO_MS - 100);
    });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancelar).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });

  it("clique fora não fecha nem depois de liberado", () => {
    const { onCancelar } = abrir();
    liberar();
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);
    expect(onCancelar).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });

  it("depois de 3 s libera, anuncia uma vez e confirma", () => {
    const { onConfirmar } = abrir();
    liberar();
    expect(screen.queryByText("Aguarde 3s")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Confirmação liberada");
    fireEvent.click(screen.getByRole("button", { name: "Fechar venda" }));
    expect(onConfirmar).toHaveBeenCalledTimes(1);
  });

  it("depois de liberado, Esc cancela", () => {
    const { onCancelar } = abrir();
    liberar();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancelar).toHaveBeenCalledTimes(1);
  });

  it("enquanto processa, nem Confirmar nem Cancelar respondem", () => {
    const { onConfirmar, onCancelar } = abrir({ carregando: true });
    liberar();
    fireEvent.click(screen.getByRole("button", { name: "Fechar venda" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onConfirmar).not.toHaveBeenCalled();
    expect(onCancelar).not.toHaveBeenCalled();
  });

  it("erro NÃO fecha o modal e aparece na tela", () => {
    abrir({ erro: "O número da venda no Masc é obrigatório." });
    liberar();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("obrigatório");
  });

  it("a variante destrutiva não muda o tempo de espera", () => {
    const { onConfirmar } = abrir({ variante: "destrutiva" });
    act(() => {
      vi.advanceTimersByTime(BLOQUEIO_MS - 100);
    });
    fireEvent.click(screen.getByRole("button", { name: "Fechar venda" }));
    expect(onConfirmar).not.toHaveBeenCalled();
    liberar();
    fireEvent.click(screen.getByRole("button", { name: "Fechar venda" }));
    expect(onConfirmar).toHaveBeenCalledTimes(1);
  });
});

describe("ConfirmarExclusao herda o contrato", () => {
  it("escreve o resumo com o nome próprio do registro e espera 3 s", () => {
    const onConfirmar = vi.fn();
    render(
      <ConfirmarExclusao
        aberto
        entidade="o contato Maria Silva"
        onConfirmar={onConfirmar}
        onCancelar={vi.fn()}
      />,
    );
    expect(screen.getByRole("alertdialog").textContent).toContain("o contato Maria Silva");
    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));
    expect(onConfirmar).not.toHaveBeenCalled();
    liberar();
    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));
    expect(onConfirmar).toHaveBeenCalledTimes(1);
  });
});

describe("lista fechada de ações com block", () => {
  it("tem exatamente os 20 itens de §9.1", () => {
    expect(ACOES_COM_BLOCK).toHaveLength(20);
    expect(new Set(ACOES_COM_BLOCK).size).toBe(20);
  });

  it("não contém o que §9.1 diz que NÃO existe", () => {
    const proibidos = ["restaurar-registro-excluido", "remover-ultimo-fator"];
    for (const proibido of proibidos) {
      expect(ACOES_COM_BLOCK as readonly string[]).not.toContain(proibido);
    }
  });

  it("o piso de telas ligadas sobe junto com as telas", () => {
    expect(telasLigadas.length).toBeGreaterThanOrEqual(PISO_DE_TELAS_LIGADAS);
    expect(telasLigadas.every((tela) => (ACOES_COM_BLOCK as readonly string[]).includes(tela))).toBe(
      true,
    );
  });
});

describe("M7: as cerimônias administrativas passam pelo block", () => {
  const LOJA = "33333333-3333-4333-8333-333333333333";
  const ALVO = {
    id: "44444444-4444-4444-8444-444444444444",
    nome: "Bia Lima",
    papel: "vendedor" as const,
    lojaId: LOJA,
    updatedAt: "2026-09-16T09:00:00.000Z",
  };
  const casos = [
    ["papel", "Trocar papel ou loja", "Trocar papel", usuarios.trocarPapel, false],
    ["promover", "Promover a administrador", "Promover", usuarios.promoverAAdmin, true],
    ["transferir", "Transferir a posse", "Transferir posse", usuarios.transferirPosse, true],
    ["recuperar", "Recuperação assistida", "Recuperar acesso", usuarios.recuperarAcesso, false],
  ] as const;

  it.each(casos)("%s só chama o servidor depois dos 3 s", async (acao, menu, botao, chamada, ciencia) => {
    chamada.mockResolvedValue({ ok: true, dados: { updatedAt: new Date() } });
    render(
      <AcoesUsuario
        usuario={ALVO}
        disponiveis={[acao]}
        lojas={[{ id: LOJA, nome: "Centro", sigla: "CEN" }]}
      />,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: `Ações para ${ALVO.nome}` }), { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitem", { name: menu }));
    if (ciencia) {
      fireEvent.change(screen.getByLabelText("Ciência"), { target: { value: FRASE_CIENCIA_ADMIN } });
    }
    const motivo = screen.getAllByRole("textbox").at(-1)!;
    fireEvent.change(motivo, { target: { value: "decisão registrada em reunião" } });
    fireEvent.click(screen.getByRole("button", { name: botao }));

    const dialogo = screen.getByRole("alertdialog");
    fireEvent.click(within(dialogo).getByRole("button", { name: botao }));
    expect(chamada).not.toHaveBeenCalled();

    liberar();
    fireEvent.click(within(dialogo).getByRole("button", { name: botao }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(chamada).toHaveBeenCalledTimes(1);
  });
});
