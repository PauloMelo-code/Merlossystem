import { defineConfig } from "drizzle-kit";

// `generate` trabalha só sobre o schema — não abre conexão. A aplicação da
// migração é `npm run db:migrate` (src/lib/db/migrate.ts), que é o único lugar
// da base de código autorizado a ler DATABASE_URL_MIGRACAO junto de
// scripts/db-backup.mjs e scripts/db-teste.mjs. Por isso não há `dbCredentials`
// aqui: a credencial do papel dono não entra em arquivo de configuração.
export default defineConfig({
  dialect: "postgresql",
  // Glob, e não só o caminho da pasta: o `schema/` nasce dividido em
  // subpastas (`auth/`, `conversas/`, `catalogo/`, `conteudo/`, `pedidos/`) e o
  // drizzle-kit NÃO desce nos subdiretórios quando recebe um diretório — via
  // só as tabelas da raiz e geraria migração faltando 24 tabelas.
  schema: "./src/lib/db/schema/**/*.ts",
  out: "./src/lib/db/migrations",
  migrations: { schema: "drizzle" },
});
