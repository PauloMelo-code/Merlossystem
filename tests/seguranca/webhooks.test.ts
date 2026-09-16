import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  conferirAssinaturaMeta,
  conferirSegredoPorHash,
  hashDeSegredo,
} from "@/lib/seguranca/assinaturas";
import { TETO_WEBHOOK } from "@/lib/seguranca/corpo";
import { rotaDeMaquina } from "@/lib/seguranca/maquina";
import { redisDoLimitador } from "@/lib/seguranca/limite";
import { arquivosDe, lerFonte } from "./_fonte";

/**
 * T15 — superficie de maquina (02-seguranca.md §12, 03-arquitetura.md §11).
 *
 * Este arquivo prova o WRAPPER, que e da fundacao: ordem fixa, isonomia da
 * recusa, teto de corpo e "nenhum JSON.parse antes de autenticar". O pacote de
 * integracoes (M5) completa com os tres webhooks de verdade — WhatsApp,
 * Instagram e uazapi — e com a idempotencia por id de evento.
 */

const URL_BASE = "http://localhost:3005/api/webhooks/uazapi";
const SEGREDO = "segredo-de-prova-sem-valor-real-01";
const HASH = hashDeSegredo(SEGREDO);

type Integracao = { id: string; hash: string };

/** O que M5 vai montar de verdade; aqui e memoria, para provar a ORDEM. */
const banco = new Map<string, Integracao>([["viva", { id: "viva", hash: HASH }]]);

const espiao = { carregou: 0, processou: 0 };

function montar() {
  espiao.carregou = 0;
  espiao.processou = 0;
  return rotaDeMaquina<Integracao>({
    provedor: "uazapi",
    chave: (req) => new URL(req.url).pathname.split("/").pop() ?? null,
    carregar: async (chave) => {
      espiao.carregou += 1;
      return banco.get(chave) ?? null;
    },
    // O segredo so vem de CABECALHO, e o corpo chega CRU (nunca parseado).
    conferir: (_corpoCru, req, integracao) =>
      conferirSegredoPorHash(req.headers.get("x-uazapi-secret"), integracao?.hash ?? null),
    processar: async ({ corpoCru }) => {
      espiao.processou += 1;
      // O primeiro JSON.parse do fluxo esta AQUI, depois de autenticar.
      JSON.parse(corpoCru);
      return new Response(null, { status: 200 });
    },
  });
}

