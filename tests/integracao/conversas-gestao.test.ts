import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Contexto } from "@/lib/auth/guard";
import {
  abrirAtendimento,
  arquivarConversa,
  marcarComoLida,
  mudarPrioridade,
  paginaDeConversas,
  paginaDeMensagens,
  processarEventoDeCanal,
  reabrirConversa,
  resolverConversa,
  transferirConversa,
} from "@/lib/conversas";
import { db } from "@/lib/db/client";
import { emTransacao } from "@/lib/db/mutacoes";
import {
  banco,
  criarConta,
  criarLoja,
  criarUsuarioComSessao,
  fecharBanco,
  gravarEvento,
  payloadWhatsapp,
} from "./conversas-apoio";

/**
 * Gestão e leitura do atendimento (pacote M1): ações reversíveis com o
 * `updated_at` novo para o "Desfazer", colisão, transferência só para quem
 * atende a loja, eventos de sistema na linha do tempo e cursor `(instante, id)`.
 */

let lojaId: string;
let conta: { id: string; referencia: string };
let ctx: Contexto;

beforeAll(async () => {
  lojaId = await criarLoja();
  conta = await criarConta(lojaId);
  const { usuarioId, sessaoId } = await criarUsuarioComSessao(lojaId, "vendedor");
  ctx = {
    sessao: {
      usuarioId,
      sessaoId,
      papel: "vendedor",
      lojaId,
      ativo: true,
      precisaTrocarSenha: false,
      precisaConfigurarFator: false,
    },
    escopo: { tipo: "uma", lojaId },
    autorId: usuarioId,
    origem: "ui",
  };
});

afterAll(fecharBanco);

