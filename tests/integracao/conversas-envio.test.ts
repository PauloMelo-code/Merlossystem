import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Contexto } from "@/lib/auth/guard";
import type { ClienteHttp } from "@/lib/canais/tipos";
import {
  enviarDaFila,
  enviarPelaTela,
  processarEventoDeCanal,
  reenviarMensagem,
  registrarEnvio,
} from "@/lib/conversas";
import { emTransacao } from "@/lib/db/mutacoes";
import { fecharConexoes, redisDoLimitador } from "@/lib/fila/conexao";
import { fecharFilas } from "@/lib/fila/filas";
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
 * Saída (pacote M1): envio pela tela, pela costura e pela fila; reenvio como
 * ÚNICA saída de `falhou`; conta da conversa decide; janela de 24 h; nota
 * interna nunca vai ao canal. O provedor é um dublê (`ClienteHttp`).
 */

let lojaId: string;
let conta: { id: string; referencia: string };
let ctx: Contexto;

const provedorOk = (id = `wamid.${randomUUID()}`): ClienteHttp => async () => ({
  status: 200,
  tipo: "application/json",
  bytes: Buffer.from(JSON.stringify({ messages: [{ id }] })),
});
const provedorRecusa = (status: number, mensagem: string): ClienteHttp => async () => ({
  status,
  tipo: "application/json",
  bytes: Buffer.from(JSON.stringify({ error: { message: mensagem } })),
});

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

afterAll(async () => {
  await fecharFilas();
  await fecharConexoes();
  await redisDoLimitador().quit().catch(() => undefined);
  await fecharBanco();
});

