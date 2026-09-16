import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * OAuth do Bling (02-seguranca.md §12, D-11) — o fluxo de M5 por cima do
 * `state` da fundação (T16): cookie, dono do `state`, uso único, troca do
 * código só no servidor, credencial só no cofre, e o refresh sob trava.
 *
 * A rede é falsa: `fetch` e DNS são substituídos, e o destino continua
 * passando pela allowlist de `buscarExterno`.
 */

vi.mock("@/lib/env", async (original) => {
  const mod = await original<typeof import("@/lib/env")>();
  return {
    ...mod,
    env: {
      ...mod.env,
      BLING_CLIENT_ID: "cliente-de-teste",
      BLING_CLIENT_SECRET: "segredo-do-cliente-de-teste",
      BLING_REDIRECT_URI: "http://localhost:3015/api/integracoes/bling/callback",
    },
  };
});

vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: "203.0.113.10", family: 4 }],
}));

type Chamada = { url: string; corpo: string; autorizacao: string | null };
const chamadas: Chamada[] = [];
const respostas: Response[] = [];

vi.stubGlobal("fetch", async (url: URL | string, init: RequestInit = {}) => {
  const cabecalhos = new Headers(init.headers);
  chamadas.push({ url: String(url), corpo: String(init.body ?? ""), autorizacao: cabecalhos.get("authorization") });
  return respostas.shift() ?? new Response("{}", { status: 500 });
});

const { assinarEstado } = await import("@/lib/seguranca/assinaturas");
const { cifrar } = await import("@/lib/seguranca/cofre");
const { fecharFilas, fila } = await import("@/lib/fila/filas");
const { redisDoLimitador } = await import("@/lib/seguranca/limite");
const oauth = await import("@/lib/integracoes/oauth");
const { banco, contextoDe, linhaDaConta, semearUsuario } = await import("./integracoes-apoio");

