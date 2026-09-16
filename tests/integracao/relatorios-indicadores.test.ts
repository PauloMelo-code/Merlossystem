import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encontrarDivergencias, reconciliar } from "@/lib/alertas";
import { chaveDaDivergencia } from "@/lib/alertas/reconciliacao";
import { db, pool } from "@/lib/db/client";
import { gerarCsv, montarRelatorio } from "@/lib/relatorios";
import { periodoPadrao } from "@/lib/validadores/auditoria";
import { alertasDaLoja, cenario, conversaCom, emRollback, exigirBancoDeTeste, umaLinha } from "./auditoria-apoio";

/**
 * `/relatorios` (04-ui.md §5.5) com as duas definições FIXADAS:
 *   Receita = soma de `pedidos.total` com `masc_status = 'lancado'` no período;
 *   Tempo de primeira resposta = `primeira_resposta_em − created_at`.
 * E a reconciliação, que ACHA divergência, abre alerta e não corrige nada.
 */

beforeAll(() => exigirBancoDeTeste());
afterAll(async () => {
  await pool.end();
});

describe("indicadores por loja e período", () => {
  it("receita só conta pedido lançado no período; mediana da primeira resposta; série sem buraco", async () => {
    await emRollback(async (tx) => {
      const c = await cenario(tx);
      const { contatoId } = await conversaCom(tx, c);
      const pedido = (numero: string, total: string, masc: string, lancadoHa: string | null, status = "confirmado") =>
        tx.execute(sql`
          insert into pedidos (loja_id, contato_id, numero, total, subtotal, masc_status, masc_venda_id, masc_lancado_em, status, criado_por)
          values (${c.lojaId}, ${contatoId}, ${numero}, ${total}, ${total}, ${masc}, ${lancadoHa === null ? null : `V${numero}`},
                  ${lancadoHa === null ? null : sql`now() - ${lancadoHa}::interval`}, ${status}, ${c.usuarioId})`);
      await pedido("A-1", "100.10", "lancado", "1 hour");
      await pedido("A-2", "50.05", "lancado", "2 days");
      await pedido("A-3", "999.00", "pendente", null);
      await pedido("A-4", "70.00", "lancado", "90 days");
      await pedido("A-5", "10.00", "pendente", null, "cancelado");

      // Três conversas: respostas em 2, 4 e sem resposta -> mediana 3 min.
      for (const minutos of [2, 4, null]) {
        const { conversaId } = await conversaCom(tx, c);
        await tx.execute(sql`
          update conversas set created_at = now() - interval '1 hour',
                 primeira_resposta_em = ${minutos === null ? null : sql`now() - interval '1 hour' + ${`${minutos} minutes`}::interval`}
           where id = ${conversaId}`);
      }

      const periodo = periodoPadrao(30);
      const r = await montarRelatorio({ tipo: "uma", lojaId: c.lojaId }, periodo, tx);
      expect(r.loja).toMatch(/^Centro /);
      expect(r.indicadores).toMatchObject({
        receita: "150.15",
        pedidosLancados: 2,
        ticketMedio: "75.08",
        pedidosCriados: 4,
        // 4 conversas: a do contato dos pedidos (sem resposta) e as 3 do laço.
        taxaResposta: 2 / 4,
        tempoPrimeiraResposta: 3,
      });
      expect(r.serie).toHaveLength(30);
      expect(r.serie.at(-1)?.dia).toBe(periodo.ateTexto);
      const somaSerie = r.serie.reduce((t, p) => t + Number(p.receita), 0);
      expect(somaSerie.toFixed(2)).toBe("150.15");

      const csv = gerarCsv({ ...r, deTexto: periodo.deTexto, ateTexto: periodo.ateTexto });
      expect(csv).toContain(`Loja;${r.loja}`);
      expect(csv).toContain("Receita;R$ 150,15;");

      const vazio = await montarRelatorio({ tipo: "uma", lojaId: c.outraLojaId }, periodo, tx);
      expect(vazio.indicadores).toMatchObject({ pedidosLancados: 0, ticketMedio: null, taxaResposta: null, tempoPrimeiraResposta: null });
      const nenhuma = await montarRelatorio({ tipo: "nenhuma" }, periodo, tx);
      expect(nenhuma.indicadores.receita).toBe("0.00");
    });
  });
});

