import { afterAll, describe, expect, it } from "vitest";

/**
 * Numeração de pedido (01-dados-dominio.md §6.2, ADR 0019; aceite do M4):
 * 100 pedidos concorrentes → 100 números distintos, sem buraco.
 *
 * O defeito do antigo era `max(substr) + 1` com retry: duas vendedoras no
 * mesmo segundo levavam o mesmo número. Aqui o `UPDATE ... RETURNING` é a
 * trava, e o rollback devolve o número — por isso não há buraco.
 *
 * Precisa de Postgres de verdade: roda com `DATABASE_URL_TESTE` (banco do
 * pacote, 05-plano §3.3). Sem ela o arquivo é PULADO e o Vitest mostra o
 * `skip` — nunca passa em silêncio.
 */

const temBanco = Boolean(process.env.DATABASE_URL_TESTE);

/** O `pg` pode chegar embrulhado pelo Drizzle: procura o código na cadeia. */
function codigoPg(erro: unknown): string | undefined {
  for (let atual = erro as { code?: string; cause?: unknown } | undefined; atual; atual = atual.cause as typeof atual) {
    if (atual.code) return atual.code;
  }
  return undefined;
}

describe("proximoNumeroDePedido (Postgres)", async () => {
  if (!temBanco) {
    it.skip("sem DATABASE_URL_TESTE: rode com o banco do pacote", () => undefined);
    return;
  }
  const { sql } = await import("drizzle-orm");
  const { db, pool } = await import("@/lib/db/client");
  const { proximoNumeroDePedido } = await import("@/lib/db/mutacoes");
  const { exigirBancoDeTeste, umaLinha } = await import("../integracao/pedidos-apoio");

  exigirBancoDeTeste();

  afterAll(async () => {
    await pool.end().catch(() => undefined);
  });

  async function novaLoja(): Promise<string> {
    const s = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    for (let i = 0; i < 30; i += 1) {
      const sigla = Array.from({ length: 3 }, () =>
        String.fromCharCode(65 + Math.floor(Math.random() * 26)),
      ).join("");
      try {
        const linha = await umaLinha<{ id: string }>(db, sql`
          insert into lojas (nome, slug, sigla) values (${`Num ${s}`}, ${`num-${s}-${i}`}, ${sigla})
          returning id`);
        return linha.id;
      } catch {
        // sigla já usada por outra loja viva: sorteia de novo
      }
    }
    throw new Error("não achei sigla livre");
  }

  it("100 transações concorrentes recebem 1..100, sem repetir e sem buraco", async () => {
    const lojaId = await novaLoja();
    const numeros = await Promise.all(
      Array.from({ length: 100 }, () =>
        db.transaction((tx) => proximoNumeroDePedido(tx, lojaId, "2609")),
      ),
    );
    expect(new Set(numeros).size).toBe(100);
    expect([...numeros].sort((a, b) => a - b)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
  }, 60_000);

  it("transação desfeita devolve o número: o próximo não pula", async () => {
    const lojaId = await novaLoja();
    await db.transaction((tx) => proximoNumeroDePedido(tx, lojaId, "2610"));
    await expect(
      db.transaction(async (tx) => {
        await proximoNumeroDePedido(tx, lojaId, "2610");
        throw new Error("venda desistida");
      }),
    ).rejects.toThrow("venda desistida");
    const seguinte = await db.transaction((tx) => proximoNumeroDePedido(tx, lojaId, "2610"));
    expect(seguinte).toBe(2);
  });

  it("cada loja e cada mês contam do zero", async () => {
    const [a, b] = [await novaLoja(), await novaLoja()];
    expect(await db.transaction((tx) => proximoNumeroDePedido(tx, a, "2611"))).toBe(1);
    expect(await db.transaction((tx) => proximoNumeroDePedido(tx, b, "2611"))).toBe(1);
    expect(await db.transaction((tx) => proximoNumeroDePedido(tx, a, "2612"))).toBe(1);
    expect(await db.transaction((tx) => proximoNumeroDePedido(tx, a, "2611"))).toBe(2);
  });

  it("o CHECK recusa ano-mês inválido e contador excluído", async () => {
    const lojaId = await novaLoja();
    const invalido = await db.transaction((tx) => proximoNumeroDePedido(tx, lojaId, "2613")).catch((e: unknown) => e);
    expect(codigoPg(invalido)).toBe("23514");
    await db.transaction((tx) => proximoNumeroDePedido(tx, lojaId, "2601"));
    const excluido = await db
      .execute(sql`update pedidos_numeracao set is_deleted = true where loja_id = ${lojaId}`)
      .catch((e: unknown) => e);
    expect(codigoPg(excluido)).toBe("23514");
  });
});
