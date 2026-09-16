import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModalConfirmacaoBlock } from "@/components/comum/modal-confirmacao-block";
import { ConfirmarExclusao } from "@/components/comum/confirmar-exclusao";

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

const PISO_DE_TELAS_LIGADAS = 0;
const telasLigadas: readonly string[] = [];

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
