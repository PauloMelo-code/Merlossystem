import Redis, { type RedisOptions } from "ioredis";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { redisDoLimitador } from "@/lib/seguranca/limite";

/**
 * Conexões Redis dedicadas (03-arquitetura.md §3, §8, §9).
 *
 * Cinco papéis, quatro clientes — e não um cliente por uso:
 *
 *   - `redisDaFila()`      produtor e worker do BullMQ;
 *   - `redisPublicador()`  `PUBLISH` dos eventos de tempo real;
 *   - `redisAssinante()`   `PSUBSCRIBE` — UM por processo (§9);
 *   - `redisDoLimitador()` já existe em `seguranca/limite.ts` e é reexportado
 *     daqui. Duas implementações do mesmo balde dariam dois tetos diferentes
 *     para o mesmo número.
 *
 * A separação não é estética: uma conexão em `SUBSCRIBE` não aceita mais nenhum
 * comando, então o publicador e o limitador PRECISAM de socket próprio. E o
 * BullMQ exige `maxRetriesPerRequest: null` — com o padrão do ioredis, o worker
 * derruba o job quando o Redis pisca.
 *
 * Sem `server-only`: o worker é processo Node puro, fora do runtime do Next.
 */

export { redisDoLimitador };

type Cache = {
  _redisFila?: Redis | undefined;
  _redisPublicador?: Redis | undefined;
  _redisAssinante?: Redis | undefined;
};

const global_ = globalThis as unknown as Cache;

function criar(nome: string, extras: RedisOptions = {}): Redis {
  const cliente = new Redis(env.REDIS_URL, {
    // Exigência do BullMQ: a retentativa é da FILA (attempts + backoff), não do
    // socket. Com retentativa no socket, o job falha antes de a fila decidir.
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
    ...extras,
  });
  // Sem este ouvinte, Redis fora do ar vira `unhandledRejection` e mata o worker.
  cliente.on("error", (erro: Error) => logger.warn({ redis: nome, erro: erro.message }, "redis"));
  return cliente;
}

/** Conexão do produtor e dos workers. */
export function redisDaFila(): Redis {
  return (global_._redisFila ??= criar("fila"));
}

/** Conexão de escrita do tempo real (`PUBLISH`). */
export function redisPublicador(): Redis {
  return (global_._redisPublicador ??= criar("publicador"));
}

/**
 * Conexão de leitura do tempo real. UMA por processo: `createSubscriber()` por
 * aba seriam 200 conexões por instância e o Redis cairia muito antes do teto de
 * conexões SSE (§9).
 */
export function redisAssinante(): Redis {
  return (global_._redisAssinante ??= criar("assinante"));
}

/** Fecha o que este módulo abriu. Chamado só no desligamento do worker. */
export async function fecharConexoes(): Promise<void> {
  const abertos = [global_._redisFila, global_._redisPublicador, global_._redisAssinante];
  global_._redisFila = undefined;
  global_._redisPublicador = undefined;
  global_._redisAssinante = undefined;
  await Promise.allSettled(abertos.filter((c): c is Redis => Boolean(c)).map((c) => c.quit()));
}
