import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Contexto } from "@/lib/auth/guard";
import type { ClienteHttp, ConfigDoCanal } from "@/lib/canais/tipos";
import {
  enviarDaFila,
  enviarPelaTela,
  processarEventoDeCanal,
  reenviarMensagem,
  registrarEnvio,
  type DadosDoEnvio,
} from "@/lib/conversas";
import { ATOR_SISTEMA, contextoDeSistema, emTransacao } from "@/lib/db/mutacoes";
import { ErroDeEscopo } from "@/lib/erros";
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
 * interna nunca vai ao canal; anexo sobe pelo binário do MinIO. O provedor é
 * um dublê (`ClienteHttp`) e a config de plataforma é FIXA — nada vem do env.
 */

// O binário da mídia é do M3 (MinIO): aqui, bytes fixos por id.
const binarios = vi.hoisted(() => new Map<string, Buffer>());
vi.mock("@/lib/midias/leitura", async () => {
  const { ErroDeEscopo: Escopo } = await import("@/lib/erros");
  return {
    lerBinarioDaMidia: async (_lojaId: string, midiaId: string) => {
      const bytes = binarios.get(midiaId);
      if (!bytes) throw new Escopo();
      return { midiaId, bytes, mime: "image/png", nomeOriginal: "vestido.png", tamanhoBytes: bytes.byteLength };
    },
  };
});

const CONFIG: ConfigDoCanal = { versaoGraph: "v23.0", baseUazapi: "https://uazapi.exemplo.com" };

let lojaId: string;
let conta: { id: string; referencia: string };
let ctx: Contexto;

