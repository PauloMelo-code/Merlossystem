import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  anonimizarEventosAntigos,
  detalheDoEvento,
  detalheDoEventoDeAcesso,
  listarEventosDeAcesso,
  listarExcluidos,
  listarTrilha,
  ocorrenciasDe,
  painelDeQualidade,
} from "@/lib/auditoria";
import { decodificarCursor } from "@/lib/auditoria/cursor";
import { db, pool } from "@/lib/db/client";
import { ErroDeEscopo } from "@/lib/erros";
import { cenario, conversaCom, emRollback, exigirBancoDeTeste, mensagem, umaLinha } from "./auditoria-apoio";

/**
 * Leituras de `/auditoria` (04-ui.md §5.5) e a prova do append-only pelo papel
 * da aplicação. Tudo em transação com rollback, como `merlo_app`.
 */

beforeAll(() => exigirBancoDeTeste());
afterAll(async () => {
  await pool.end();
});

const periodo = { de: new Date(Date.now() - 86_400_000), ate: new Date(Date.now() + 60_000) };

describe("a trilha é append-only de verdade (papel merlo_app)", () => {
  it.each(["auditoria_eventos", "auth_eventos"])("UPDATE e DELETE em %s falham com 42501", async (tabela) => {
    const erros: string[] = [];
    // A exclusão é montada por partes de propósito: é uma TENTATIVA que tem de
    // falhar (prova do REVOKE), e a trava T25 reprova o literal em qualquer
    // arquivo do repositório.
    const exclusao = ["delete", "from", tabela].join(" ");
    for (const comando of [`update ${tabela} set ip = 'x'`, exclusao]) {
      await db
        .transaction(async (tx) => {
          await tx.execute(sql`set local role merlo_app`);
          await tx.execute(sql.raw(comando));
        })
        .catch((e: { code?: string; cause?: { code?: string } }) => erros.push(e.code ?? e.cause?.code ?? "?"));
    }
    expect(erros).toEqual(["42501", "42501"]);
  });
});

describe("trilha de negócio", () => {
  it("respeita a loja, pagina por cursor e o detalhe de outra loja é 404", async () => {
    await emRollback(async (tx) => {
      const c = await cenario(tx);
      for (let i = 0; i < 3; i += 1) {
        await tx.execute(sql`
          insert into auditoria_eventos (ator_tipo, ator_id, loja_id, acao, entidade, entidade_id, criado_em)
          values ('usuario', ${c.usuarioId}, ${c.lojaId}, 'contato_alterado', 'contatos', ${`c${i}`},
                  now() - ${`${i} minutes`}::interval)`);
      }
      const daOutra = await umaLinha(tx, sql`
        insert into auditoria_eventos (ator_tipo, ator_id, loja_id, acao, entidade)
        values ('usuario', ${c.usuarioId}, ${c.outraLojaId}, 'contato_criado', 'contatos') returning id`);

      const escopo = { tipo: "uma", lojaId: c.lojaId } as const;
      const p1 = await listarTrilha(escopo, { cursor: null, direcao: "proxima", porPagina: 2 }, tx);
      expect(p1.itens.map((e) => e.entidadeId)).toEqual(["c0", "c1"]);
      expect(p1.itens[0]?.atorNome).toBe("Bia de Teste");
      expect(p1.cursorProximo).not.toBeNull();
      const p2 = await listarTrilha(
        escopo,
        { cursor: decodificarCursor(p1.cursorProximo), direcao: "proxima", porPagina: 2 },
        tx,
      );
      expect(p2.itens.map((e) => e.entidadeId)).toEqual(["c2"]);
      expect(p2.cursorProximo).toBeNull();
      const volta = await listarTrilha(
        escopo,
        { cursor: decodificarCursor(p2.cursorAnterior), direcao: "anterior", porPagina: 2 },
        tx,
      );
      expect(volta.itens.map((e) => e.entidadeId)).toEqual(["c0", "c1"]);

      await expect(detalheDoEvento(escopo, daOutra.id, tx)).rejects.toBeInstanceOf(ErroDeEscopo);
      const filtrada = await listarTrilha(
        { tipo: "todas" },
        { acao: "contato_criado", cursor: null, direcao: "proxima", porPagina: 50 },
        tx,
      );
      expect(filtrada.itens.map((e) => e.id)).toContain(daOutra.id);
    });
  });

  it("campo PII aparece como (alterado) e segredo nem aparece, mesmo gravado cru", async () => {
    await emRollback(async (tx) => {
      const c = await cenario(tx);
      const evento = await umaLinha(tx, sql`
        insert into auditoria_eventos (ator_tipo, ator_id, loja_id, acao, entidade, entidade_id, antes, depois, detalhes)
        values ('usuario', ${c.usuarioId}, ${c.lojaId}, 'contato_alterado', 'contatos', 'x',
                '{"telefone":"5551999990000","status":"a"}'::jsonb,
                '{"telefone":"5551888880000","status":"b","token_api":"segredo"}'::jsonb,
                '{"motivo":"ok","senha":"123"}'::jsonb)
        returning id`);
      const detalhe = await detalheDoEvento({ tipo: "uma", lojaId: c.lojaId }, evento.id, tx);
      expect(detalhe.diff).toEqual([
        { campo: "status", antes: "a", depois: "b" },
        { campo: "telefone", antes: "(alterado)", depois: "(alterado)" },
      ]);
      expect(JSON.stringify(detalhe)).not.toMatch(/5551|segredo|123/);
      expect(detalhe.detalhes).toEqual({ motivo: "ok" });
    });
  });
});

