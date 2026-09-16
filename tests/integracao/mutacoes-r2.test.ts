import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ATOR_SISTEMA,
  contextoDeSistema,
  emTransacao,
  registrarComentarioDePesquisa,
  registrarRespostaDePesquisa,
  registrarUsoDeIa,
  transicionarPagamento,
  transicionarTranscricao,
} from "@/lib/db/mutacoes";
import { banco, criarConta, criarContatoDeCrm, criarLoja, fecharBanco } from "./conversas-apoio";

/**
 * Escritas do R2 na porta única (FR5), com efeito real: claim atômico de
 * pagamento e de transcrição, primeira resposta de pesquisa e o registro de
 * uso de IA que o banco não deixa reescrever.
 */

let lojaId: string;
let outraLojaId: string;
let contatoId: string;
let integracaoId: string;
beforeAll(async () => {
  lojaId = await criarLoja();
  outraLojaId = await criarLoja();
  integracaoId = (await criarConta(lojaId)).id;
  contatoId = await criarContatoDeCrm(lojaId, `55519${String(Date.now()).slice(-8)}`, "Ana");
});
afterAll(fecharBanco);

const um = async (texto: string, params: unknown[]) => (await banco.query(texto, params)).rows[0];
const ctxDa = (loja: string) => contextoDeSistema({ origem: "worker", lojaId: loja });

async function trilha(entidadeId: string) {
  const { rows } = await banco.query(
    "select acao, ator_tipo, ator_id, motivo, depois from auditoria_eventos where entidade_id = $1 order by criado_em",
    [entidadeId],
  );
  return rows;
}

describe("registrarRespostaDePesquisa e registrarComentarioDePesquisa", () => {
  async function pesquisa(): Promise<string> {
    const r = await um(
      `insert into pesquisas_satisfacao (loja_id, contato_id, gatilho, enviada_em)
       values ($1, $2, 'pedido_entregue', now()) returning id`,
      [lojaId, contatoId],
    );
    return r.id;
  }

  it("só a primeira nota vale; comentário grava uma vez, depois da nota, com diff mascarado", async () => {
    const id = await pesquisa();
    const ctx = ctxDa(lojaId);
    expect(await emTransacao(ctx, (tx, c) => registrarComentarioDePesquisa(tx, id, "antes da nota", c))).toBe(false);
    const agora = new Date();
    expect(await emTransacao(ctx, (tx, c) => registrarRespostaDePesquisa(tx, id, { nota: 5, respondidaEm: agora }, c))).toBe(true);
    expect(await emTransacao(ctx, (tx, c) => registrarRespostaDePesquisa(tx, id, { nota: 1, respondidaEm: agora }, c))).toBe(false);
    expect(await emTransacao(ctx, (tx, c) => registrarComentarioDePesquisa(tx, id, "amei a Ana", c))).toBe(true);
    expect(await emTransacao(ctx, (tx, c) => registrarComentarioDePesquisa(tx, id, "de novo", c))).toBe(false);

    const linha = await um("select nota, comentario, modified_by from pesquisas_satisfacao where id = $1", [id]);
    expect(linha).toEqual({ nota: 5, comentario: "amei a Ana", modified_by: ATOR_SISTEMA });
    const eventos = await trilha(id);
    expect(eventos.map((e) => e.acao)).toEqual(["pesquisa_respondida", "pesquisa_respondida"]);
    expect(eventos[0]).toMatchObject({ ator_tipo: "sistema", ator_id: ATOR_SISTEMA, motivo: null });
    expect(JSON.stringify(eventos[1].depois)).not.toContain("amei");
  });

  it("nota nula é pedido para sair e vai para o motivo da trilha", async () => {
    const id = await pesquisa();
    await emTransacao(ctxDa(lojaId), (tx, c) =>
      registrarRespostaDePesquisa(tx, id, { nota: null, respondidaEm: new Date() }, c),
    );
    expect((await trilha(id))[0]).toMatchObject({ acao: "pesquisa_respondida", motivo: "pediu para sair" });
  });

  it("outra loja não alcança a pesquisa", async () => {
    const id = await pesquisa();
    const r = await emTransacao(ctxDa(outraLojaId), (tx, c) =>
      registrarRespostaDePesquisa(tx, id, { nota: 4, respondidaEm: new Date() }, c),
    );
    expect(r).toBe(false);
    expect((await um("select nota from pesquisas_satisfacao where id = $1", [id])).nota).toBeNull();
  });
});

