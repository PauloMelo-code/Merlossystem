import { sql } from "drizzle-orm";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { db } from "@/lib/db/client";
import { compararEmTempoConstante } from "@/lib/seguranca/assinaturas";
import { conferirCofre } from "@/lib/seguranca/cofre";
import { chaveDeIp, ipDoCliente } from "@/lib/seguranca/ip";
import { limitarPorIp, redisDoLimitador } from "@/lib/seguranca/limite";

/**
 * Readiness (03-arquitetura.md §5). So responde a quem manda o segredo em
 * CABECALHO, comparado em tempo constante — nunca por query string e nunca com
 * `===` (T17). Limitador por IP antes de tocar qualquer dependencia, e o
 * resultado fica 10 s em cache: a sonda do orquestrador bate de 5 em 5 s e,
 * sem cache, isso vira um `select` e um `ping` por instancia por batida.
 */

export const dynamic = "force-dynamic";

export const CACHE_MS = 10_000;

type Veredito = { pronto: boolean; banco: boolean; redis: boolean; cofre: boolean };

let ultimo: { em: number; veredito: Veredito } | null = null;

async function medir(): Promise<Veredito> {
  const banco = await db
    .execute(sql`select 1`)
    .then(() => true)
    .catch((erro: unknown) => {
      logger.error({ erro: String(erro) }, "sonda: banco fora");
      return false;
    });

  const redis = await redisDoLimitador()
    .ping()
    .then(() => true)
    .catch((erro: unknown) => {
      logger.error({ erro: String(erro) }, "sonda: redis fora");
      return false;
    });

  // O cofre entra aqui porque chave ausente ou de tamanho errado significa que
  // a instancia nao consegue abrir nenhuma credencial de integracao — subir
  // assim e prometer o que nao se cumpre.
  let cofre = true;
  try {
    conferirCofre();
  } catch {
    cofre = false;
  }

  // ponytail: o MinIO entra quando M3 entregar `armazenamento/s3.ts` e
  // exportar a conferencia. Ler `S3_ENDPOINT` daqui reprova na trava de fonte
  // (o endpoint so pode ser lido naquele modulo).
  return { pronto: banco && redis && cofre, banco, redis, cofre };
}

export async function GET(req: Request): Promise<Response> {
  const ip = ipDoCliente(req.headers);
  const veredito = await limitarPorIp("sonda", chaveDeIp(ip), { janela: 60, max: 120 });
  if (!veredito.permitido) return new Response(null, { status: 429 });

  const segredo = env.SONDA_SEGREDO;
  if (!compararEmTempoConstante(req.headers.get("x-merlo-sonda"), segredo ?? null)) {
    // Sem segredo configurado, a rota recusa toda sonda (INV-43): nunca
    // "aceita porque nao configurou".
    return new Response(null, { status: 401, headers: { "cache-control": "no-store" } });
  }

  const agora = Date.now();
  if (!ultimo || agora - ultimo.em > CACHE_MS) {
    ultimo = { em: agora, veredito: await medir() };
  }

  return new Response(JSON.stringify(ultimo.veredito), {
    status: ultimo.veredito.pronto ? 200 : 503,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
