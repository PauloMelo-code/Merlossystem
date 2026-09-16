import type { Sessao } from "@/lib/auth/guard";
import type { EscopoLoja } from "@/lib/auth/loja";
import { env } from "@/lib/env";
import { redisAssinante } from "@/lib/fila/conexao";
import { logger } from "@/lib/logger";
import {
  ehCanalDeRevogacao,
  idDoCanal,
  PADROES_ASSINADOS,
  type EventoTempoReal,
} from "@/lib/tempo-real/canal";

/**
 * COSTURA — dono: M1 (05-plano-construcao.md §5). Contrato de
 * 03-arquitetura.md §9:
 *
 *  1. UM SUBSCRIBER POR PROCESSO. `psubscribe` de `loja:*` e `usuario:*` numa
 *     conexão só (`redisAssinante()`), e fan-out em memória por
 *     `Map<lojaId, Set<conexao>>`.
 *  2. TETO POR USUÁRIO ANTES DO GLOBAL. `EVENTOS_MAX_POR_USUARIO` (3; 2 para
 *     `dono` e `admin`). Ao exceder, fecha a conexão MAIS ANTIGA do mesmo
 *     usuário. Só então vale `EVENTOS_MAX_CONEXOES`, que responde 503.
 *     Cada corte registra `sse_limite_atingido` (log estruturado: a lista
 *     fechada de `auth_eventos` não tem esse tipo).
 *  3. A SESSÃO É REAVALIADA NO LAÇO, a cada heartbeat de 25 s, sem renovar
 *     atividade. Divergiu, sumiu, expirou ou passou das 12 h → emite
 *     `sessao-invalidada` e fecha. `usuario:<id>:revogar` fecha na hora.
 *  4. `X-Accel-Buffering: no` e `Cache-Control: no-store`.
 *  5. Reconexão com `Last-Event-ID`; a UI SEMPRE reconcilia com leitura completa.
 *  6. O evento não carrega conteúdo: `{ tipo, conversaId, lojaId, versao }`.
 *
 * A limpeza acontece no `abort` do request — sem ela, o `Map` cresce a cada aba
 * fechada e o processo vaza memória até reiniciar.
 */

export type ConexaoSse = {
  usuarioId: string;
  sessaoId: string;
  lojaId: string | null;
  abertaEm: Date;
};

type Conexao = ConexaoSse & {
  /** Chave do fan-out: a loja, ou `*` para gestão em "todas as lojas". */
  chave: string;
  enviar: (evento: EventoTempoReal) => void;
  fechar: (motivo: string) => void;
};

export const HEARTBEAT_MS = 25_000;
const TODAS = "*";

type Estado = {
  porLoja: Map<string, Set<Conexao>>;
  porUsuario: Map<string, Conexao[]>;
  total: number;
  assinando: boolean;
};

const global_ = globalThis as unknown as { _sse?: Estado };
const estado: Estado = (global_._sse ??= {
  porLoja: new Map(),
  porUsuario: new Map(),
  total: 0,
  assinando: false,
});

/** Para o teste e para a sonda: quantas conexões esta instância segura. */
export function conexoesAbertas(): { total: number; doUsuario: (usuarioId: string) => number } {
  return {
    total: estado.total,
    doUsuario: (id) => estado.porUsuario.get(id)?.length ?? 0,
  };
}

function enviarPara(conjunto: Iterable<Conexao> | undefined, evento: EventoTempoReal): void {
  for (const c of conjunto ?? []) c.enviar(evento);
}

/**
 * Fan-out EM MEMÓRIA para as conexões desta instância. Quem publica entre
 * processos é `src/lib/tempo-real/publicar.ts`; esta função é a outra ponta,
 * chamada pelo assinante único ao receber a mensagem do Redis. Gestão que olha
 * "todas as lojas" recebe o evento de qualquer loja.
 */
export function publicarParaLoja(lojaId: string, evento: EventoTempoReal): void {
  enviarPara(estado.porLoja.get(lojaId), evento);
  enviarPara(estado.porLoja.get(TODAS), evento);
}

/** O que o assinante único faz com cada mensagem do Redis. */
export function aoReceber(canal: string, mensagem: string): void {
  let evento: EventoTempoReal;
  try {
    evento = JSON.parse(mensagem) as EventoTempoReal;
  } catch {
    return;
  }
  const id = idDoCanal(canal);
  if (!id) return;
  if (ehCanalDeRevogacao(canal)) {
    for (const c of [...(estado.porUsuario.get(id) ?? [])]) c.fechar(evento.motivo ?? "revogada");
    return;
  }
  if (canal.startsWith("loja:")) publicarParaLoja(id, evento);
  else enviarPara(estado.porUsuario.get(id), evento);
}

/** Liga o assinante ÚNICO do processo (idempotente). */
export function garantirAssinante(): void {
  if (estado.assinando) return;
  estado.assinando = true;
  const assinante = redisAssinante();
  assinante.on("pmessage", (_padrao: string, canal: string, mensagem: string) => aoReceber(canal, mensagem));
  assinante.psubscribe(...PADROES_ASSINADOS).catch((erro: unknown) => {
    estado.assinando = false;
    logger.error({ erro: String(erro) }, "assinante do tempo real não subiu");
  });
}

