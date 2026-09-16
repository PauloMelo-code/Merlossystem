import type { NextConfig } from "next";
import { CABECALHOS_DE_SEGURANCA, CSP_DE_API } from "./src/lib/seguranca/csp";

const nextConfig: NextConfig = {
  // Imagem de produção: o runner copia só o standalone (Dockerfile, alvo `app`).
  output: "standalone",
  // Existe outro lockfile acima deste diretório (C:\Users\Paulo); sem isto o Next
  // sobe a raiz do tracing e empacota arquivos de fora do projeto.
  outputFileTracingRoot: import.meta.dirname,
  // Addons nativos ficam fora do bundle do Turbopack.
  serverExternalPackages: ["@node-rs/argon2", "sharp", "pg"],
  experimental: {
    // A-16: 1 MB vale para TODA Server Action, inclusive as públicas (login,
    // convite, reset). O upload de mídia vai por Route Handler dedicado, que
    // não tem este limite. Trava de fonte reprova valor maior.
    serverActions: { bodySizeLimit: "1mb" },
  },
  poweredByHeader: false,

  /**
   * Borda: 02-seguranca.md §14.1 e §14.2.
   *
   * Os cabeçalhos fixos valem para TODA resposta. A CSP tem duas casas, de
   * propósito: a de página nasce em `src/proxy.ts`, porque o nonce é por
   * requisição e um segundo header de CSP aqui viraria interseção — e a
   * interseção com uma política sem nonce bloquearia o próprio script do Next.
   * O que sobra para cá é a CSP das respostas de `/api`, que não renderizam
   * HTML nem executam script: `default-src 'none'`.
   */
  async headers() {
    return [
      { source: "/:path*", headers: [...CABECALHOS_DE_SEGURANCA] },
      {
        source: "/api/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP_DE_API },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
