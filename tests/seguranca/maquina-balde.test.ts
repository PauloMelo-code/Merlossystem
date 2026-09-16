import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { conferirSegredoPorHash, hashDeSegredo } from "@/lib/seguranca/assinaturas";
import { rotaDeMaquina, type ConfigMaquina } from "@/lib/seguranca/maquina";
import { redisDoLimitador, type Regra } from "@/lib/seguranca/limite";

/**
 * REQ-I4 — o teto por integração conta SÓ requisição autenticada
 * (02-seguranca.md §12). O id da integração é público (vai na URL): um balde
 * contado antes da assinatura deixaria qualquer um calar a conta com POST sem
 * assinatura. Inclui o caso T-PG-24 do pacote de pagamentos.
 */

const URL_BASE = "http://localhost:3005/api/webhooks/prova";
const SEGREDO = "segredo-de-prova-sem-valor-real-02";
const HASH = hashDeSegredo(SEGREDO);
/** Teto por IP alto: aqui só o balde por integração está em prova. */
const IP_FOLGADO: Regra = { janela: 60, max: 100_000 };

type Integracao = { id: string; hash: string };
const banco = new Map<string, Integracao>([["conta-1", { id: "conta-1", hash: HASH }]]);

function montar(extra: Partial<ConfigMaquina<Integracao>> = {}) {
  const espiao = { processou: 0, verificou: 0 };
  const tratar = rotaDeMaquina<Integracao>({
    provedor: "prova-balde",
    limiteIp: IP_FOLGADO,
    chave: (req) => new URL(req.url).pathname.split("/").pop() ?? null,
    carregar: async (chave) => banco.get(chave) ?? null,
    conferir: (_corpo, req, integracao) =>
      conferirSegredoPorHash(req.headers.get("x-prova-secret"), integracao?.hash ?? null),
    processar: async () => {
      espiao.processou += 1;
      return new Response(null, { status: 200 });
    },
    verificar: () => {
      espiao.verificou += 1;
      return new Response("desafio", { status: 200 });
    },
    ...extra,
  });
  return { tratar, espiao };
}

function postar(assinado: boolean): Request {
  return new Request(`${URL_BASE}/conta-1`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(assinado ? { "x-prova-secret": SEGREDO } : {}) },
    body: "{}",
  });
}

function obter(): Request {
  return new Request(`${URL_BASE}/conta-1?hub.challenge=1`, { method: "GET" });
}

async function emLotes(total: number, fazer: () => Promise<Response>): Promise<Response[]> {
  const respostas: Response[] = [];
  for (let feitos = 0; feitos < total; feitos += 50) {
    const lote = Array.from({ length: Math.min(50, total - feitos) }, fazer);
    respostas.push(...(await Promise.all(lote)));
  }
  return respostas;
}

beforeEach(async () => {
  await redisDoLimitador().flushdb().catch(() => undefined);
});

afterAll(async () => {
  await redisDoLimitador().quit().catch(() => undefined);
});

describe("REQ-I4: balde por integração só depois da assinatura", () => {
  it("301 POSTs sem assinatura (lotes de 50) não bloqueiam a integração", async () => {
    const { tratar, espiao } = montar();
    const recusas = await emLotes(301, () => tratar(postar(false)));
    expect(recusas.every((r) => r.status === 401)).toBe(true);
    const r = await tratar(postar(true));
    expect(r.status).toBe(200);
    expect(espiao.processou).toBe(1);
  }, 120_000);

  it("requisição autenticada ainda conta no balde", async () => {
    const { tratar } = montar({ limiteIntegracao: { janela: 60, max: 3 } });
    const status: number[] = [];
    for (let i = 0; i < 4; i += 1) status.push((await tratar(postar(true))).status);
    expect(status).toEqual([200, 200, 200, 429]);
  });

  it("limiteIntegracao: null desliga o balde", async () => {
    const { tratar } = montar({ limiteIntegracao: null });
    const status: number[] = [];
    for (let i = 0; i < 4; i += 1) status.push((await tratar(postar(true))).status);
    expect(status).toEqual([200, 200, 200, 200]);
  });

  it("GET de challenge não consome o balde por integração", async () => {
    const { tratar, espiao } = montar({ limiteIntegracao: { janela: 60, max: 1 } });
    for (let i = 0; i < 3; i += 1) expect((await tratar(obter())).status).toBe(200);
    expect(espiao.verificou).toBe(3);
    expect((await tratar(postar(true))).status).toBe(200);
  });

  it("T-PG-24: 300 GETs e 300 POSTs sem assinatura, depois o assinado passa e o 6º estoura", async () => {
    const { tratar } = montar({ limiteIntegracao: { janela: 60, max: 5 } });
    await emLotes(300, () => tratar(obter()));
    await emLotes(300, () => tratar(postar(false)));
    const status: number[] = [];
    for (let i = 0; i < 6; i += 1) status.push((await tratar(postar(true))).status);
    expect(status).toEqual([200, 200, 200, 200, 200, 429]);
  }, 120_000);
});
