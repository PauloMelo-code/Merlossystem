import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Sessao } from "@/lib/auth/guard";
import { banco, criarLoja, criarUsuarioComSessao, fecharBanco } from "./conversas-apoio";

/**
 * Tempo real (03-arquitetura.md §9), pacote M1:
 *   - desativar a conta com o stream aberto fecha em ≤ 30 s (heartbeat de 25 s
 *     + reavaliação); aqui o intervalo é encurtado e o limite provado à parte;
 *   - `usuario:<id>:revogar` fecha na hora;
 *   - teto POR USUÁRIO antes do teto GLOBAL;
 *   - fan-out por loja: evento de outra loja não chega.
 */

// Teto global baixo ANTES de qualquer import carregar `env.ts`.
vi.hoisted(() => {
  process.env.EVENTOS_MAX_CONEXOES = "3";
});

type Sse = typeof import("@/server/sse");
let sse: Sse;
let motivo: typeof import("@/lib/conversas").motivoParaFecharFluxo;
let revogar: typeof import("@/lib/tempo-real/publicar").revogarSessoes;
let fechar: () => Promise<void>;
let lojaId: string;

beforeAll(async () => {
  sse = await import("@/server/sse");
  motivo = (await import("@/lib/conversas")).motivoParaFecharFluxo;
  revogar = (await import("@/lib/tempo-real/publicar")).revogarSessoes;
  const conexao = await import("@/lib/fila/conexao");
  fechar = async () => {
    await conexao.fecharConexoes();
    await conexao.redisDoLimitador().quit().catch(() => undefined);
  };
  lojaId = await criarLoja();
});

afterAll(async () => {
  await fechar();
  await fecharBanco();
});

function sessaoDe(usuarioId: string, sessaoId: string, papel: Sessao["papel"] = "vendedor"): Sessao {
  return {
    usuarioId,
    sessaoId,
    papel,
    lojaId: papel === "vendedor" ? lojaId : null,
    ativo: true,
    precisaTrocarSenha: false,
    precisaConfigurarFator: false,
  };
}

type Aberto = { resposta: Response; texto: () => string; fechado: Promise<number>; abortar: () => void };