async function conversaRecebida(): Promise<{ conversaId: string; contatoId: string }> {
  const from = `55519${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
  const corpo = payloadWhatsapp(conta.referencia, { id: `wamid.${randomUUID()}`, from });
  const r = await processarEventoDeCanal({ eventoId: await gravarEvento("whatsapp_oficial", conta, lojaId, corpo) });
  const conversaId = r.novas[0]!.conversaId;
  const { rows } = await banco.query("select contato_id from conversas where id = $1", [conversaId]);
  return { conversaId, contatoId: rows[0].contato_id };
}

function enviarTexto(conversaId: string, conteudo = "Temos sim!", nota = false) {
  return emTransacao(ctx, (tx, c) =>
    enviarPelaTela(
      { conversaId, conteudo, chaveIdempotencia: randomUUID(), notaInterna: nota, variaveis: [] },
      c,
      tx,
    ),
  );
}

async function linha(mensagemId: string) {
  const { rows } = await banco.query(
    `select status_entrega, externo_id, falha_motivo, autor_usuario_id, nota_interna, conversa_id
       from conversas_mensagens where id = $1`,
    [mensagemId],
  );
  return rows[0];
}

describe("envio", () => {
  it("tela registra pendente com autor da sessão; fila envia e guarda o id externo", async () => {
    const { conversaId } = await conversaRecebida();
    const r = await enviarTexto(conversaId);
    expect(r.envio).not.toBeNull();
    expect(await linha(r.mensagemId)).toMatchObject({ status_entrega: "pendente", autor_usuario_id: ctx.autorId });

    const { rows: c } = await banco.query("select responsavel_id, nao_lidas, primeira_resposta_em from conversas where id = $1", [conversaId]);
    expect(c[0]).toMatchObject({ responsavel_id: ctx.autorId, nao_lidas: 0 });
    expect(c[0].primeira_resposta_em).not.toBeNull();

    const desfecho = await enviarDaFila(r.envio!, false, provedorOk("wamid.OK1"));
    expect(desfecho.desfecho).toBe("enviada");
    expect(await linha(r.mensagemId)).toMatchObject({ status_entrega: "enviada", externo_id: "wamid.OK1" });
  });

  it("recusa permanente vira `falhou` com motivo; reenvio é claim único e limpa o motivo", async () => {
    const { conversaId } = await conversaRecebida();
    const r = await enviarTexto(conversaId);
    const falha = await enviarDaFila(r.envio!, false, provedorRecusa(400, "Número inválido"));
    expect(falha.desfecho).toBe("falhou");
    expect(await linha(r.mensagemId)).toMatchObject({ status_entrega: "falhou", falha_motivo: "Número inválido" });

    const reenvio = await emTransacao(ctx, (tx, c) => reenviarMensagem({ mensagemId: r.mensagemId }, c, tx));
    expect(await linha(r.mensagemId)).toMatchObject({ status_entrega: "pendente", falha_motivo: null });
    await expect(
      emTransacao(ctx, (tx, c) => reenviarMensagem({ mensagemId: r.mensagemId }, c, tx)),
    ).rejects.toMatchObject({ codigo: "COLISAO" });

    const { rows: trilha } = await banco.query(
      "select count(*)::int as n from auditoria_eventos where acao = 'mensagem_reenviada' and entidade_id = $1",
      [r.mensagemId],
    );
    expect(trilha[0].n).toBe(1);

    const ok = await enviarDaFila(reenvio.envio!, false, provedorOk());
    expect(ok.desfecho).toBe("enviada");
  });

  it("erro transitório retenta; na última tentativa vira `falhou`", async () => {
    const { conversaId } = await conversaRecebida();
    const r = await enviarTexto(conversaId);
    await expect(enviarDaFila(r.envio!, false, provedorRecusa(503, "Indisponível"))).rejects.toThrow("Indisponível");
    expect((await linha(r.mensagemId)).status_entrega).toBe("pendente");
    const ultima = await enviarDaFila(r.envio!, true, provedorRecusa(503, "Indisponível"));
    expect(ultima.desfecho).toBe("falhou");
  });

  it("a conta da CONVERSA decide a saída, não o dado do job", async () => {
    const { conversaId } = await conversaRecebida();
    const outra = await criarConta(lojaId, { status: "desconectado" });
    const r = await enviarTexto(conversaId);
    const desfecho = await enviarDaFila({ ...r.envio!, integracaoId: outra.id }, false, provedorOk());
    expect(desfecho.desfecho).toBe("enviada");
  });

  it("número desconectado: a tela recusa e a fila falha fechado", async () => {
    const loja = await criarLoja();
    const caida = await criarConta(loja, { status: "conectado" });
    const from = "5551911112222";
    const corpo = payloadWhatsapp(caida.referencia, { id: `wamid.${randomUUID()}`, from });
    const e = await processarEventoDeCanal({ eventoId: await gravarEvento("whatsapp_oficial", caida, loja, corpo) });
    const conversaId = e.novas[0]!.conversaId;
    await banco.query("update lojas_integracoes set status = 'desconectado' where id = $1", [caida.id]);

    const gestora: Contexto = { ...ctx, sessao: { ...ctx.sessao, papel: "gerente", lojaId: null }, escopo: { tipo: "todas" } };
    await expect(
      emTransacao(gestora, (tx, c) =>
        enviarPelaTela({ conversaId, conteudo: "oi", chaveIdempotencia: randomUUID(), notaInterna: false, variaveis: [] }, c, tx),
      ),
    ).rejects.toMatchObject({ codigo: "VALIDACAO" });

    // Nota interna continua valendo com o número caído.
    const nota = await emTransacao(gestora, (tx, c) =>
      enviarPelaTela({ conversaId, conteudo: "cliente pediu retorno", chaveIdempotencia: randomUUID(), notaInterna: true, variaveis: [] }, c, tx),
    );
    expect(nota.envio).toBeNull();
    expect(await linha(nota.mensagemId)).toMatchObject({ nota_interna: true, status_entrega: null, externo_id: null });
  });

  it("janela de 24 h fechada: texto é recusado", async () => {
    const { conversaId } = await conversaRecebida();
    await banco.query("update conversas set ultima_entrada_em = now() - interval '25 hours' where id = $1", [conversaId]);
    await expect(enviarTexto(conversaId)).rejects.toMatchObject({ codigo: "VALIDACAO" });
  });

  it("nota interna nunca vai à fila", async () => {
    const { conversaId } = await conversaRecebida();
    const r = await enviarTexto(conversaId, "só para a equipe", true);
    expect(r.envio).toBeNull();
    const desfecho = await enviarDaFila({ lojaId, mensagemId: r.mensagemId, integracaoId: conta.id }, false, provedorOk());
    expect(desfecho.desfecho).toBe("ignorada");
  });

  it("costura registrarEnvio: mesma chave = mesma mensagem; conta de outra loja = 404", async () => {
    const { conversaId, contatoId } = await conversaRecebida();
    const sistema: Contexto = { ...ctx, origem: "worker" };
    const chave = randomUUID();
    const envio = { lojaId, contatoId, integracaoId: conta.id, conteudo: "Promoção!", chaveIdempotencia: chave };
    const a = await emTransacao(sistema, (tx, c) => registrarEnvio(tx, envio, c));
    const b = await emTransacao(sistema, (tx, c) => registrarEnvio(tx, envio, c));
    expect(a).toEqual(b);
    expect(a.conversaId).toBe(conversaId);
    const { rows } = await banco.query("select autor_tipo, autor_usuario_id from conversas_mensagens where id = $1", [a.mensagemId]);
    expect(rows[0]).toMatchObject({ autor_tipo: "campanha", autor_usuario_id: null });

    const alheia = await criarConta(await criarLoja());
    await expect(
      emTransacao(sistema, (tx, c) => registrarEnvio(tx, { ...envio, integracaoId: alheia.id, chaveIdempotencia: randomUUID() }, c)),
    ).rejects.toMatchObject({ codigo: "NAO_ENCONTRADO" });
  });

  it("conversa de outra loja responde 404", async () => {
    const { conversaId } = await conversaRecebida();
    const outraLoja = await criarLoja();
    const intrusa: Contexto = { ...ctx, sessao: { ...ctx.sessao, lojaId: outraLoja }, escopo: { tipo: "uma", lojaId: outraLoja } };
    await expect(
      emTransacao(intrusa, (tx, c) =>
        enviarPelaTela({ conversaId, conteudo: "x", chaveIdempotencia: randomUUID(), notaInterna: false, variaveis: [] }, c, tx),
      ),
    ).rejects.toMatchObject({ codigo: "NAO_ENCONTRADO" });
  });
});
