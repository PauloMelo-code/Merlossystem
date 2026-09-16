import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MensagemNaTela } from "@/app/(app)/conversas/_components/balao-mensagem";

/**
 * Composer e balão (04-ui.md §5.2), pacote M1:
 *   - os QUATRO bloqueios, cada um com explicação e saída;
 *   - nota interna muda o composer inteiro e salva sem ir ao canal;
 *   - falha de entrega com o MOTIVO em texto visível e "Tentar de novo".
 */

vi.mock("next/link", () => ({
  default: ({ href, children, ...resto }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...resto}>
      {children}
    </a>
  ),
}));

const { Composer } = await import("@/app/(app)/conversas/_components/composer");
const { BalaoMensagem } = await import("@/app/(app)/conversas/_components/balao-mensagem");

type Props = Parameters<typeof Composer>[0];

function montar(extra: Partial<Props> = {}) {
  const aoEnviar = vi.fn(async () => null);
  render(
    <Composer
      conversaId="c1"
      bloqueio={null}
      aviso={null}
      limite={4096}
      modelos={[]}
      respostas={[]}
      aoEnviar={aoEnviar}
      {...extra}
    />,
  );
  return { aoEnviar };
}

describe("composer: os quatro bloqueios", () => {
  it("janela de 24 h: explica e oferece 'Escolher modelo'; responder fica travado", () => {
    montar({ bloqueio: { caso: "janela_24h" } });
    expect(screen.getByText(/Passaram 24h desde a última mensagem da cliente/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Escolher modelo" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Responder" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("número desconectado: diz desde quando e oferece Reconectar a quem pode", () => {
    montar({
      bloqueio: { caso: "desconectado", conta: "Vendas Centro", desde: "2026-09-16T13:42:00.000Z", podeReconectar: true },
    });
    expect(screen.getByText(/O número Vendas Centro está desconectado desde .*Mensagens não serão enviadas\./)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Reconectar" }).getAttribute("href")).toBe("/configuracoes/integracoes");
  });

  it("número desconectado para quem não pode reconectar: 'Avise o administrador'", () => {
    montar({ bloqueio: { caso: "desconectado", conta: "Vendas Centro", desde: null, podeReconectar: false } });
    expect(screen.getByText("Avise o administrador.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Reconectar" })).toBeNull();
  });

  it("papel sem escrita: não há composer, só o aviso", () => {
    montar({ bloqueio: { caso: "somente_leitura" } });
    expect(screen.getByText("Você tem acesso só de leitura nesta loja.")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Enviar" })).toBeNull();
  });

  it("sem conexão: explica, mantém o rascunho e não envia", () => {
    const { aoEnviar } = montar({ bloqueio: { caso: "sem_conexao" } });
    expect(screen.getByText("Sem conexão. Não é possível enviar agora.")).toBeTruthy();
    const campo = screen.getByRole("textbox");
    fireEvent.change(campo, { target: { value: "já te respondo" } });
    const enviar = screen.getByRole("button", { name: /Enviar/ }) as HTMLButtonElement;
    expect(enviar.disabled).toBe(true);
    fireEvent.keyDown(campo, { key: "Enter" });
    expect(aoEnviar).not.toHaveBeenCalled();
    expect((campo as HTMLTextAreaElement).value).toBe("já te respondo");
  });

  it("sem bloqueio e com aviso: o aviso inline aparece e Enter envia", async () => {
    const { aoEnviar } = montar({ aviso: "Enviar reabre a conversa." });
    expect(screen.getByText("Enviar reabre a conversa.")).toBeTruthy();
    const campo = screen.getByRole("textbox");
    fireEvent.change(campo, { target: { value: "  Temos sim!  " } });
    fireEvent.keyDown(campo, { key: "Enter" });
    await waitFor(() => expect(aoEnviar).toHaveBeenCalledWith({ conteudo: "Temos sim!", nota: false }));
  });
});

describe("composer: nota interna", () => {
  it("muda placeholder e botão e salva como nota", async () => {
    const { aoEnviar } = montar();
    fireEvent.click(screen.getByRole("button", { name: /Nota interna/ }));
    const campo = screen.getByPlaceholderText("Escreva uma nota para a equipe (a cliente não vê)");
    fireEvent.change(campo, { target: { value: "cliente prefere retirar" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar nota" }));
    await waitFor(() => expect(aoEnviar).toHaveBeenCalledWith({ conteudo: "cliente prefere retirar", nota: true }));
  });

  it("com o número desconectado, a nota interna continua disponível", () => {
    montar({ bloqueio: { caso: "desconectado", conta: "X", desde: null, podeReconectar: false } });
    expect(screen.getByRole("button", { name: "Salvar nota" })).toBeTruthy();
  });

  it("erro do servidor: mensagem visível e o texto volta ao campo", async () => {
    const aoEnviar = vi.fn(async () => "Registro não encontrado.");
    montar({ aoEnviar });
    const campo = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(campo, { target: { value: "oi" } });
    fireEvent.click(screen.getByRole("button", { name: /Enviar/ }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Registro não encontrado."));
    expect(campo.value).toBe("oi");
  });
});

const falhada: MensagemNaTela = {
  id: "m1",
  direcao: "saida",
  autorTipo: "usuario",
  autorNome: "Ana",
  doAparelho: false,
  conteudo: "Oi Maria",
  tipo: "texto",
  status: "falhou",
  falhaMotivo: "O número da cliente não tem WhatsApp.",
  notaInterna: false,
  ocorridaEm: "2026-09-16T12:00:00.000Z",
  cartao: null,
  midias: [],
};

describe("balão: falha de entrega", () => {
  it("mostra o motivo em TEXTO e 'Tentar de novo' chama o reenvio", () => {
    const aoReenviar = vi.fn();
    render(
      <ul>
        <BalaoMensagem mensagem={falhada} mostrarAutor colado={false} podeReenviar aoReenviar={aoReenviar} />
      </ul>,
    );
    expect(screen.getByText("O número da cliente não tem WhatsApp.")).toBeTruthy();
    expect(screen.getByText("Não entregue")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Tentar de novo/ }));
    expect(aoReenviar).toHaveBeenCalledWith("m1");
  });

  it("quem não escreve vê o motivo, mas não o botão", () => {
    render(
      <ul>
        <BalaoMensagem mensagem={falhada} mostrarAutor colado={false} podeReenviar={false} aoReenviar={() => {}} />
      </ul>,
    );
    expect(screen.getByText("O número da cliente não tem WhatsApp.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Tentar de novo/ })).toBeNull();
  });

  it("mídia sai pela rota interna; indisponível avisa em vez de mostrar link externo", () => {
    render(
      <ul>
        <BalaoMensagem
          mensagem={{
            ...falhada,
            status: "entregue",
            midias: [
              { id: "a", tipo: "imagem", mime: "image/jpeg", legenda: "vestido", endereco: "/api/midias/x", miniatura: "/api/midias/x?miniatura=1" },
              { id: "b", tipo: "audio", mime: "audio/ogg", legenda: null, endereco: null, miniatura: null },
            ],
          }}
          mostrarAutor
          colado={false}
          podeReenviar
          aoReenviar={() => {}}
        />
      </ul>,
    );
    expect(screen.getByRole("img", { name: "vestido" }).getAttribute("src")).toBe("/api/midias/x?miniatura=1");
    expect(screen.getByText("Mídia indisponível")).toBeTruthy();
  });

  it("nota interna não mostra estado de entrega", () => {
    render(
      <ul>
        <BalaoMensagem
          mensagem={{ ...falhada, notaInterna: true, status: null, falhaMotivo: null }}
          mostrarAutor
          colado={false}
          podeReenviar
          aoReenviar={() => {}}
        />
      </ul>,
    );
    expect(screen.getByText("Nota de Ana")).toBeTruthy();
    expect(screen.queryByText("Não entregue")).toBeNull();
  });
});