function abrir(sessao: Sessao, intervaloMs = 60_000, reavaliar?: () => Promise<string | null>): Aberto {
  const controle = new AbortController();
  const req = new Request("http://localhost/api/eventos", { signal: controle.signal });
  const inicio = Date.now();
  const resposta = sse.abrirFluxo(req, sessao, {
    escopo: sessao.lojaId ? { tipo: "uma", lojaId: sessao.lojaId } : { tipo: "todas" },
    reavaliar: reavaliar ?? (() => motivo(sessao, new Date(inicio))),
    intervaloMs,
  });
  let acumulado = "";
  const fechado = (async () => {
    if (!resposta.body) return Date.now() - inicio;
    const leitor = resposta.body.getReader();
    const decodificador = new TextDecoder();
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      acumulado += decodificador.decode(value);
    }
    return Date.now() - inicio;
  })();
  return { resposta, texto: () => acumulado, fechado, abortar: () => controle.abort() };
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("SSE", () => {
  it("abre com os cabeçalhos certos e o heartbeat é de 25 s (≤ 30 s)", async () => {
    const { usuarioId, sessaoId } = await criarUsuarioComSessao(lojaId);
    const a = abrir(sessaoDe(usuarioId, sessaoId));
    expect(a.resposta.status).toBe(200);
    expect(a.resposta.headers.get("content-type")).toContain("text/event-stream");
    expect(a.resposta.headers.get("cache-control")).toBe("no-store");
    expect(a.resposta.headers.get("x-accel-buffering")).toBe("no");
    expect(sse.HEARTBEAT_MS).toBe(25_000);
    expect(sse.HEARTBEAT_MS).toBeLessThanOrEqual(30_000);
    a.abortar();
    await a.fechado;
  });

  it("desativar a conta com o stream aberto fecha no heartbeat seguinte", async () => {
    const { usuarioId, sessaoId } = await criarUsuarioComSessao(lojaId);
    const a = abrir(sessaoDe(usuarioId, sessaoId), 100);
    await esperar(150);
    expect(sse.conexoesAbertas().doUsuario(usuarioId)).toBe(1);
    await banco.query("update usuarios set ativo = false where id = $1", [usuarioId]);
    const duracao = await a.fechado;
    expect(duracao).toBeLessThan(2_000);
    expect(a.texto()).toContain("event: sessao-invalidada");
    expect(a.texto()).toContain("conta_desativada");
    expect(sse.conexoesAbertas().doUsuario(usuarioId)).toBe(0);
  });

  it("papel trocado também fecha", async () => {
    const { usuarioId, sessaoId } = await criarUsuarioComSessao(lojaId);
    const a = abrir(sessaoDe(usuarioId, sessaoId), 100);
    await banco.query("update usuarios set papel = 'viewer' where id = $1", [usuarioId]);
    await a.fechado;
    expect(a.texto()).toContain("papel_alterado");
  });

  it("`usuario:<id>:revogar` fecha na hora", async () => {
    const { usuarioId, sessaoId } = await criarUsuarioComSessao(lojaId);
    const a = abrir(sessaoDe(usuarioId, sessaoId));
    await esperar(400); // o assinante único termina o PSUBSCRIBE
    const antes = Date.now();
    revogar(usuarioId, "sessoes_encerradas");
    await a.fechado;
    expect(Date.now() - antes).toBeLessThan(2_000);
    expect(a.texto()).toContain("sessoes_encerradas");
  });

  it("teto por usuário ANTES do global: a aba mais antiga cai e a nova entra", async () => {
    const { usuarioId, sessaoId } = await criarUsuarioComSessao(lojaId);
    const s = sessaoDe(usuarioId, sessaoId);
    const semReavaliar = async () => null;
    const abas = [abrir(s, 60_000, semReavaliar), abrir(s, 60_000, semReavaliar), abrir(s, 60_000, semReavaliar)];
    expect(sse.conexoesAbertas().total).toBe(3); // teto global (3) alcançado

    const quarta = abrir(s, 60_000, semReavaliar);
    expect(quarta.resposta.status).toBe(200); // o global não recusou: o do usuário agiu antes
    await abas[0]!.fechado;
    expect(abas[0]!.texto()).toContain("limite_por_usuario");
    expect(sse.conexoesAbertas().doUsuario(usuarioId)).toBe(3);

    // Outra pessoa, com a instância cheia: agora vale o global (503).
    const outro = await criarUsuarioComSessao(lojaId);
    const recusada = abrir(sessaoDe(outro.usuarioId, outro.sessaoId), 60_000, semReavaliar);
    expect(recusada.resposta.status).toBe(503);

    for (const a of [...abas.slice(1), quarta]) a.abortar();
    await Promise.all([...abas.slice(1), quarta].map((a) => a.fechado));
    expect(sse.conexoesAbertas().total).toBe(0);
  });

  it("dono e admin têm teto 2", () => {
    expect(sse.tetoDoUsuario("dono")).toBe(2);
    expect(sse.tetoDoUsuario("admin")).toBe(2);
    expect(sse.tetoDoUsuario("vendedor")).toBe(3);
  });

  it("fan-out por loja: evento de outra loja não chega; gestão em 'todas' recebe", async () => {
    const vend = await criarUsuarioComSessao(lojaId);
    const gest = await criarUsuarioComSessao(null, "gerente");
    const semReavaliar = async () => null;
    const a = abrir(sessaoDe(vend.usuarioId, vend.sessaoId), 60_000, semReavaliar);
    const g = abrir(sessaoDe(gest.usuarioId, gest.sessaoId, "gerente"), 60_000, semReavaliar);
    const outraLoja = await criarLoja();
    sse.aoReceber(`loja:${outraLoja}`, JSON.stringify({ tipo: "mensagem-nova", lojaId: outraLoja, versao: 1, conversaId: "x" }));
    sse.aoReceber(`loja:${lojaId}`, JSON.stringify({ tipo: "mensagem-nova", lojaId, versao: 2, conversaId: "y" }));
    await esperar(50);
    a.abortar();
    g.abortar();
    await Promise.all([a.fechado, g.fechado]);
    expect(a.texto()).toContain('"conversaId":"y"');
    expect(a.texto()).not.toContain('"conversaId":"x"');
    expect(g.texto()).toContain('"conversaId":"x"');
    expect(g.texto()).toContain('"conversaId":"y"');
    // O evento não carrega conteúdo de mensagem.
    expect(a.texto()).not.toMatch(/conteudo|texto|telefone/);
  });
});
