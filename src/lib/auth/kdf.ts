import "server-only";
import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";

/**
 * KDF de senha (02-seguranca.md §6).
 *
 * Argon2id `m=19456 KiB, t=2, p=1` — piso OWASP. O scrypt padrão do Better Auth
 * fica abaixo dele (G22), por isso `emailAndPassword.password` aponta para cá.
 *
 * SEMÁFORO: `@node-rs/argon2` é addon nativo e roda no threadpool do libuv. Com
 * o default de 4 threads, uma rajada de login satura o pool e trava TODA I/O de
 * arquivo do processo — inclusive o SSE e `/api/midias/[id]`, que moram no mesmo
 * container. Daí `UV_THREADPOOL_SIZE=8` no Dockerfile MAIS um teto de 4
 * operações em voo. Ao estourar, quem chama devolve a recusa única de §8 —
 * nunca 503, que seria oráculo.
 *
 * O valor final sai de `scripts/medir-kdf.mjs` rodado na VPS (§22, item 2).
 */

/**
 * `Algorithm.Argon2id` é `declare const enum` no `.d.ts` do addon, e const enum
 * ambiente não pode ser lido com `isolatedModules` ligado. O valor literal 2 é
 * o do próprio arquivo de tipos e está fixado aqui com o nome ao lado.
 */
export const ARGON2ID = 2;

export const CUSTO_ARGON2 = {
  algorithm: ARGON2ID,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const MAX_KDF_EM_VOO = 4;

/** Teto bruto ANTES de qualquer avaliação ou hash: DoS de KDF com 1 MB (B8). */
export const MAX_BYTES_SENHA = 1024;

export class SemaforoCheio extends Error {
  constructor() {
    super("Semáforo de KDF cheio.");
    this.name = "SemaforoCheio";
  }
}

let emVoo = 0;

/** Fila é o que NÃO queremos: cheio recusa na hora, para não virar espera. */
async function comSemaforo<T>(fn: () => Promise<T>): Promise<T> {
  if (emVoo >= MAX_KDF_EM_VOO) throw new SemaforoCheio();
  emVoo += 1;
  try {
    return await fn();
  } finally {
    emVoo -= 1;
  }
}

export function kdfEmVoo(): number {
  return emVoo;
}

function conferirTamanho(senha: string): void {
  if (Buffer.byteLength(senha, "utf8") > MAX_BYTES_SENHA) {
    throw new Error("Senha acima do teto bruto.");
  }
}

export const kdf = {
  async hash(senha: string): Promise<string> {
    conferirTamanho(senha);
    return comSemaforo(() => argon2Hash(senha, CUSTO_ARGON2));
  },

  /**
   * Nunca lança por senha errada: hash corrompido ou de outro algoritmo vira
   * `false`. Lançar aqui distinguiria "conta antiga" de "senha errada".
   */
  async verify(hash: string, senha: string): Promise<boolean> {
    if (Buffer.byteLength(senha, "utf8") > MAX_BYTES_SENHA) return false;
    return comSemaforo(async () => {
      try {
        // Sem opções: o `verify` lê os parâmetros do próprio envelope PHC, e é
        // isso que permite subir o custo sem invalidar hash antigo.
        return await argon2Verify(hash, senha);
      } catch {
        return false;
      }
    });
  },
};
