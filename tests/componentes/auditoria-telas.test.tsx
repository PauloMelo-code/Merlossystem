import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";

/**
 * Telas de `/auditoria` (04-ui.md §5.5): os quatro estados que dá para provar
 * no componente (vazio, vazio com filtro, com itens, acessível) e as regras
 * que só a tela segura:
 *   - a trilha e os excluídos não têm ação de exclusão nem de restauração;
 *   - a listagem de acesso não mostra IP;
 *   - campo PII aparece como "(alterado)";
 *   - a aba ativa é anunciada.
 * O estado de ERRO é da página (`EstadoErro` com a mensagem da action), e o de
 * CARREGAMENTO é o `loading.tsx` da casca.
 */

vi.mock("next/navigation", () => ({ usePathname: () => "/auditoria/qualidade" }));

const { TabelaTrilha } = await import("@/app/(app)/auditoria/_components/tabela-trilha");
const { TabelaAcessos } = await import("@/app/(app)/auditoria/_components/tabela-acessos");
const { TabelaExcluidos } = await import("@/app/(app)/auditoria/_components/tabela-excluidos");
const { TabelaQualidade } = await import("@/app/(app)/auditoria/_components/tabela-qualidade");
const { DetalheEvento } = await import("@/app/(app)/auditoria/_components/detalhe-evento");
const { AbasAuditoria } = await import("@/app/(app)/auditoria/_components/abas-auditoria");
const { FormularioFiltros } = await import("@/app/(app)/auditoria/_components/formulario-filtros");

const GRAVES = new Set(["serious", "critical"]);
async function semViolacaoGrave(no: HTMLElement) {
  const r = await axe(no);
  expect(r.violations.filter((v) => GRAVES.has(String(v.impact))).map((v) => v.id)).toEqual([]);
}

const QUANDO = "2026-09-10T15:00:00.000Z";
const semAcaoDestrutiva = () =>
  expect(screen.queryByRole("button", { name: /excluir|apagar|restaurar|remover/i })).toBeNull();

describe("trilha", () => {
  it("vazio sem filtro e vazio com filtro dizem coisas diferentes", () => {
    const { rerender } = render(<TabelaTrilha eventos={[]} comFiltro={false} />);
    expect(screen.getByText("Nenhum evento registrado ainda.")).toBeTruthy();
    rerender(<TabelaTrilha eventos={[]} comFiltro />);
    expect(screen.getByText("Nenhum evento com esses filtros.")).toBeTruthy();
  });

  it("com itens: abre o detalhe e não oferece exclusão", async () => {
    const { container } = render(
      <TabelaTrilha
        comFiltro={false}
        eventos={[
          {
            id: "e1",
            criadoEm: QUANDO,
            pessoa: "Bia",
            acao: "Contato: alterado",
            entidade: "Contatos",
            entidadeId: "0f8fad5b-d9cb",
            hrefDetalhe: "/auditoria?evento=e1",
          },
        ]}
      />,
    );
    const links = screen.getAllByRole("link", { name: /ver detalhe/i });
    expect(links[0]?.getAttribute("href")).toBe("/auditoria?evento=e1");
    semAcaoDestrutiva();
    await semViolacaoGrave(container);
  });

  it("detalhe mostra (alterado) no campo PII e a tabela de diff tem cabeçalhos", async () => {
    const { container } = render(
      <DetalheEvento
        titulo="Contato: alterado"
        quando={QUANDO}
        hrefFechar="/auditoria"
        linhas={[{ rotulo: "Pessoa", valor: "Bia" }]}
        diff={[
          { campo: "status", antes: "novo", depois: "cliente" },
          { campo: "telefone", antes: "(alterado)", depois: "(alterado)" },
          { campo: "opt_out", antes: undefined, depois: false },
        ]}
      />,
    );
    const linha = screen.getByRole("row", { name: /telefone/ });
    expect(within(linha).getAllByText("(alterado)")).toHaveLength(2);
    expect(screen.getByRole("row", { name: /opt_out/ }).textContent).toContain("não");
    expect(screen.getByRole("link", { name: "Fechar detalhe" })).toBeTruthy();
    await semViolacaoGrave(container);
  });
});

