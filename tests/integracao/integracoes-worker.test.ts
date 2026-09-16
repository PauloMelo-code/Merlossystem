import type { Job } from "bullmq";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fila `integracoes` (03-arquitetura.md §8.1, §12.2): modelos da Meta,
 * sessão do uazapi e o fan-out dos agendadores. A rede é falsa.
 */

vi.mock("@/lib/env", async (original) => {
  const mod = await original<typeof import("@/lib/env")>();
  return {
    ...mod,
    env: { ...mod.env, META_GRAPH_VERSION: "v23.0", UAZAPI_BASE_URL: "https://uazapi.exemplo.com" },
  };
});

vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: "203.0.113.20", family: 4 }],
}));

const respostas: Response[] = [];
const urls: string[] = [];
const corpos: unknown[] = [];
vi.stubGlobal("fetch", async (url: URL | string, init?: RequestInit) => {
  urls.push(String(url));
  corpos.push(typeof init?.body === "string" ? JSON.parse(init.body) : null);
  return respostas.shift() ?? new Response("{}", { status: 500 });
});

const proc = await import("@/server/processadores/integracoes");
const { ATOR_SISTEMA } = await import("@/lib/db/mutacoes");
const { componentesDoModelo, enviarModeloParaAprovacao } = await import("@/lib/integracoes/meta/aprovacao");
const { fecharFilas, fila } = await import("@/lib/fila/filas");
const { redisDoLimitador } = await import("@/lib/seguranca/limite");
const { mudancaDoModelo } = await import("@/lib/integracoes/meta/modelos");
const { lerPagina, statusDaMeta } = await import("@/lib/integracoes/meta/graph");
const { lerEstado } = await import("@/lib/integracoes/uazapi");
const { aleatorio, banco, contextoDe, linhaDaConta, semearConta, semearLoja, semearUsuario, trilhaDe } = await import(
  "./integracoes-apoio"
);

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

function job<T>(data: T, name = "teste"): Job<T> {
  return { data, name, id: `teste-${aleatorio(4)}` } as unknown as Job<T>;
}

beforeEach(async () => {
  respostas.length = 0;
  urls.length = 0;
  corpos.length = 0;
  await redisDoLimitador().flushdb().catch(() => undefined);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await fecharFilas();
  await redisDoLimitador().quit().catch(() => undefined);
  await banco.end().catch(() => undefined);
});

async function semearModelo(integracaoId: string, lojaId: string, nome: string, status: string): Promise<string> {
  const { rows } = await banco.query<{ id: string }>(
    `insert into lojas_integracoes_templates
       (loja_id, integracao_id, nome, categoria, corpo, variaveis_contagem, status, created_at, updated_at)
     values ($1, $2, $3, 'marketing', 'Olá {{1}}', 1, $4, now(), now()) returning id`,
    [lojaId, integracaoId, nome, status],
  );
  return rows[0]!.id;
}

describe("regras puras", () => {
  it("status da Meta: conhecido vira o nosso; desconhecido não mexe", () => {
    expect(statusDaMeta("APPROVED")).toBe("aprovado");
    expect(statusDaMeta("REJECTED")).toBe("rejeitado");
    expect(statusDaMeta("PENDING")).toBe("enviado");
    expect(statusDaMeta("PAUSED")).toBe("pausado");
    expect(statusDaMeta("QUALQUER")).toBeNull();
  });

  it("mudança: aprovado carimba aprovado_em uma vez; sem diferença não grava", () => {
    const agora = new Date();
    const remoto = { id: "9", nome: "x", idioma: "pt_BR", status: "aprovado" as const, motivo: null };
    expect(mudancaDoModelo({ status: "enviado", metaId: null, motivo: null }, remoto, agora)).toEqual({
      status: "aprovado",
      meta_template_id: "9",
      motivo_rejeicao: null,
      aprovado_em: agora,
    });
    expect(mudancaDoModelo({ status: "aprovado", metaId: "9", motivo: null }, remoto, agora)).toBeNull();
  });

  it("página da Graph API: ignora item malformado e segue o next", () => {
    const lida = lerPagina({ data: [{ id: "1", name: "a", status: "APPROVED" }, { nada: 1 }], paging: { next: "https://graph.facebook.com/n" } });
    expect(lida.modelos).toHaveLength(1);
    expect(lida.proxima).toBe("https://graph.facebook.com/n");
  });

  it("estado do uazapi: QR em texto vira imagem gerada aqui", () => {
    const estado = lerEstado({ instance: { status: "connecting", qrcode: "2@abc" } });
    expect(estado.estado).toBe("conectando");
    expect(estado.qr).toMatch(/^data:image\/svg\+xml;base64,/);
  });
});