function registrar(c: Conexao): void {
  const conjunto = estado.porLoja.get(c.chave) ?? new Set<Conexao>();
  conjunto.add(c);
  estado.porLoja.set(c.chave, conjunto);
  estado.porUsuario.set(c.usuarioId, [...(estado.porUsuario.get(c.usuarioId) ?? []), c]);
  estado.total += 1;
}

function remover(c: Conexao): void {
  const conjunto = estado.porLoja.get(c.chave);
  if (conjunto?.delete(c)) {
    estado.total -= 1;
    if (conjunto.size === 0) estado.porLoja.delete(c.chave);
  }
  const restantes = (estado.porUsuario.get(c.usuarioId) ?? []).filter((x) => x !== c);
  if (restantes.length === 0) estado.porUsuario.delete(c.usuarioId);
  else estado.porUsuario.set(c.usuarioId, restantes);
}

export function tetoDoUsuario(papel: Sessao["papel"]): number {
  const teto = env.EVENTOS_MAX_POR_USUARIO;
  return papel === "dono" || papel === "admin" ? Math.min(teto, 2) : teto;
}

export type OpcoesDoFluxo = {
  escopo: EscopoLoja;
  /** Motivo para fechar, ou `null` se a sessão continua valendo. */
  reavaliar: () => Promise<string | null>;
  /** Só o teste encurta. Em produção é o heartbeat de 25 s. */
  intervaloMs?: number;
};

const CABECALHOS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-store",
  "x-accel-buffering": "no",
  connection: "keep-alive",
};

function linhaDoEvento(evento: EventoTempoReal): string {
  return `id: ${evento.versao}\nevent: ${evento.tipo}\ndata: ${JSON.stringify(evento)}\n\n`;
}

/** Handler de `GET /api/eventos` (Route Handler, runtime Node). */
export function abrirFluxo(req: Request, sessao: Sessao, opcoes?: OpcoesDoFluxo): Response {
  if (!opcoes || opcoes.escopo.tipo === "nenhuma") {
    return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
  }
  const escopo = opcoes.escopo;
  const chave = escopo.tipo === "uma" ? escopo.lojaId : TODAS;

  // Teto por usuário ANTES do global: a aba mais antiga da mesma pessoa sai.
  const minhas = estado.porUsuario.get(sessao.usuarioId) ?? [];
  const excedentes = minhas.length - tetoDoUsuario(sessao.papel) + 1;
  for (const antiga of minhas.slice(0, Math.max(0, excedentes))) {
    logger.warn({ evento: "sse_limite_atingido", usuarioId: sessao.usuarioId, teto: "usuario" }, "sse");
    antiga.fechar("limite_por_usuario");
  }
  if (estado.total >= env.EVENTOS_MAX_CONEXOES) {
    logger.warn({ evento: "sse_limite_atingido", usuarioId: sessao.usuarioId, teto: "instancia" }, "sse");
    return new Response(null, { status: 503, headers: { "cache-control": "no-store", "retry-after": "15" } });
  }

  garantirAssinante();
  const codificador = new TextEncoder();
  let conexao: Conexao | null = null;

  const corpo = new ReadableStream<Uint8Array>({
    start(controle) {
      let aberto = true;
      let relogio: ReturnType<typeof setInterval> | null = null;
      const escrever = (texto: string) => {
        if (!aberto) return;
        try {
          controle.enqueue(codificador.encode(texto));
        } catch {
          fechar("escrita_falhou");
        }
      };
      const fechar = (motivo: string) => {
        if (!aberto) return;
        escrever(linhaDoEvento({ tipo: "sessao-invalidada", lojaId: null, versao: Date.now(), motivo }));
        aberto = false;
        if (relogio) clearInterval(relogio);
        if (conexao) remover(conexao);
        try {
          controle.close();
        } catch {
          // o cliente já tinha fechado
        }
      };

      conexao = {
        usuarioId: sessao.usuarioId,
        sessaoId: sessao.sessaoId,
        lojaId: escopo.tipo === "uma" ? escopo.lojaId : null,
        abertaEm: new Date(),
        chave,
        enviar: (evento) => escrever(linhaDoEvento(evento)),
        fechar,
      };
      registrar(conexao);
      escrever("retry: 5000\n: conectado\n\n");

      relogio = setInterval(() => {
        escrever(": ping\n\n");
        opcoes
          .reavaliar()
          .then((motivo) => {
            if (motivo) fechar(motivo);
          })
          .catch(() => fechar("reavaliacao_falhou"));
      }, opcoes.intervaloMs ?? HEARTBEAT_MS);

      req.signal.addEventListener("abort", () => fechar("cliente_saiu"), { once: true });
    },
    cancel() {
      conexao?.fechar("cliente_saiu");
    },
  });

  return new Response(corpo, { status: 200, headers: CABECALHOS });
}