const tokens = (sufixo: string) =>
  new Response(
    JSON.stringify({ access_token: `acesso-${sufixo}`, refresh_token: `renova-${sufixo}`, expires_in: 21600 }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

let admin: string;
let outro: string;

beforeAll(async () => {
  admin = await semearUsuario("admin");
  outro = await semearUsuario("admin");
});

beforeEach(async () => {
  chamadas.length = 0;
  respostas.length = 0;
  await redisDoLimitador().flushdb().catch(() => undefined);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await fecharFilas();
  await redisDoLimitador().quit().catch(() => undefined);
  await banco.end().catch(() => undefined);
});

function entrada(usuarioId: string, state: string, nonceDoCookie: string | null) {
  const ctx = contextoDe(usuarioId);
  return { sessao: ctx.sessao, ctx, code: "codigo-do-bling", state, nonceDoCookie };
}

describe("início da autorização", () => {
  it("URL do Bling com client_id, redirect fixo e state assinado; nada de segredo", () => {
    const { url, nonce } = oauth.iniciarAutorizacaoBling(contextoDe(admin).sessao);
    const u = new URL(url);
    expect(u.host).toBe("www.bling.com.br");
    expect(u.searchParams.get("client_id")).toBe("cliente-de-teste");
    expect(u.searchParams.get("redirect_uri")).toBe("http://localhost:3015/api/integracoes/bling/callback");
    expect(u.searchParams.get("state")).toContain(nonce);
    expect(url).not.toContain("segredo-do-cliente");
  });
});

describe("retorno recusado — sempre a mesma recusa, sem tocar no Bling", () => {
  it.each([
    ["cookie ausente", () => ({ ...assinarEstado(admin), cookie: null as string | null, dono: admin })],
    ["cookie de outro fluxo", () => ({ ...assinarEstado(admin), cookie: "outro-nonce", dono: admin })],
    ["state de outra sessão", () => {
      const e = assinarEstado(admin);
      return { ...e, cookie: e.nonce, dono: outro };
    }],
    ["state expirado", () => {
      const e = assinarEstado(admin, Date.now() - 10 * 60 * 1000);
      return { ...e, cookie: e.nonce, dono: admin };
    }],
    ["state adulterado", () => {
      const e = assinarEstado(admin);
      return { state: `${e.state.slice(0, -2)}00`, nonce: e.nonce, cookie: e.nonce, dono: admin };
    }],
  ])("%s", async (_nome, montar) => {
    const caso = montar();
    await expect(oauth.concluirAutorizacaoBling(entrada(caso.dono, caso.state, caso.cookie))).rejects.toBeInstanceOf(
      oauth.ErroDeOAuth,
    );
    expect(chamadas).toHaveLength(0);
  });
});

describe("retorno aceito", () => {
  it("troca o código com Basic, guarda só no cofre, conta de rede e sincroniza; state reusado é recusado", async () => {
    const { state, nonce } = assinarEstado(admin);
    respostas.push(tokens("um"));
    const { integracaoId } = await oauth.concluirAutorizacaoBling(entrada(admin, state, nonce));

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]!.url).toBe("https://www.bling.com.br/Api/v3/oauth/token");
    expect(chamadas[0]!.autorizacao).toBe(
      `Basic ${Buffer.from("cliente-de-teste:segredo-do-cliente-de-teste").toString("base64")}`,
    );
    expect(chamadas[0]!.corpo).toContain("grant_type=authorization_code");
    expect(chamadas[0]!.corpo).not.toContain("segredo-do-cliente");

    const linha = await linhaDaConta(integracaoId);
    expect(linha).toMatchObject({ provedor: "bling", loja_id: null, status: "conectado", credenciais_aad: integracaoId });
    expect(String(linha.credenciais_cifradas)).not.toContain("acesso-um");
    expect(linha.expira_em).toBeInstanceOf(Date);

    const jobs = await fila("integracoes").getJobs(["waiting", "delayed", "prioritized"]);
    expect(jobs.some((j) => j.name === "sincronizar-bling" && j.data.integracaoId === integracaoId)).toBe(true);

    // Reuso do MESMO state (e do mesmo cookie): recusado antes da rede.
    await expect(oauth.concluirAutorizacaoBling(entrada(admin, state, nonce))).rejects.toBeInstanceOf(
      oauth.ErroDeOAuth,
    );
    expect(chamadas).toHaveLength(1);

    // Reconectar atualiza a MESMA conta de rede.
    const segundo = assinarEstado(admin);
    respostas.push(tokens("dois"));
    const outraVez = await oauth.concluirAutorizacaoBling(entrada(admin, segundo.state, segundo.nonce));
    expect(outraVez.integracaoId).toBe(integracaoId);
    const { rows } = await banco.query<{ n: string }>(
      "select count(*)::text as n from lojas_integracoes where provedor = 'bling' and is_deleted = false",
    );
    expect(rows[0]!.n).toBe("1");
  });

  it("Bling recusando o código não grava nada", async () => {
    const { state, nonce } = assinarEstado(admin);
    respostas.push(new Response('{"error":"invalid_grant"}', { status: 400 }));
    await expect(oauth.concluirAutorizacaoBling(entrada(admin, state, nonce))).rejects.toMatchObject({
      codigo: "INTEGRACAO",
      permanente: true,
    });
  });
});

describe("renovar token", () => {
  async function contaDeRede(): Promise<string> {
    const { rows } = await banco.query<{ id: string }>(
      "select id from lojas_integracoes where provedor = 'bling' and is_deleted = false limit 1",
    );
    if (rows[0]) return rows[0].id;
    const { state, nonce } = assinarEstado(admin);
    respostas.push(tokens("base"));
    return (await oauth.concluirAutorizacaoBling(entrada(admin, state, nonce))).integracaoId;
  }

  it("gira o refresh e guarda o par novo cifrado", async () => {
    const id = await contaDeRede();
    await banco.query("update lojas_integracoes set credenciais_cifradas = $1, status = 'conectado' where id = $2", [
      cifrar(JSON.stringify({ access_token: "velho", refresh_token: "refresh-velho" }), id),
      id,
    ]);
    chamadas.length = 0;
    respostas.push(tokens("novo"));
    expect(await oauth.renovarTokenBling(id)).toBe("renovado");
    expect(chamadas[0]!.corpo).toContain("grant_type=refresh_token");
    expect(chamadas[0]!.corpo).toContain("refresh_token=refresh-velho");
    expect((await linhaDaConta(id)).status).toBe("conectado");
  });

  it("refresh recusado marca a conta como expirada, com o motivo", async () => {
    const id = await contaDeRede();
    respostas.push(new Response("{}", { status: 400 }));
    expect(await oauth.renovarTokenBling(id)).toBe("expirado");
    const linha = await linhaDaConta(id);
    expect(linha.status).toBe("expirado");
    expect(String(linha.ultimo_erro)).toMatch(/Bling recusou/);
  });

  it("conta que não é do Bling é ignorada", async () => {
    expect(await oauth.renovarTokenBling("7f000000-0000-4000-8000-0000000000aa")).toBe("ignorado");
  });
});
