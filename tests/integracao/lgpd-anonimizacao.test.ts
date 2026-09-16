import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "@/lib/db/client";
import type { Transacao } from "@/lib/db/mutacoes";
import { ErroDeColisao, ErroDeEscopo, ErroDeValidacao } from "@/lib/erros";
import { anonimizarContato, MARCADOR, NOME_ANONIMO } from "@/lib/lgpd";
import {
  cenario,
  contexto,
  emRollback,
  exigirBancoDeTeste,
  novoContato,
  umaLinha,
  type Cenario,
} from "./contatos-apoio";

/**
 * Aceite do pacote M2 (01-dados-dominio.md §8; 01-dados.md §14).
 *
 * Anonimizar um contato com mensagem de TEXTO, mídia com transcrição, pesquisa
 * respondida e pedido lançado: a transação FECHA (o marcador não viola o CHECK
 * `conversas_mensagens_conteudo_presente`) e o telefone do titular não é
 * encontrável em NENHUMA coluna de texto de NENHUMA tabela.
 */

const TELEFONE = "5551988887777";

beforeAll(() => exigirBancoDeTeste());
afterAll(async () => {
  await pool.end().catch(() => undefined);
});

type Titular = { contatoId: string; updatedAt: Date; pedidoId: string; midiaId: string };