describe("sincronizar-templates", () => {
  it("atualiza o que a Meta aprovou/reprovou/pausou, não toca rascunho, grava trilha de sistema", async () => {
    const loja = await semearLoja();
    const conta = await semearConta({
      provedor: "whatsapp_oficial",
      lojaId: loja.id,
      credencial: { access_token: "tok-meta", waba_id: "123456789" },
    });
    const enviado = await semearModelo(conta.id, loja.id, `oferta_${aleatorio(3)}`, "enviado");
    const reprovavel = await semearModelo(conta.id, loja.id, `cupom_${aleatorio(3)}`, "enviado");
    const rascunho = await semearModelo(conta.id, loja.id, `novo_${aleatorio(3)}`, "rascunho");
    const pausavel = await semearModelo(conta.id, loja.id, `aviso_${aleatorio(3)}`, "aprovado");
    const todos = [enviado, reprovavel, rascunho, pausavel];
    const nomes = await banco.query<{ id: string; nome: string }>(
      "select id, nome from lojas_integracoes_templates where id = any($1::uuid[])",
      [todos],
    );
    const nome = (id: string) => nomes.rows.find((r) => r.id === id)!.nome;

    respostas.push(
      json({
        data: [
          { id: "m1", name: nome(enviado), language: "pt_BR", status: "APPROVED" },
          { id: "m2", name: nome(reprovavel), language: "pt_BR", status: "REJECTED", rejected_reason: "INVALID_FORMAT" },
          { id: "m3", name: nome(rascunho), language: "pt_BR", status: "APPROVED" },
          { id: "m4", name: nome(pausavel), language: "pt_BR", status: "PAUSED" },
        ],
      }),
    );
    await proc.sincronizarTemplates(job({ integracaoId: conta.id, lojaId: loja.id }));

    expect(urls[0]).toMatch(/^https:\/\/graph\.facebook\.com\/v23\.0\/123456789\/message_templates\?/);
    const { rows } = await banco.query<{ id: string; status: string; motivo_rejeicao: string | null; aprovado_em: Date | null; modified_by: string | null }>(
      "select id, status, motivo_rejeicao, aprovado_em, modified_by from lojas_integracoes_templates where id = any($1::uuid[])",
      [todos],
    );
    const por = (id: string) => rows.find((r) => r.id === id)!;
    expect(por(enviado)).toMatchObject({ status: "aprovado", modified_by: ATOR_SISTEMA });
    expect(por(enviado).aprovado_em).toBeInstanceOf(Date);
    expect(por(reprovavel)).toMatchObject({ status: "rejeitado", motivo_rejeicao: "INVALID_FORMAT" });
    expect(por(rascunho).status).toBe("rascunho");
    expect(por(pausavel)).toMatchObject({ status: "pausado", modified_by: ATOR_SISTEMA });
    expect(await trilhaDe(enviado)).toMatchObject([{ acao: "template_aprovado", ator_tipo: "sistema" }]);
    expect(await trilhaDe(pausavel)).toMatchObject([{ acao: "template_pausado", ator_tipo: "sistema" }]);
    expect((await linhaDaConta(conta.id)).ultima_sincronizacao).toBeInstanceOf(Date);
  });

  it("token recusado pela Meta vira status 'erro' da conta, sem retentar", async () => {
    const loja = await semearLoja();
    const conta = await semearConta({
      provedor: "whatsapp_oficial",
      lojaId: loja.id,
      credencial: { access_token: "tok-vencido", waba_id: "987654321" },
    });
    respostas.push(json({ error: {} }, 401));
    await proc.sincronizarTemplates(job({ integracaoId: conta.id, lojaId: loja.id }));
    expect(await linhaDaConta(conta.id)).toMatchObject({ status: "erro" });
  });

  it("sem carga (agendador): distribui um job por conta oficial e fecha o evento do webhook", async () => {
    const loja = await semearLoja();
    const conta = await semearConta({ provedor: "whatsapp_oficial", lojaId: loja.id });
    const { rows } = await banco.query<{ id: string }>(
      `insert into lojas_integracoes_eventos (provedor, tipo, evento_externo_id, assinatura_ok, corpo, created_at, updated_at)
       values ('whatsapp_oficial', 'recebido', $1, true, '{"cru":true}', now(), now()) returning id`,
      [`modelo-${aleatorio()}`],
    );
    await proc.sincronizarTemplates(job({ eventoId: rows[0]!.id }));
    const jobs = await fila("integracoes").getJobs(["waiting", "delayed", "prioritized"]);
    expect(jobs.some((j) => j.data.integracaoId === conta.id)).toBe(true);
    const { rows: ev } = await banco.query<{ tipo: string; corpo: unknown; processado_em: Date | null }>(
      "select tipo, corpo, processado_em from lojas_integracoes_eventos where id = $1",
      [rows[0]!.id],
    );
    expect(ev[0]).toMatchObject({ tipo: "processado", corpo: { mascarado: true, tipo: "modelo" } });
    expect(ev[0]!.processado_em).toBeInstanceOf(Date);
  });
});

