import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import {
  abrirAlerta,
  anonimizarTitular,
  ATOR_SISTEMA,
  atualizarEstado,
  contextoDeSistema,
  emTransacao,
  inserirDestinatariosEmLote,
  registrarEventoDeIngestao,
  registrarProcessamentoEvento,
  type EventoDeIngestao,
} from "@/lib/db/mutacoes";
import { alertas } from "@/lib/db/schema/alertas";
import { lojas_integracoes_eventos } from "@/lib/db/schema/integracoes";
import { banco, criarConta, criarContatoDeCrm, criarLoja, fecharBanco } from "./conversas-apoio";

/**
 * Helpers de sistema de `mutacoes/sistema.ts`, com efeito real: conflito do
 * índice parcial, uma linha de trilha por lote e o alcance da anonimização.
 */

let lojaId: string;
let integracaoId: string;
beforeAll(async () => {
  lojaId = await criarLoja();
  integracaoId = (await criarConta(lojaId)).id;
});
afterAll(fecharBanco);

const um = async (texto: string, params: unknown[]) => (await banco.query(texto, params)).rows[0];

describe("registrarEventoDeIngestao + registrarProcessamentoEvento", () => {
  const evento = (externo: string): EventoDeIngestao => ({
    provedor: "whatsapp_oficial",
    integracaoId,
    lojaId,
    tipo: "recebido",
    eventoExternoId: externo,
    assinaturaOk: true,
    ip: "203.0.113.9",
    corpo: { telefone: "5551999990000", texto: "oi" },
    cabecalhos: { "content-type": "application/json" },
  });

  it("a reentrega do mesmo id não duplica e continua pendente", async () => {
    const externo = `wamid.${randomUUID()}`;
    const a = await registrarEventoDeIngestao(evento(externo));
    const b = await registrarEventoDeIngestao(evento(externo));
    expect(a).toMatchObject({ novo: true, pendente: true });
    expect(b).toEqual({ id: a.id, novo: false, pendente: true });
    const linha = await um(
      "select count(*)::int n, max(modified_by::text) autor from lojas_integracoes_eventos where evento_externo_id = $1",
      [externo],
    );
    expect(linha).toEqual({ n: 1, autor: ATOR_SISTEMA });
  });

  it("sem id externo a linha sempre nasce: nulo não consome a chave de dedupe", async () => {
    const a = await registrarEventoDeIngestao({ ...evento("x"), eventoExternoId: null });
    const b = await registrarEventoDeIngestao({ ...evento("x"), eventoExternoId: null });
    expect(a).toMatchObject({ novo: true, pendente: true });
    expect(b).toMatchObject({ novo: true, pendente: true });
    expect(b.id).not.toBe(a.id);
  });

  it("processar mascara o corpo no mesmo UPDATE; a reentrega deixa de estar pendente", async () => {
    const externo = `wamid.${randomUUID()}`;
    const { id } = await registrarEventoDeIngestao(evento(externo));
    await db.transaction((tx) =>
      registrarProcessamentoEvento(tx, id, { tipo: "processado", projecao: { mascarado: true, tipo: "texto" } }),
    );
    const linha = await um("select tipo, corpo, processado_em from lojas_integracoes_eventos where id = $1", [id]);
    expect(linha.tipo).toBe("processado");
    expect(linha.corpo).toEqual({ mascarado: true, tipo: "texto" });
    expect(linha.processado_em).toBeInstanceOf(Date);
    expect((await registrarEventoDeIngestao(evento(externo))).pendente).toBe(false);
  });

  it("falhou guarda o corpo cru como prova; a retenção zera o ip", async () => {
    const { id } = await registrarEventoDeIngestao(evento(`wamid.${randomUUID()}`));
    await db.transaction(async (tx) => {
      await registrarProcessamentoEvento(tx, id, { tipo: "falhou", erro: "timeout" });
      await atualizarEstado(tx, lojas_integracoes_eventos, { id, escopo: { tipo: "todas" } }, { ip: null });
    });
    const linha = await um("select corpo, erro, ip from lojas_integracoes_eventos where id = $1", [id]);
    expect(linha).toEqual({ corpo: { telefone: "5551999990000", texto: "oi" }, erro: "timeout", ip: null });
  });
});