describe("reconciliação", () => {
  it("acha espelho de opt-out e contadores divergentes, e não corrige", async () => {
    await emRollback(async (tx) => {
      const c = await cenario(tx);
      const certo = await umaLinha(tx, sql`
        insert into contatos (loja_id, telefone, opt_out, opt_out_em) values (${c.lojaId}, '5551900000001', true, now()) returning id`);
      await tx.execute(sql`
        insert into consentimentos (loja_id, contato_id, tipo, concedido, origem, termo_versao)
        values (${c.lojaId}, ${certo.id}, 'opt_out', true, 'tela', 'v1')`);
      const semOrigem = await umaLinha(tx, sql`
        insert into contatos (loja_id, telefone, opt_out, opt_out_em) values (${c.lojaId}, '5551900000002', true, now()) returning id`);
      const revogou = await umaLinha(tx, sql`
        insert into contatos (loja_id, telefone, opt_out, opt_out_em) values (${c.lojaId}, '5551900000003', true, now()) returning id`);
      await tx.execute(sql`
        insert into consentimentos (loja_id, contato_id, tipo, concedido, origem, termo_versao, criado_em)
        values (${c.lojaId}, ${revogou.id}, 'opt_out', true, 'tela', 'v1', now() - interval '1 day'),
               (${c.lojaId}, ${revogou.id}, 'opt_in', true, 'tela', 'v1', now())`);
      const contador = await umaLinha(tx, sql`
        insert into contatos (loja_id, telefone, pedidos_contagem, pedidos_valor_total)
        values (${c.lojaId}, '5551900000004', 2, 30) returning id`);
      await tx.execute(sql`
        insert into pedidos (loja_id, contato_id, numero, total, subtotal, criado_por)
        values (${c.lojaId}, ${contador.id}, 'R-1', 30, 30, ${c.usuarioId})`);

      const achadas = await encontrarDivergencias(c.lojaId, tx);
      const ordem = (a: { tipo: string; contatoId: string }, b: { tipo: string; contatoId: string }) =>
        (a.tipo + a.contatoId).localeCompare(b.tipo + b.contatoId);
      expect([...achadas].sort(ordem)).toEqual(
        [
          { tipo: "contadores", lojaId: c.lojaId, contatoId: contador.id },
          { tipo: "opt_out", lojaId: c.lojaId, contatoId: semOrigem.id },
          { tipo: "opt_out", lojaId: c.lojaId, contatoId: revogou.id },
        ].sort(ordem),
      );
      const intacto = await umaLinha<{ opt_out: boolean; pedidos_contagem: number }>(tx, sql`
        select opt_out, pedidos_contagem from contatos where id = ${contador.id}`);
      expect(intacto).toEqual({ opt_out: false, pedidos_contagem: 2 });
    });
  });

  it("vira alerta espelho_divergente sem duplicar, e é resolvido quando a divergência some", async () => {
    const c = await cenario(db);
    const contato = await umaLinha(db, sql`
      insert into contatos (loja_id, telefone, opt_out, opt_out_em)
      values (${c.lojaId}, ${`5551${Date.now().toString().slice(-9)}`}, true, now()) returning id`);
    const chave = chaveDaDivergencia({ tipo: "opt_out", contatoId: contato.id });

    await reconciliar(c.lojaId);
    await reconciliar(c.lojaId);
    let alertas = await alertasDaLoja(c.lojaId);
    expect(alertas).toHaveLength(1);
    expect(alertas[0]).toMatchObject({
      tipo: "espelho_divergente",
      chave_deduplicacao: chave,
      severidade: "critica",
      contato_id: contato.id,
      resolvido_em: null,
    });
    // Não corrigiu o dado.
    const intacto = await umaLinha<{ opt_out: boolean }>(db, sql`select opt_out from contatos where id = ${contato.id}`);
    expect(intacto.opt_out).toBe(true);

    // Alguém registra a origem do opt-out: a divergência some e o alerta é resolvido.
    await db.execute(sql`
      insert into consentimentos (loja_id, contato_id, tipo, concedido, origem, termo_versao)
      values (${c.lojaId}, ${contato.id}, 'opt_out', true, 'tela', 'v1')`);
    expect(await reconciliar(c.lojaId)).toEqual([]);
    alertas = await alertasDaLoja(c.lojaId);
    expect(alertas).toHaveLength(1);
    expect(alertas[0]?.resolvido_em).not.toBeNull();
  });
});