describe("acessos", () => {
  it("a listagem não tem coluna de IP", () => {
    render(
      <TabelaAcessos
        comFiltro={false}
        eventos={[
          { id: "a", criadoEm: QUANDO, tipo: "Login falha", resultado: "falha", pessoa: "hash abc…", hrefDetalhe: "/x" },
        ]}
      />,
    );
    expect(screen.queryByText(/^IP$/)).toBeNull();
    expect(screen.getAllByText("Falhou").length).toBeGreaterThan(0);
  });
});

describe("excluídos", () => {
  it("somente leitura: leva à trilha, nunca restaura", () => {
    render(
      <TabelaExcluidos
        rotuloDaEntidade="Contatos"
        comPeriodo={false}
        registros={[{ id: "r", rotulo: "Ex-cliente", excluidoEm: QUANDO, excluidoPor: "Bia", hrefTrilha: "/auditoria?entidade=contatos&entidadeId=r" }]}
      />,
    );
    expect(screen.getAllByRole("link", { name: /ver na trilha/i })[0]?.getAttribute("href")).toContain("entidadeId=r");
    semAcaoDestrutiva();
  });

  it("vazio diz a entidade e o período", () => {
    render(<TabelaExcluidos rotuloDaEntidade="Pedidos" comPeriodo registros={[]} />);
    expect(screen.getByText("Nenhum registro excluído em Pedidos nesse período.")).toBeTruthy();
  });
});

describe("qualidade", () => {
  const rotulos = {
    falhas_envio: "Falhas de envio",
    dispensas_masc: "Dispensas do Masc",
    voltou_fila_masc: "Voltaram à fila do Masc",
    recusas_403: "Acessos negados",
  };
  const linha = (nome: string, falhas: number) => ({
    pessoaId: nome,
    nome,
    falhasEnvio: falhas,
    dispensasMasc: 0,
    voltouFilaMasc: 0,
    recusas403: 0,
    hrefs: { falhas_envio: `/q?p=${nome}`, dispensas_masc: "/q", voltou_fila_masc: "/q", recusas_403: "/q" },
  });

  it("ordena pelo total e reordena ao clicar; zero não vira link", () => {
    render(<TabelaQualidade rotulos={rotulos} linhas={[linha("Ana", 1), linha("Caio", 5)]} />);
    const tabela = screen.getByRole("table");
    const nomes = () => within(tabela).getAllByRole("row").slice(1).map((r) => r.textContent?.split(/\d/)[0]);
    expect(nomes()).toEqual(["Caio", "Ana"]);
    fireEvent.click(within(tabela).getByRole("button", { name: "Pessoa" }));
    expect(nomes()).toEqual(["Caio", "Ana"]);
    fireEvent.click(within(tabela).getByRole("button", { name: "Pessoa" }));
    expect(nomes()).toEqual(["Ana", "Caio"]);
    expect(within(tabela).getAllByRole("link", { name: /ver ocorrências de Falhas de envio de Caio/ })).toHaveLength(1);
    expect(within(tabela).queryByRole("link", { name: /Dispensas do Masc de Caio/ })).toBeNull();
  });

  it("vazio", () => {
    render(<TabelaQualidade rotulos={rotulos} linhas={[]} />);
    expect(screen.getByText("Nenhum erro registrado no período.")).toBeTruthy();
  });
});

describe("casca e filtros", () => {
  it("aba ativa anunciada com aria-current", () => {
    render(
      <AbasAuditoria
        abas={[
          { rotulo: "Trilha", rota: "/auditoria" },
          { rotulo: "Qualidade", rota: "/auditoria/qualidade" },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "Qualidade" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Trilha" }).getAttribute("aria-current")).toBeNull();
  });

  it("filtros são form GET nativo, com rótulo em cada campo", async () => {
    const { container } = render(
      <FormularioFiltros
        destino="/auditoria"
        campos={[
          { tipo: "lista", nome: "acao", rotulo: "Ação", vazio: "Todas", opcoes: [{ valor: "a", rotulo: "A" }], valor: "a" },
          { tipo: "data", nome: "de", rotulo: "De" },
          { tipo: "oculto", nome: "entidade", valor: "contatos" },
          { tipo: "oculto", nome: "vazio" },
        ]}
      />,
    );
    const form = screen.getByRole("search");
    expect(form.getAttribute("method")).toBe("get");
    expect((screen.getByLabelText("Ação") as HTMLSelectElement).value).toBe("a");
    expect(screen.getByLabelText("De").getAttribute("type")).toBe("date");
    expect(container.querySelectorAll('input[type="hidden"]')).toHaveLength(1);
    await semViolacaoGrave(container);
  });
});
