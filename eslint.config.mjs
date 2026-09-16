// Flat config (o `next lint` não existe mais no Next 16; o comando é `eslint .`).
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  {
    ignores: [
      ".next/**",
      "dist/**",
      "node_modules/**",
      "next-env.d.ts",
      // SQL gerado pelo drizzle-kit: não é código-fonte nosso.
      "src/lib/db/migrations/**",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
];

export default config;
