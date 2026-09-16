import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gerarAlertas, reconhecerAlerta } from "@/lib/alertas";
import { candidatosDe } from "@/lib/alertas/_consultas";
import { chaveDeDeduplicacao } from "@/lib/alertas/regras";
import { db, pool } from "@/lib/db/client";
import { ATOR_SISTEMA } from "@/lib/db/mutacoes";
import { ErroDeColisao, ErroDeEscopo } from "@/lib/erros";
import { alertasDaLoja, cenario, contexto, conversaCom, exigirBancoDeTeste, mensagem, umaLinha } from "./auditoria-apoio";

/**
 * O GERADOR de alertas (01-dados.md §6.6). Aceite do pacote M8:
 *   - quem resolve é o gerador, a pessoa só reconhece;
 *   - alerta reconhecido que continua valendo NÃO duplica;
 *   - quando a condição some, o gerador resolve; quando volta, nasce outro.
 *
 * A massa é gravada (o gerador abre as próprias transações) e cada teste usa
 * lojas novas: `gerarAlertas({ lojaId })` só olha a loja do teste.
 */

beforeAll(() => exigirBancoDeTeste());
afterAll(async () => {
  await pool.end();
});

describe("detecção por tipo", () => {
  it("SLA estoura com entrada sem resposta além do prazo do canal, e só aí", async () => {
    const c = await cenario(db);
    const atrasada = await conversaCom(db, c);
    await mensagem(db, c, atrasada.conversaId, "entrada", 6); // WhatsApp: 5 min
    const noPrazo = await conversaCom(db, c);
    await mensagem(db, c, noPrazo.conversaId, "entrada", 2);
    const respondida = await conversaCom(db, c);
    await mensagem(db, c, respondida.conversaId, "entrada", 30);
    await mensagem(db, c, respondida.conversaId, "saida", 29);

    const ids = (await candidatosDe("sla_estourado", c.lojaId)).map((x) => x.alvoId);
    expect(ids).toEqual([atrasada.conversaId]);
  });

  it("nota interna não conta como resposta", async () => {
    const c = await cenario(db);
    const conversa = await conversaCom(db, c);
    await mensagem(db, c, conversa.conversaId, "entrada", 10);
    await db.execute(sql`
      insert into conversas_mensagens (loja_id, conversa_id, direcao, autor_tipo, conteudo, nota_interna, ocorrida_em)
      values (${c.lojaId}, ${conversa.conversaId}, 'saida', 'usuario', 'vou ver', true, now())`);
    const ids = (await candidatosDe("sla_estourado", c.lojaId)).map((x) => x.alvoId);
    expect(ids).toContain(conversa.conversaId);
  });

  it("risco de avaliação só em Instagram/Facebook e só depois de 2 h", async () => {
    const c = await cenario(db, "instagram");
    const antiga = await conversaCom(db, c);
    await mensagem(db, c, antiga.conversaId, "entrada", 130);
    const recente = await conversaCom(db, c);
    await mensagem(db, c, recente.conversaId, "entrada", 30);
    const ids = (await candidatosDe("risco_avaliacao", c.lojaId)).map((x) => x.alvoId);
    expect(ids).toEqual([antiga.conversaId]);
  });

  it("follow-up atrasado: agendada vencida além da tolerância", async () => {
    const c = await cenario(db);
    const { contatoId } = await conversaCom(db, c);
    const vencida = await umaLinha(db, sql`
      insert into conversas_agendamentos (loja_id, contato_id, integracao_id, conteudo, tipo_conteudo, agendada_para, gatilho)
      values (${c.lojaId}, ${contatoId}, ${c.integracaoId}, 'volta', 'texto', now() - interval '1 hour', 'follow_up')
      returning id`);
    await db.execute(sql`
      insert into conversas_agendamentos (loja_id, contato_id, integracao_id, conteudo, tipo_conteudo, agendada_para, gatilho)
      values (${c.lojaId}, ${contatoId}, ${c.integracaoId}, 'depois', 'texto', now() + interval '1 hour', 'follow_up')`);
    const ids = (await candidatosDe("follow_up_atrasado", c.lojaId)).map((x) => x.alvoId);
    expect(ids).toEqual([vencida.id]);
  });

  it("sessão uazapi que já esteve de pé e caiu; número nunca pareado não é queda", async () => {
    const c = await cenario(db);
    const caiu = await umaLinha(db, sql`
      insert into lojas_integracoes (loja_id, provedor, rotulo, status, ultima_sincronizacao)
      values (${c.lojaId}, 'uazapi', 'Vendas', 'desconectado', now() - interval '1 day') returning id`);
    await db.execute(sql`
      insert into lojas_integracoes (loja_id, provedor, rotulo, status)
      values (${c.lojaId}, 'uazapi', 'Novo', 'desconectado')`);
    const achados = await candidatosDe("sessao_uazapi_caiu", c.lojaId);
    expect(achados.map((x) => x.alvoId)).toEqual([caiu.id]);
    expect(achados[0]?.rotulo).toBe("Vendas");
  });

  it("integração com erro (fora uazapi)", async () => {
    const c = await cenario(db);
    await db.execute(sql`update lojas_integracoes set status = 'erro' where id = ${c.integracaoId}`);
    const ids = (await candidatosDe("integracao_com_erro", c.lojaId)).map((x) => x.alvoId);
    expect(ids).toEqual([c.integracaoId]);
  });

  it("primeiro contato: novo, sem compra e sem atendimento", async () => {
    const c = await cenario(db);
    const novo = await conversaCom(db, c);
    await mensagem(db, c, novo.conversaId, "entrada", 1);
    const atendido = await conversaCom(db, c);
    await mensagem(db, c, atendido.conversaId, "entrada", 3);
    await mensagem(db, c, atendido.conversaId, "saida", 2);
    const cliente = await conversaCom(db, c, { pedidos: 2 });
    await mensagem(db, c, cliente.conversaId, "entrada", 1);
    const ids = (await candidatosDe("primeiro_contato", c.lojaId)).map((x) => x.alvoId);
    expect(ids).toEqual([novo.contatoId]);
  });
});