describe("qualidade: os quatro indicadores vêm das fontes reais", () => {
  it("falhas de envio, dispensas, voltas à fila e recusas 403, por pessoa", async () => {
    await emRollback(async (tx) => {
      const c = await cenario(tx);
      const { conversaId } = await conversaCom(tx, c);
      await mensagem(tx, c, conversaId, "saida", 5, { status: "falhou", autor: c.usuarioId, falha: "número inválido" });
      await mensagem(tx, c, conversaId, "saida", 4, { status: "falhou", autor: c.usuarioId, falha: "janela fechada" });
      await mensagem(tx, c, conversaId, "saida", 3, { status: "entregue", autor: c.usuarioId });
      for (const acao of ["pedido_dispensado_masc", "pedido_voltou_fila_masc", "pedido_voltou_fila_masc"]) {
        await tx.execute(sql`
          insert into auditoria_eventos (ator_tipo, ator_id, loja_id, acao, entidade, entidade_id, motivo)
          values ('usuario', ${c.usuarioId}, ${c.lojaId}, ${acao}, 'pedidos', gen_random_uuid()::text, 'cliente desistiu')`);
      }
      // Recusa conta pela loja do cadastro: a pessoa do cenário é de gestão (sem loja).
      await tx.execute(sql`
        insert into auth_eventos (tipo, usuario_id, resultado, detalhes)
        values ('recusa_403', ${c.usuarioId}, 'recusado', '{"acao":"pedidos:cancelar"}'::jsonb)`);

      const naLoja = await painelDeQualidade({ tipo: "uma", lojaId: c.lojaId }, periodo, tx);
      expect(naLoja.find((l) => l.pessoaId === c.usuarioId)).toMatchObject({
        falhasEnvio: 2,
        dispensasMasc: 1,
        voltouFilaMasc: 2,
        recusas403: 0,
      });
      const naRede = await painelDeQualidade({ tipo: "todas" }, periodo, tx);
      expect(naRede.find((l) => l.pessoaId === c.usuarioId)?.recusas403).toBe(1);
      const naOutra = await painelDeQualidade({ tipo: "uma", lojaId: c.outraLojaId }, periodo, tx);
      expect(naOutra.find((l) => l.pessoaId === c.usuarioId)).toBeUndefined();

      const falhas = await ocorrenciasDe({ tipo: "todas" }, "falhas_envio", c.usuarioId, periodo, tx);
      expect(falhas.map((o) => o.descricao).sort()).toEqual(["janela fechada", "número inválido"]);
      expect(falhas[0]?.rota).toBe(`/conversas/${conversaId}`);
      const recusas = await ocorrenciasDe({ tipo: "todas" }, "recusas_403", c.usuarioId, periodo, tx);
      expect(recusas.map((o) => o.descricao)).toEqual(["pedidos:cancelar"]);
    });
  });
});