describe("conferir-sessao-uazapi", () => {
  it("sessão aberta vira 'conectado' e publica a mudança", async () => {
    const loja = await semearLoja();
    const conta = await semearConta({ provedor: "uazapi", lojaId: loja.id, status: "desconectado" });
    respostas.push(json({ instance: { status: "connected" } }));
    await proc.conferirSessaoUazapi(job({ integracaoId: conta.id, lojaId: loja.id }));
    expect(urls[0]).toBe("https://uazapi.exemplo.com/instance/status");
    expect(await linhaDaConta(conta.id)).toMatchObject({ status: "conectado", ultimo_erro: null });
  });

  it("sessão caída vira 'desconectado' com o motivo; token recusado vira 'erro'", async () => {
    const loja = await semearLoja();
    const caida = await semearConta({ provedor: "uazapi", lojaId: loja.id });
    respostas.push(json({ status: "disconnected" }));
    await proc.conferirSessaoUazapi(job({ integracaoId: caida.id }));
    expect(await linhaDaConta(caida.id)).toMatchObject({ status: "desconectado" });

    const recusada = await semearConta({ provedor: "uazapi", lojaId: loja.id });
    respostas.push(json({}, 401));
    await proc.conferirSessaoUazapi(job({ integracaoId: recusada.id }));
    expect(await linhaDaConta(recusada.id)).toMatchObject({ status: "erro" });
  });

  it("falha de rede sobe para a fila retentar", async () => {
    const loja = await semearLoja();
    const conta = await semearConta({ provedor: "uazapi", lojaId: loja.id });
    respostas.push(json({}, 503));
    await expect(proc.conferirSessaoUazapi(job({ integracaoId: conta.id }))).rejects.toMatchObject({
      permanente: false,
    });
  });
});

