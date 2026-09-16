import type { NextConfig } from "next";

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
};

export default nextConfig;