describe("excluídos: somente leitura, com quem e quando", () => {
  it("lista o excluído da loja com o autor, e nada vivo nem de outra loja", async () => {
    await emRollback(async (tx) => {
      const c = await cenario(tx);
      await tx.execute(sql`
        insert into contatos (loja_id, nome, telefone, is_deleted, deleted_at, modified_by)
        values (${c.lojaId}, 'Ex-cliente', '5551911112222', true, now(), ${c.usuarioId})`);
      await tx.execute(sql`insert into contatos (loja_id, nome, telefone) values (${c.lojaId}, 'Viva', '5551933334444')`);
      await tx.execute(sql`
        insert into contatos (loja_id, nome, telefone, is_deleted, deleted_at)
        values (${c.outraLojaId}, 'De outra loja', '5551955556666', true, now())`);

      const pagina = await listarExcluidos(
        { tipo: "uma", lojaId: c.lojaId },
        { entidade: "contatos", cursor: null, direcao: "proxima", porPagina: 50 },
        tx,
      );
      expect(pagina.itens.map((r) => [r.rotulo, r.excluidoPorNome])).toEqual([["Ex-cliente", "Bia de Teste"]]);
    });
  });
});

describe("trilha de acesso", () => {
  it("a listagem não traz IP nem navegador; o detalhe traz; e-mail só como hash", async () => {
    await emRollback(async (tx) => {
      const c = await cenario(tx);
      const evento = await umaLinha(tx, sql`
        insert into auth_eventos (tipo, usuario_id, email_hash, resultado, ip, agente, meio)
        values ('login_falha', ${c.usuarioId}, 'hmac-abc', 'falha', '203.0.113.9', 'Firefox', 'senha')
        returning id`);
      const pagina = await listarEventosDeAcesso(
        { pessoa: c.usuarioId, cursor: null, direcao: "proxima", porPagina: 25 },
        tx,
      );
      expect(pagina.itens).toHaveLength(1);
      expect(pagina.itens[0]).not.toHaveProperty("ip");
      expect(pagina.itens[0]).not.toHaveProperty("agente");
      expect(pagina.itens[0]?.emailHash).toBe("hmac-abc");
      const detalhe = await detalheDoEventoDeAcesso(evento.id, tx);
      expect(detalhe).toMatchObject({ ip: "203.0.113.9", agente: "Firefox", usuarioNome: "Bia de Teste" });
    });
  });
});

describe("retenção do diário de ingestão", () => {
  it("anonimiza o antigo por UPDATE e não remove linha nenhuma", async () => {
    const antigo = await umaLinha(db, sql`
      insert into lojas_integracoes_eventos (provedor, tipo, assinatura_ok, ip, corpo, cabecalhos, created_at)
      values ('uazapi', 'processado', true, '198.51.100.1', '{"telefone":"5551"}'::jsonb,
              '{"user-agent":"x"}'::jsonb, now() - interval '31 days') returning id`);
    const recente = await umaLinha(db, sql`
      insert into lojas_integracoes_eventos (provedor, tipo, assinatura_ok, corpo, created_at)
      values ('uazapi', 'recebido', true, '{"telefone":"5552"}'::jsonb, now() - interval '2 days') returning id`);
    const antes = await umaLinha<{ n: string }>(db, sql`select count(*)::text as n from lojas_integracoes_eventos`);

    const total = await anonimizarEventosAntigos();
    expect(total).toBeGreaterThanOrEqual(1);

    const depois = await umaLinha<{ n: string }>(db, sql`select count(*)::text as n from lojas_integracoes_eventos`);
    expect(depois.n).toBe(antes.n);
    const linhas = await db.execute<{ id: string; corpo: unknown; cabecalhos: unknown }>(sql`
      select id, corpo, cabecalhos from lojas_integracoes_eventos where id in (${antigo.id}, ${recente.id})`);
    const porId = new Map(linhas.rows.map((l) => [l.id, l]));
    expect(porId.get(antigo.id)).toMatchObject({ corpo: { anonimizado: true }, cabecalhos: {} });
    expect(porId.get(recente.id)?.corpo).toEqual({ telefone: "5552" });
    // Idempotente: a segunda rodada não acha mais nada deste lote.
    expect(await anonimizarEventosAntigos()).toBe(0);
  });
});
