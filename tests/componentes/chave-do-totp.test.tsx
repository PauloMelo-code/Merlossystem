import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import * as matchers from "vitest-axe/matchers";
import { ChaveDoTotp } from "@/components/comum/chave-do-totp";
import { qrDeDataUrl } from "@/lib/qr";

/**
 * A chave do segundo fator nas duas formas (04-ui.md §5.1).
 *
 * O que este arquivo protege e que nenhuma revisão pega sozinha: o QR NÃO pode
 * substituir a chave escrita. Quem tem o autenticador no mesmo aparelho da tela
 * não consegue fotografá-la, e quem usa leitor de tela não enxerga imagem
 * nenhuma — se alguém "limpar" a tela tirando o texto, essas pessoas perdem o
 * acesso e o teste é o que avisa.
 *
 * O `data:` URL é gerado pelo MESMO módulo do servidor, e não por um valor
 * inventado aqui: assim o teste também prova que o gerador devolve algo que a
 * tag `img` aceita.
 */

expect.extend(matchers);

const URI =
  "otpauth://totp/MerlostoreChat:fulana@merlo.test?secret=JBSWY3DPEHPK3PXP&issuer=MerlostoreChat";
const CHAVE = "JBSWY3DPEHPK3PXP";

describe("ChaveDoTotp", () => {
  it("mostra o QR e a chave escrita ao mesmo tempo", () => {
    render(<ChaveDoTotp uri={URI} qr={qrDeDataUrl(URI)} />);

    const imagem = screen.getByRole("img");
    expect(imagem.getAttribute("src")).toMatch(/^data:image\/svg\+xml;base64,/);
    // Alt descritivo: diz o que é E aponta a alternativa, em vez de "QR code".
    expect(imagem.getAttribute("alt")).toMatch(/chave está escrita logo abaixo/i);

    expect(screen.getByText(CHAVE)).toBeTruthy();
    expect(screen.getByRole("button", { name: /copiar a chave/i })).toBeTruthy();
  });

  it("sem QR, a chave escrita sozinha continua servindo", () => {
    render(<ChaveDoTotp uri={URI} />);

    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText(CHAVE)).toBeTruthy();
    expect(screen.getByText(/inserir a chave manualmente/i)).toBeTruthy();
  });

  it("com uri quebrada, diz o que aconteceu em vez de mostrar caixa vazia", () => {
    render(<ChaveDoTotp uri="não é uma uri" qr="" />);

    expect(screen.getByRole("alert").textContent).toMatch(/gere uma nova/i);
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("leva o foco para o título quando a chave aparece", () => {
    render(<ChaveDoTotp uri={URI} qr={qrDeDataUrl(URI)} />);

    expect(document.activeElement?.textContent).toBe("Cadastre esta chave no aplicativo");
  });

  it("não tem violação grave de acessibilidade", async () => {
    const { container } = render(<ChaveDoTotp uri={URI} qr={qrDeDataUrl(URI)} />);
    const resultado = await axe(container);
    const graves = resultado.violations.filter((v) =>
      ["serious", "critical"].includes(String(v.impact)),
    );
    expect(graves.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
