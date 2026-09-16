import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const raiz = fileURLToPath(new URL("..", import.meta.url));
const src = fileURLToPath(new URL("../src", import.meta.url));

/**
 * `server-only` resolve para um módulo que LANÇA quando a condição
 * `react-server` não está ligada — e o Vitest roda em Node puro. Sem este
 * alias, todo teste que alcança `db/client.ts`, `auth/**` ou `seguranca/**`
 * quebra no import, e o teste de EFEITO que a régua de segurança exige
 * (02-seguranca.md §4.4) não existiria. O alias aponta para o `empty.js` que o
 * próprio pacote publica sob a condição `react-server`.
 */
const vazioServerOnly = fileURLToPath(
  new URL("../node_modules/server-only/empty.js", import.meta.url),
);

// Quatro projetos (03-arquitetura.md §20). O config mora em config/, então a
// raiz precisa ser dita à mão — senão os `include` resolveriam a partir daqui.
export default defineConfig({
  root: raiz,
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: `${src.replace(/\\/g, "/")}/$1` },
      { find: /^server-only$/, replacement: vazioServerOnly.replace(/\\/g, "/") },
    ],
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unidade",
          environment: "node",
          include: ["tests/unidade/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "travas",
          environment: "node",
          include: ["tests/travas/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "componentes",
          environment: "jsdom",
          globals: true,
          setupFiles: ["config/vitest.setup.ts"],
          include: ["tests/componentes/**/*.test.{ts,tsx}"],
        },
      },
      {
        extends: true,
        test: {
          name: "integracao",
          environment: "node",
          // UM arquivo por vez: todos compartilham o MESMO Postgres e o mesmo
          // índice do Redis, e cada arquivo de segurança começa com um
          // `truncate`. Em paralelo, um arquivo apaga a massa do outro no meio
          // do teste e a suíte falha por motivo que não é o do produto.
          fileParallelism: false,
          // Postgres real + Redis. O globalSetup entra com o schema (F4).
          include: [
            "tests/integracao/**/*.test.ts",
            "tests/seguranca/**/*.test.ts",
          ],
        },
      },
    ],
  },
});
