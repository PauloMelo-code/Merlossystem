import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextoDeGravacao } from "@/lib/db/mutacoes";

/**
 * Disparo de campanha e mensagem agendada contra Postgres REAL (pacote M6).
 *
 * A costura de saída (`registrarEnvio`, do M1) é trocada por um dublê que grava
 * a mensagem de verdade — com o único `(conversa_id, chave_idempotencia)` do
 * banco — e conta as chamadas. Fila e tempo real também são dublês: o que se
 * prova aqui é a regra de reserva, lease, pausa e opt-out, não o Redis.
 *
 * Nada é apagado: cada teste nasce numa loja nova. O banco inteiro é recriado
 * por `node scripts/db-teste.mjs --sufixo m6`.
 */

const envios: { contatoId: string; chave: string; conteudo: string }[] = [];
const filas: { fila: string; dados: Record<string, unknown>; opcoes: Record<string, unknown> }[] = [];

vi.mock("@/lib/conversas/saida", () => ({
  registrarEnvio: vi.fn(async (tx: { execute: (q: unknown) => Promise<{ rows: { id: string }[] }> }, e: {
    lojaId: string;
    contatoId: string;
    conteudo: string;
    chaveIdempotencia: string;
  }) => {
    const r = await tx.execute(sql`
      insert into conversas_mensagens
        (loja_id, conversa_id, direcao, autor_tipo, conteudo, status_entrega, chave_idempotencia, ocorrida_em)
      select ${e.lojaId}, c.id, 'saida', 'campanha', ${e.conteudo}, 'pendente', ${e.chaveIdempotencia}, now()
        from conversas c where c.contato_id = ${e.contatoId} limit 1
      returning id`);
    envios.push({ contatoId: e.contatoId, chave: e.chaveIdempotencia, conteudo: e.conteudo });
    return { mensagemId: r.rows[0]!.id, conversaId: "" };
  }),
}));
vi.mock("@/lib/fila/filas", () => ({
  enfileirar: vi.fn(async (fila: string, _job: string, dados: Record<string, unknown>, opcoes = {}) => {
    filas.push({ fila, dados, opcoes });
    return "job";
  }),
}));
vi.mock("@/lib/tempo-real/publicar", () => ({ publicarNaLoja: vi.fn() }));

const { ATOR_SISTEMA, emTransacao } = await import("@/lib/db/mutacoes");
const { pool: poolDoApp } = await import("@/lib/db/client");
const disparo = await import("@/lib/campanhas/disparo");
const { processarLoteDeCampanha } = await import("@/lib/campanhas/lote");
const { criarAgendamento, reagendar } = await import("@/lib/agendamentos/gravacao");
const { enviarAgendamento } = await import("@/lib/agendamentos/envio");
const { conferirEnviavel } = await import("@/lib/conteudo/gravacao");
const { ErroDeValidacao } = await import("@/lib/erros");

const banco = new Pool({ connectionString: process.env.DATABASE_URL_TESTE, max: 3 });

type Loja = { lojaId: string; usuarioId: string; uazapi: string; oficial: string; contatos: string[] };

async function q<T extends Record<string, unknown>>(texto: string, valores: unknown[] = []) {
  return (await banco.query<T>(texto, valores)).rows;
}