const enviar = (dados: DadosDoEnvio, ultima: boolean, http: ClienteHttp) =>
  enviarDaFila(dados, ultima, { http, config: CONFIG });

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

    const desfecho = await enviar(r.envio!, false, provedorOk("wamid.OK1"));
    expect(desfecho.desfecho).toBe("enviada");
    expect(await linha(r.mensagemId)).toMatchObject({ status_entrega: "enviada", externo_id: "wamid.OK1" });
  });

  it("recusa permanente vira `falhou` com motivo; reenvio é claim único e limpa o motivo", async () => {
    const { conversaId } = await conversaRecebida();
    const r = await enviarTexto(conversaId);
    const falha = await enviar(r.envio!, false, provedorRecusa(400, "Número inválido"));
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

    const ok = await enviar(reenvio.envio!, false, provedorOk());
    expect(ok.desfecho).toBe("enviada");
  });

  it("erro transitório retenta; na última tentativa vira `falhou`", async () => {
    const { conversaId } = await conversaRecebida();
    const r = await enviarTexto(conversaId);
    await expect(enviar(r.envio!, false, provedorRecusa(503, "Indisponível"))).rejects.toThrow("Indisponível");
    expect((await linha(r.mensagemId)).status_entrega).toBe("pendente");
    const ultima = await enviar(r.envio!, true, provedorRecusa(503, "Indisponível"));
    expect(ultima.desfecho).toBe("falhou");
  });

  it("a conta da CONVERSA decide a saída, não o dado do job", async () => {
    const { conversaId } = await conversaRecebida();
    const outra = await criarConta(lojaId, { status: "desconectado" });
    const r = await enviarTexto(conversaId);
    const desfecho = await enviar({ ...r.envio!, integracaoId: outra.id }, false, provedorOk());
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
    const desfecho = await enviar({ lojaId, mensagemId: r.mensagemId, integracaoId: conta.id }, false, provedorOk());
    expect(desfecho.desfecho).toBe("ignorada");
  });

  it("costura registrarEnvio: mesma chave = mesma mensagem; conta de outra loja = 404", async () => {
    const { conversaId, contatoId } = await conversaRecebida();
    const sistema = contextoDeSistema({ origem: "worker", lojaId });
    const chave = randomUUID();
    const envio = { lojaId, contatoId, integracaoId: conta.id, conteudo: "Promoção!", chaveIdempotencia: chave };
    const a = await emTransacao(sistema, (tx, c) => registrarEnvio(tx, envio, c));
    const b = await emTransacao(sistema, (tx, c) => registrarEnvio(tx, envio, c));
    expect(a).toEqual(b);
    expect(a.conversaId).toBe(conversaId);
    const { rows } = await banco.query(
      "select autor_tipo, autor_usuario_id, modified_by from conversas_mensagens where id = $1",
      [a.mensagemId],
    );
    // Sem pessoa: o autor da linha é o ATOR_SISTEMA, e a mensagem não tem usuário.
    expect(rows[0]).toMatchObject({ autor_tipo: "campanha", autor_usuario_id: null, modified_by: ATOR_SISTEMA });
    const { rows: trilha } = await banco.query(
      "select ator_tipo, ator_id from auditoria_eventos where acao = 'mensagem_enviada' and entidade_id = $1",
      [a.mensagemId],
    );
    expect(trilha).toEqual([{ ator_tipo: "sistema", ator_id: ATOR_SISTEMA }]);

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

describe("anexo de saída", () => {
  async function criarMidia(loja: string, bytes?: Buffer): Promise<string> {
    const id = randomUUID();
    await banco.query(
      `insert into lojas_midias (id, loja_id, nome_original, chave_objeto, tipo_arquivo, mime_type, tamanho_bytes, origem, pasta)
       values ($1, $2, 'vestido.png', $3, 'imagem', 'image/png', 4, 'upload', 'geral')`,
      [id, loja, `${loja}/upload/${id}.png`],
    );
    if (bytes) binarios.set(id, bytes);
    return id;
  }

  const anexar = (conversaId: string, midiaId: string, conteudo = "") =>
    emTransacao(ctx, (tx, c) =>
      enviarPelaTela(
        { conversaId, conteudo, chaveIdempotencia: randomUUID(), notaInterna: false, midiaId, variaveis: [] },
        c,
        tx,
      ),
    );

  it("a tela liga a mídia guardada; a fila sobe o binário (multipart) e cita o id", async () => {
    const { conversaId } = await conversaRecebida();
    const midiaId = await criarMidia(lojaId, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const r = await anexar(conversaId, midiaId, "olha esse");

    const { rows: m } = await banco.query("select tipo_conteudo, conteudo, status_entrega from conversas_mensagens where id = $1", [r.mensagemId]);
    expect(m[0]).toEqual({ tipo_conteudo: "imagem", conteudo: "olha esse", status_entrega: "pendente" });
    const { rows: anexo } = await banco.query(
      "select midia_id, url_externa, baixada, tipo_arquivo from conversas_mensagens_midias where mensagem_id = $1",
      [r.mensagemId],
    );
    expect(anexo).toEqual([{ midia_id: midiaId, url_externa: null, baixada: true, tipo_arquivo: "imagem" }]);
    const { rows: trilha } = await banco.query(
      "select count(*)::int as n from auditoria_eventos where acao = 'midia_enviada' and entidade = 'conversas_mensagens_midias' and ator_id = $1",
      [ctx.autorId],
    );
    expect(trilha[0].n).toBeGreaterThanOrEqual(1);

    const vistas: { url: string; corpo: unknown }[] = [];
    const graph: ClienteHttp = async (url, opcoes) => {
      vistas.push({ url, corpo: opcoes.corpo });
      const corpo = url.endsWith("/media") ? { id: "MID-9" } : { messages: [{ id: "wamid.ANEXO" }] };
      return { status: 200, tipo: "application/json", bytes: Buffer.from(JSON.stringify(corpo)) };
    };
    const desfecho = await enviar(r.envio!, false, graph);
    expect(desfecho.desfecho).toBe("enviada");
    expect(vistas[0]!.url).toMatch(/\/media$/);
    expect(vistas[0]!.corpo).toBeInstanceOf(FormData);
    expect(JSON.parse(vistas[1]!.corpo as string)).toMatchObject({ type: "image", image: { id: "MID-9", caption: "olha esse" } });
    expect(await linha(r.mensagemId)).toMatchObject({ status_entrega: "enviada", externo_id: "wamid.ANEXO" });
  });

  it("mídia de outra loja responde 404 e nada é gravado", async () => {
    const { conversaId } = await conversaRecebida();
    const alheia = await criarMidia(await criarLoja(), Buffer.from([1]));
    await expect(anexar(conversaId, alheia)).rejects.toMatchObject({ codigo: "NAO_ENCONTRADO" });
    await expect(anexar(conversaId, randomUUID())).rejects.toBeInstanceOf(ErroDeEscopo);
  });

  it("binário que sumiu antes do envio: `falhou` com motivo, sem retentar", async () => {
    const { conversaId } = await conversaRecebida();
    const midiaId = await criarMidia(lojaId);
    const r = await anexar(conversaId, midiaId);
    const desfecho = await enviar(r.envio!, false, provedorOk());
    expect(desfecho.desfecho).toBe("falhou");
    expect(await linha(r.mensagemId)).toMatchObject({ status_entrega: "falhou", falha_motivo: "O anexo foi excluído da galeria." });
  });
});
