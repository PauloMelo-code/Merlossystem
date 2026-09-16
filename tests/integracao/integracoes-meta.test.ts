import { createHmac } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Webhooks da Meta ponta a ponta (03-arquitetura.md §11; 02-seguranca.md §12).
 *
 * O ambiente de teste NÃO define `META_APP_SECRET` (é o que prova, em T15, que
 * a ausência RECUSA). Aqui o ambiente é estendido só neste arquivo.
 */

const SEGREDO_APP = "segredo-do-app-meta-de-teste-0123456789abcdef";
const TOKEN_WA = "token-de-challenge-do-whatsapp-0123456789";
const TOKEN_IG = "token-de-challenge-do-instagram-012345678";

vi.mock("@/lib/env", async (original) => {
  const mod = await original<typeof import("@/lib/env")>();
  return {
    ...mod,
    env: {
      ...mod.env,
      META_APP_SECRET: SEGREDO_APP,
      META_GRAPH_VERSION: "v23.0",
      WHATSAPP_VERIFY_TOKEN: TOKEN_WA,
      INSTAGRAM_VERIFY_TOKEN: TOKEN_IG,
    },
  };
});

const { webhookInstagram, webhookWhatsapp } = await import("@/lib/integracoes/roteamento");
const { fecharFilas, fila } = await import("@/lib/fila/filas");
const { redisDoLimitador } = await import("@/lib/seguranca/limite");
const { aleatorio, banco, eventosDa, semearConta, semearLoja } = await import("./integracoes-apoio");

const BASE = "http://localhost:3015/api/webhooks";

function assinar(corpo: string): string {
  return `sha256=${createHmac("sha256", SEGREDO_APP).update(corpo, "utf8").digest("hex")}`;
}