describe("enviarModeloParaAprovacao (costura do M6)", () => {
  const oficial = async () => {
    const loja = await semearLoja();
    const conta = await semearConta({
      provedor: "whatsapp_oficial",
      lojaId: loja.id,
      credencial: { access_token: "tok-meta", waba_id: "555666777" },
    });
    return { loja, conta, ctx: contextoDe(await semearUsuario("gerente"), "gerente") };
  };
  const linha = async (id: string) =>
    (await banco.query("select * from lojas_integracoes_templates where id = $1", [id])).rows[0] as Record<string, unknown>;

  it("rascunho: cria na WABA com exemplo por variável e grava enviado com trilha da pessoa", async () => {
    const { loja, conta, ctx } = await oficial();
    const id = await semearModelo(conta.id, loja.id, `boas_vindas_${aleatorio(3)}`, "rascunho");
    respostas.push(json({ id: "778899", status: "PENDING", category: "MARKETING" }));

    const r = await enviarModeloParaAprovacao(ctx, id);

    expect(r).toEqual({ templateId: id, externoId: "778899", status: "enviado" });
    expect(urls[0]).toBe("https://graph.facebook.com/v23.0/555666777/message_templates");
    expect(corpos[0]).toMatchObject({
      language: "pt_BR",
      category: "MARKETING",
      components: [{ type: "BODY", text: "Olá {{1}}", example: { body_text: [["exemplo 1"]] } }],
    });
    expect(await linha(id)).toMatchObject({ status: "enviado", meta_template_id: "778899", modified_by: ctx.autorId });
    expect((await linha(id)).enviado_em).toBeInstanceOf(Date);
    expect(await trilhaDe(id)).toMatchObject([{ acao: "template_enviado", ator_tipo: "usuario", ator_id: ctx.autorId }]);
  });

  it("rejeitado com id da Meta: edita o que está lá e limpa o motivo", async () => {
    const { loja, conta, ctx } = await oficial();
    const id = await semearModelo(conta.id, loja.id, `cupom_${aleatorio(3)}`, "rejeitado");
    await banco.query(
      "update lojas_integracoes_templates set meta_template_id = '4455', motivo_rejeicao = 'INVALID_FORMAT' where id = $1",
      [id],
    );
    respostas.push(json({ success: true }));

    expect(await enviarModeloParaAprovacao(ctx, id)).toMatchObject({ externoId: "4455", status: "enviado" });
    expect(urls[0]).toBe("https://graph.facebook.com/v23.0/4455");
    expect(await linha(id)).toMatchObject({ status: "enviado", motivo_rejeicao: null });
  });

  it("outra loja é 404 e modelo já com a Meta é recusado, sem chamar a Meta", async () => {
    const { loja, conta, ctx } = await oficial();
    const outra = await semearLoja();
    const rascunho = await semearModelo(conta.id, loja.id, `x_${aleatorio(3)}`, "rascunho");
    await expect(
      enviarModeloParaAprovacao({ ...ctx, escopo: { tipo: "uma", lojaId: outra.id } }, rascunho),
    ).rejects.toMatchObject({ codigo: "NAO_ENCONTRADO" });
    const aprovado = await semearModelo(conta.id, loja.id, `y_${aleatorio(3)}`, "aprovado");
    await expect(enviarModeloParaAprovacao(ctx, aprovado)).rejects.toMatchObject({ codigo: "VALIDACAO" });
    expect(urls).toHaveLength(0);
  });

  it("Meta recusa o modelo: erro permanente com o motivo dela e nada gravado", async () => {
    const { loja, conta, ctx } = await oficial();
    const id = await semearModelo(conta.id, loja.id, `promo_${aleatorio(3)}`, "rascunho");
    respostas.push(json({ error: { message: "Invalid parameter", error_user_msg: "Nome já usado." } }, 400));

    await expect(enviarModeloParaAprovacao(ctx, id)).rejects.toMatchObject({
      codigo: "INTEGRACAO",
      permanente: true,
      message: "A Meta recusou o pedido: Nome já usado.",
    });
    expect(await linha(id)).toMatchObject({ status: "rascunho", meta_template_id: null });
    expect(await trilhaDe(id)).toHaveLength(0);
  });

  it("componentes: cabeçalho de texto, rodapé e botões; mídia e OTP recusados", () => {
    const base = { categoria: "utility", cabecalhoTipo: "texto", cabecalho: "Oi {{1}}", corpo: "Pedido {{1}}", rodape: "Merlo", variaveisContagem: 1 };
    const botoes = [
      { tipo: "url" as const, texto: "Ver", valor: "https://merlo.exemplo.com" },
      { tipo: "resposta_rapida" as const, texto: "Sair" },
    ];
    expect(componentesDoModelo({ ...base, botoes }).map((c) => c.type)).toEqual(["HEADER", "BODY", "FOOTER", "BUTTONS"]);
    expect(componentesDoModelo({ ...base, botoes })[0]).toMatchObject({ example: { header_text: ["exemplo 1"] } });
    expect(() => componentesDoModelo({ ...base, botoes: [], cabecalhoTipo: "imagem" })).toThrow(/mídia/);
    expect(() => componentesDoModelo({ ...base, botoes: [], categoria: "authentication" })).toThrow();
  });
});