function postar(
  caminho: string,
  corpo: string,
  cabecalhos: Record<string, string> = {},
): Request {
  return new Request(`${URL_BASE}/${caminho}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...cabecalhos },
    body: corpo,
  });
}

beforeEach(async () => {
  await redisDoLimitador().flushdb().catch(() => undefined);
});

afterAll(async () => {
  await redisDoLimitador().quit().catch(() => undefined);
});

describe("T15 isonomia da recusa de maquina", () => {
  it("integracao inexistente, revogada e assinatura invalida respondem IGUAL", async () => {
    const tratar = montar();
    const respostas = await Promise.all([
      tratar(postar("nao-existe", "{}", { "x-uazapi-secret": SEGREDO })),
      tratar(postar("viva", "{}", { "x-uazapi-secret": "segredo-errado" })),
      tratar(postar("viva", "{}")),
    ]);
    for (const r of respostas) {
      expect(r.status).toBe(401);
      expect(await r.text()).toBe("");
      expect(r.headers.get("cache-control")).toBe("no-store");
      // Nenhum motivo vaza: sem `reason`, sem WWW-Authenticate.
      expect(r.headers.get("www-authenticate")).toBeNull();
    }
  });

  it("a recusa custa o mesmo piso de tempo das duas pontas", async () => {
    const tratar = montar();
    const marcar = async (caminho: string) => {
      const inicio = Date.now();
      await tratar(postar(caminho, "{}", { "x-uazapi-secret": "errado" }));
      return Date.now() - inicio;
    };
    const inexistente = await marcar("nao-existe");
    const invalida = await marcar("viva");
    expect(inexistente).toBeGreaterThanOrEqual(300);
    expect(Math.abs(inexistente - invalida)).toBeLessThan(200);
  });
});

describe("T15 ordem fixa: nada antes de autenticar", () => {
  it("corpo malformado ainda chega a conferencia, e ela recusa sem parsear", async () => {
    const tratar = montar();
    const r = await tratar(postar("viva", "isto nao e json", { "x-uazapi-secret": "errado" }));
    expect(r.status).toBe(401);
    expect(espiao.processou).toBe(0);
  });

  it("segredo na query string nunca e lido: recusa antes de tocar o banco (D-10/I15)", async () => {
    const tratar = montar();
    const req = new Request(`${URL_BASE}/viva?segredo=${SEGREDO}`, {
      method: "POST",
      body: "{}",
    });
    const r = await tratar(req);
    expect(r.status).toBe(401);
    expect(espiao.carregou).toBe(0);
  });

  it("corpo acima do teto responde 413 sem carregar integracao", async () => {
    const tratar = montar();
    const grande = JSON.stringify({ lixo: "x".repeat(TETO_WEBHOOK + 1_000) });
    const r = await tratar(postar("viva", grande, { "x-uazapi-secret": SEGREDO }));
    expect(r.status).toBe(413);
    expect(espiao.carregou).toBe(0);
  });

  it("assinatura valida chega ao processamento e responde 200", async () => {
    const tratar = montar();
    const r = await tratar(postar("viva", '{"ok":true}', { "x-uazapi-secret": SEGREDO }));
    expect(r.status).toBe(200);
    expect(espiao.processou).toBe(1);
  });

  it("falha ao persistir devolve 500, para o provedor reentregar", async () => {
    const tratar = rotaDeMaquina<Integracao>({
      provedor: "uazapi",
      chave: () => "viva",
      carregar: async () => banco.get("viva") ?? null,
      conferir: (_c, req, i) =>
        conferirSegredoPorHash(req.headers.get("x-uazapi-secret"), i?.hash ?? null),
      processar: async () => {
        throw new Error("banco fora");
      },
    });
    const r = await tratar(postar("viva", "{}", { "x-uazapi-secret": SEGREDO }));
    expect(r.status).toBe(500);
  });
});

describe("T15 assinaturas", () => {
  it("sem META_APP_SECRET no ambiente, o HMAC do Meta RECUSA (INV-43)", () => {
    // Nunca "aceita porque nao configurou". O ambiente de teste nao define o
    // segredo, entao esta e a prova do caminho de configuracao faltando.
    expect(conferirAssinaturaMeta('{"entry":[]}', "sha256=qualquer")).toBe(false);
    expect(conferirAssinaturaMeta('{"entry":[]}', null)).toBe(false);
  });

  it("segredo por integracao: hash gravado ausente nunca autentica", () => {
    expect(conferirSegredoPorHash(SEGREDO, null)).toBe(false);
    expect(conferirSegredoPorHash(null, HASH)).toBe(false);
    expect(conferirSegredoPorHash(SEGREDO, HASH)).toBe(true);
  });
});

describe("T15 fonte: canal humano e canal de maquina nao se misturam", () => {
  it("maquina.ts nao le cookie, authorization nem identidade de cabecalho", () => {
    const fonte = lerFonte("src/lib/seguranca/maquina.ts");
    expect(fonte).not.toMatch(/get\("(cookie|authorization|x-user-id|x-loja-id|x-roles)"\)/);
  });

  it("nenhum handler de src le identidade de cabecalho (I13)", () => {
    const proibido = /["'](x-user-id|x-loja-id|x-roles)["']/;
    const achados = arquivosDe("src", [".ts", ".tsx"]).filter((f) => proibido.test(lerFonte(f)));
    expect(achados).toEqual([]);
  });
});
