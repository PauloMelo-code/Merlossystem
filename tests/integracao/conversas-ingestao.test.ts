import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processarEventoDeCanal } from "@/lib/conversas";
import { ATOR_SISTEMA } from "@/lib/db/mutacoes";
import {
  banco,
  criarConta,
  criarContatoDeCrm,
  criarLoja,
  fecharBanco,
  gravarEvento,
  payloadStatus,
  payloadWhatsapp,
} from "./conversas-apoio";

/**
 * Entrada ponta a ponta (pacote M1): webhook já persistido → contato →
 * conversa → mensagem; idempotência por `(loja_id, externo_id)`; conversa
 * resolvida reabre e arquivada não; recibo monotônico; descarte registrado.
 */

let lojaId: string;
let conta: { id: string; referencia: string };

beforeAll(async () => {
  lojaId = await criarLoja();
  conta = await criarConta(lojaId);
});

afterAll(fecharBanco);

const numero = () => `55519${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

async function receber(from: string, texto = "Oi") {
  const externo = `wamid.${randomUUID()}`;
  const corpo = payloadWhatsapp(conta.referencia, { id: externo, from, texto });
  const eventoId = await gravarEvento("whatsapp_oficial", conta, lojaId, corpo);
  const r = await processarEventoDeCanal({ eventoId });
  return { externo, eventoId, r };
}

async function statusDe(externo: string, status: string, erro?: string) {
  const corpo = payloadStatus(conta.referencia, externo, status, erro);
  await processarEventoDeCanal({ eventoId: await gravarEvento("whatsapp_oficial", conta, lojaId, corpo) });
}

describe("entrada de mensagem", () => {
  it("cria contato, conversa e mensagem, e mascara o corpo do evento", async () => {
    const from = numero();
    const { externo, eventoId, r } = await receber(from, "Tem o vestido no P?");
    expect(r.novas).toHaveLength(1);

    const { rows: msgs } = await banco.query(
      `select m.direcao, m.autor_tipo, m.conteudo, c.integracao_id, c.nao_lidas,
              c.ultima_entrada_em, ct.telefone, ct.whatsapp_id
         from conversas_mensagens m
         join conversas c on c.id = m.conversa_id
         join contatos ct on ct.id = c.contato_id
        where m.loja_id = $1 and m.externo_id = $2`,
      [lojaId, externo],
    );
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({
      direcao: "entrada",
      autor_tipo: "contato",
      conteudo: "Tem o vestido no P?",
      integracao_id: conta.id,
      nao_lidas: 1,
      telefone: from,
      whatsapp_id: from,
    });
    expect(msgs[0].ultima_entrada_em).not.toBeNull();

    const { rows: ev } = await banco.query(
      "select tipo, processado_em, corpo from lojas_integracoes_eventos where id = $1",
      [eventoId],
    );
    expect(ev[0].tipo).toBe("processado");
    expect(ev[0].processado_em).not.toBeNull();
    expect(ev[0].corpo.mascarado).toBe(true);
    expect(JSON.stringify(ev[0].corpo)).not.toContain(from);
    expect(JSON.stringify(ev[0].corpo)).not.toContain("vestido");

    // Trilha com as ações próprias da entrada, gravada pelo ATOR_SISTEMA.
    const { mensagemId, conversaId } = r.novas[0]!;
    const { rows: trilha } = await banco.query(
      `select entidade, acao, ator_tipo, ator_id from auditoria_eventos
        where entidade_id in ($1, $2) order by entidade`,
      [mensagemId, conversaId],
    );
    expect(trilha).toEqual([
      { entidade: "conversas", acao: "conversa_criada", ator_tipo: "sistema", ator_id: ATOR_SISTEMA },
      { entidade: "conversas_mensagens", acao: "mensagem_recebida", ator_tipo: "sistema", ator_id: ATOR_SISTEMA },
    ]);
  });

  it("a 2ª entrega do mesmo externo_id não duplica", async () => {
    const from = numero();
    const externo = `wamid.${randomUUID()}`;
    const corpo = payloadWhatsapp(conta.referencia, { id: externo, from });
    await processarEventoDeCanal({ eventoId: await gravarEvento("whatsapp_oficial", conta, lojaId, corpo) });
    const segunda = await processarEventoDeCanal({
      eventoId: await gravarEvento("whatsapp_oficial", conta, lojaId, corpo),
    });
    expect(segunda.novas).toHaveLength(0);
    const { rows } = await banco.query(
      "select count(*)::int as n from conversas_mensagens where loja_id = $1 and externo_id = $2",
      [lojaId, externo],
    );
    expect(rows[0].n).toBe(1);
  });

  it("reprocessar o MESMO evento é inócuo", async () => {
    const { eventoId } = await receber(numero());
    const deNovo = await processarEventoDeCanal({ eventoId });
    expect(deNovo.novas).toHaveLength(0);
  });

  it("mensagens seguidas do mesmo contato caem na mesma conversa", async () => {
    const from = numero();
    const a = await receber(from, "um");
    const b = await receber(from, "dois");
    expect(a.r.novas[0]!.conversaId).toBe(b.r.novas[0]!.conversaId);
    const { rows } = await banco.query(
      "select nao_lidas, ultima_mensagem_previa from conversas where id = $1",
      [a.r.novas[0]!.conversaId],
    );
    expect(rows[0]).toMatchObject({ nao_lidas: 2, ultima_mensagem_previa: "dois" });
  });

  it("conversa resolvida REABRE; arquivada NÃO reabre", async () => {
    const from = numero();
    const { r } = await receber(from);
    const conversaId = r.novas[0]!.conversaId;
    await banco.query("update conversas set status = 'resolvida', resolvida_em = now() where id = $1", [conversaId]);

    const reaberta = await receber(from);
    expect(reaberta.r.novas[0]!.conversaId).toBe(conversaId);
    const { rows: st } = await banco.query("select status from conversas where id = $1", [conversaId]);
    expect(st[0].status).toBe("aberta");
    const { rows: trilha } = await banco.query(
      `select count(*)::int as n from auditoria_eventos
        where entidade = 'conversas' and entidade_id = $1
          and acao = 'conversa_reaberta' and antes is not null`,
      [conversaId],
    );
    expect(trilha[0].n).toBe(1);

    await banco.query("update conversas set status = 'arquivada' where id = $1", [conversaId]);
    const nova = await receber(from);
    expect(nova.r.novas[0]!.conversaId).not.toBe(conversaId);
  });

  it("recibo é monotônico: entregue atrasado não rebaixa lida", async () => {
    const { externo } = await receber(numero());
    await banco.query("update conversas_mensagens set status_entrega = 'enviada' where externo_id = $1", [externo]);
    await statusDe(externo, "read");
    await statusDe(externo, "delivered");
    const { rows } = await banco.query("select status_entrega from conversas_mensagens where externo_id = $1", [externo]);
    expect(rows[0].status_entrega).toBe("lida");
  });

  it("recibo `failed` grava o motivo; recibo posterior não tira de `falhou`", async () => {
    const { externo } = await receber(numero());
    await banco.query("update conversas_mensagens set status_entrega = 'enviada' where externo_id = $1", [externo]);
    await statusDe(externo, "failed", "Janela fechada");
    await statusDe(externo, "read");
    const { rows } = await banco.query(
      "select status_entrega, falha_motivo from conversas_mensagens where externo_id = $1",
      [externo],
    );
    expect(rows[0]).toMatchObject({ status_entrega: "falhou", falha_motivo: "Janela fechada" });
  });

  it("evento só com descarte fica `descartado` e não cria contato", async () => {
    const antes = await banco.query("select count(*)::int as n from contatos where loja_id = $1", [lojaId]);
    const corpo = payloadWhatsapp(conta.referencia, { id: `wamid.${randomUUID()}`, from: numero() });
    const mensagem = corpo.entry[0]!.changes[0]!.value.messages[0] as Record<string, unknown>;
    mensagem.type = "reaction";
    const eventoId = await gravarEvento("whatsapp_oficial", conta, lojaId, corpo);
    const r = await processarEventoDeCanal({ eventoId });
    expect(r.novas).toHaveLength(0);
    const { rows } = await banco.query("select tipo, corpo from lojas_integracoes_eventos where id = $1", [eventoId]);
    expect(rows[0].tipo).toBe("descartado");
    expect(rows[0].corpo.descartados[0]).toMatchObject({ motivo: "tipo_nao_suportado", tipoOriginal: "reaction" });
    const depois = await banco.query("select count(*)::int as n from contatos where loja_id = $1", [lojaId]);
    expect(depois.rows[0].n).toBe(antes.rows[0].n);
  });

  it("conta com erro: evento descartado com motivo, nada gravado", async () => {
    const quebrada = await criarConta(lojaId, { status: "erro" });
    const corpo = payloadWhatsapp(quebrada.referencia, { id: `wamid.${randomUUID()}`, from: numero() });
    const eventoId = await gravarEvento("whatsapp_oficial", quebrada, lojaId, corpo);
    const r = await processarEventoDeCanal({ eventoId });
    expect(r.descartado).toBe("conta com erro");
    const { rows } = await banco.query("select tipo, erro from lojas_integracoes_eventos where id = $1", [eventoId]);
    expect(rows[0]).toMatchObject({ tipo: "descartado", erro: "conta com erro" });
  });

  it("contato de CRM sem whatsapp_id recebe a mensagem (sem duplicar)", async () => {
    const from = numero();
    const contatoId = await criarContatoDeCrm(lojaId, from);
    const { r } = await receber(from);
    const { rows } = await banco.query("select contato_id from conversas where id = $1", [r.novas[0]!.conversaId]);
    expect(rows[0].contato_id).toBe(contatoId);
  });

  it("uazapi: mensagem do próprio aparelho (deMim) é gravada como saída", async () => {
    const contaUaz = await criarConta(lojaId, { provedor: "uazapi" });
    const cliente = numero();
    const externo = `UAZ${randomUUID().slice(0, 12)}`;
    const corpo = {
      EventType: "messages",
      instanceName: contaUaz.referencia,
      message: {
        messageid: externo,
        chatid: `${cliente}@s.whatsapp.net`,
        sender: "5551900000000@s.whatsapp.net",
        fromMe: true,
        messageType: "Conversation",
        text: "Te mando a foto já já",
        messageTimestamp: Date.now(),
      },
    };
    const r = await processarEventoDeCanal({ eventoId: await gravarEvento("uazapi", contaUaz, lojaId, corpo) });
    expect(r.novas).toHaveLength(1);
    const { rows } = await banco.query(
      "select direcao, autor_tipo, autor_usuario_id, status_entrega, metadados from conversas_mensagens where externo_id = $1",
      [externo],
    );
    expect(rows[0]).toMatchObject({ direcao: "saida", autor_tipo: "usuario", autor_usuario_id: null, status_entrega: "enviada" });
    expect(rows[0].metadados.enviada_pelo_aparelho).toBe(true);
  });
});