describe("abrirAlerta", () => {
  it("deduplica enquanto aberto e reabre depois que o gerador resolve", async () => {
    const novo = {
      lojaId,
      tipo: "espelho_divergente" as const,
      severidade: "alta" as const,
      mensagem: "Opt-out divergente",
      chave: `espelho:${randomUUID()}`,
    };
    const primeiro = await db.transaction((tx) => abrirAlerta(tx, novo));
    const repetido = await db.transaction((tx) => abrirAlerta(tx, novo));
    expect(primeiro).toEqual(expect.any(String));
    expect(repetido).toBeNull();

    await db.transaction((tx) =>
      atualizarEstado(tx, alertas, { id: primeiro!, escopo: { tipo: "uma", lojaId } }, { resolvido_em: new Date() }),
    );
    const reaberto = await db.transaction((tx) => abrirAlerta(tx, novo));
    expect(reaberto).toEqual(expect.any(String));
    expect(reaberto).not.toBe(primeiro);
    const linha = await um("select modified_by from alertas where id = $1", [reaberto]);
    expect(linha.modified_by).toBe(ATOR_SISTEMA);
  });
});

async function criarCampanha(): Promise<string> {
  const r = await um(
    `insert into campanhas (loja_id, criada_por, integracao_id, nome, conteudo_texto)
     values ($1, $2, $3, 'Teste', 'Oi') returning id`,
    [lojaId, ATOR_SISTEMA, integracaoId],
  );
  return r.id;
}

describe("inserirDestinatariosEmLote", () => {
  it("ignora repetidos e já existentes, e grava UMA linha de trilha", async () => {
    const campanhaId = await criarCampanha();
    const a = await criarContatoDeCrm(lojaId, "5551922220001");
    const b = await criarContatoDeCrm(lojaId, "5551922220002");
    const ctx = contextoDeSistema({ origem: "worker", lojaId });
    const lote = (ids: string[]) =>
      emTransacao(ctx, (tx, c) =>
        inserirDestinatariosEmLote(tx, c, { lojaId, campanhaId, contatoIds: ids }, "campanha_iniciada"),
      );
    expect(await lote([a, a, b])).toBe(2);
    expect(await lote([a, b])).toBe(0);
    const n = await um("select count(*)::int n from campanhas_destinatarios where campanha_id = $1", [campanhaId]);
    expect(n.n).toBe(2);
    const { rows } = await banco.query(
      "select acao, depois from auditoria_eventos where entidade = 'campanhas' and entidade_id = $1 order by criado_em",
      [campanhaId],
    );
    expect(rows).toEqual([
      { acao: "campanha_iniciada", depois: { destinatarios_pedidos: 2, destinatarios_inseridos: 2 } },
      { acao: "campanha_iniciada", depois: { destinatarios_pedidos: 2, destinatarios_inseridos: 0 } },
    ]);
  });
});