describe("abrir, reconhecer, resolver e reincidir", () => {
  it("abre pela porta oficial: autor é o ATOR_SISTEMA e abrir não grava trilha", async () => {
    const c = await cenario(db);
    const conversa = await conversaCom(db, c);
    await mensagem(db, c, conversa.conversaId, "entrada", 10);
    const resumo = await gerarAlertas({ lojaId: c.lojaId });
    expect(resumo.abertos).toBeGreaterThanOrEqual(1);
    const linhas = await alertasDaLoja(c.lojaId);
    expect(linhas.length).toBe(resumo.abertos);
    expect(linhas.every((a) => a.modified_by === ATOR_SISTEMA)).toBe(true);
    const trilha = await umaLinha<{ n: string }>(db, sql`
      select count(*)::text as n from auditoria_eventos
       where entidade = 'alertas' and entidade_id in (select id::text from alertas where loja_id = ${c.lojaId})`);
    expect(trilha.n).toBe("0");
  });

  it("reconhecer: trava de colisão, trilha alerta_reconhecido e 404 para outra loja", async () => {
    const c = await cenario(db);
    const { conversaId } = await conversaCom(db, c);
    await mensagem(db, c, conversaId, "entrada", 10);
    await gerarAlertas({ lojaId: c.lojaId });
    const alerta = (await alertasDaLoja(c.lojaId))[0]!;
    const visto = new Date(alerta.updated_at);

    const deOutraLoja = contexto(c, { tipo: "uma", lojaId: c.outraLojaId });
    await expect(
      db.transaction((tx) => reconhecerAlerta({ id: alerta.id, updatedAt: visto }, deOutraLoja, tx)),
    ).rejects.toBeInstanceOf(ErroDeEscopo);

    await db.transaction((tx) => reconhecerAlerta({ id: alerta.id, updatedAt: visto }, contexto(c), tx));
    const depois = (await alertasDaLoja(c.lojaId))[0]!;
    expect(depois.reconhecido_por).toBe(c.usuarioId);
    expect(depois.resolvido_em).toBeNull();

    // Segunda pessoa com a tela velha: colisão, não sobrescreve.
    await expect(
      db.transaction((tx) => reconhecerAlerta({ id: alerta.id, updatedAt: visto }, contexto(c), tx)),
    ).rejects.toBeInstanceOf(ErroDeColisao);

    const trilha = await umaLinha<{ acao: string; ator_id: string }>(db, sql`
      select acao, ator_id from auditoria_eventos where entidade = 'alertas' and entidade_id = ${alerta.id}`);
    expect(trilha).toEqual({ acao: "alerta_reconhecido", ator_id: c.usuarioId });
  });

  it("reconhecido que volta a valer não duplica; resolvido pelo gerador; reincidência abre outro", async () => {
    const c = await cenario(db);
    const { conversaId } = await conversaCom(db, c);
    await mensagem(db, c, conversaId, "entrada", 10);
    const opcoes = { lojaId: c.lojaId };

    const primeira = await gerarAlertas(opcoes);
    expect(primeira.abertos).toBeGreaterThanOrEqual(1);
    const chave = chaveDeDeduplicacao("sla_estourado", { tipo: "conversa", id: conversaId });
    let linhas = (await alertasDaLoja(c.lojaId)).filter((a) => a.chave_deduplicacao === chave);
    expect(linhas).toHaveLength(1);

    // A pessoa reconhece; a condição continua valendo.
    const alerta = linhas[0]!;
    await db.transaction((tx) =>
      reconhecerAlerta({ id: alerta.id, updatedAt: new Date(alerta.updated_at) }, contexto(c), tx),
    );
    await gerarAlertas(opcoes);
    await gerarAlertas(opcoes);
    linhas = (await alertasDaLoja(c.lojaId)).filter((a) => a.chave_deduplicacao === chave);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.reconhecido_em).not.toBeNull();
    expect(linhas[0]?.resolvido_em).toBeNull();

    // Respondida: o GERADOR resolve.
    await mensagem(db, c, conversaId, "saida", 0);
    const segunda = await gerarAlertas(opcoes);
    expect(segunda.resolvidos).toBeGreaterThanOrEqual(1);
    linhas = (await alertasDaLoja(c.lojaId)).filter((a) => a.chave_deduplicacao === chave);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.resolvido_em).not.toBeNull();

    // A cliente volta a escrever e fica sem resposta: alerta NOVO.
    await db.execute(sql`
      insert into conversas_mensagens (loja_id, conversa_id, direcao, autor_tipo, conteudo, ocorrida_em)
      values (${c.lojaId}, ${conversaId}, 'entrada', 'contato', 'e aí?', now() + interval '1 second')`);
    await db.execute(sql`update conversas set ultima_entrada_em = now() - interval '20 minutes' where id = ${conversaId}`);
    await db.execute(sql`update conversas_mensagens set ocorrida_em = now() - interval '30 minutes'
                          where conversa_id = ${conversaId} and direcao = 'saida'`);
    await gerarAlertas(opcoes);
    linhas = (await alertasDaLoja(c.lojaId)).filter((a) => a.chave_deduplicacao === chave);
    expect(linhas).toHaveLength(2);
    expect(linhas.filter((a) => a.resolvido_em === null)).toHaveLength(1);
  });

  it("a dedupe é do BANCO: dois abertos com a mesma chave não coexistem", async () => {
    const c = await cenario(db);
    const inserir = () =>
      db.execute(sql`
        insert into alertas (loja_id, tipo, severidade, mensagem, chave_deduplicacao)
        values (${c.lojaId}, 'integracao_com_erro', 'alta', 'x', 'chave-fixa')`);
    await inserir();
    const erro = await inserir().then(() => null, (e: unknown) => e as { code?: string; cause?: { code?: string } });
    expect(erro?.code ?? erro?.cause?.code).toBe("23505");
  });

  it("carimbo sla_estourado_em liga no estouro e desliga na resposta, sem mexer em updated_at", async () => {
    const c = await cenario(db);
    const { conversaId } = await conversaCom(db, c);
    await mensagem(db, c, conversaId, "entrada", 10);
    const antes = await umaLinha<{ updated_at: Date }>(db, sql`select updated_at from conversas where id = ${conversaId}`);

    await gerarAlertas({ lojaId: c.lojaId });
    let conversa = await umaLinha<{ sla_estourado_em: Date | null; updated_at: Date }>(
      db,
      sql`select sla_estourado_em, updated_at from conversas where id = ${conversaId}`,
    );
    expect(conversa.sla_estourado_em).not.toBeNull();
    expect(conversa.updated_at).toEqual(antes.updated_at);

    await mensagem(db, c, conversaId, "saida", 0);
    await gerarAlertas({ lojaId: c.lojaId });
    conversa = await umaLinha(db, sql`select sla_estourado_em, updated_at from conversas where id = ${conversaId}`);
    expect(conversa.sla_estourado_em).toBeNull();
  });
});