/** Loja nova com gerente, duas contas e `n` contatos com conversa aberta. */
async function novaLoja(n: number): Promise<Loja> {
  const lojaId = randomUUID();
  for (let tentativa = 0; ; tentativa++) {
    const sigla = Array.from({ length: 3 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join("");
    try {
      await q(`insert into lojas (id, nome, slug, sigla) values ($1, 'Loja teste', $2, $3)`, [lojaId, `l-${lojaId}`, sigla]);
      break;
    } catch (erro) {
      if (tentativa > 5) throw erro; // sigla sorteada repetida: sorteia de novo
    }
  }
  const usuarioId = randomUUID();
  // `campanhas:criar|disparar` é de gerente para cima; gerente não tem loja no cadastro.
  await q(`insert into usuarios (id, nome, email, papel, loja_id, ativo) values ($1, 'Pessoa', $2, 'gerente', null, true)`, [
    usuarioId,
    `g-${usuarioId}@teste.invalido`,
  ]);
  const [uazapi] = await q<{ id: string }>(
    `insert into lojas_integracoes (loja_id, provedor, rotulo, status) values ($1, 'uazapi', 'Vendas', 'conectado') returning id`,
    [lojaId],
  );
  const [oficial] = await q<{ id: string }>(
    `insert into lojas_integracoes (loja_id, provedor, rotulo, status) values ($1, 'whatsapp_oficial', 'Oficial', 'conectado') returning id`,
    [lojaId],
  );
  const contatos = await q<{ id: string }>(
    `insert into contatos (loja_id, nome, telefone, created_at)
     select $1, 'Cliente ' || g, (5551900000000 + g)::text, now() + (g || ' ms')::interval
       from generate_series(1, $2::int) g returning id`,
    [lojaId, n],
  );
  await q(
    `insert into conversas (loja_id, contato_id, integracao_id)
     select $1, c.id, $2 from contatos c where c.loja_id = $1`,
    [lojaId, uazapi!.id],
  );
  return { lojaId, usuarioId, uazapi: uazapi!.id, oficial: oficial!.id, contatos: contatos.map((c) => c.id) };
}

function ctxDe(l: Loja): ContextoDeGravacao {
  return { escopo: { tipo: "uma", lojaId: l.lojaId }, autorId: l.usuarioId, origem: "ui" };
}

async function trilha(entidadeId: string) {
  return q<{ acao: string; entidade: string; ator_tipo: string; ator_id: string | null; depois: unknown }>(
    `select acao, entidade, ator_tipo, ator_id, depois from auditoria_eventos where entidade_id = $1 order by criado_em, id`,
    [entidadeId],
  );
}

async function atualizadoEm(tabela: string, id: string): Promise<Date> {
  const [linha] = await q<{ updated_at: Date }>(`select updated_at from ${tabela} where id = $1`, [id]);
  return linha!.updated_at;
}

async function campanhaDeTexto(l: Loja): Promise<string> {
  const { id } = await emTransacao(ctxDe(l), (tx, ctx) =>
    disparo.criarCampanha(tx, ctx, {
      nome: "Inverno",
      integracao_id: l.uazapi,
      template_id: null,
      conteudo_texto: "Chegou a coleção nova",
      variaveis: [],
      segmento: {},
    }),
  );
  return id;
}

async function iniciar(l: Loja, id: string) {
  const alvo = { id, updated_at: await atualizadoEm("campanhas", id) };
  return emTransacao(ctxDe(l), (tx, ctx) => disparo.iniciarCampanha(tx, ctx, alvo));
}

/** Um "worker": processa lotes até a cadeia parar ou concluir. */
async function worker(l: Loja, campanhaId: string, tamanho: number): Promise<void> {
  for (let i = 0; i < 10_000; i++) {
    const r = await processarLoteDeCampanha({ lojaId: l.lojaId, campanhaId, tamanho });
    if (r.desfecho !== "continua") return;
  }
  throw new Error("cadeia não terminou");
}

beforeAll(() => {
  if (!process.env.DATABASE_URL_TESTE) throw new Error("DATABASE_URL_TESTE não está definida.");
});

beforeEach(() => {
  envios.length = 0;
  filas.length = 0;
});

afterAll(async () => {
  await banco.end();
  await poolDoApp.end();
});

describe("disparo em lote", () => {
  it("500 destinatários com 2 workers: ninguém recebe duas vezes e a campanha conclui", async () => {
    const l = await novaLoja(500);
    const id = await campanhaDeTexto(l);
    const d = await iniciar(l, id);
    expect(d.provedor).toBe("uazapi");

    await Promise.all([worker(l, id, 20), worker(l, id, 20)]);

    expect(envios).toHaveLength(500);
    expect(new Set(envios.map((e) => e.contatoId)).size).toBe(500);
    const [c] = await q<{ status: string; total_destinatarios: number }>(
      `select status, total_destinatarios from campanhas where id = $1`,
      [id],
    );
    expect(c).toEqual({ status: "concluida", total_destinatarios: 500 });
    const porStatus = await q<{ status: string; n: string }>(
      `select status, count(*) n from campanhas_destinatarios where campanha_id = $1 group by status`,
      [id],
    );
    expect(porStatus).toEqual([{ status: "enviado", n: "500" }]);
    // a mensagem entrou na conversa da cliente e o destinatário aponta para ela
    const [sem] = await q<{ n: string }>(
      `select count(*) n from campanhas_destinatarios where campanha_id = $1 and mensagem_id is null`,
      [id],
    );
    expect(sem!.n).toBe("0");
    // uma linha de trilha pelo lote, não uma por destinatário; a conclusão é do sistema
    // (iniciar e o lote dividem a transação, logo o mesmo `criado_em`: a ordem entre eles não conta)
    const linhas = await trilha(id);
    expect(linhas.map((t) => t.acao).sort()).toEqual([
      "campanha_concluida",
      "campanha_criada",
      "campanha_iniciada",
      "campanha_iniciada",
    ]);
    expect(linhas.map((t) => t.depois)).toContainEqual({ destinatarios_pedidos: 500, destinatarios_inseridos: 500 });
    expect(linhas.at(-1)).toMatchObject({ acao: "campanha_concluida", ator_tipo: "sistema", ator_id: ATOR_SISTEMA });
    const [porDestinatario] = await q<{ n: string }>(
      `select count(*) n from auditoria_eventos where entidade = 'campanhas_destinatarios'
          and entidade_id in (select id::text from campanhas_destinatarios where campanha_id = $1)`,
      [id],
    );
    expect(porDestinatario!.n).toBe("0");
  });

  it("iniciar duas vezes com o mesmo updated_at não materializa em dobro", async () => {
    const l = await novaLoja(5);
    const id = await campanhaDeTexto(l);
    const alvo = { id, updated_at: await atualizadoEm("campanhas", id) };
    const resultados = await Promise.allSettled([
      emTransacao(ctxDe(l), (tx, ctx) => disparo.iniciarCampanha(tx, ctx, alvo)),
      emTransacao(ctxDe(l), (tx, ctx) => disparo.iniciarCampanha(tx, ctx, alvo)),
    ]);
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const [n] = await q<{ n: string }>(`select count(*) n from campanhas_destinatarios where campanha_id = $1`, [id]);
    expect(n!.n).toBe("5");
  });

  it("pausar no meio e retomar não reenvia ninguém", async () => {
    const l = await novaLoja(30);
    const id = await campanhaDeTexto(l);
    await iniciar(l, id);

    await processarLoteDeCampanha({ lojaId: l.lojaId, campanhaId: id, tamanho: 10 });
    expect(envios).toHaveLength(10);

    const pausa = { id, updated_at: await atualizadoEm("campanhas", id) };
    await emTransacao(ctxDe(l), (tx, ctx) => disparo.pausarCampanha(tx, ctx, pausa));
    const parado = await processarLoteDeCampanha({ lojaId: l.lojaId, campanhaId: id, tamanho: 10 });
    expect(parado.desfecho).toBe("parada");
    expect(envios).toHaveLength(10);

    const retoma = { id, updated_at: await atualizadoEm("campanhas", id) };
    await emTransacao(ctxDe(l), (tx, ctx) => disparo.retomarCampanha(tx, ctx, retoma));
    await worker(l, id, 10);
    expect(envios).toHaveLength(30);
    expect(new Set(envios.map((e) => e.contatoId)).size).toBe(30);
  });

  it("reserva com lease vencido volta à fila e sai uma vez só", async () => {
    const l = await novaLoja(3);
    const id = await campanhaDeTexto(l);
    await iniciar(l, id);
    await q(
      `update campanhas_destinatarios set status = 'reservado', reservado_em = now() - interval '10 minutes'
        where campanha_id = $1`,
      [id],
    );
    await worker(l, id, 10);
    expect(envios).toHaveLength(3);
  });

  it("opt-out lê a verdade (consentimentos), não o espelho", async () => {
    const l = await novaLoja(4);
    const [a, b, c] = l.contatos;
    // a: saiu (verdade) com espelho desatualizado em false
    await q(`insert into consentimentos (loja_id, contato_id, tipo, concedido, origem, termo_versao)
             values ($1, $2, 'opt_out', true, 'tela', 'v1')`, [l.lojaId, a]);
    // b: saiu e voltou — a última linha manda
    await q(`insert into consentimentos (loja_id, contato_id, tipo, concedido, origem, termo_versao, criado_em)
             values ($1, $2, 'opt_out', true, 'tela', 'v1', now() - interval '1 day'),
                    ($1, $2, 'opt_in', true, 'tela', 'v1', now())`, [l.lojaId, b]);
    // c: espelho diz opt-out, mas não há linha de verdade
    await q(`update contatos set opt_out = true, opt_out_em = now() where id = $1`, [c]);

    const id = await campanhaDeTexto(l);
    await iniciar(l, id);
    const alvos = (await q<{ contato_id: string }>(
      `select contato_id from campanhas_destinatarios where campanha_id = $1`,
      [id],
    )).map((r) => r.contato_id);
    expect(alvos).not.toContain(a);
    expect(alvos).toContain(b);
    expect(alvos).toContain(c);
    expect(alvos).toHaveLength(3);
  });
});

describe("modelo e variáveis", () => {
  async function modelo(l: Loja, corpo: string, contagem: number, status = "aprovado") {
    const [m] = await q<{ id: string }>(
      `insert into lojas_integracoes_templates (loja_id, integracao_id, nome, categoria, corpo, variaveis_contagem, status)
       values ($1, $2, $3, 'marketing', $4, $5, $6) returning id`,
      [l.lojaId, l.oficial, `m_${randomUUID().slice(0, 8)}`, corpo, contagem, status],
    );
    return m!.id;
  }

  it("modelo com 2 variáveis e campanha com 1 é recusada", async () => {
    const l = await novaLoja(1);
    const templateId = await modelo(l, "Oi {{1}}, cupom {{2}}", 2);
    await expect(
      emTransacao(ctxDe(l), (tx, ctx) =>
        disparo.criarCampanha(tx, ctx, {
          nome: "Cupom",
          integracao_id: l.oficial,
          template_id: templateId,
          conteudo_texto: null,
          variaveis: [{ indice: 1, valor: "{nome_contato}" }],
          segmento: {},
        }),
      ),
    ).rejects.toBeInstanceOf(ErroDeValidacao);
  });

  it("número oficial renderiza o modelo por destinatária", async () => {
    const l = await novaLoja(1);
    await q(`update conversas set integracao_id = $1 where loja_id = $2`, [l.oficial, l.lojaId]);
    const templateId = await modelo(l, "Oi {{1}}, cupom {{2}}", 2);
    const { id } = await emTransacao(ctxDe(l), (tx, ctx) =>
      disparo.criarCampanha(tx, ctx, {
        nome: "Cupom",
        integracao_id: l.oficial,
        template_id: templateId,
        conteudo_texto: null,
        variaveis: [
          { indice: 1, valor: "{nome_contato}" },
          { indice: 2, valor: "FRIO10" },
        ],
        segmento: {},
      }),
    );
    const d = await iniciar(l, id);
    expect(d.provedor).toBe("whatsapp_oficial");
    await worker(l, id, 10);
    expect(envios.map((e) => e.conteudo)).toEqual(["Oi Cliente, cupom FRIO10"]);
  });

  it("modelo não aprovado não dispara", async () => {
    const l = await novaLoja(1);
    const templateId = await modelo(l, "Oi", 0, "enviado");
    await expect(
      emTransacao(ctxDe(l), (tx, ctx) =>
        disparo.criarCampanha(tx, ctx, {
          nome: "X",
          integracao_id: l.oficial,
          template_id: templateId,
          conteudo_texto: null,
          variaveis: [],
          segmento: {},
        }),
      ),
    ).rejects.toBeInstanceOf(ErroDeValidacao);
  });

  it("nome de 300 caracteres grava (CHECK da 0018) e só rascunho/rejeitado vai para a Meta", async () => {
    const l = await novaLoja(1);
    const [longo] = await q<{ id: string }>(
      `insert into lojas_integracoes_templates (loja_id, integracao_id, nome, categoria, corpo, variaveis_contagem)
       values ($1, $2, $3, 'marketing', 'Oi', 0) returning id`,
      [l.lojaId, l.oficial, "a".repeat(300)],
    );
    await emTransacao(ctxDe(l), (tx, ctx) => conferirEnviavel(tx, ctx, longo!.id));
    const enviado = await modelo(l, "Oi", 0, "enviado");
    await expect(emTransacao(ctxDe(l), (tx, ctx) => conferirEnviavel(tx, ctx, enviado))).rejects.toBeInstanceOf(
      ErroDeValidacao,
    );
  });
});

describe("ritmo por conta", () => {
  it("uazapi: lote de 1 e próximo lote 1 s depois", async () => {
    const l = await novaLoja(3);
    const id = await campanhaDeTexto(l);
    const d = await iniciar(l, id);
    await disparo.agendarLote(d);
    expect(filas[0]!.dados).toMatchObject({ campanhaId: id, tamanho: 1 });

    const r = await processarLoteDeCampanha(filas[0]!.dados as never);
    expect(r.enviados).toBe(1);
    expect(filas[1]!.opcoes).toMatchObject({ delay: 1000 });
    expect(filas[1]!.dados).toMatchObject({ tamanho: 1, sequencia: 1 });
  });

  it("oficial: lote de 10", async () => {
    const d = { lojaId: randomUUID(), campanhaId: randomUUID(), provedor: "whatsapp_oficial" as const };
    await disparo.agendarLote(d);
    expect(filas[0]!.dados).toMatchObject({ tamanho: 10 });
  });
});

describe("mensagem agendada", () => {
  async function agendar(l: Loja, gatilho: "promocao" | "manual") {
    return emTransacao(ctxDe(l), (tx, ctx) =>
      criarAgendamento(tx, ctx, {
        contato_id: l.contatos[0]!,
        integracao_id: l.uazapi,
        tipo_conteudo: "texto",
        conteudo: "Oi!",
        template_id: null,
        variaveis: [],
        agendada_para: new Date(Date.now() + 3_600_000),
        gatilho,
      }),
    );
  }

  it("promocional respeita opt-out; manual sai mesmo assim", async () => {
    const l = await novaLoja(1);
    await q(`insert into consentimentos (loja_id, contato_id, tipo, concedido, origem, termo_versao)
             values ($1, $2, 'opt_out', true, 'tela', 'v1')`, [l.lojaId, l.contatos[0]]);
    const promo = await agendar(l, "promocao");
    const manual = await agendar(l, "manual");

    expect(await enviarAgendamento({ lojaId: l.lojaId, agendamentoId: promo.id })).toBe("cancelada");
    expect(await enviarAgendamento({ lojaId: l.lojaId, agendamentoId: manual.id })).toBe("enviada");
    expect(envios).toHaveLength(1);

    const [linha] = await q<{ status: string; mensagem_id: string | null }>(
      `select status, mensagem_id from conversas_agendamentos where id = $1`,
      [manual.id],
    );
    expect(linha!.status).toBe("enviada");
    expect(linha!.mensagem_id).not.toBeNull();
    expect((await trilha(promo.id)).map((t) => [t.acao, t.ator_tipo])).toEqual([
      ["agendamento_criado", "usuario"],
      ["agendamento_cancelado", "sistema"],
    ]);
    expect((await trilha(manual.id)).map((t) => t.acao)).toEqual(["agendamento_criado", "mensagem_enviada"]);
    // reprocessar não duplica
    expect(await enviarAgendamento({ lojaId: l.lojaId, agendamentoId: manual.id })).toBe("ignorada");
    expect(envios).toHaveLength(1);
  });

  it("job de horário antigo é descartado depois de reagendar", async () => {
    const l = await novaLoja(1);
    const a = await agendar(l, "manual");
    const novo = new Date(Date.now() + 7_200_000);
    const alvo = { id: a.id, updated_at: await atualizadoEm("conversas_agendamentos", a.id), agendada_para: novo };
    await emTransacao(ctxDe(l), (tx, ctx) => reagendar(tx, ctx, alvo));
    const antigo = { lojaId: l.lojaId, agendamentoId: a.id, agendadaPara: a.agendadaPara.toISOString() };
    expect(await enviarAgendamento(antigo)).toBe("ignorada");
    expect(envios).toHaveLength(0);
    expect((await trilha(a.id)).map((t) => t.acao)).toEqual(["agendamento_criado", "agendamento_reagendado"]);
  });
});
