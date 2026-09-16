import { and, count, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/lib/db/client";
import { vivosE } from "@/lib/db/consultas";
import { pedidos } from "@/lib/db/schema/pedidos";
import { ErroDeColisao, ErroDeEscopo, ErroDeValidacao } from "@/lib/erros";
import {
  alterarStatusDoPedido,
  cancelarPedido,
  criarPedido,
  dispensarDoMasc,
  informarRastreio,
  registrarLancamentoMasc,
  voltarParaFilaDoMasc,
} from "@/lib/pedidos";
import { naFilaDoMasc } from "@/lib/pedidos/_consultas";
import { novoPedidoSchema } from "@/lib/validadores/pedidos";
import { cenario, contexto, emRollback, exigirBancoDeTeste, umaLinha, type Cenario } from "./pedidos-apoio";

/**
 * Pedido de ponta a ponta no Postgres (01-dados-dominio.md §6; 04-ui.md §5.3).
 * Tudo em transação com rollback, pelo papel `merlo_app`.
 */

beforeAll(() => exigirBancoDeTeste());
afterAll(async () => {
  await pool.end().catch(() => undefined);
});

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const novo = (c: Cenario, extra: Record<string, unknown> = {}) =>
  novoPedidoSchema.parse({
    contatoId: c.contatoId,
    itens: [
      { variacaoId: c.variacoes.P, quantidade: 2 },
      { variacaoId: c.variacoes.M, quantidade: 1 },
    ],
    frete: "15,00",
    desconto: "9.70",
    ...extra,
  });

async function versao(tx: Tx, id: string): Promise<Date> {
  const l = await umaLinha<{ updated_at: Date }>(tx, sql`select updated_at from pedidos where id = ${id}`);
  return new Date(l.updated_at);
}

function codigoPg(erro: unknown): string | undefined {
  for (let a = erro as { code?: string; cause?: unknown } | undefined; a; a = a.cause as typeof a) {
    if (a.code) return a.code;
  }
  return undefined;
}

describe("fechar venda", () => {
  it("numera no formato da loja, usa o preço do servidor e nasce pendente no Masc", async () => {
    await emRollback(async (tx) => {
      const c = await cenario(tx);
      const r = await criarPedido(novo(c), contexto(c), tx);
      expect(r.numero).toMatch(new RegExp(`^MS\\d{4}-${c.sigla}-0001$`));
      // 2 × 129,90 + 1 × 129,90 + 15,00 − 9,70
      expect(r.total).toBe("395.00");

      const p = await umaLinha<Record<string, string>>(tx, sql`
        select status, masc_status, subtotal, total, criado_por from pedidos where id = ${r.id}`);
      expect(p).toMatchObject({ status: "confirmado", masc_status: "pendente", subtotal: "389.70", criado_por: c.usuarioId });

      const itens = await tx.execute(sql`
        select sku, tamanho, quantidade, preco_unitario, total_item from pedidos_itens
        where pedido_id = ${r.id} order by tamanho desc`);
      expect(itens.rows).toEqual([
        { sku: c.skuP, tamanho: "P", quantidade: 2, preco_unitario: "129.90", total_item: "259.80" },
        // Sem SKU no tamanho, o item leva o SKU do produto (a reserva degrada).
        { sku: c.skuProduto, tamanho: "M", quantidade: 1, preco_unitario: "129.90", total_item: "129.90" },
      ]);

      const contato = await umaLinha<Record<string, unknown>>(tx, sql`
        select pedidos_contagem, pedidos_valor_total, ultima_compra_em from contatos where id = ${c.contatoId}`);
      expect(contato).toMatchObject({ pedidos_contagem: 1, pedidos_valor_total: "395.00" });
      expect(contato.ultima_compra_em).not.toBeNull();

      const trilha = await umaLinha<{ n: number }>(tx, sql`
        select count(*)::int as n from auditoria_eventos where entidade = 'pedidos' and entidade_id = ${r.id}
          and acao = 'pedido_criado' and ator_id = ${c.usuarioId}`);
      expect(trilha.n).toBe(1);

      const segundo = await criarPedido(novo(c), contexto(c), tx);
      expect(segundo.numero.endsWith("-0002")).toBe(true);
    });
  });

  it("pedido com negócio move o negócio para ganho na mesma transação", async () => {
    await emRollback(async (tx) => {
      const c = await cenario(tx);
      const negocio = await umaLinha<{ id: string }>(tx, sql`
        insert into negocios (loja_id, contato_id, estagio) values (${c.lojaId}, ${c.contatoId}, 'negociando')
        returning id`);
      await criarPedido(novo(c, { negocioId: negocio.id }), contexto(c), tx);
      const depois = await umaLinha<{ estagio: string }>(tx, sql`select estagio from negocios where id = ${negocio.id}`);
      expect(depois.estagio).toBe("ganho");
      const trilha = await umaLinha<{ n: number }>(tx, sql`
        select count(*)::int as n from auditoria_eventos
        where entidade = 'negocios' and entidade_id = ${negocio.id} and acao = 'negocio_estagio_alterado'`);
      expect(trilha.n).toBe(1);
    });
  });

  it("recusa desconto acima dos produtos, variação de outra loja e contato de outra loja", async () => {
    await emRollback(async (tx) => {
      const c = await cenario(tx);
      const outra = await cenario(tx);
      await expect(
        tx.transaction((sp) => criarPedido(novo(c, { desconto: "999.00" }), contexto(c), sp)),
      ).rejects.toBeInstanceOf(ErroDeValidacao);
      await expect(
        tx.transaction((sp) =>
          criarPedido(
            novo(c, { itens: [{ variacaoId: outra.variacoes.P, quantidade: 1 }] }),
            contexto(c),
            sp,
          ),
        ),
      ).rejects.toBeInstanceOf(ErroDeValidacao);
      await expect(
        tx.transaction((sp) => criarPedido(novo(c, { contatoId: outra.contatoId }), contexto(c), sp)),
      ).rejects.toBeInstanceOf(ErroDeEscopo);
    });
  });
});

describe("CHECKs de coerência", () => {
  it("pedidos_total_coerente e itens_total_coerente barram valor inventado", async () => {
    await emRollback(async (tx) => {
      const c = await cenario(tx);
      const totalErrado = await tx
        .transaction((sp) =>
          sp.execute(sql`
            insert into pedidos (loja_id, contato_id, numero, subtotal, frete, desconto, total, criado_por)
            values (${c.lojaId}, ${c.contatoId}, 'X-1', '100.00', '10.00', '5.00', '100.00', ${c.usuarioId})`),
        )
        .catch((e: unknown) => e);
      expect(codigoPg(totalErrado)).toBe("23514");

      const pedido = await umaLinha<{ id: string }>(tx, sql`
        insert into pedidos (loja_id, contato_id, numero, subtotal, frete, desconto, total, criado_por)
        values (${c.lojaId}, ${c.contatoId}, 'X-2', '100.00', '10.00', '5.00', '105.00', ${c.usuarioId})
        returning id`);
      const itemErrado = await tx
        .transaction((sp) =>
          sp.execute(sql`
            insert into pedidos_itens (loja_id, pedido_id, produto_id, nome, tamanho, quantidade, preco_unitario, total_item)
            values (${c.lojaId}, ${pedido.id}, ${c.produtoId}, 'Vestido', 'P', 3, '10.00', '20.00')`),
        )
        .catch((e: unknown) => e);
      expect(codigoPg(itemErrado)).toBe("23514");
    });
  });
});

describe("ponte manual com o Masc", () => {
  it("lança, recusa número repetido na loja e volta para a fila preservando o número", async () => {
    await emRollback(async (tx) => {
      const c = await cenario(tx);
      const ctx = contexto(c);
      const a = await criarPedido(novo(c), ctx, tx);
      const b = await criarPedido(novo(c), ctx, tx);

      const lancado = await registrarLancamentoMasc(
        { id: a.id, updatedAt: await versao(tx, a.id), mascVendaId: "V-100" },
        ctx,
        tx,
      );
      const linha = await umaLinha<Record<string, unknown>>(tx, sql`
        select masc_status, masc_venda_id, masc_lancado_por, masc_lancado_em from pedidos where id = ${a.id}`);
      expect(linha).toMatchObject({ masc_status: "lancado", masc_venda_id: "V-100", masc_lancado_por: c.usuarioId });

      await expect(
        registrarLancamentoMasc({ id: b.id, updatedAt: await versao(tx, b.id), mascVendaId: "V-100" }, ctx, tx),
      ).rejects.toMatchObject({ codigo: "VALIDACAO", campos: { mascVendaId: [expect.stringContaining("outro pedido")] } });

      // A transação continua viva depois da recusa (savepoint).
      await voltarParaFilaDoMasc({ id: a.id, updatedAt: lancado.atualizadoEm }, ctx, tx);
      const volta = await umaLinha<Record<string, unknown>>(tx, sql`
        select masc_status, masc_venda_id, masc_lancado_por, masc_lancado_em from pedidos where id = ${a.id}`);
      expect(volta).toMatchObject({ masc_status: "pendente", masc_venda_id: "V-100", masc_lancado_por: c.usuarioId });
      expect(volta.masc_lancado_em).not.toBeNull();
    });
  });

  it("dispensar exige pedido na fila; versão velha vira colisão", async () => {
    await emRollback(async (tx) => {
      const c = await cenario(tx);
      const ctx = contexto(c);
      const p = await criarPedido(novo(c), ctx, tx);
      const lida = await versao(tx, p.id);
      await dispensarDoMasc({ id: p.id, updatedAt: lida, observacao: "venda feita no balcão" }, ctx, tx);
      await expect(
        tx.transaction((sp) =>
          dispensarDoMasc({ id: p.id, updatedAt: lida, observacao: "de novo, com versão velha" }, ctx, sp),
        ),
      ).rejects.toBeInstanceOf(ErroDeValidacao);
      await expect(
        tx.transaction((sp) => voltarParaFilaDoMasc({ id: p.id, updatedAt: lida }, ctx, sp)),
      ).rejects.toBeInstanceOf(ErroDeColisao);
    });
  });
});

describe("andamento e cancelamento", () => {
  it("cancelar tira da fila, devolve os contadores e encerra o pedido", async () => {
    await emRollback(async (tx) => {
      const c = await cenario(tx);
      const ctx = contexto(c);
      const p = await criarPedido(novo(c), ctx, tx);
      const v1 = await alterarStatusDoPedido({ id: p.id, updatedAt: await versao(tx, p.id), status: "preparando" }, ctx, tx);
      const v2 = await informarRastreio(
        { id: p.id, updatedAt: v1.atualizadoEm, rastreioCodigo: "BR123456789", rastreioUrl: "https://rastreio.exemplo/1", entregaMetodo: undefined },
        ctx,
        tx,
      );
      await cancelarPedido({ id: p.id, updatedAt: v2.atualizadoEm, motivo: "cliente desistiu da compra" }, ctx, tx);

      const linha = await umaLinha<Record<string, unknown>>(tx, sql`
        select status, cancelado_motivo, cancelado_em, rastreio_codigo from pedidos where id = ${p.id}`);
      expect(linha).toMatchObject({ status: "cancelado", cancelado_motivo: "cliente desistiu da compra", rastreio_codigo: "BR123456789" });
      const contato = await umaLinha<Record<string, unknown>>(tx, sql`
        select pedidos_contagem, pedidos_valor_total from contatos where id = ${c.contatoId}`);
      expect(contato).toMatchObject({ pedidos_contagem: 0, pedidos_valor_total: "0.00" });

      const [fila] = await tx
        .select({ n: count() })
        .from(pedidos)
        .where(and(vivosE(pedidos, sql`${pedidos.loja_id} = ${c.lojaId}`), naFilaDoMasc()));
      expect(fila?.n).toBe(0);

      const depois = await versao(tx, p.id);
      await expect(
        tx.transaction((sp) => alterarStatusDoPedido({ id: p.id, updatedAt: depois, status: "enviado" }, ctx, sp)),
      ).rejects.toBeInstanceOf(ErroDeValidacao);
      await expect(
        tx.transaction((sp) => registrarLancamentoMasc({ id: p.id, updatedAt: depois, mascVendaId: "V-9" }, ctx, sp)),
      ).rejects.toBeInstanceOf(ErroDeValidacao);
    });
  });

  it("pedido de outra loja responde 'não encontrado'", async () => {
    await emRollback(async (tx) => {
      const c = await cenario(tx);
      const outra = await cenario(tx);
      const p = await criarPedido(novo(c), contexto(c), tx);
      await expect(
        tx.transaction((sp) =>
          alterarStatusDoPedido({ id: p.id, updatedAt: new Date(), status: "enviado" }, contexto(outra), sp),
        ),
      ).rejects.toBeInstanceOf(ErroDeEscopo);
    });
  });
});

describe("fila 'falta lançar' usa o índice parcial", () => {
  it("o plano da contagem passa por ix_pedidos_fila_masc", async () => {
    const consulta = db
      .select({ n: count() })
      .from(pedidos)
      .where(vivosE(pedidos, sql`${pedidos.loja_id} = '00000000-0000-4000-8000-000000000000'`, naFilaDoMasc()))
      .toSQL();
    const cliente = await pool.connect();
    try {
      await cliente.query("begin");
      await cliente.query("set local enable_seqscan = off");
      const plano = await cliente.query(`explain ${consulta.sql}`, consulta.params);
      const texto = plano.rows.map((r: Record<string, string>) => Object.values(r)[0]).join("\n");
      expect(texto).toContain("ix_pedidos_fila_masc");
    } finally {
      await cliente.query("rollback");
      cliente.release();
    }
  });
});
