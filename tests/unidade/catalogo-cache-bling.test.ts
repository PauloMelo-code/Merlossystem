import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cache de saldo do Bling (03-arquitetura.md §12.1): 60 s por depósito,
 * single-flight, e falha do Bling NUNCA vira zero.
 */

const leitura = vi.hoisted(() => ({
  lerSaldos: vi.fn<(conta: unknown, deposito: string, ids: readonly string[]) => Promise<Map<string, number>>>(),
}));

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/integracoes/bling/cliente", () => ({
  contaBling: vi.fn(async () => ({ id: "conta", token: "t" })),
}));
vi.mock("@/lib/integracoes/bling/leitura", () => leitura);

const { saldosNoDeposito, esvaziarCacheDeSaldos } = await import("@/lib/integracoes/bling/cache");

beforeEach(() => {
  esvaziarCacheDeSaldos();
  leitura.lerSaldos.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-16T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("saldosNoDeposito", () => {
  it("lê uma vez e serve do cache por 60 s", async () => {
    leitura.lerSaldos.mockResolvedValue(new Map([["1", 4]]));
    const a = await saldosNoDeposito("D1", ["1"]);
    const b = await saldosNoDeposito("D1", ["1"]);
    expect(a.saldos.get("1")?.saldo).toBe(4);
    expect(b.saldos.get("1")?.saldo).toBe(4);
    expect(leitura.lerSaldos).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-09-16T12:01:01Z"));
    leitura.lerSaldos.mockResolvedValue(new Map([["1", 2]]));
    const c = await saldosNoDeposito("D1", ["1"]);
    expect(c.saldos.get("1")?.saldo).toBe(2);
    expect(leitura.lerSaldos).toHaveBeenCalledTimes(2);
  });

  it("o cache é POR DEPÓSITO", async () => {
    leitura.lerSaldos.mockResolvedValue(new Map([["1", 4]]));
    await saldosNoDeposito("D1", ["1"]);
    await saldosNoDeposito("D2", ["1"]);
    expect(leitura.lerSaldos.mock.calls.map((c) => c[1])).toEqual(["D1", "D2"]);
  });

  it("single-flight: duas perguntas simultâneas fazem uma chamada", async () => {
    let soltar: (m: Map<string, number>) => void = () => undefined;
    leitura.lerSaldos.mockReturnValue(new Promise((r) => (soltar = r)));
    const p1 = saldosNoDeposito("D1", ["1", "2"]);
    const p2 = saldosNoDeposito("D1", ["2", "1"]);
    soltar(new Map([["1", 1], ["2", 2]]));
    const [a, b] = await Promise.all([p1, p2]);
    expect(leitura.lerSaldos).toHaveBeenCalledTimes(1);
    expect(a.saldos.get("2")?.saldo).toBe(2);
    expect(b.saldos.get("1")?.saldo).toBe(1);
  });

  it("produto que o Bling não devolve fica null, nunca zero", async () => {
    leitura.lerSaldos.mockResolvedValue(new Map());
    const r = await saldosNoDeposito("D1", ["9"]);
    expect(r.saldos.get("9")?.saldo).toBeNull();
  });

  it("Bling fora do ar: serve a última leitura com a hora dela, ou null", async () => {
    leitura.lerSaldos.mockResolvedValue(new Map([["1", 7]]));
    await saldosNoDeposito("D1", ["1"]);
    vi.setSystemTime(new Date("2026-09-16T12:10:00Z"));
    leitura.lerSaldos.mockRejectedValue(new Error("503"));
    const r = await saldosNoDeposito("D1", ["1", "2"]);
    expect(r.falhou).toBe(true);
    expect(r.saldos.get("1")).toEqual({ saldo: 7, lidoEm: new Date("2026-09-16T12:00:00Z") });
    expect(r.saldos.get("2")).toEqual({ saldo: null, lidoEm: null });
  });
});
