import "server-only";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { env } from "@/lib/env";

/**
 * Cliente único do banco (03-arquitetura.md §6.1).
 *
 * `DATABASE_URL` aponta SEMPRE para o papel `merlo_app`, que nunca é dono das
 * tabelas — é o que faz o `REVOKE UPDATE, DELETE, TRUNCATE` das trilhas valer
 * (01-dados.md §7.3). `DATABASE_URL_MIGRACAO` (papel `merlo_migracao`) não é
 * lida aqui nem em nenhum pool da aplicação: só `src/lib/db/migrate.ts`,
 * `scripts/db-backup.mjs` e `scripts/db-teste.mjs` a usam.
 *
 * `DB_POOL_MAX`: 10 no app, 5 no worker. O `Pool` do `pg` é preguiçoso — ele só
 * abre socket na primeira consulta, então `next build` importa este módulo sem
 * tocar no banco.
 */

// O HMR do Next reavalia o módulo a cada edição; sem o singleton, cada recarga
// deixaria um pool órfão segurando conexões até o Postgres recusar as novas.
const global_ = globalThis as unknown as { _pool?: Pool };

export const pool =
  global_._pool ?? new Pool({ connectionString: env.DATABASE_URL, max: env.DB_POOL_MAX });

if (env.NODE_ENV !== "production") global_._pool = pool;

export const db = drizzle(pool, { schema });
