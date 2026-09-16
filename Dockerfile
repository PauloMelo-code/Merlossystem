# syntax=docker/dockerfile:1
#
# Imagem única, dois alvos: `app` (Next standalone) e `worker` (BullMQ).
# slim e não alpine: sharp e @node-rs/argon2 são addons nativos compilados
# contra a glibc. NADA de seed, migração ou bootstrap no entrypoint — migrar é
# passo de release (npm run db:migrate), e a falha aborta o deploy.

FROM node:24-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
# sharp e Argon2id bloqueiam thread do libuv; o padrão (4) estrangula o login.
ENV NODE_ENV=production \
    UV_THREADPOOL_SIZE=8 \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# ── dependências ────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --include=dev

FROM base AS deps-prod
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── build: Next standalone + worker empacotado ──────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
# O worker é empacotado aqui porque `output: standalone` não copia src/ nem tsx,
# e `npx tsx` em runtime resolveria pacote pela rede a cada boot.
RUN ./node_modules/.bin/esbuild src/server/worker.ts \
      --bundle --platform=node --target=node24 --format=esm \
      --packages=external --outfile=dist/worker.mjs

# ── alvo app ────────────────────────────────────────────────────────────────
FROM base AS app
ENV PORT=3005 \
    HOSTNAME=0.0.0.0
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3005
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3005/api/saude || exit 1
CMD ["node", "server.js"]

# ── alvo worker ─────────────────────────────────────────────────────────────
FROM base AS worker
COPY --from=deps-prod --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
# `--conditions=react-server`: o bundle mantém `import "server-only"` (é externo),
# e esse pacote LANÇA no import fora do runtime do Next. A condição faz o Node
# resolver o `empty.js` que o próprio pacote publica. Sem ela o worker não sobe.
CMD ["node", "--conditions=react-server", "dist/worker.mjs"]
