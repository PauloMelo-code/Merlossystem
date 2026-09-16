import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cliente Bling (03-arquitetura.md §12.1): só `GET`, pela porta anti-SSRF,
 * consumindo o balde de 3 req/s da conta ANTES de sair, e com o erro do
 * provedor traduzido em permanente × temporário.
 */

const m = vi.hoisted(() => ({
  consumir: vi.fn(),
  buscarExterno: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/lib/seguranca/cofre", () => ({ decifrar: vi.fn() }));
vi.mock("@/lib/seguranca/limite", () => ({ consumir: m.consumir }));
vi.mock("@/lib/rede/buscarExterno", () => ({ buscarExterno: m.buscarExterno }));

const { lerDoBling, montarUrl } = await import("@/lib/integracoes/bling/cliente");
const { chaveDoLimitador, LIMITE_BLING } = await import("@/lib/integracoes/bling/config");
const { listarDepositos } = await import("@/lib/integracoes/bling/leitura");

const conta = { id: "conta-1", token: "tok" };
const resposta = (status: number, corpo: unknown = {}) => ({
  status,
  tipo: "application/json",
  bytes: Buffer.from(JSON.stringify(corpo)),
});

beforeEach(() => {
  m.consumir.mockReset().mockResolvedValue({ permitido: true, retryAfter: null });
  m.buscarExterno.mockReset();
});

describe("lerDoBling", () => {
  it("monta a URL da API v3 com lista em `chave[]`", () => {
    expect(montarUrl("/estoques/saldos/7", { idsProdutos: ["1", "2"] })).toBe(
      "https://api.bling.com.br/Api/v3/estoques/saldos/7?idsProdutos%5B%5D=1&idsProdutos%5B%5D=2",
    );
  });

  it("GET com token, pelo buscarExterno do provedor bling, depois de consumir o balde da conta", async () => {
    m.buscarExterno.mockResolvedValue(resposta(200, { data: [1] }));
    await expect(lerDoBling(conta, "/produtos", { pagina: 1 })).resolves.toEqual({ data: [1] });
    expect(m.consumir).toHaveBeenCalledWith(chaveDoLimitador("conta-1"), LIMITE_BLING);
    const [, opcoes] = m.buscarExterno.mock.calls[0]!;
    expect(opcoes).toMatchObject({ provedor: "bling", metodo: "GET", cabecalhos: { Authorization: "Bearer tok" } });
    expect(LIMITE_BLING).toEqual({ janela: 1, max: 3 });
  });

  it("espera a vez quando o balde está cheio", async () => {
    m.consumir
      .mockResolvedValueOnce({ permitido: false, retryAfter: 1 })
      .mockResolvedValueOnce({ permitido: true, retryAfter: null });
    m.buscarExterno.mockResolvedValue(resposta(200));
    await lerDoBling(conta, "/produtos");
    expect(m.consumir).toHaveBeenCalledTimes(2);
  });

  it.each([
    [401, true],
    [403, true],
    [400, true],
    [429, false],
    [503, false],
  ])("HTTP %i vira erro de integração (permanente = %s)", async (status, permanente) => {
    m.buscarExterno.mockResolvedValue(resposta(status));
    await expect(lerDoBling(conta, "/produtos")).rejects.toMatchObject({ codigo: "INTEGRACAO", permanente });
  });

  it("404 é 'não existe', não erro", async () => {
    m.buscarExterno.mockResolvedValue(resposta(404));
    await expect(lerDoBling(conta, "/produtos/9")).resolves.toBeNull();
  });
});

describe("listarDepositos (costura do M5)", () => {
  it("GET /depositos, id como texto, situacao 0 = inativo e item malformado descartado", async () => {
    m.buscarExterno.mockResolvedValue(
      resposta(200, {
        data: [
          { id: 101, descricao: "Loja Centro", situacao: 1, padrao: true },
          { id: 102, descricao: "Antigo", situacao: 0, padrao: false },
          { id: 103, descricao: "Sem situação" },
          { id: 104 },
        ],
      }),
    );
    await expect(listarDepositos(conta, 1)).resolves.toEqual([
      { id: "101", descricao: "Loja Centro", padrao: true, ativo: true },
      { id: "102", descricao: "Antigo", padrao: false, ativo: false },
      { id: "103", descricao: "Sem situação", padrao: false, ativo: true },
    ]);
    const [url, opcoes] = m.buscarExterno.mock.calls[0]!;
    expect(url).toContain("/Api/v3/depositos?pagina=1");
    expect(opcoes).toMatchObject({ metodo: "GET" });
  });
});
