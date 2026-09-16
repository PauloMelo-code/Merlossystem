import "server-only";
import Redis from "ioredis";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { registrarEventoAuth } from "@/lib/auth/trilha";

/**
 * Limitador por IP e por chave (02-seguranca.md §7.2, REQ-C2).
 *
 * Janela fixa no Redis: `MULTI` + `INCR` + `EXPIRE NX` num round trip. É o
 * mesmo objeto usado como `rateLimit.customStorage` do Better Auth e pelos
 * limitadores próprios (`acaoPublica`, webhooks, mídia).
 *
 * FAIL-OPEN deliberado: Redis fora do ar deixa a requisição passar e grava
 * `limitador_indisponivel`. O limitador é defesa em profundidade; o controle
 * real do login é o bloqueio por CONTA, que é banco. Fail-closed aqui
 * significaria "Redis cai, ninguém entra na loja".
 */

export type Regra = { janela: number; max: number };
export type Veredito = { permitido: boolean; retryAfter: number | null };

const global_ = globalThis as unknown as { _redisLimite?: Redis };

export function redisDoLimitador(): Redis {
  const existente = global_._redisLimite;
  if (existente) return existente;
  const cliente = new Redis(env.REDIS_URL, {
    // Falha rápido quando o Redis está fora: o fail-open é decisão, não espera.
    maxRetriesPerRequest: 2,
    // A fila offline fica LIGADA de propósito. Com ela desligada, a primeira
    // requisição depois do boot chega antes do `ready` e o limitador passa
    // fail-open sem que o Redis esteja fora — justamente na hora em que o
    // processo acabou de subir e o teto importa.
    enableOfflineQueue: true,
    lazyConnect: false,
  });
  // Sem este `on("error")`, um Redis fora do ar vira `unhandledRejection` e
  // derruba o processo inteiro — o oposto do fail-open que a §7.2 pede.
  cliente.on("error", (erro) => logger.warn({ erro: erro.message }, "redis do limitador"));
  global_._redisLimite = cliente;
  return cliente;
}

/** Dedupe do alerta de indisponibilidade: 1 h, em memória (o Redis é quem caiu). */
let avisadoEm = 0;

function limitadorIndisponivel(erro: unknown): void {
  const agora = Date.now();
  if (agora - avisadoEm < 3_600_000) return;
  avisadoEm = agora;
  logger.error({ erro: String(erro) }, "limitador indisponível: passando fail-open");
  void registrarEventoAuth({ tipo: "limitador_indisponivel", resultado: "falha" });
}

/**
 * Consome uma unidade da janela. Confere e incrementa na MESMA operação: com
 * `get` seguido de `set`, N requisições simultâneas passam todas pela leitura
 * velha antes de qualquer incremento (é o que o próprio pacote do BA diz ao
 * recusar armazenamento com `get`/`set` separados).
 */
export async function consumir(chave: string, regra: Regra): Promise<Veredito> {
  try {
    const resposta = await redisDoLimitador()
      .multi()
      .incr(chave)
      .expire(chave, regra.janela, "NX")
      .ttl(chave)
      .exec();

    const contagem = Number(resposta?.[0]?.[1] ?? 0);
    const ttl = Number(resposta?.[2]?.[1] ?? regra.janela);
    if (contagem > regra.max) {
      return { permitido: false, retryAfter: ttl > 0 ? ttl : regra.janela };
    }
    return { permitido: true, retryAfter: null };
  } catch (erro) {
    limitadorIndisponivel(erro);
    return { permitido: true, retryAfter: null };
  }
}

/** Teto por IP. `escopo` separa os baldes (`sign-in`, `webhook`, `midia`…). */
export async function limitarPorIp(
  escopo: string,
  chaveDoIp: string,
  regra: Regra,
): Promise<Veredito> {
  return consumir(`limite:${escopo}:${chaveDoIp}`, regra);
}

/**
 * `SET NX EX`: marca uma chave só uma vez na janela. É o cooldown de reset por
 * conta-alvo (§11.2) e o uso único do `state` do OAuth (§12).
 * Fail-open pelo mesmo motivo de `consumir`.
 */
export async function marcarUmaVez(chave: string, segundos: number): Promise<boolean> {
  try {
    const resposta = await redisDoLimitador().set(chave, "1", "EX", segundos, "NX");
    return resposta === "OK";
  } catch (erro) {
    limitadorIndisponivel(erro);
    return true;
  }
}

/**
 * `rateLimit.customStorage` do Better Auth. A assinatura conferida no pacote
 * instalado é `consume(key, { window, max }) -> { allowed, retryAfter }`
 * (docs/seguranca/conferencia-ba-1.7.5.md §1, item 12).
 */
export const armazenamentoLimiteRedis = {
  consume: async (chave: string, regra: { window: number; max: number }) => {
    const veredito = await consumir(`ba:${chave}`, { janela: regra.window, max: regra.max });
    return { allowed: veredito.permitido, retryAfter: veredito.retryAfter };
  },
};