describe("anonimizarTitular", () => {
  const TELEFONE = "5551933330001";
  const MARCADOR = "[removido a pedido do titular]";

  async function montarTitular() {
    const contatoId = await criarContatoDeCrm(lojaId, TELEFONE, "Maria");
    const conversa = await um(
      `insert into conversas (loja_id, integracao_id, contato_id, ultima_mensagem_previa)
       values ($1, $2, $3, $4) returning id`,
      [lojaId, integracaoId, contatoId, `me liga no ${TELEFONE}`],
    );
    const msg = await um(
      `insert into conversas_mensagens (loja_id, conversa_id, direcao, autor_tipo, conteudo, ocorrida_em, metadados)
       values ($1, $2, 'entrada', 'contato', $3, now(), '{"encaminhada":true}') returning id`,
      [lojaId, conversa.id, `me liga no ${TELEFONE}`],
    );
    const midia = await um(
      `insert into lojas_midias (loja_id, chave_objeto, tipo_arquivo, mime_type, tamanho_bytes, origem, nome_original)
       values ($1, $2, 'imagem', 'image/jpeg', 10, 'recebida', $3) returning id`,
      [lojaId, `loja/${randomUUID()}`, `rg-${TELEFONE}.jpg`],
    );
    await banco.query(
      `insert into conversas_mensagens_midias (loja_id, mensagem_id, midia_id, tipo_arquivo, mime_type, legenda, transcricao)
       values ($1, $2, $3, 'imagem', 'image/jpeg', $4, $4)`,
      [lojaId, msg.id, midia.id, TELEFONE],
    );
    await banco.query(
      `insert into conversas_agendamentos (loja_id, contato_id, integracao_id, tipo_conteudo, conteudo, agendada_para, gatilho)
       values ($1, $2, $3, 'texto', $4, now() + interval '1 day', 'promocao')`,
      [lojaId, contatoId, integracaoId, `Oi Maria ${TELEFONE}`],
    );
    await banco.query(
      `insert into pesquisas_satisfacao (loja_id, contato_id, gatilho, comentario)
       values ($1, $2, 'conversa_encerrada', $3)`,
      [lojaId, contatoId, TELEFONE],
    );
    await banco.query(
      `insert into pedidos
         (loja_id, contato_id, numero, criado_por, observacoes, endereco_entrega, masc_observacao, cancelado_motivo)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        lojaId,
        contatoId,
        `T-${randomUUID().slice(0, 8)}`,
        ATOR_SISTEMA,
        TELEFONE,
        JSON.stringify({ rua: TELEFONE }),
        `lançado para ${TELEFONE}`,
        `cliente ${TELEFONE} desistiu`,
      ],
    );
    return { contatoId, midiaId: midia.id as string };
  }

  it("limpa os depósitos em lote, cancela o pendente e devolve as mídias para o job", async () => {
    const { contatoId, midiaId } = await montarTitular();
    const ctx = contextoDeSistema({ origem: "worker", lojaId });
    const r = await emTransacao(ctx, (tx, c) =>
      anonimizarTitular(tx, c, { lojaId, contatoId, marcador: MARCADOR }),
    );
    expect(r.midiaIds).toEqual([midiaId]);
    expect(r.tabelas).toEqual({
      conversas_mensagens: 1,
      conversas: 1,
      conversas_mensagens_midias: 1,
      pesquisas_satisfacao: 1,
      conversas_agendamentos: 1,
      pedidos: 1,
      lojas_midias: 1,
    });
    const agendamento = await um(
      "select status, conteudo, cancelada_por from conversas_agendamentos where contato_id = $1",
      [contatoId],
    );
    expect(agendamento).toEqual({ status: "cancelada", conteudo: MARCADOR, cancelada_por: ATOR_SISTEMA });
    const midia = await um("select is_deleted, deleted_at, nome_original from lojas_midias where id = $1", [midiaId]);
    expect(midia).toMatchObject({ is_deleted: true, nome_original: null });
    const pedido = await um(
      "select observacoes, endereco_entrega, masc_observacao, cancelado_motivo from pedidos where contato_id = $1",
      [contatoId],
    );
    expect(pedido).toEqual({
      observacoes: null,
      endereco_entrega: null,
      masc_observacao: MARCADOR,
      cancelado_motivo: MARCADOR,
    });

    // O telefone só sobrevive em `contatos`, que é da regra de negócio (trava de colisão).
    const achados = await um(
      `select
         (select count(*)::int from conversas_mensagens where conteudo like $1)
       + (select count(*)::int from conversas where ultima_mensagem_previa like $1)
       + (select count(*)::int from conversas_mensagens_midias where legenda like $1 or transcricao like $1)
       + (select count(*)::int from conversas_agendamentos where conteudo like $1)
       + (select count(*)::int from pesquisas_satisfacao where comentario like $1)
       + (select count(*)::int from pedidos
           where observacoes like $1 or endereco_entrega::text like $1
              or masc_observacao like $1 or cancelado_motivo like $1)
       + (select count(*)::int from lojas_midias where nome_original like $1) as n`,
      [`%${TELEFONE}%`],
    );
    expect(achados.n).toBe(0);
  });

  it("não alcança outro titular da mesma loja", async () => {
    const vizinho = await criarContatoDeCrm(lojaId, "5551933330002", "Vizinha");
    await banco.query(
      `insert into pesquisas_satisfacao (loja_id, contato_id, gatilho, comentario)
       values ($1, $2, 'conversa_encerrada', 'fica')`,
      [lojaId, vizinho],
    );
    const alvo = await criarContatoDeCrm(lojaId, "5551933330003", "Alvo");
    const ctx = contextoDeSistema({ origem: "worker", lojaId });
    await emTransacao(ctx, (tx, c) => anonimizarTitular(tx, c, { lojaId, contatoId: alvo, marcador: MARCADOR }));
    const p = await um("select comentario from pesquisas_satisfacao where contato_id = $1", [vizinho]);
    expect(p.comentario).toBe("fica");
  });
});
