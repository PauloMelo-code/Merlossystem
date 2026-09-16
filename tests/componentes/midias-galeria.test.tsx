import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MidiaDto } from "@/lib/midias/dto";

/**
 * Galeria (04-ui.md §5.4): a grade só aponta para `/api/midias/[id]` e excluir
 * passa pelo bloqueio de 3 s (§9.1, item 5 "excluir-registro").
 */

const acoes = vi.hoisted(() => ({ excluirMidia: vi.fn() }));
vi.mock("@/lib/actions/midias", () => acoes);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { GradeMidias } = await import("@/app/(app)/galeria/_components/grade-midias");
const { enviarArquivo } = await import("@/app/(app)/galeria/_components/area-upload");

function midia(parcial: Partial<MidiaDto> = {}): MidiaDto {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    lojaId: "22222222-2222-4222-8222-222222222222",
    nomeOriginal: "vestido-azul.png",
    tipoArquivo: "imagem",
    mimeType: "image/png",
    tamanhoBytes: 2048,
    largura: 10,
    altura: 10,
    origem: "upload",
    pasta: "produtos",
    temMiniatura: true,
    criadaEm: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
    ...parcial,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  acoes.excluirMidia.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("grade de mídias", () => {
  it("imagem aponta para a rota interna com miniatura; documento vira ícone", () => {
    render(
      <GradeMidias
        midias={[midia(), midia({ id: "33333333-3333-4333-8333-333333333333", tipoArquivo: "documento", nomeOriginal: null })]}
        podeExcluir={false}
      />,
    );
    const img = screen.getByRole("img", { name: "vestido-azul.png" });
    expect(img.getAttribute("src")).toBe("/api/midias/11111111-1111-4111-8111-111111111111?miniatura=1");
    expect(screen.getByRole("button", { name: "Abrir Documento sem nome" })).toBeTruthy();
    const enderecos = [...document.querySelectorAll("[src],[href]")].map(
      (e) => e.getAttribute("src") ?? e.getAttribute("href"),
    );
    expect(enderecos.every((e) => e?.startsWith("/api/midias/"))).toBe(true);
    expect(document.body.innerHTML).not.toMatch(/url_externa|urlExterna/);
  });

  it("sem midia:excluir, o botão de excluir não existe", () => {
    render(<GradeMidias midias={[midia()]} podeExcluir={false} />);
    expect(screen.queryByRole("button", { name: /Excluir/ })).toBeNull();
  });

  it("excluir: block de 3 s com resumo, Esc não fecha, erro mantém o modal", async () => {
    acoes.excluirMidia.mockResolvedValueOnce({ ok: false, codigo: "COLISAO", mensagem: "Alterado por outra pessoa." });
    render(<GradeMidias midias={[midia()]} podeExcluir />);

    fireEvent.click(screen.getByRole("button", { name: "Excluir vestido-azul.png" }));
    const modal = screen.getByRole("alertdialog");
    expect(modal.textContent).toContain('Você vai excluir a mídia "vestido-azul.png".');
    const confirmar = screen.getByRole("button", { name: "Excluir" });
    expect(confirmar.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement?.textContent).toBe("Cancelar");

    fireEvent.click(confirmar);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(acoes.excluirMidia).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(confirmar.getAttribute("aria-disabled")).toBe("false");

    await act(async () => {
      fireEvent.click(confirmar);
    });
    expect(acoes.excluirMidia).toHaveBeenCalledWith({
      id: "11111111-1111-4111-8111-111111111111",
      updated_at: "2026-09-01T12:00:00.000Z",
      loja: "22222222-2222-4222-8222-222222222222",
    });
    expect(screen.getByRole("alert").textContent).toBe("Alterado por outra pessoa.");
    expect(screen.queryByRole("alertdialog")).not.toBeNull();
  });

  it("excluir com sucesso fecha o modal", async () => {
    acoes.excluirMidia.mockResolvedValueOnce({ ok: true, dados: null });
    render(<GradeMidias midias={[midia()]} podeExcluir />);
    fireEvent.click(screen.getByRole("button", { name: "Excluir vestido-azul.png" }));
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Excluir" }));
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("envio por XMLHttpRequest", () => {
  it("manda o arquivo cru com o tipo e devolve o motivo do servidor", async () => {
    const enviados: { url: string; tipo: string | null; corpo: unknown }[] = [];
    class XhrFalso {
      status = 415;
      responseText = JSON.stringify({ codigo: "VALIDACAO", mensagem: "Tipo de arquivo não aceito." });
      upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      private url = "";
      private tipo: string | null = null;
      open(_m: string, url: string) {
        this.url = url;
      }
      setRequestHeader(_n: string, v: string) {
        this.tipo = v;
      }
      send(corpo: unknown) {
        enviados.push({ url: this.url, tipo: this.tipo, corpo });
        this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 } as ProgressEvent);
        this.onload?.();
      }
    }
    vi.stubGlobal("XMLHttpRequest", XhrFalso);
    const progresso: number[] = [];
    const arquivo = new File(["<svg/>"], "x.svg", { type: "image/svg+xml" });
    const motivo = await enviarArquivo(arquivo, "/api/midias?pasta=geral", (f) => progresso.push(f));
    vi.unstubAllGlobals();

    expect(motivo).toBe("Tipo de arquivo não aceito.");
    expect(progresso).toEqual([0.5]);
    expect(enviados).toEqual([{ url: "/api/midias?pasta=geral", tipo: "image/svg+xml", corpo: arquivo }]);
  });
});
