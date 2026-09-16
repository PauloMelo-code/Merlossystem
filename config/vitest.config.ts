import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const raiz = fileURLToPath(new URL("..", import.meta.url));
const src = fileURLToPath(new URL("../src", import.meta.url));

// Quatro projetos (03-arquitetura.md §20). O config mora em config/, então a
// raiz precisa ser dita à mão — senão os `include` resolveriam a partir daqui.
export default defineConfig({
  root: raiz,
  resolve: {
    alias: [{ find: /^@\/(.*)$/, replacement: `${src.replace(/\\/g, "/")}/$1` }],
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