/** O titular com PII espalhada em todo depósito que o §8 lista. */
async function titularCompleto(tx: Transacao, c: Cenario): Promise<Titular> {
  const contato = await umaLinha<{ id: string; updated_at: Date }>(tx, sql`
    insert into contatos (loja_id, nome, telefone, whatsapp_id, email, observacoes, endereco)
    values (${c.lojaId}, 'Maria Titular', ${TELEFONE}, ${TELEFONE}, 'maria@exemplo.invalido',
            ${`ligar no ${TELEFONE}`},
            ${JSON.stringify({ cep: "90000000", logradouro: "Rua A", numero: "1", bairro: "B", cidade: "Porto Alegre", uf: "RS" })}::jsonb)
    returning id, updated_at`);
  const conversa = await umaLinha<{ id: string }>(tx, sql`
    insert into conversas (loja_id, contato_id, integracao_id, ultima_mensagem_previa)
    values (${c.lojaId}, ${contato.id}, ${c.integracaoId}, ${`meu número é ${TELEFONE}`}) returning id`);
  await tx.execute(sql`
    insert into conversas_mensagens (loja_id, conversa_id, direcao, autor_tipo, conteudo, ocorrida_em, metadados)
    values (${c.lojaId}, ${conversa.id}, 'entrada', 'contato', ${`meu número é ${TELEFONE}`}, now(),
            ${JSON.stringify({ story_url: `https://exemplo.invalido/${TELEFONE}` })}::jsonb)`);
  const comMidia = await umaLinha<{ id: string }>(tx, sql`
    insert into conversas_mensagens (loja_id, conversa_id, direcao, autor_tipo, tipo_conteudo, ocorrida_em)
    values (${c.lojaId}, ${conversa.id}, 'entrada', 'contato', 'audio', now()) returning id`);
  const midia = await umaLinha<{ id: string }>(tx, sql`
    insert into lojas_midias (loja_id, chave_objeto, tipo_arquivo, mime_type, tamanho_bytes, origem, nome_original)
    values (${c.lojaId}, ${`${c.lojaId}/recebida/${crypto.randomUUID()}.ogg`}, 'audio', 'audio/ogg', 1024,
            'recebida', ${`audio-${TELEFONE}.ogg`}) returning id`);
  await tx.execute(sql`
    insert into conversas_mensagens_midias (loja_id, mensagem_id, midia_id, tipo_arquivo, mime_type, legenda, transcricao, baixada)
    values (${c.lojaId}, ${comMidia.id}, ${midia.id}, 'audio', 'audio/ogg',
            ${`legenda ${TELEFONE}`}, ${`me liga no ${TELEFONE}`}, true)`);
  await tx.execute(sql`
    insert into pesquisas_satisfacao (loja_id, contato_id, conversa_id, gatilho, nota, comentario, respondida_em)
    values (${c.lojaId}, ${contato.id}, ${conversa.id}, 'conversa_encerrada', 5,
            ${`adorei, meu zap ${TELEFONE}`}, now())`);
  const produto = await umaLinha<{ id: string }>(tx, sql`
    insert into produtos (loja_id, nome, preco) values (${c.lojaId}, 'Vestido', '100.00') returning id`);
  const pedido = await umaLinha<{ id: string }>(tx, sql`
    insert into pedidos (loja_id, contato_id, numero, criado_por, subtotal, total, masc_status, masc_venda_id, masc_lancado_em)
    values (${c.lojaId}, ${contato.id}, 'CEN-0001', ${c.usuarioId}, '100.00', '100.00', 'lancado', 'V-1', now())
    returning id`);
  await tx.execute(sql`
    insert into pedidos_itens (loja_id, pedido_id, produto_id, nome, tamanho, quantidade, preco_unitario, total_item)
    values (${c.lojaId}, ${pedido.id}, ${produto.id}, 'Vestido', 'M', 1, '100.00', '100.00')`);
  return { contatoId: contato.id, updatedAt: new Date(contato.updated_at), pedidoId: pedido.id, midiaId: midia.id };
}

/** Toda coluna de texto/json de toda tabela do schema `public`, onde o telefone ainda aparece. */
async function ondeOTelefoneAparece(tx: Transacao): Promise<string[]> {
  const colunas = await tx.execute<{ table_name: string; column_name: string }>(sql`
    select table_name, column_name from information_schema.columns
     where table_schema = 'public'
       and data_type in ('text', 'character varying', 'jsonb', 'json')
       and table_name not like '\\_\\_%'`);
  const achados: string[] = [];
  for (const { table_name, column_name } of colunas.rows) {
    const r = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from ${sql.identifier(table_name)}
       where ${sql.identifier(column_name)}::text like ${`%${TELEFONE}%`}`);
    if ((r.rows[0]?.n ?? 0) > 0) achados.push(`${table_name}.${column_name}`);
  }
  return achados;
}

describe("anonimização LGPD (aceite do M2)", () => {
  it("fecha a transação e o telefone do titular some de TODAS as tabelas", async () => {
    await emRollback(async (tx) => {
      const c = await cenario(tx);
      const t = await titularCompleto(tx, c);
      expect((await ondeOTelefoneAparece(tx)).length).toBeGreaterThan(5);

      const saida = await anonimizarContato(tx, contexto(c), {
        contatoId: t.contatoId,
        updatedAt: t.updatedAt,
        protocolo: "LGPD-2026-001",
        motivo: "Pedido da titular por e-mail",
      });

      expect(await ondeOTelefoneAparece(tx)).toEqual([]);

      const contato = await umaLinha<{ nome: string; telefone: string | null; anonimizado_em: Date | null }>(
        tx,
        sql`select nome, telefone, anonimizado_em from contatos where id = ${t.contatoId}`,
      );
      expect(contato).toMatchObject({ nome: NOME_ANONIMO, telefone: null });
      expect(contato.anonimizado_em).not.toBeNull();

      // Marcador, nunca NULL — inclusive na mensagem de mídia (o CHECK aceita os dois).
      const conteudos = await tx.execute<{ conteudo: string | null }>(sql`
        select m.conteudo from conversas_mensagens m join conversas c on c.id = m.conversa_id
         where c.contato_id = ${t.contatoId}`);
      expect(conteudos.rows.map((l) => l.conteudo)).toEqual([MARCADOR, MARCADOR]);

      // Mídia recebida: excluída e na lista do job; o binário é do job.
      expect(saida.midiaIds).toEqual([t.midiaId]);
      const midia = await umaLinha<{ is_deleted: boolean; deleted_at: Date | null }>(
        tx,
        sql`select is_deleted, deleted_at from lojas_midias where id = ${t.midiaId}`,
      );
      expect(midia.is_deleted).toBe(true);
      expect(midia.deleted_at).not.toBeNull();

      // O pedido PERMANECE (registro fiscal), apontando para o contato anonimizado.
      const pedido = await umaLinha<{ total: string; numero: string; contato_id: string }>(
        tx,
        sql`select total, numero, contato_id from pedidos where id = ${t.pedidoId}`,
      );
      expect(pedido).toEqual({ total: "100.00", numero: "CEN-0001", contato_id: t.contatoId });

      // Solicitação com a contagem por tabela.
      const solicitacao = await umaLinha<{ tipo: string; resultado: { tabelas: Record<string, number>; objetos_removidos: number } }>(
        tx,
        sql`select tipo, resultado from lgpd_solicitacoes where id = ${saida.solicitacaoId}`,
      );
      expect(solicitacao.tipo).toBe("eliminacao");
      expect(solicitacao.resultado.tabelas).toMatchObject({
        contatos: 1,
        conversas_mensagens: 2,
        conversas: 1,
        conversas_mensagens_midias: 1,
        pesquisas_satisfacao: 1,
        lojas_midias: 1,
      });
      expect(solicitacao.resultado.objetos_removidos).toBe(0);

      // Trilha ANTES do efeito, sem PII.
      const trilha = await tx.execute<{ acao: string; depois: unknown }>(sql`
        select acao, depois from auditoria_eventos
         where entidade = 'contatos' and entidade_id = ${t.contatoId}
         order by criado_em, acao`);
      const anonimizado = trilha.rows.find((l) => l.acao === "lgpd_anonimizado");
      expect(anonimizado?.depois).toEqual({ protocolo: "LGPD-2026-001" });
    });
  });

  it("contato de outra loja responde como inexistente (404)", async () => {
    await emRollback(async (tx) => {
      const c = await cenario(tx);
      const t = await novoContato(tx, c.lojaId, { telefone: TELEFONE });
      await expect(
        tx.transaction((sp) =>
          anonimizarContato(sp, contexto(c, c.outraLojaId), {
            contatoId: t.id,
            updatedAt: t.updatedAt,
            protocolo: "LGPD-X-1",
            motivo: "Tentativa pela loja errada",
          }),
        ),
      ).rejects.toBeInstanceOf(ErroDeEscopo);
    });
  });

  it("versão velha da ficha recusa com COLISAO e nada muda", async () => {
    await emRollback(async (tx) => {
      const c = await cenario(tx);
      const t = await novoContato(tx, c.lojaId, { telefone: TELEFONE });
      await expect(
        tx.transaction((sp) =>
          anonimizarContato(sp, contexto(c), {
            contatoId: t.id,
            updatedAt: new Date(t.updatedAt.getTime() - 1000),
            protocolo: "LGPD-X-2",
            motivo: "Ficha aberta há muito tempo",
          }),
        ),
      ).rejects.toBeInstanceOf(ErroDeColisao);
      const trilha = await umaLinha<{ n: number }>(tx, sql`
        select count(*)::int as n from auditoria_eventos where entidade_id = ${t.id}`);
      expect(trilha.n).toBe(0);
      expect(await ondeOTelefoneAparece(tx)).toEqual(["contatos.telefone"]);
    });
  });

  it("não anonimiza duas vezes e não reusa protocolo", async () => {
    await emRollback(async (tx) => {
      const c = await cenario(tx);
      const a = await novoContato(tx, c.lojaId, { nome: "A" });
      const b = await novoContato(tx, c.lojaId, { nome: "B" });
      const ctx = contexto(c);
      await anonimizarContato(tx, ctx, { contatoId: a.id, updatedAt: a.updatedAt, protocolo: "P-0001", motivo: "Primeiro pedido" });

      const atual = await umaLinha<{ updated_at: Date }>(tx, sql`select updated_at from contatos where id = ${a.id}`);
      await expect(
        tx.transaction((sp) =>
          anonimizarContato(sp, ctx, { contatoId: a.id, updatedAt: new Date(atual.updated_at), protocolo: "P-0002", motivo: "Pedido repetido" }),
        ),
      ).rejects.toBeInstanceOf(ErroDeValidacao);
      await expect(
        tx.transaction((sp) =>
          anonimizarContato(sp, ctx, { contatoId: b.id, updatedAt: b.updatedAt, protocolo: "P-0001", motivo: "Protocolo repetido" }),
        ),
      ).rejects.toBeInstanceOf(ErroDeValidacao);
    });
  });
});
