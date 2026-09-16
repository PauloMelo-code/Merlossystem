import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Disponibilidade calculada no Postgres (01-dados-dominio.md §4.2): o saldo
 * vem do Bling (aqui, do cache simulado) e a reserva vem dos pedidos. Nada é
 * gravado. Massa commitada em loja nova, porque a função lê pelo `db`.
 */

const saldos = vi.hoisted(() => new Map<string, number | null>());
const chamadas = vi.hoisted(() => ({ depositos: [] as string[] }));

vi.mock("@/lib/integracoes/bling/cache", () => ({
  saldosNoDeposito: vi.fn(async (depositoId: string, ids: readonly string[]) => {
    chamadas.depositos.push(depositoId);
    const mapa = new Map<string, { saldo: number | null; lidoEm: Date | null }>();
    for (const id of ids) {
      mapa.set(id, saldos.has(id) ? { saldo: saldos.get(id) ?? null, lidoEm: new Date() } : { saldo: null, lidoEm: null });
    }
    return { saldos: mapa, falhou: false };
  }),
}));

const { db, pool } = await import("@/lib/db/client");
const { calcularDisponiveis, calcularDisponivel } = await import("@/lib/catalogo/disponibilidade");
const { sql } = await import("drizzle-orm");
const apoio = await import("./pedidos-apoio");

beforeAll(() => apoio.exigirBancoDeTeste());
afterAll(async () => {
  await pool.end().catch(() => undefined);
});

describe("calcularDisponivel", () => {
  it("saldo menos reservado, só pedido pendente e vivo, casado por SKU, nunca negativo", async () => {
    const deposito = `dep-${Date.now()}`;
    const c = await apoio.cenario(db, { deposito });
    const idP = `b-${c.skuProduto.slice(5)}-p`;
    const idProduto = `b-${c.skuProduto.slice(5)}`;
    saldos.set(idP, 5);
    saldos.set(idProduto, 1);

    await apoio.pedidoCru(db, c, { sku: c.skuP, quantidade: 2 });
    await apoio.pedidoCru(db, c, { sku: c.skuP, quantidade: 3, status: "cancelado" });
    await apoio.pedidoCru(db, c, { sku: c.skuP, quantidade: 1, status: "devolvido" });
    await apoio.pedidoCru(db, c, { sku: c.skuP, quantidade: 4, masc: "lancado" });
    await apoio.pedidoCru(db, c, { sku: c.skuP, quantidade: 4, masc: "dispensado" });
    await apoio.pedidoCru(db, c, { sku: null, quantidade: 7 });
    await apoio.pedidoCru(db, c, { sku: c.skuProduto, quantidade: 3 });
    // Pedido excluído logicamente não conta.
    const excluido = await apoio.pedidoCru(db, c, { sku: c.skuP, quantidade: 9 });
    await db.execute(sql`update pedidos set is_deleted = true, deleted_at = now() where id = ${excluido}`);

    const mapa = await calcularDisponiveis(c.lojaId, [c.skuP, c.skuProduto, "SKU-QUE-NAO-EXISTE"]);
    expect(mapa.get(c.skuP)).toMatchObject({ saldo: 5, reservado: 2, disponivel: 3, leituraAntiga: false });
    expect(mapa.get(c.skuProduto)).toMatchObject({ saldo: 1, reservado: 3, disponivel: 0 });
    expect(mapa.get("SKU-QUE-NAO-EXISTE")).toMatchObject({ saldo: null, disponivel: null, leituraAntiga: true });
    expect(chamadas.depositos.at(-1)).toBe(deposito);

    // Calcular não grava nada: os pedidos continuam como estavam.
    const linhas = await db.execute(sql`select count(*)::int as n from pedidos where loja_id = ${c.lojaId}`);
    expect((linhas.rows[0] as { n: number }).n).toBe(8);
  });

  it("loja sem depósito do Bling: 'não sabemos', com a reserva ainda calculada", async () => {
    const c = await apoio.cenario(db);
    await apoio.pedidoCru(db, c, { sku: c.skuP, quantidade: 2 });
    const antes = chamadas.depositos.length;
    const d = await calcularDisponivel(c.lojaId, c.skuP);
    expect(d).toMatchObject({ disponivel: null, saldo: null, reservado: 2 });
    expect(chamadas.depositos.length).toBe(antes);
  });

  it("o mesmo SKU em outra loja não reserva nesta", async () => {
    const deposito = `dep-${Date.now()}-b`;
    const c = await apoio.cenario(db, { deposito });
    const outra = await apoio.cenario(db, { deposito });
    saldos.set(`b-${c.skuProduto.slice(5)}-p`, 10);
    // Pedido na outra loja com o SKU desta.
    await apoio.pedidoCru(db, { ...outra, skuP: c.skuP }, { sku: c.skuP, quantidade: 6 });
    const d = await calcularDisponivel(c.lojaId, c.skuP);
    expect(d).toMatchObject({ saldo: 10, reservado: 0, disponivel: 10 });
  });
});
