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
      // Arquivos-ouro para COPIAR. Citam de propósito módulos que ainda não
      // existem (`@/lib/db/schema/exemplo`, a chave `exemplo:criar`); compilar
      // isso exigiria criar um domínio "exemplo" só para o lint ficar feliz.
      // Também estão fora do `tsconfig.json`.
      "templates/**",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
];

export default config;