function postar(canal: string, corpo: string, assinatura: string | null = assinar(corpo)): Request {
  return new Request(`${BASE}/${canal}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(assinatura ? { "x-hub-signature-256": assinatura } : {}),
    },
    body: corpo,
  });
}

function loteWhatsapp(entradas: { telefoneId: string; wamid: string }[]): string {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: entradas.map((e) => ({
      id: "WABA",
      changes: [
        {
          field: "messages",
          value: {
            metadata: { phone_number_id: e.telefoneId },
            messages: [{ id: e.wamid, type: "text", text: { body: "oi" } }],
          },
        },
      ],
    })),
  });
}

beforeEach(async () => {
  await redisDoLimitador().flushdb().catch(() => undefined);
});

afterAll(async () => {
  await fecharFilas();
  await redisDoLimitador().quit().catch(() => undefined);
  await banco.end().catch(() => undefined);
});

describe("webhook do WhatsApp oficial", () => {
  it("lote com DUAS contas é agrupado por conta, cada uma na sua loja", async () => {
    const [lojaA, lojaB] = [await semearLoja(), await semearLoja()];
    const contaA = await semearConta({ provedor: "whatsapp_oficial", lojaId: lojaA.id });
    const contaB = await semearConta({ provedor: "whatsapp_oficial", lojaId: lojaB.id });
    const corpo = loteWhatsapp([
      { telefoneId: contaA.referencia, wamid: `wamid.${aleatorio()}` },
      { telefoneId: contaB.referencia, wamid: `wamid.${aleatorio()}` },
    ]);
    const r = await webhookWhatsapp(postar("whatsapp", corpo));
    expect(r.status).toBe(200);

    const [a] = await eventosDa(contaA.id);
    const [b] = await eventosDa(contaB.id);
    expect(a?.tipo).toBe("recebido");
    expect(b?.tipo).toBe("recebido");
    const { rows } = await banco.query<{ loja_id: string }>(
      "select loja_id from lojas_integracoes_eventos where id = any($1::uuid[]) order by loja_id",
      [[a!.id, b!.id]],
    );
    expect(rows.map((l) => l.loja_id).sort()).toEqual([lojaA.id, lojaB.id].sort());
    expect(await fila("mensagens-entrada").getJob(`evento-${a!.id}`)).toBeDefined();
    expect(await fila("mensagens-entrada").getJob(`evento-${b!.id}`)).toBeDefined();
  });

  it("assinatura forjada: 401 sem corpo e NENHUMA linha", async () => {
    const loja = await semearLoja();
    const conta = await semearConta({ provedor: "whatsapp_oficial", lojaId: loja.id });
    const corpo = loteWhatsapp([{ telefoneId: conta.referencia, wamid: `wamid.${aleatorio()}` }]);
    const forjada = await webhookWhatsapp(postar("whatsapp", corpo, `sha256=${"0".repeat(64)}`));
    const semAssinatura = await webhookWhatsapp(postar("whatsapp", corpo, null));
    expect([forjada.status, semAssinatura.status]).toEqual([401, 401]);
    expect(await forjada.text()).toBe("");
    expect(await eventosDa(conta.id)).toEqual([]);
  });

  it("conta desconhecida: 200 e linha 'recusado', sem job e sem loja chutada", async () => {
    const wamid = `wamid.${aleatorio()}`;
    const r = await webhookWhatsapp(postar("whatsapp", loteWhatsapp([{ telefoneId: "nao-cadastrado", wamid }])));
    expect(r.status).toBe(200);
    const { rows } = await banco.query<{ id: string; tipo: string; loja_id: string | null; erro: string }>(
      "select id, tipo, loja_id, erro from lojas_integracoes_eventos where evento_externo_id = $1",
      [`msg-${wamid}`],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tipo: "recusado", loja_id: null });
    expect(await fila("mensagens-entrada").getJob(`evento-${rows[0]!.id}`)).toBeUndefined();
  });

  it("status de modelo dispara a sincronização de modelos", async () => {
    const corpo = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA",
          changes: [
            {
              field: "message_template_status_update",
              value: { event: "APPROVED", message_template_id: aleatorio(), message_template_name: "oferta" },
            },
          ],
        },
      ],
    });
    expect((await webhookWhatsapp(postar("whatsapp", corpo))).status).toBe(200);
    const { rows } = await banco.query<{ id: string }>(
      "select id from lojas_integracoes_eventos where corpo::text like $1",
      [`%${JSON.parse(corpo).entry[0].changes[0].value.message_template_id}%`],
    );
    const job = await fila("integracoes").getJob(`modelos-${rows[0]!.id}`);
    expect(job?.name).toBe("sincronizar-templates");
  });

  it("GET de verificação: token do canal certo ecoa o desafio; o do outro canal é recusado", async () => {
    const url = (token: string) =>
      new Request(`${BASE}/whatsapp?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=12345`);
    const certo = await webhookWhatsapp(url(TOKEN_WA));
    expect(certo.status).toBe(200);
    expect(await certo.text()).toBe("12345");
    expect((await webhookWhatsapp(url(TOKEN_IG))).status).toBe(403);
    expect((await webhookInstagram(url(TOKEN_WA))).status).toBe(403);
  });
});

describe("webhook do Instagram", () => {
  it("a conta é o entry.id; a mesma mensagem entregue duas vezes vira uma linha", async () => {
    const loja = await semearLoja();
    const conta = await semearConta({ provedor: "instagram", lojaId: loja.id });
    const corpo = JSON.stringify({
      object: "instagram",
      entry: [{ id: conta.referencia, messaging: [{ sender: { id: "u" }, message: { mid: `m-${aleatorio()}` } }] }],
    });
    expect((await webhookInstagram(postar("instagram", corpo))).status).toBe(200);
    expect((await webhookInstagram(postar("instagram", corpo))).status).toBe(200);
    expect(await eventosDa(conta.id)).toHaveLength(1);
  });

  it("conta de WhatsApp com a mesma referência não recebe evento do Instagram", async () => {
    const loja = await semearLoja();
    const oficial = await semearConta({ provedor: "whatsapp_oficial", lojaId: loja.id });
    const corpo = JSON.stringify({
      object: "instagram",
      entry: [{ id: oficial.referencia, messaging: [{ message: { mid: `m-${aleatorio()}` } }] }],
    });
    expect((await webhookInstagram(postar("instagram", corpo))).status).toBe(200);
    expect(await eventosDa(oficial.id)).toEqual([]);
  });
});