describe("transicionarPagamento", () => {
  async function pagamento(): Promise<string> {
    const pedido = await um(
      `insert into pedidos (loja_id, contato_id, numero, criado_por) values ($1, $2, $3, $4) returning id`,
      [lojaId, contatoId, `R2-${randomUUID().slice(0, 8)}`, ATOR_SISTEMA],
    );
    const r = await um(
      `insert into pagamentos (loja_id, pedido_id, provedor, metodo, valor)
       values ($1, $2, 'pagamento_simulado', 'pix', 100) returning id`,
      [lojaId, pedido.id],
    );
    return r.id;
  }

  it("é claim: só sai do estado de origem, uma vez, com trilha e motivo", async () => {
    const id = await pagamento();
    const pagoEm = new Date();
    const confirmar = () =>
      emTransacao(ctxDa(lojaId), (tx, c) =>
        transicionarPagamento(
          tx,
          { id, lojaId, de: ["pendente"], para: "aprovado", pagoEm },
          c,
          "pagamento_confirmado",
          "webhook conferido",
        ),
      );
    const [a, b] = await Promise.all([confirmar(), confirmar()]);
    expect([a, b].sort()).toEqual([false, true]);
    const linha = await um("select status, pago_em, modified_by from pagamentos where id = $1", [id]);
    expect(linha).toMatchObject({ status: "aprovado", modified_by: ATOR_SISTEMA });
    expect(linha.pago_em).toBeInstanceOf(Date);
    const eventos = await trilha(id);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ acao: "pagamento_confirmado", motivo: "webhook conferido" });
  });

  it("outra loja não transiciona", async () => {
    const id = await pagamento();
    const r = await emTransacao(ctxDa(outraLojaId), (tx, c) =>
      transicionarPagamento(tx, { id, lojaId: outraLojaId, de: ["pendente"], para: "cancelado" }, c, "pagamento_cancelado"),
    );
    expect(r).toBe(false);
    expect((await um("select status from pagamentos where id = $1", [id])).status).toBe("pendente");
  });
});

describe("transicionarTranscricao", () => {
  async function audio(tipo = "audio"): Promise<string> {
    const conversa = await um(
      "insert into conversas (loja_id, integracao_id, contato_id) values ($1, $2, $3) returning id",
      [lojaId, integracaoId, contatoId],
    );
    await banco.query("update conversas set status = 'resolvida' where id = $1", [conversa.id]);
    const msg = await um(
      `insert into conversas_mensagens (loja_id, conversa_id, direcao, autor_tipo, conteudo, ocorrida_em)
       values ($1, $2, 'entrada', 'contato', '[áudio]', now()) returning id`,
      [lojaId, conversa.id],
    );
    const r = await um(
      `insert into conversas_mensagens_midias (loja_id, mensagem_id, url_externa, tipo_arquivo, mime_type)
       values ($1, $2, 'https://midia.exemplo.test/a.ogg', $3, 'audio/ogg') returning id`,
      [lojaId, msg.id, tipo],
    );
    return r.id;
  }

  it("anda só a partir do estado de origem e grava o texto no fim", async () => {
    const id = await audio();
    const alvo = { id, escopo: { tipo: "uma" as const, lojaId } };
    const passo = (de: (null | "pendente" | "processando")[], para: "pendente" | "processando" | "concluida", texto?: string) =>
      emTransacao(ctxDa(lojaId), (tx) => transicionarTranscricao(tx, alvo, de, para, texto));

    expect(await passo(["processando"], "concluida", "x")).toBe(false);
    expect(await passo([null], "pendente")).toBe(true);
    const [a, b] = await Promise.all([passo(["pendente"], "processando"), passo(["pendente"], "processando")]);
    expect([a, b].sort()).toEqual([false, true]);
    expect(await passo(["processando"], "concluida", "oi, tudo bem?")).toBe(true);
    const linha = await um("select transcricao_status, transcricao from conversas_mensagens_midias where id = $1", [id]);
    expect(linha).toEqual({ transcricao_status: "concluida", transcricao: "oi, tudo bem?" });
  });

  it("não toca mídia que não é áudio nem mídia de outra loja", async () => {
    const imagem = await audio("imagem");
    const deOutra = await audio();
    const r1 = await emTransacao(ctxDa(lojaId), (tx) =>
      transicionarTranscricao(tx, { id: imagem, escopo: { tipo: "uma", lojaId } }, [null], "pendente"),
    );
    const r2 = await emTransacao(ctxDa(outraLojaId), (tx) =>
      transicionarTranscricao(tx, { id: deOutra, escopo: { tipo: "uma", lojaId: outraLojaId } }, [null], "pendente"),
    );
    expect([r1, r2]).toEqual([false, false]);
  });
});

describe("registrarUsoDeIa", () => {
  it("grava a linha com os padrões e o banco recusa reescrever o custo", async () => {
    const marca = `T${randomUUID().slice(0, 6)}`;
    await emTransacao(ctxDa(lojaId), (tx) =>
      registrarUsoDeIa(tx, {
        lojaId,
        usuarioId: null,
        funcao: "classificacao",
        provedor: "simulado",
        modelo: "claude-haiku-4-5-20251001",
        tokensEntrada: 120,
        custoUsdMicros: 240,
        resultado: "falha",
        erroCodigo: marca,
      }),
    );
    const linha = await um(
      `select id, usuario_id, tokens_entrada, tokens_saida, audio_segundos, custo_usd_micros, resultado
         from lojas_ia_usos where erro_codigo = $1`,
      [marca],
    );
    expect(linha).toMatchObject({
      usuario_id: null,
      tokens_entrada: 120,
      tokens_saida: 0,
      audio_segundos: 0,
      custo_usd_micros: 240,
      resultado: "falha",
    });
    await expect(
      banco.query("update lojas_ia_usos set custo_usd_micros = 0 where id = $1", [linha.id]),
    ).rejects.toMatchObject({ code: expect.stringMatching(/^(42501|P0001)$/) });
  });

  it("modelo fora da lista fechada o banco recusa", async () => {
    await expect(
      emTransacao(ctxDa(lojaId), (tx) =>
        registrarUsoDeIa(tx, {
          lojaId,
          usuarioId: null,
          funcao: "sugestao",
          provedor: "anthropic",
          modelo: "claude-opus-antigo" as never,
          resultado: "sucesso",
        }),
      ),
    ).rejects.toBeTruthy();
  });
});
