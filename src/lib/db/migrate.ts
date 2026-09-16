import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

/**
 * Aplica as migrações (03-arquitetura.md §17). `npm run db:migrate`.
 *
 * Roda com o papel `merlo_migracao`, que é o DONO das tabelas — `merlo_app`
 * nunca é dono, senão o `REVOKE UPDATE, DELETE, TRUNCATE` das trilhas seria
 * decorativo (01-dados.md §7.3).
 *
 * Este arquivo lê `process.env` direto, e não `src/lib/env.ts`, de propósito:
 * `env.ts` exige o ambiente inteiro da aplicação (Redis, S3, segredos de auth)
 * e a migração não precisa de nada disso — e `client.ts` importa `server-only`,
 * que estoura fora do runtime do Next. É uma das três exceções escritas da
 * trava T17, junto de `scripts/db-teste.mjs` e `scripts/db-backup.mjs`.
 */
async function principal() {
  const url = process.env.DATABASE_URL_MIGRACAO;
  if (!url) {
    console.error(
      "DATABASE_URL_MIGRACAO não está definida. Ela aponta para o papel merlo_migracao;\n" +
        "DATABASE_URL (papel merlo_app) não tem permissão para criar tabela.",
    );
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), {
      migrationsFolder: "./src/lib/db/migrations",
      migrationsSchema: "drizzle",
    });
    console.log("Migrações aplicadas.");
  } finally {
    await pool.end();
  }
}

// `void` e não `await` de topo: o tsx transpila este arquivo como CJS e o
// top-level await falharia no transform.
void principal().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
