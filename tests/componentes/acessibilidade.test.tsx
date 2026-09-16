import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import * as matchers from "vitest-axe/matchers";
import { ModalConfirmacaoBlock } from "@/components/comum/modal-confirmacao-block";
import { Campo, idsDeApoio } from "@/components/comum/campo";
import { FaixaAviso } from "@/components/comum/faixa-aviso";
import { SeloStatus } from "@/components/comum/selo-status";
import { Input } from "@/components/ui/input";

/**
 * Piloto de acessibilidade (04-ui.md §11; risco 6 de 03-arquitetura.md §23:
 * "vitest-axe com Vitest 5 / Vite 8, não verificado por ninguém — rodar um
 * teste-piloto no commit que abre o pacote de UI").
 *
 * É este arquivo. Ele prova que o par roda e cobre os componentes compartilhados
 * que toda tela vai herdar. Sem violação `serious` nem `critical`.
 *
 * As telas inteiras entram em F8 e na onda 2, cada uma com a sua passada.
 */

expect.extend(matchers);

const GRAVES = new Set(["serious", "critical"]);

async function conferir(no: HTMLElement) {
  const resultado = await axe(no);
  const graves = resultado.violations.filter((v) => GRAVES.has(String(v.impact)));
  expect(graves.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

describe("acessibilidade dos componentes compartilhados", () => {
  it("modal block: alertdialog, foco preso e rótulos", async () => {
    const { baseElement } = render(
      <ModalConfirmacaoBlock
        aberto
        titulo="Excluir contato"
        resumo="Você vai excluir o contato Maria Silva."
        textoConfirmar="Excluir"
        variante="destrutiva"
        onConfirmar={() => {}}
        onCancelar={() => {}}
      />,
    );
    await conferir(baseElement);
  });

  it("campo: label associado, ajuda e erro descritos", async () => {
    const { container } = render(
      <Campo nome="telefone" rotulo="Telefone" ajuda="Com DDD" erro="Informe o DDD">
        <Input
          id="telefone"
          name="telefone"
          type="tel"
          autoComplete="tel"
          aria-invalid
          aria-describedby={idsDeApoio("telefone", { ajuda: "Com DDD", erro: "Informe o DDD" })}
        />
      </Campo>,
    );
    await conferir(container);
  });

  it("faixa e selo: estado nunca só por cor", async () => {
    const { container } = render(
      <div>
        <FaixaAviso
          tom="perigo"
          titulo="O número Vendas Centro está desconectado."
          descricao="Mensagens não serão enviadas."
        />
        <SeloStatus dominio="status_conversa" valor="pendente" />
      </div>,
    );
    await conferir(container);
  });
});