const numero = () => `55519${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

async function receber(from: string, texto: string, timestamp?: number) {
  const corpo = payloadWhatsapp(conta.referencia, {
    id: `wamid.${randomUUID()}`,
    from,
    texto,
    ...(timestamp ? { timestamp } : {}),
  });
  const r = await processarEventoDeCanal({ eventoId: await gravarEvento("whatsapp_oficial", conta, lojaId, corpo) });
  return r.novas[0]!.conversaId;
}

async function atualEm(conversaId: string): Promise<Date> {
  const { rows } = await banco.query("select updated_at from conversas where id = $1", [conversaId]);
  return rows[0].updated_at;
}

describe("gestão da conversa", () => {
  it("resolver devolve o updated_at novo e o Desfazer (reabrir) funciona com ele", async () => {
    const id = await receber(numero(), "oi");
    const resolvida = await emTransacao(ctx, async (tx, c) =>
      resolverConversa({ conversaId: id, updatedAt: await atualEm(id) }, c, tx),
    );
    expect(resolvida.lojaId).toBe(lojaId);
    const desfeita = await emTransacao(ctx, (tx, c) =>
      reabrirConversa({ conversaId: id, updatedAt: new Date(resolvida.updatedAt) }, c, tx),
    );
    expect(desfeita.updatedAt).not.toBe(resolvida.updatedAt);
    const { rows } = await banco.query("select status, resolvida_em from conversas where id = $1", [id]);
    expect(rows[0]).toMatchObject({ status: "aberta", resolvida_em: null });
  });

  it("updated_at velho = COLISAO, nunca sobrescreve em silêncio", async () => {
    const id = await receber(numero(), "oi");
    const velho = await atualEm(id);
    await emTransacao(ctx, (tx, c) => mudarPrioridade({ conversaId: id, updatedAt: velho, prioridade: "alta" }, c, tx));
    await expect(
      emTransacao(ctx, (tx, c) => arquivarConversa({ conversaId: id, updatedAt: velho }, c, tx)),
    ).rejects.toMatchObject({ codigo: "COLISAO" });
  });

  it("reabrir quando já existe outra aberta do par é recusado com mensagem", async () => {
    const from = numero();
    const id = await receber(from, "oi");
    await emTransacao(ctx, async (tx, c) => arquivarConversa({ conversaId: id, updatedAt: await atualEm(id) }, c, tx));
    const nova = await receber(from, "voltei");
    expect(nova).not.toBe(id);
    await expect(
      emTransacao(ctx, async (tx, c) => reabrirConversa({ conversaId: id, updatedAt: await atualEm(id) }, c, tx)),
    ).rejects.toMatchObject({ codigo: "VALIDACAO" });
  });

  it("transferir só para quem atende a loja; evento aparece na linha do tempo", async () => {
    const id = await receber(numero(), "quero trocar");
    const outraLoja = await criarLoja();
    const estranha = await criarUsuarioComSessao(outraLoja, "vendedor");
    await expect(
      emTransacao(ctx, async (tx, c) =>
        transferirConversa({ conversaId: id, updatedAt: await atualEm(id), responsavelId: estranha.usuarioId }, c, tx),
      ),
    ).rejects.toMatchObject({ codigo: "VALIDACAO" });

    const colega = await criarUsuarioComSessao(lojaId, "vendedor");
    await emTransacao(ctx, async (tx, c) =>
      transferirConversa({ conversaId: id, updatedAt: await atualEm(id), responsavelId: colega.usuarioId }, c, tx),
    );
    const pagina = await paginaDeMensagens(db, ctx.escopo, id, null);
    const eventos = pagina.itens.filter((m) => m.tipo === "sistema").map((m) => m.conteudo);
    expect(eventos).toEqual(["Vendedora Teste transferiu para Vendedora Teste"]);
  });

  it("marcar como lida zera o contador sem mexer no updated_at", async () => {
    const from = numero();
    const id = await receber(from, "1");
    await receber(from, "2");
    const antes = await atualEm(id);
    await emTransacao(ctx, (tx, c) => marcarComoLida({ conversaId: id }, c, tx));
    const { rows } = await banco.query("select nao_lidas, updated_at from conversas where id = $1", [id]);
    expect(rows[0].nao_lidas).toBe(0);
    expect(rows[0].updated_at.getTime()).toBe(antes.getTime());
  });

  it("conversa de outra loja: 404 (nunca 403)", async () => {
    const id = await receber(numero(), "oi");
    const outra = await criarLoja();
    const intrusa: Contexto = { ...ctx, escopo: { tipo: "uma", lojaId: outra } };
    await expect(
      emTransacao(intrusa, async (tx, c) => resolverConversa({ conversaId: id, updatedAt: await atualEm(id) }, c, tx)),
    ).rejects.toMatchObject({ codigo: "NAO_ENCONTRADO" });
    await expect(abrirAtendimento(db, intrusa, id)).rejects.toMatchObject({ codigo: "NAO_ENCONTRADO" });
  });
});

describe("leitura", () => {
  it("cursor (ocorrida_em, id) não pula mensagem do mesmo instante", async () => {
    const from = numero();
    const instante = Math.floor(Date.now() / 1000) - 3600;
    let id = "";
    for (let i = 0; i < 45; i += 1) id = await receber(from, `m${i}`, instante);
    const primeira = await paginaDeMensagens(db, ctx.escopo, id, null);
    expect(primeira.anterior).not.toBeNull();
    const segunda = await paginaDeMensagens(db, ctx.escopo, id, primeira.anterior);
    const vistas = new Set([...primeira.itens, ...segunda.itens].filter((m) => m.tipo !== "sistema").map((m) => m.id));
    expect(vistas.size).toBe(45);
  });

  it("abrir atendimento: DTO sem url_externa e com bloqueio calculado", async () => {
    const id = await receber(numero(), "oi");
    const aberto = await abrirAtendimento(db, ctx, id);
    expect(aberto.conversa.bloqueio).toBeNull();
    expect(aberto.conversa.aviso).toBe("Ao responder, a conversa fica com você.");
    expect(JSON.stringify(aberto)).not.toContain("url_externa");

    const leitora: Contexto = { ...ctx, sessao: { ...ctx.sessao, papel: "viewer" } };
    const soLeitura = await abrirAtendimento(db, leitora, id);
    expect(soLeitura.conversa.bloqueio).toEqual({ caso: "somente_leitura" });
  });

  it("lista: filtro 'minhas' e 'sem responsável'", async () => {
    const id = await receber(numero(), "sem dono");
    const semDono = await paginaDeConversas(db, ctx.escopo, ctx.autorId, { visao: "sem_responsavel", status: "andamento" }, null);
    expect(semDono.itens.some((i) => i.id === id)).toBe(true);
    const minhas = await paginaDeConversas(db, ctx.escopo, ctx.autorId, { visao: "minhas", status: "andamento" }, null);
    expect(minhas.itens.some((i) => i.id === id)).toBe(false);
    expect(semDono.semResposta).toBeGreaterThan(0);
  });
});
