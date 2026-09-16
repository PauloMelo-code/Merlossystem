# 09 — Implementações de referência e versões (levantamento)

> Data da consulta: **2026-09-15**. Fontes: `npm view` (registro público) + páginas oficiais (links no fim).
> Escopo: READ-ONLY sobre HUG Atende, espaco-flow e MerlostoreChat. Nenhum segredo copiado.
> Público: arquitetos que **não** leram o código. Cada padrão traz `arquivo:linha` para conferência.
> Observação: `MerlostoreChat/.env.example` **não pôde ser lido** (bloqueado por regra de negação do ambiente). As variáveis citadas vêm de `docs/integracoes.md:768-786`.

---

## 0. Resumo executivo (o que muda o desenho)

1. **Versões fixadas pelo contexto valem, com 4 ajustes forçados pelo ecossistema**:
   - **TypeScript 6.0.3, não 7**: `eslint-config-next@16.3.5` depende de `typescript-eslint ^8.46`, cujo peer é `typescript >=4.8.4 <6.1.0`. TS 7 (Go, sem API JS até a 7.1) quebra o lint.
   - **ESLint 9.39.5, não 10**: `eslint-plugin-react@7.37.5`, `eslint-plugin-import` e `eslint-plugin-jsx-a11y` (dependências do `eslint-config-next`) têm peer `eslint ≤ ^9`.
   - **BullMQ 6 não traz `ioredis`** (virou peer opcional) e **removeu repeatable jobs** (`repeat`), substituídos por `upsertJobScheduler`. Os dois projetos de referência usam `repeat` e quebram no v6.
   - **Node ≥ 24.15** se usar `jsdom@30` (engines `^22.22.2 || ^24.15.0`). A máquina do Paulo roda **v24.12.0**: ou atualiza o Node ou fixa `jsdom@29.1.1`.
2. **Better Auth 1.7.5**: passkey é **pacote separado** (`@better-auth/passkey`); adapters viraram pacotes (`@better-auth/drizzle-adapter`, mas o import continua `better-auth/adapters/drizzle`); CLI agora é o pacote **`auth`** (`npx auth generate`); `better-auth` já depende de **zod ^4.5.4**. Usar **≥ 1.7.3** (1.7.0–1.7.2 exigiam coluna `account.issuer`, revertido na 1.7.3).
3. **Next 16.3.5**: mínimo seguro é **16.3.3** (25/08/2026: 2 RCE críticos — AVIF via sharp/libheif e servidor em **Windows**, que é a máquina de dev). `proxy.ts` roda em **Node** (não edge) e **não é fronteira de segurança**; Server Actions são **POST alcançáveis diretamente**.
4. **Armadilha 2 (Better Auth × soft delete)**: `session.preserveSessionInDatabase` **só atua com `secondaryStorage`** e mantém a linha com `expiresAt` = momento da revogação (não usa `is_deleted`). `verification` continua com delete físico. Não há forma nativa de soft delete → ADR obrigatório (opções na §5.4).
5. **Não existe 2FA obrigatório nativo** no Better Auth (só para quem já ativou). O portão da casa exige segundo fator para todos → precisa de hook próprio (§5.3).
6. **`cookieCache` ligado (como no HUG) viola a régua da casa**: papel/ban ficam em cache até `maxAge` (HUG: 5 min). Desligar.
7. **BullMQ 6 tem backend PostgreSQL estável** (`createPostgresBackend`, PG ≥ 13). Informação nova relevante para o ADR 0007 do Merlostore ("fila no Postgres"): permite a ferramenta de verdade (retry, scheduler, DLQ) sem Redis. Não reabre a infra fixada (Redis 6382), mas o arquiteto deve registrar a escolha.
8. **Vitest 5.0.1 saiu hoje** (5.0.0 em 03/09). Não embute mais o `vite` (instalar `vite@8` explícito). Alternativa conservadora: `vitest@4.1.11`.

---

## 1. Tabela de versões recomendadas

Legenda de "Pin": **exato** = sem `^` (framework/segurança, conferir no lockfile); **^** = faixa menor aceitável.

### 1.1 Runtime, framework e linguagem

| Pacote | `latest` hoje | Recomendado | Pin | Data da versão | Motivo / restrição |
|---|---|---|---|---|---|
| Node.js | — | **24 LTS ≥ 24.15** | imagem `node:24-alpine` | — | next ≥20.9; vitest 5 `^22.12‖^24`; ioredis 6/aws-sdk ≥20; jsdom 30 `^24.15`. Dev local está em 24.12.0 |
| next | 16.3.5 | **16.3.5** | exato | 2026-09-11 | 16.3.3 corrige RCE críticos (ago/26). Engines `>=20.9.0` |
| react / react-dom | 19.3.0 | **19.3.0** | exato | 2026-09-09 | minor sem breaking (View Transitions e Fragment Refs estáveis). Peer do next: `^19.0.0` |
| @types/react / @types/react-dom | 19.3.0 | **19.3.0** | ^ | — | `@types/react-dom@19.3.0` exige `@types/react ^19.3.0` |
| typescript | **7.0.2** | **6.0.3** | ~ | 6.0.3 em 2026-04-16 | typescript-eslint 8.70 peer `<6.1.0`; Next 16 mínimo 5.1 |
| @types/node | 22.20.3 (tag latest) | **24.13.5** | ^ | — | alinhar com Node 24 |
| eslint | **10.10.0** | **9.39.5** | ^9 | — | plugins do eslint-config-next não aceitam ESLint 10 |
| eslint-config-next | 16.3.5 | **16.3.5** | exato | — | flat config (`eslint.config.mjs`); `next lint` foi removido |
| tsx | 4.23.13 | 4.23.13 | ^ | — | scripts/worker/seed |
| server-only | 0.0.1 | 0.0.1 | exato | — | marcar DAL e actions |

### 1.2 Banco e ORM

| Pacote | `latest` | Recomendado | Pin | Data | Motivo |
|---|---|---|---|---|---|
| PostgreSQL | — | **16** (imagem `postgres:16`) | — | — | fixado; HUG usa 17 (divergência só de referência) |
| drizzle-orm | 0.45.2 | **0.45.2** | exato | 2026-03-27 | 1.0 ainda RC (`1.0.0-rc.4` 2026-06-27; tags rc5). Better Auth aceita `^0.45.2 ‖ >=1.0.0-rc.1` |
| drizzle-kit | 0.31.10 | **0.31.10** | exato | — | Better Auth peer `>=0.31.4`. Deps: tsx/esbuild (não importa `typescript`) |
| pg (node-postgres) | 8.23.0 | **8.23.0** | ^ | 2026-08-08 | driver único: peer do Better Auth e do backend PG do BullMQ; HUG usa `pg` |
| postgres (postgres.js) | 3.4.9 | não usar | — | — | espaco-flow usa; evitar 2 drivers |
| @types/pg | 8.23.1 | 8.23.1 | ^ | — | — |
| drizzle-zod | 0.8.3 | opcional | ^ | — | peer `zod ^3.25‖^4`, `drizzle-orm >=0.36` |

### 1.3 Autenticação

| Pacote | `latest` | Recomendado | Pin | Data | Motivo |
|---|---|---|---|---|---|
| better-auth | 1.7.5 | **1.7.5** | exato | 2026-09-14 | ≥1.7.3 obrigatório (issuer revertido). Deps: `zod ^4.5.4`, `@better-auth/drizzle-adapter 1.7.5`, `@noble/hashes`, `jose`, `kysely`. Peers opcionais: `next ^14‖^15‖^16`, `react ^18‖^19`, `pg ^8` |
| @better-auth/passkey | 1.7.5 | **1.7.5** | exato | 2026-09-14 | **pacote separado**; deps `@simplewebauthn/server ^13.3.1`, `@simplewebauthn/browser ^13.3.0`, `zod ^4.5.4`; peers `better-auth ^1.7.5`, `@better-auth/core ^1.7.5`, `better-call 1.4.0`, `@better-auth/utils 0.4.2`, `@better-fetch/fetch 1.3.2`, `nanostores ^1.0.1` |
| auth (CLI) | 1.7.5 | via `npx auth` | — | — | "The CLI for Better Auth": `generate`, `migrate`, `create-admin`. `@better-auth/cli` parou em 1.4.21 |
| @better-auth/redis-storage | 1.7.5 | só se escolher `secondaryStorage` | exato | — | peer **`ioredis ^5.0.0`** (conflita com ioredis 6) |
| @node-rs/argon2 | 2.2.1 | **2.2.1** | ^ | — | Argon2id exigido pela régua (`docs/seguranca-login.md:53`); plugar em `emailAndPassword.password.hash/verify`. Addon nativo: incluir em `serverExternalPackages` e usar imagem com binário musl |
| @daveyplate/better-auth-ui | 3.4.0 | **não adotar** | — | — | HUG usa 2.x; v3 puxa dezenas de peers Radix/captcha e não segue o design system base-nova |

### 1.4 Fila, cache, storage, IA

| Pacote | `latest` | Recomendado | Pin | Data | Motivo |
|---|---|---|---|---|---|
| bullmq | 6.3.6 | **6.3.6** | ^6.3 | 6.0.0 em 2026-07-30 | deps não incluem ioredis; peers opcionais `ioredis >=5`, `pg >=8`, `redis >=5` |
| ioredis | 6.0.0 | **5.11.1** (ou 6.0.0) | ^ | 6.0.0 em 2026-07-31 | 6 = RESP3 padrão e Node ≥20; compatível com BullMQ (`protocol: 2` restaura v5). Ficar em 5.11.1 **se** usar `@better-auth/redis-storage` (peer ^5) — uma versão só na árvore |
| @aws-sdk/client-s3 | 3.1133.0 | **3.1133.0** | ^ | 2026-09-15 | ADR 0006 do Merlostore (SDK S3, não o do MinIO). Engines ≥20 |
| @aws-sdk/s3-request-presigner | 3.1133.0 | **3.1133.0** | mesma do client | — | URL assinada TTL 10 min (ADR 0006) |
| minio (SDK) | 8.0.7 | não usar | — | — | HUG e espaco-flow usam; Merlostore decidiu AWS SDK |
| sharp | 0.35.4 | **0.35.4** | ^ | 2026-08-26 | thumbnail (ADR 0006) e `next/image`; Next 16.3.3 desliga otimização AVIF |
| @anthropic-ai/sdk | 0.126.0 | **0.126.0** | ^ | 2026-09-15 | peer `zod ^3.25‖^4`. Merlostore hoje em ^0.80 |
| pino | 10.3.1 | 10.3.1 | ^ | — | HUG usa 9.x com `redact` |
| dotenv | 17.4.2 | só em worker/scripts | ^ | — | Next carrega `.env` sozinho |

### 1.5 UI e validação

| Pacote | `latest` | Recomendado | Pin | Data | Motivo |
|---|---|---|---|---|---|
| tailwindcss | 4.3.3 | **4.3.3** | ^4.3 | 4.3.0 em 2026-05-08 | CSS-first, sem `tailwind.config.ts` |
| @tailwindcss/postcss | 4.3.3 | **4.3.3** | igual ao tailwind | — | deps `postcss ^8.5.16` |
| postcss | 8.5.28 | 8.5.28 | ^ | — | — |
| shadcn (CLI) | 4.21.0 | **via `npx shadcn@4.21.0`** | — | 2026-09-04 | é CLI, **não** dependência de runtime (Merlostore hoje o tem em `dependencies`). Engines ≥20.18.1 |
| tw-animate-css | 1.4.0 | 1.4.0 | ^ | — | substitui `tailwindcss-animate` |
| @base-ui/react | 1.8.0 | 1.8.0 (se `base-*`) | ^ | — | Merlostore usa `style: "base-nova"` |
| radix-ui | 1.6.7 | só se `radix-*` | — | — | alternativa de primitivos |
| lucide-react | 1.46.0 | ^1 | ^ | — | `iconLibrary: lucide` |
| sonner | 2.0.8 | ^2 | ^ | — | toast do shadcn foi deprecado em favor de sonner |
| next-themes | 0.4.6 | 0.4.6 | ^ | — | — |
| class-variance-authority / tailwind-merge | 0.7.1 / 3.7.0 | idem | ^ | — | — |
| react-hook-form / @hookform/resolvers | 7.88.0 / 5.9.1 | idem | ^ | — | resolvers peer `zod ^3.25‖^4` |
| zod | 4.6.5 | **4.6.5** | ^4.6 | 4.6.0 em 2026-09-09 | alinhado ao `zod ^4.5.4` do Better Auth (dedupe) |

### 1.6 Testes

| Pacote | `latest` | Recomendado | Pin | Data | Motivo |
|---|---|---|---|---|---|
| vitest | 5.0.1 | **5.0.1** (alternativa 4.1.11) | ^5.0 | 5.0.0 em 2026-09-03; 5.0.1 em 2026-09-15 | Node `^22.12‖^24‖>=26`; peer `vite ^6.4‖^7‖^8` (**não embutido**) |
| vite | 8.3.0 | **8.3.0** | ^8 | — | Rolldown + Oxc; opção `esbuild` deprecada (convertida para `oxc`) |
| @vitejs/plugin-react | 6.1.1 | opcional | ^6 | — | peer `vite ^8`. Merlostore dispensa (config em `config/vitest.config.ts:6-10`) |
| jsdom | 30.0.1 | **29.1.1** (ou 30 com Node ≥24.15) | ^ | — | engines do 30: `^22.22.2‖^24.15.0‖>=26` |
| @testing-library/react | 16.3.3 | 16.3.3 | ^ | — | peer `@testing-library/dom ^10`, React 19 ok |
| @testing-library/jest-dom | 7.0.1 | 7.0.1 | ^ | — | — |

---

## 2. Next.js 16 — breaking changes e regras que o código novo precisa respeitar

Fonte primária: guia oficial de upgrade (versão da doc 16.3.5, atualizado 2026-08-25).

### 2.1 Requisitos
- Node **≥ 20.9.0**; TypeScript **≥ 5.1.0**; navegadores Chrome/Edge/Firefox 111+, Safari 16.4+.

### 2.2 Build e ferramentas
- **Turbopack é padrão** em `next dev` e `next build`. Havendo `webpack` custom no `next.config`, o **build falha** (usar `--webpack` para sair). Config sai de `experimental.turbopack` para `turbopack` (topo).
- Cache em disco do Turbopack ligado por padrão em dev e build (`experimental.turbopackFileSystemCacheForDev/ForBuild`).
- **`next lint` removido**; `next build` **não roda lint**; chave `eslint` do `next.config` removida. Script de lint vira `eslint .` com `eslint.config.mjs` (flat config). Codemod: `npx @next/codemod@canary next-lint-to-eslint-cli .`.
- `next dev` grava em **`.next/dev`**; lockfile impede dois `next dev` (ou dois `next build`) no mesmo projeto.
- Saída do build não mostra mais `size`/`First Load JS`.
- `process.argv` com `'dev'` no `next.config` passa a ser `false` em `next dev` (usar `NODE_ENV`/`phase`).
- **`next dev` escreve/mantém um bloco gerenciado no `AGENTS.md`** (16.2+/16.3) apontando para `node_modules/next/dist/docs/`. O repositório já tem `AGENTS.md` da base: prever o bloco `<!-- BEGIN:nextjs-agent-rules -->` e commitá-lo, senão ele reaparece como diff a cada `dev`.

### 2.3 APIs de request 100% assíncronas
- `cookies()`, `headers()`, `draftMode()` **só** com `await`.
- `params` (em `page`, `layout`, `route`, `default`, `opengraph-image`, `twitter-image`, `icon`, `apple-icon`) e `searchParams` (em `page`) são **Promise**.
- Em `opengraph-image`/`icon`: `params` e `id` são Promise; `generateImageMetadata` segue síncrono. Em `sitemap`, `id` é `Promise<string>`.
- Tipagem: `npx next typegen` gera os helpers globais `PageProps<'/rota/[id]'>`, `LayoutProps`, `RouteContext`.
- Consequência para o legado: o HUG ainda usa `requireUser(headers())` síncrono em exemplo (`src/lib/auth/guard.ts:27`) — em 16 é `await headers()`.

### 2.4 `middleware.ts` → `proxy.ts`
- Renomear arquivo e função exportada para `proxy`. `middleware` segue funcionando, mas deprecado.
- `proxy` roda **só no runtime `nodejs`** (não configurável). Edge exige manter `middleware`.
- Flags renomeadas: `skipMiddlewareUrlNormalize` → `skipProxyUrlNormalize`.
- **Não é fronteira de segurança** (armadilha 3). Evidência recente: CVE-2026-64642 (jul/2026) permitia **bypass** do middleware/proxy em App Router + Turbopack + `i18n.locales` com uma entrada. Toda página, route handler e action confere sessão por conta própria.
- Com Node runtime, é possível validar a sessão completa no proxy (`auth.api.getSession({ headers: await headers() })`), mas isso é conforto de UX (redirect), não controle.

### 2.5 Cache
- `revalidateTag(tag)` com 1 argumento está deprecado e dá **erro de tipo**: usar `revalidateTag(tag, 'max')` (perfil `cacheLife`).
- **`updateTag(tag)`** (novo, só em Server Actions): expira e recarrega na mesma requisição (read-your-writes) — é o que tela de cadastro com optimistic locking quer.
- **`refresh()`** (novo, `next/cache`): atualiza o router do cliente a partir de uma action.
- `cacheLife` e `cacheTag` estáveis (sem `unstable_`).
- `experimental.ppr`, `experimental_ppr`, `experimental.dynamicIO`, `experimental.useCache` **removidos**. Substituto: `cacheComponents: true` (topo) — **não é renomeação**: ligar faz o build acusar dado não cacheado fora de `<Suspense>`.
- 16.3 adiciona `partialPrefetching: true` (Instant Navigations, opt-in). Recomendação oficial: não ligar modelos novos de cache no mesmo commit da migração.

### 2.6 `next/image` (relevante para mídia no MinIO)
- **Imagem local com query string** exige `images.localPatterns[].search`. A rota do Merlostore `GET /api/media/[id]/raw?thumb=1` (ADR 0006) cai aqui se passar por `next/image`; alternativa: `unoptimized` para mídia privada (e ela já tem `Cache-Control: private`).
- `images.dangerouslyAllowLocalIP` agora bloqueado por padrão: otimizar imagem de `localhost:9002` (MinIO de dev) retorna 400.
- `minimumCacheTTL` padrão 60 s → **4 h**; `imageSizes` sem 16; `qualities` padrão **`[75]`**; `maximumRedirects` padrão 3.
- `images.domains` deprecado (usar `remotePatterns`); `next/legacy/image` deprecado.
- Next 16.3.3 **desliga otimização AVIF** (RCE via libheif).

### 2.7 Outras remoções e mudanças
- Parallel routes: **todo slot precisa de `default.js`** (senão o build falha).
- AMP removido; `serverRuntimeConfig`/`publicRuntimeConfig` removidos (usar env; `await connection()` antes de ler `process.env` em runtime).
- `devIndicators.appIsrStatus/buildActivity/buildActivityPosition` removidos.
- `unstable_rootParams` removido → `next/root-params` (16.3: `import { lang } from 'next/root-params'`).
- Next não sobrescreve mais `scroll-behavior: smooth` na navegação (opt-in via `data-scroll-behavior="smooth"` no `<html>`).
- `reactCompiler: true` estável (não padrão; exige `babel-plugin-react-compiler`); 16.3 tem `experimental.turbopackRustReactCompiler`.
- 16.3: `catchError` (`next/error`) para error boundary que não engole `notFound`/`redirect`; `import.meta.glob`; `experimental.useOffline`; suporte a TS 7 no `next build` (`useTypeScriptCli`).

### 2.8 Server Actions — regras de segurança (doc "data-security", 16.3.5)
- Toda action exportada é **alcançável por POST direto**, mesmo sem uso na UI. IDs são criptografados e recalculados por build, mas isso **não** substitui autenticação.
- Verificação de sessão da **página não se estende** à action: reautenticar e **autorizar o recurso** (IDOR) dentro de cada action (ou num DAL `server-only`).
- Validar todo input (FormData, params, searchParams, headers).
- **Filtrar retorno** (não devolver linha crua do banco).
- Proteção CSRF: só POST + comparação `Origin` × `Host`/`X-Forwarded-Host`. Atrás de proxy com host diferente: `experimental.serverActions.allowedOrigins`.
- Variáveis capturadas em closure são cifradas por build; com **mais de uma instância** (HML/PRD com várias réplicas ou web + outro processo servindo actions), definir `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` (base64 de 32 bytes).
- `experimental.taint` + `experimental_taintObjectReference`/`experimental_taintUniqueValue` como segunda camada.
- Proibido mutar em render (logout por `searchParams` etc.).
- Checklist oficial de auditoria: DAL isolado; props de `"use client"` sem dado privado; em `"use server"`: input validado, reautorização, posse do recurso, retorno filtrado; `[param]` é input; `proxy.ts` e `route.ts` merecem pentest.

### 2.9 Advisories do Next que definem a versão mínima
| Release | Versões corrigidas | Itens |
|---|---|---|
| Jul/2026 (20/07) | 16.2.11, 15.5.21, entra no 16.3.0 | CVE-2026-64641 (DoS via Server Actions, High), -64642 (bypass de proxy, High), -64645 (SSRF em rewrites, High), -64649 (SSRF em actions com servidor custom, High), -64644 (DoS image SVG), -64646 (payload ilimitado em action edge), -64643 (divulgação de IDs de Server Function), -64648/-64647 (confusão de cache em `fetch` com body) |
| Ago/2026 (25/08) | **16.3.3**, 15.5.24 | GHSA-2xp9-vwfh-vxw4 (RCE no Image Optimization com AVIF via libheif/sharp, **Critical**); CVE-2026-75604 (RCE em servidor **Windows**, App+Pages Router sem Cache Components, **Critical**) |

---

## 3. Better Auth 1.7 — o que confirmar no desenho

### 3.1 Mudanças da 1.7 (em relação ao HUG, que roda 1.6.25)
- **Pacotes separados**: `@better-auth/passkey`, `@better-auth/sso`, `@better-auth/api-key`, `@better-auth/oauth-provider` (substitui `oidcProvider`, deprecado), `@better-auth/scim`, `@better-auth/stripe`, `@better-auth/expo`, `@better-auth/electron`, `@better-auth/redis-storage`. Adapters: `@better-auth/{drizzle,kysely,prisma,mongo,memory}-adapter` (dependências do core; import público segue `better-auth/adapters/drizzle`).
- Continuam no core (`better-auth/plugins`): `admin`, `twoFactor`, `emailOTP`, `bearer`, `customSession`, `anonymous`, `deviceAuthorization`, `access` (`better-auth/plugins/access`) e `better-auth/plugins/admin/access`. Cliente: `better-auth/react`, `better-auth/client/plugins`. Next: `better-auth/next-js`. Cookies: `better-auth/cookies`.
- **Schema `account`**: 1.7.0–1.7.2 exigiam `issuer`; **1.7.3 reverteu** para `providerId` + `accountId` (`issuer` opcional). Projeto novo em 1.7.5 **não** precisa de `issuer`.
- Modelo de identidade de contas externas normalizado (issuer + subject) — só afeta login social/SSO (não previsto aqui).
- `enableTwoFactor` agora recebe `method: 'totp' | 'otp'` e retorna `{ method, totpURI, backupCodes }` ou `{ method: 'otp' }`.
- `advanced.database.joins` saiu de experimental.
- **Adapters customizados** precisam implementar métodos novos para "ações de uso único e contadores" — pesa contra a opção "adapter com soft delete" (§5.4 C).
- CLI: `npx auth generate` / `npx auth migrate` / `npx auth create-admin`. A migração gerada não cobre dados (só relevante para quem já tinha contas externas).
- `hydrateSession` evita request extra no servidor; passkey pode criar sessão no registro.

### 3.2 Integração com Next 16 (doc oficial)
```ts
// src/app/api/auth/[...all]/route.ts
import { toNextJsHandler } from "better-auth/next-js";
export const { GET, POST } = toNextJsHandler(auth);

// server component / action
const session = await auth.api.getSession({ headers: await headers() });
```
- `nextCookies()` **deve ser o último plugin** (senão actions não gravam cookie).
- Fora do Next (worker, seed, WS) usar instância **sem** `nextCookies` (gotcha do HUG, `docs/STATUS.md` "Decisões / gotchas").
- `getSessionCookie(request)` só confere **presença** do cookie; não valida.

### 3.3 Opções que o endurecimento precisa fixar (nomes exatos e defaults)
| Opção | Default | Observação para o desenho |
|---|---|---|
| `emailAndPassword.disableSignUp` | `false` | **true** (HUG `src/lib/auth/auth.ts:80` explica o vazamento com cadastro aberto) |
| `emailAndPassword.minPasswordLength` / `maxPasswordLength` | 8 / 128 | régua: 15 se fator único; 8 só com 2FA real |
| `emailAndPassword.password.hash` / `.verify` | scrypt (`@noble/hashes`) | Argon2id via `@node-rs/argon2` (régua) |
| `emailAndPassword.revokeSessionsOnPasswordReset` | **false** | ligar |
| `emailAndPassword.requireEmailVerification` | false | decidir (usuários criados por admin) |
| `session.expiresIn` / `updateAge` / `freshAge` | 7 d / 1 d / 1 d | régua: teto absoluto ≤ 24 h e inatividade ≤ 1 h |
| `session.cookieCache.enabled` / `maxAge` / `strategy` | false / — / `compact`‖`jwt`‖`jwe` | **manter desligado**: sessão revogada segue válida até `maxAge` |
| `session.storeSessionInDatabase` / `preserveSessionInDatabase` | false / false | só fazem efeito com `secondaryStorage` (§5.4) |
| `verification.storeInDatabase` / `disableCleanup` | false / false | `disableCleanup` só pula a limpeza "na leitura" |
| `rateLimit.enabled` | só em produção | ligar também em dev/HML para testar |
| `rateLimit.storage` | `"memory"` | `"database"` (tabela `rateLimit`) ou `"secondary-storage"`; memória viola a régua |
| `rateLimit.window` / `max` / `customRules` | 60 / 100 / — | regras por caminho; `false` desliga um caminho; resposta 429 com `X-Retry-After` |
| `advanced.ipAddress.ipAddressHeaders` / `trustedProxies` / `disableIpTracking` / `ipv6Subnet` | `x-forwarded-for` / — / false / `/64` | sem `trustedProxies`, XFF com >1 valor não resolve IP e tudo cai num balde único (HUG `auth.ts:149-175`) |
| `advanced.database.generateId` | id texto | `"uuid"` (PG gera) ou função |
| `advanced.useSecureCookies` / `cookiePrefix` / `defaultCookieAttributes` | por ambiente | forçar `secure` em HML/PRD |
| `advanced.disableCSRFCheck` / `disableOriginCheck` | false | **nunca** ligar |
| `trustedOrigins` | baseURL | aceita array, função async e curingas |
| `account.accountLinking.enabled` / `allowDifferentEmails` | true / false | sem login social → pode desligar |
| `user.deleteUser.enabled` | false | manter desligado (delete físico) |
| `logger.level` / `telemetry.enabled` | `warn` / false | — |
| `hooks.before/after` (`createAuthMiddleware`) | — | funil para trilha de login/logout/falha |
| `databaseHooks.{user,session,account,verification}.{create,update,delete}.{before,after}` | — | `before` retornando `false` aborta a operação |
| `{modelName, fields}` por modelo | nomes em inglês | permite tabelas/colunas em PT (`user: { modelName: "usuarios", fields: {...} }`); **a inferência de tipos continua com os nomes originais** |

### 3.4 Plugins necessários
- **admin** (`better-auth/plugins`): `ac`, `roles`, `defaultRole`, `adminRoles`; `banUser`/`unbanUser`/`revokeUserSessions`/`createUser`. HUG: `src/lib/auth/auth.ts:183-188`, `src/app/api/team/route.ts:12,232,241`. Não conceder `user:delete` (remoção física).
- **twoFactor** (`better-auth/plugins`) + `twoFactorClient` (`better-auth/client/plugins`): opções `issuer`, `totpOptions`, `otpOptions.sendOTP`, `backupCodeOptions`, `skipVerificationOnEnable`, `twoFactorCookieMaxAge`, `allowPasswordless`. Schema: tabela `twoFactor` + coluna `user.twoFactorEnabled`. Login devolve `twoFactorRedirect: true` e `twoFactorMethods`. **Não há obrigatoriedade global nativa**.
- **passkey** (`@better-auth/passkey`, cliente `@better-auth/passkey/client`): `rpID`, `rpName`, `origin`, `authenticatorSelection`, `registration.requireSession` (default true). Tabela `passkey` (gerar com `npx auth generate` e conferir colunas). A régua exige `userVerified: true` no servidor (`docs/seguranca-login.md:73-74`).

### 3.5 Advisories Better Auth
- Lote de jun/2026 (12 advisories, 2 críticos em SSO e core OIDC/MCP): corrigidos em `better-auth@1.6.11–1.6.14`, `@better-auth/sso@1.6.11`, `@better-auth/oauth-provider@1.6.5/1.6.11`, `@better-auth/scim@1.7.0-beta.4`.
- 11/08/2026: GHSA-8c5h-wx78-2cfg (High) — posse de domínio no **SSO**.
- Nada listado especificamente contra core/admin/2FA/passkey na linha 1.7.5 na data da consulta (página de advisories vista parcialmente). Linha 1.6 segue mantida (1.6.33 em 14/09). Regra da casa: conferir no **lockfile**, não no `package.json` (HUG declara `^1.2.0` e tem 1.6.25 instalado).

---

## 4. Demais breaking changes a respeitar

### 4.1 Zod 4 (Merlostore já declara ^4.3.6; referências usam Zod 3.25)
- `z.string().email()/.uuid()/.url()` deprecados → `z.email()`, `z.uuid()`, `z.url()`. UUID estrito (RFC 9562/4122); `z.guid()` para formato solto.
- Parâmetro `message` deprecado → `error`; `invalid_type_error`/`required_error` removidos; `errorMap` → `error`.
- `.format()`/`.flatten()` deprecados → `z.treeifyError()` (e `z.prettifyError()`).
- `.strict()`/`.passthrough()` → `z.strictObject()`/`z.looseObject()`; `.merge()` → `.extend()`; `.deepPartial()` removido.
- `z.record()` exige 2 argumentos; `z.nativeEnum()` → `z.enum()`; `.nonempty()` = `.min(1)`.
- `.default()` aplica ao tipo de saída; `z.coerce.*` tem input `unknown` (ex.: `updatedAtSchema = z.coerce.date()` do espaco-flow `src/lib/validators/comum.ts:19` segue válido).
- `z.number()` sem infinitos; `.int()` só inteiros seguros; `.ip()` → `z.ipv4()/z.ipv6()`.
- `z.function()` redesenhado (`input`/`output` + `.implement()`); `.refine()` sem type predicate; `ctx.path` removido.

### 4.2 Drizzle 0.45 / drizzle-kit 0.31
- Terceiro parâmetro de `pgTable` deve **retornar array**: `(t) => [index("...").on(t.col)]`. A forma objeto (`(t) => ({ ... })`) está **deprecada desde 0.36** — espaco-flow usa a forma antiga (`src/lib/db/schema/usuarios.ts:30-33`, `auditoria.ts:32-36`, `jobs.ts:31-33`).
- Armadilha 1 (precisão): coluna `timestamp` do PG tem precisão 6 (µs) por padrão; `Date` do JS tem ms. `defaultNow()` grava µs, o app lê truncado e `eq(updated_at, original)` nunca bate. Usar `timestamp("updated_at", { precision: 3, withTimezone: true, mode: "date" })` e `$onUpdate(() => new Date())` (decidir `withTimezone`; HUG usa `withTimezone: true` com `mode: "string"` sem `precision`, `src/lib/db/schema/_helpers.ts:35-43`).
- `drizzle.config.ts` com `migrations: { schema: "drizzle" }` (HUG `drizzle.config.ts:25`) isola a tabela de controle de migração.
- 1.0 (RC) muda Relational Queries (v1→v2), formato da pasta de migrações e move validadores para `drizzle-orm/zod`: **não** misturar RC com 0.45.

### 4.3 Tailwind v4 + shadcn CLI v4
- Sem `tailwind.config.ts`: `@import "tailwindcss"` + `@theme inline` no CSS; PostCSS com `@tailwindcss/postcss`.
- `components.json` em v4: `tailwind.config` deve ser **string vazia**. O Merlostore atual aponta para `tailwind.config.ts` (`components.json:7`).
- `tailwindcss-animate` → `tw-animate-css` (`@import "tw-animate-css"`).
- Cores OKLCH; primitivos com `data-slot`; sem `forwardRef` (`React.ComponentProps`); `toast` → `sonner`.
- `style` = `{radix|base|aria}-{vega|nova|maia|lyra|mira|luma|sera|rhea}`. Trocar biblioteca exige reinstalar componentes com `--overwrite`.

### 4.4 BullMQ 6
- Removidos: `Queue.add/addBulk(..., { repeat })`, `getRepeatableJobs`, `removeRepeatable`, `removeRepeatableByKey`, classe `Repeat` → **`upsertJobScheduler` / `getJobSchedulers` / `removeJobScheduler`**; `repeat.utc` → `{ tz: 'UTC' }`. Metadados legados de repeatable **dão erro** no v6 (irrelevante em banco/Redis novo).
- `debounce` removido → deduplicação.
- `Queue#client`, `Queue#redisVersion`, `Queue#databaseType`, `Worker#blockingClient`, `FlowProducer#client` removidos (acesso via `getBackend()`); `Worker#waitUntilReady()` resolve `void`; `Queue.resume()`/`Worker.resume()` assíncronos.
- IDs de jobs de flow sem `jobId` viram UUID.
- `ioredis` não vem mais junto: instalar explicitamente. Conexão aceita opções (`{ host, port }`), instância `IORedis` reutilizável (worker duplica internamente; `maxRetriesPerRequest: null`) ou backend factory.
- jobId **não pode conter `:`** (gotcha registrado no HUG `src/lib/queue/queues.ts:162` e espaco-flow `src/lib/fila/dispatch.ts:19`).
- **Backend PostgreSQL** (`createPostgresBackend`, último argumento do construtor): estável, PG ≥ 13 (14+ recomendado), peer `pg`; schema padrão `bullmq`; migração **não automática** (`runMigrations()`, idempotente); API completa (schedulers, limiter, QueueEvents, flows, dedupe); throughput ~1,5–2× menor que Redis (~11k vs ~18k jobs/s).

### 4.5 ioredis 6
- Node ≥ 20; **RESP3 por padrão** (`HELLO 3`, cai para RESP2 em Redis < 6); `protocol: 2` restaura v5. Formas de resposta usadas pelo BullMQ não mudam.

### 4.6 Vitest 5 / Vite 8
- `clearMocks` padrão **true**; `resolves`/`rejects` sem `await` reprovam o teste; `bench` virou fixture de contexto; locators estritos (modo browser).
- `vite` deixou de ser dependência do vitest: instalar `vite@^8`.
- Vite 8 usa Rolldown/Oxc: bloco `esbuild` deprecado (convertido para `oxc`). Merlostore usa `esbuild: { jsx: "automatic" }` (`config/vitest.config.ts:10`) → migrar para `oxc`.

### 4.7 TypeScript 6 (ponte para o 7)
- TS 7 remove (e o 6 deprecia) `target: es5`, `baseUrl`, `moduleResolution: node10`. `tsconfig` novo: `moduleResolution: "bundler"`, `paths` sem `baseUrl`, `strict: true`.
- Se quiser `tsc` rápido do 7 no CI: instalar `@typescript/native` (7) lado a lado com `typescript` = 6 (pacote `@typescript/typescript6@6.0.2` existe) — só depois do typescript-eslint suportar 7.1.

---

## 5. Padrões reaproveitáveis — HUG Atende (`C:\Users\Paulo\Documents\HUG\hug-atende`)

Versões instaladas (lockfile/node_modules): next **14.2.35**, react 18.3.1, better-auth **1.6.25** (package.json diz `^1.2.0`), drizzle-orm 0.45.2, drizzle-kit 0.31.10, bullmq 5.79.1, ioredis 5.10.1, zod 3.25.76, pg 8.22.0, minio 8.0.7, @anthropic-ai/sdk 0.96.0, tailwind 3.4.

### 5.1 Autenticação e RBAC
| Padrão | Onde | Reaproveitar como |
|---|---|---|
| Instância única do Better Auth com adapter Drizzle `provider: "pg"` e schema explícito | `src/lib/auth/auth.ts:50-64` | igual, com opções da §3.3 |
| Guarda de build: não lança sem `BETTER_AUTH_SECRET` durante `NEXT_PHASE=phase-production-build`, lança em runtime | `auth.ts:41-48`; mesmo truque no DB `src/lib/db/client.ts:27-33` | igual |
| Cadastro público desligado, com justificativa | `auth.ts:69-84` | igual |
| Rate limit por rota com `customRules` e explicação do NAT do escritório | `auth.ts:127-147` | trocar `storage` para `database` |
| `advanced.ipAddress.trustedProxies` com faixas privadas (Traefik/Docker) | `auth.ts:166-175` | ajustar para a topologia real (EasyPanel) |
| Access control por recurso × ação (`createAccessControl`, `ac.newRole`) espelhado no cliente | `src/lib/auth/permissions.ts:31-93`; `client.ts:26-34` | base para papéis com escopo de loja |
| Guard server-side único: `requireUser`, `requireRole`, `requireArea` (uma resolução de sessão), `requirePermission`, `AuthError(401/403)`, `RateLimitError(429)`, `toAuthErrorResponse` | `src/lib/auth/guard.ts:66-277` | **padrão central**; adicionar `requireLoja` |
| Teto por usuário em toda rota autenticada + teto apertado para rotas que disparam WhatsApp/IA (`requireSender`) | `guard.ts:142-146`, `165-174` | igual (protege número contra banimento) |
| Áreas por pessoa (catálogo único para menu, guard e tela) + anti-lockout do admin | `src/lib/auth/areas.ts:43-132` | opcional |
| Handler catch-all fino | `src/app/api/auth/[...all]/route.ts:13-16` | igual |
| Tabelas Better Auth com FK `onDelete: "restrict"` | `src/lib/db/schema/auth.ts:37-40`, `55-57` | igual |

### 5.2 Banco, auditoria, segredos
| Padrão | Onde | Observação |
|---|---|---|
| Helpers `id()`, `audit()`, `soft()` spread nas tabelas | `src/lib/db/schema/_helpers.ts:20-52` | trocar para `precision: 3` e nomes PT |
| Pool `pg` singleton em `globalThis` (HMR) e `max` por env | `src/lib/db/client.ts:34-50` | igual |
| Runner de migração com `migrationsSchema: "drizzle"` | `src/lib/db/migrate.ts:14-28`; `drizzle.config.ts:19-28` | igual |
| Trilha **append-only**, sem FK, sem `updated_at`/soft delete, `jsonb metadata`, índices por entidade/ação/categoria | `src/lib/db/schema/audit.ts:22-55` | melhor modelo das duas referências; exige exceção documentada à regra das 5 colunas |
| `logAudit` best-effort que nunca lança + `listAudit` paginado (máx. 500) | `src/lib/audit/auditService.ts:69-137` | a régua exige **modo síncrono** (grava antes, falhou não concede) para ações destrutivas — prever os dois modos |
| Cofre AES-256-GCM, envelope `iv.tag.dados` em base64 | `src/lib/security/secrets.ts:26-70` | Merlostore decidiu chave própria `INTEGRATIONS_KEY` (`docs/integracoes.md:360-363`), não derivada do segredo de auth |
| Logger pino com `redact` de token/senha | `src/lib/logger.ts:23-40` | igual |

### 5.3 Rate limit e IP
| Padrão | Onde |
|---|---|
| Janela fixa `MULTI INCR + EXPIRE NX` num round trip (auto-cura chave sem TTL) | `src/lib/security/rate-limit.ts:80-90` |
| Fail-open deliberado quando Redis cai, com log | `rate-limit.ts:102-106` |
| Perfis `apiRead`, `outbound`, `webhook` com justificativa numérica | `rate-limit.ts:44-65` |
| Conexão Redis dedicada ao rate limit sem offline queue e `commandTimeout: 200` (senão o painel trava com Redis fora) | `src/lib/queue/connection.ts:84-95` |
| `clientIp` = **último** valor do XFF (topologia cliente→Traefik→app) | `rate-limit.ts:138-145` |

### 5.4 Fila e worker
| Padrão | Onde |
|---|---|
| Conexões Redis separadas: fila, publisher, lock, rate limit; `createSubscriber()`; `closeConnections()` | `src/lib/queue/connection.ts:51-129` |
| Nomes canônicos de fila, `defaultJobOptions` (attempts por env, backoff exponencial, `removeOnComplete: {count}`, `removeOnFail: false`) | `src/lib/queue/queues.ts:44-70` |
| `assertJobIdPart` (id vazio/"TODO" colide e deduplica tudo) e jobId determinístico por `providerMessageId` | `queues.ts:164-180` |
| Debounce de IA por conversa (remove + add; turno de recuperação quando o job está ativo) | `queues.ts:195-211` |
| Exclusão mútua por conversa: `SET NX PX` + Lua compare-and-delete/extend + heartbeat + `moveToDelayed` + `DelayedError` | `src/lib/queue/conversation-lock.ts:39-107` |
| Worker: concorrência por fila, `limiter` só no outbound, DLQ `<fila>:dlq` ao esgotar tentativas, boot resiliente (lê rate do banco com fallback), graceful shutdown | `src/server/worker.ts:42-199` |

### 5.5 WhatsApp e webhook
| Padrão | Onde |
|---|---|
| Interface `WhatsAppProvider` com capacidades **opcionais** (presença do método = suporte): `sendDocument?`, `sendAudio?`, `sendPresence?`, `markAsRead?`, `connectInstance?`...; `enforcesServiceWindow` (Meta = janela 24 h) | `src/lib/whatsapp/provider.ts:203-292` |
| Tipos normalizados `NormalizedMessage` (com `toPhone` para multi-número, `fromMe`, `sentByApi`), `NormalizedStatus`, `ParsedWebhook` | `provider.ts:43-99` |
| `verifyWebhook` único para handshake GET e assinatura POST | `provider.ts:291-311` |
| Meta: HMAC-SHA256 do corpo cru (`X-Hub-Signature-256`) com `timingSafeEqual`; timeouts 20 s (HTTP) e 60 s (mídia) | `src/lib/whatsapp/meta.adapter.ts:23`, `44-46` |
| UAZAPI: segredo compartilhado em tempo constante, timeout 20 s (fetch pendurado congelava a fila) | `src/lib/whatsapp/uazapi.adapter.ts` (cabeçalho e `HTTP_TIMEOUT_MS`) |
| `isProviderConfigured()` para o `/api/health` ficar vermelho quando env some | `src/lib/whatsapp/index.ts:53-71` |
| Webhook: 413 por `content-length` antes do corpo; leitura com teto de 256 KB (chunked); assinatura antes de tocar banco; rate limit **só** para assinatura inválida; JSON inválido → 200; persistência idempotente + enqueue; 500 quando persistir falha (Meta reentrega) | `src/app/api/webhook/whatsapp/route.ts:44-188`; decisão #5 em `docs/STATUS.md` |
| Janela de 24 h (`isWithinServiceWindow`) e template de reengajamento | `src/lib/whatsapp/service-window.ts`; `docs/STATUS.md` (M2) |

### 5.6 Borda e infra
- Headers de segurança globais (HSTS 1 ano + includeSubDomains, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`), `output: "standalone"`, `poweredByHeader: false`: `next.config.mjs:14-46`. CSP deixada de fora de propósito.
- docker-compose com healthchecks (`pg_isready`, `redis-cli ping`, `mc ready local`) e Redis `--appendonly yes`: `docker-compose.yml:22-81`.

### 5.7 Armadilhas vistas no HUG
1. **`cookieCache` de 5 min** (`auth.ts:100-103`): ban e troca de papel levam até 5 min para valer — viola "papel e `is_active` na próxima requisição".
2. **Rate limit do Better Auth em memória** (comentário `auth.ts:123-126`), só por IP, **sem bloqueio por conta**.
3. `minPasswordLength: 8` sem segundo fator (`auth.ts:83`) — abaixo da régua.
4. **Login/logout não entram na trilha**: `auth.login` só aparece em comentários (`auditService.ts:47`, `schema/audit.ts:26`); nenhum hook do Better Auth grava evento.
5. Tabelas do Better Auth isentas das colunas de auditoria e com delete físico (`schema/auth.ts:4-9`), sem ADR.
6. `requirePermission` usa checagem local com TODO (`guard.ts:233-236`).
7. Credenciais do seed **literais** em `docs/STATUS.md` (seção "O que está pronto", item Auth) — viola a régua (`seguranca-login.md:68-69`, `137`).
8. `deleteSecret` com delete físico (`secrets.ts:113-115`); chave do cofre derivada do `BETTER_AUTH_SECRET` (girar o segredo invalida credenciais, `secrets.ts:8-11`).
9. Provider do WhatsApp escolhido por **env global** (`index.ts:36-42`): EasyPanel reverte env a cada deploy → 401 mudo (`index.ts:47-52`). Merlostore precisa de provider **por número/conta** vindo do banco.
10. `timestamp` com `mode: "string"` sem `precision` (`_helpers.ts:36-41`) → armadilha 1.
11. `repeat: { every }` no worker (`worker.ts:165`) — removido no BullMQ 6.
12. `meta.adapter` com `META_GRAPH_VERSION` padrão `v18.0` (`meta.adapter.ts:69`) — versão antiga da Graph API como default.
13. `middleware.ts` só confere presença do cookie e cobre 3 prefixos (`src/middleware.ts:14-26`).

---

## 6. Padrões reaproveitáveis — espaco-flow (`C:\Users\Paulo\Documents\estrutura base\espaco-flow`)

Versões instaladas: next **15.5.19**, react 19.2.7, drizzle-orm **0.38.4**, drizzle-kit 0.30.6, postgres.js 3.4.9, bullmq 5.78.1, zod 3.25.76, vitest 2.1.9. Auth **própria** (bcryptjs + tabela `sessoes`), sem Better Auth.

### 6.1 O que vale copiar
| Padrão | Onde |
|---|---|
| Matriz RBAC `recurso:acao` com **negação por padrão** + teste puro | `src/lib/auth/rbac.ts:42-96`; `rbac.test.ts:1-24` |
| `exigirPermissao` centraliza sessão + permissão e **grava `acesso_negado`** na trilha | `src/lib/actions/_helpers.ts:8-21` |
| Optimistic locking robusto: transação + `SELECT ... FOR UPDATE` + comparação por epoch ms (contorna µs × ms) | `_helpers.ts:29-54` |
| Sessão validada **no banco a cada requisição** (join com `usuarios.is_deleted`) → papel sempre fresco | `src/lib/auth/session.ts:17-42` |
| Hash dummy para nivelar tempo quando o e-mail não existe | `src/lib/actions/auth.ts:17-19`, `38-41` |
| Logout por soft delete da sessão | `auth.ts:118-129` |
| Tabelas com as 5 colunas + FK `restrict` + nomes PT | `src/lib/db/schema/usuarios.ts:7-61` |
| Action de CRUD com `useActionState` (`FormState = { erro? }`), Zod `safeParse`, `primeiroErro`, checagem de duplicidade, auditoria por operação | `src/lib/actions/clientes.ts:1-120` |
| Trilha de jobs no Postgres com `idempotency_key` UNIQUE e status `pendente→processando→concluido|falhou|dlq` (o broker é o BullMQ) | `src/lib/db/schema/jobs.ts:8-34`; `src/lib/fila/worker.ts:27-76` |
| DLQ que **avisa a equipe** (job morto = cliente sem resposta) | `worker.ts:63-76` |
| Conexão BullMQ por **opções** (não instância), `maxRetriesPerRequest: null` | `src/lib/fila/conexao.ts:7-15` |
| Webhook: só `messages.upsert` vira mensagem (ACK/presença geravam mensagem fantasma); `fromMe` não aciona IA | `src/app/api/whatsapp/webhook/route.ts:62-77` |
| Provider "sandbox" quando não configurado (dev sem WhatsApp) | `src/lib/whatsapp/provider.ts:88-113` |
| Mídia: extensão pelo mimetype real, teto 16 MB, timeout 8 s no download, **nunca silenciar falha** | `src/lib/storage/midia.ts:10-76` |
| Telefone BR: variantes com/sem 9º dígito, `0` de tronco, canônico `55+DDD+9...` — com testes de casos reais | `src/lib/whatsapp/telefone.test.ts:1-50`; `src/lib/validators/comum.ts:4-8` |
| Vitest: `environment: jsdom`, `globals`, setup com `@testing-library/jest-dom/vitest`, alias `@` | `vitest.config.ts:1-19`; `src/test/setup.ts:1` |
| `serverExternalPackages` para libs Node com require dinâmico; `outputFileTracingRoot` (há outro lockfile em `C:\Users\Paulo`) | `next.config.mjs:10-13` |

### 6.2 Armadilhas vistas no espaco-flow
1. **Segredo do webhook comparado com `===` e aceito por query string** (`?token=`), opcional fora de produção: `route.ts:9-16`, `24` — é exatamente a armadilha registrada em `seguranca-login.md:138`.
2. IP da sessão/auditoria a partir de `x-forwarded-for` **cru**: `actions/auth.ts:87-88`, `111`.
3. Mensagem diferente para conta bloqueada ("Muitas tentativas...") revela que a conta existe: `auth.ts:52`.
4. Bloqueio por conta **não atômico** (lê, decide, grava): `auth.ts:57-66`.
5. bcryptjs em vez de Argon2id (`auth.ts:7`).
6. Bucket MinIO com **leitura pública** forçada a cada upload: `src/lib/storage/minio.ts:36-49` — contraria o ADR 0006 do Merlostore (bucket privado).
7. Tabela `auditoria` com colunas de soft delete e FK para `usuarios` (`schema/auditoria.ts:14`, `25-30`) → não é append-only.
8. Terceiro parâmetro de `pgTable` em forma de objeto (deprecado): `usuarios.ts:30-33`, `auditoria.ts:32-36`, `jobs.ts:31-33`.
9. `timestamp` sem timezone e precisão padrão (µs): `usuarios.ts:24-27` → obrigou o contorno por epoch.
10. `repeat: { pattern, tz }` (`src/lib/fila/filas.ts:53`, `83`) — removido no BullMQ 6.
11. Fallback **inline** quando Redis cai (`src/lib/fila/dispatch.ts:34-39`): perde ordem FIFO e pode duplicar.
12. URLs/credenciais de dev como fallback no código (`src/lib/db/index.ts:5-6`, `drizzle.config.ts:9`, `minio.ts:22-23`) — env ausente passa despercebida.
13. `middleware.ts` só confere presença do cookie e ignora `/api/*` (`src/middleware.ts:15-31`).
14. **Arquivos-lixo na raiz** gerados por shell mal escapado (`a.created_at.getTime()`, `{console.log('DB`, `}`, `0`, `undefined)`, `multiplo`) — a base já tem `scripts/limpar-lixo-raiz.mjs`.
15. `z.string().email()` (`comum.ts:14`) — forma deprecada no Zod 4.

---

## 7. MerlostoreChat — estado atual relevante para as versões (só referência)

- Branch `refactor/reconstrucao-estrutura-base`, HEAD `5e902d4`.
- `package.json`: next 14.2.35, next-auth 4.24.13, prisma 7.5, react 18, tailwind 3.4 **com** `tw-animate-css`, `@base-ui/react ^1.3`, `shadcn ^4.1` em `dependencies`; já em **zod ^4.3.6**, `@aws-sdk/client-s3 ^3.1112`, `@anthropic-ai/sdk ^0.80`, `sharp ^0.35.3`, `jsdom ^29.1.1`, vitest 2.1.9. Scripts úteis a manter: `dev --port 3005`, `test` com `config/vitest.config.ts`, `compliance`, `map`, `docs:check`, `ai-marks`, `db:backup`.
- `docker-compose.yml`: `postgres:16` (5437), `redis:7-alpine --appendonly yes` (6382), MinIO (9002 API / 9003 console) e serviço `minio-init` que cria o bucket `merlostore-midia` **privado** (`mc anonymous set none`). Healthchecks nos três.
- `components.json`: `style: "base-nova"`, `rsc: true`, `baseColor: neutral`, `iconLibrary: lucide`, `tailwind.config: "tailwind.config.ts"` (em v4 deve ser `""`).
- `config/vitest.config.ts`: sem plugin-react, `esbuild: { jsx: "automatic" }` (vira `oxc` no Vite 8), `include` em `tests/**` e `src/**`.
- ADRs com impacto em versão/biblioteca:
  - **0006** (`docs/adr/0006-midia-no-minio.md:20-70`): AWS SDK S3 com `forcePathStyle: true`; bucket privado; leitura interna por `GET /api/media/[id]/raw` com sessão + escopo de loja; URL assinada TTL 10 min só no envio (não persistida); thumb `sharp` 200×200 webp q80 em `<chave>.thumb.webp`; chave `{storeId}/{pasta}/{uuid}.{ext}`; `Cache-Control: private`; ciclo real contra MinIO **nunca foi testado**.
  - **0007** (`docs/adr/0007-fila-no-postgres.md:31-71`): fila de disparo no próprio Postgres (`FOR UPDATE SKIP LOCKED`, laço no cliente, sem retry/agendamento) com gatilho explícito de revisão "quando aparecer o segundo trabalho assíncrono". A reconstrução já tem vários (webhook→IA, mídia, sincronização Bling, campanhas) → o gatilho foi atingido. Opções: BullMQ + Redis (infra já no compose) ou BullMQ 6 + backend Postgres.
  - **0005** (`docs/adr/0005-soft-delete.md:78-87`): única exceção de delete físico é LGPD (`DELETE /api/lgpd`); binário de mídia fica ao marcar `is_deleted`.
  - `docs/integracoes.md:356-372`: credenciais de loja cifradas com `INTEGRATIONS_KEY` (AES-256-GCM, `iv` + `authTag`), nunca devolvidas pela API, "desconectar" apaga fisicamente **o campo cifrado** e mantém o registro. `:519-541`: webhook por conta (`/api/webhooks/uazapi/[integracaoId]`) ou resolvido pelo payload; conta desconhecida → 200 + descarta + registra; segredo ausente → 403.

---

## 8. Pontos de decisão que este levantamento deixa para os arquitetos

### 8.1 Armadilha 2 — Better Auth × soft delete (precisa de ADR)
Fatos: `session` é apagada fisicamente em logout/revogação/expiração; `verification` é apagada após uso/expiração; `rateLimit` (se `database`) é contador volátil; `preserveSessionInDatabase` só existe com `secondaryStorage`; soft delete não é recurso nativo (issues #1171, #2669, discussão #4939).

| Opção | Como | Prós | Contras |
|---|---|---|---|
| **A. Isenção documentada + trilha append-only** | ADR declara `session`, `verification`, `rateLimit`, `twoFactor`, `passkey` como tabelas de framework isentas; `hooks.after` (`createAuthMiddleware`) + `databaseHooks.session.create.after` / `delete.before` gravam em `auditoria_autenticacao` (append-only, sem DELETE para o usuário do banco) | simples, sem tocar a lib, sobrevive a upgrade | a prova da sessão vive na trilha, não na tabela |
| **B. `secondaryStorage` (Redis) + `storeSessionInDatabase` + `preserveSessionInDatabase`** | sessão ativa no Redis; linha no PG preservada com `expiresAt` = revogação | histórico de sessões na própria tabela | Redis vira dependência de **login** (queda = ninguém entra); `@better-auth/redis-storage` prende `ioredis ^5`; `verification` segue física; não usa `is_deleted` |
| **C. Adapter Drizzle embrulhado (delete → update `is_deleted`)** | sobrescrever `delete/deleteMany` e filtrar leituras | cumpre a regra ao pé da letra | 1.7 exige métodos novos em adapter custom; risco alto a cada upgrade; `databaseHooks.*.delete.before` retornando `false` quebraria logout |

Complementos independentes da opção: não habilitar `user.deleteUser`; desativar usuário com `banUser` + `revokeUserSessions` (HUG `src/app/api/team/route.ts:12`); usuário do banco da aplicação sem `DELETE` na trilha.

### 8.2 Demais decisões
1. **Segundo fator obrigatório**: sem suporte nativo → hook `before` nos caminhos de sessão (ou verificação no guard) que recusa usuário sem `twoFactorEnabled`/passkey; provisionamento com passkey ou TOTP.
2. **Bloqueio por conta**: Better Auth só limita por IP/rota → coluna/tabela própria com `UPDATE` condicional atômico, acionada por hook de falha de `/sign-in/email`.
3. **`rateLimit.storage`**: `"database"` (sem Redis no caminho do login) × `"secondary-storage"`.
4. **ioredis 5.11.1 × 6.0.0** (depende de 8.1 B).
5. **Fila**: BullMQ + Redis 6382 × BullMQ 6 + backend Postgres (revisão do ADR 0007).
6. **Driver**: `pg` único (recomendado) × `postgres.js`.
7. **Timestamps**: `precision: 3`; decidir `withTimezone` (HUG usa `true`) e `mode: "date"` × `"string"`.
8. **Tabelas do Better Auth em PT** via `modelName`/`fields` (tipos continuam em inglês) × manter nomes da lib como exceção documentada.
9. **Vitest 5.0.x** (12 dias de vida) × **4.1.11**; **jsdom 29** × Node ≥ 24.15.
10. **shadcn `base-nova`** (atual, Base UI) × `radix-*`.
11. **`next/image` para mídia privada**: `localPatterns.search` × `unoptimized`.
12. `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` se houver mais de uma instância web.
13. `cacheComponents`/`partialPrefetching`: não ligar na primeira entrega (recomendação oficial).

---

## 9. Checklist "o código novo precisa respeitar" (consolidado)

- [ ] `await` em `cookies()`, `headers()`, `draftMode()`, `params`, `searchParams`; tipos `PageProps`/`LayoutProps`/`RouteContext` via `next typegen`.
- [ ] `proxy.ts` (função `proxy`, runtime Node) só para redirect de UX; guard em **toda** page, route handler e action.
- [ ] Toda Server Action: sessão + autorização do recurso + escopo de loja + Zod + retorno filtrado; DAL com `import 'server-only'`.
- [ ] `revalidateTag(tag, perfil)`; `updateTag` em actions de edição; sem `unstable_`.
- [ ] Lint com `eslint .` e `eslint.config.mjs`; `next build` não faz lint.
- [ ] Slots de parallel routes com `default.tsx`.
- [ ] `next/image`: `remotePatterns`/`localPatterns`, `qualities` se usar outro valor que 75.
- [ ] Nada de `serverRuntimeConfig`/`publicRuntimeConfig`/AMP/`experimental.ppr`/`dynamicIO`.
- [ ] Better Auth ≥ 1.7.3, `nextCookies()` por último, `cookieCache` desligado, `disableSignUp`, `revokeSessionsOnPasswordReset`, `trustedProxies`, `rateLimit.storage` persistente, Argon2id, passkey de `@better-auth/passkey`.
- [ ] Zod 4: `z.email()`, parâmetro `error`, `z.treeifyError`, `z.strictObject`.
- [ ] Drizzle: terceiro parâmetro de `pgTable` em **array**; `timestamp` com `precision: 3`.
- [ ] Tailwind v4 CSS-first, `components.json` com `tailwind.config: ""`, `tw-animate-css`, `sonner`.
- [ ] BullMQ 6: `upsertJobScheduler` (nunca `repeat`), jobId sem `:`, `ioredis` instalado explicitamente, `await queue.resume()`.
- [ ] Vitest 5: `vite@8` instalado, `await` em `resolves/rejects`, não depender de mocks acumulados entre testes; `oxc` no lugar de `esbuild`.
- [ ] Versões conferidas no **lockfile** contra os advisories (Next ≥ 16.3.3).
- [ ] `AGENTS.md` com o bloco gerenciado do Next commitado.

---

## 10. Fontes (consultadas em 2026-09-15)

Registro npm (`npm view <pacote> version dist-tags time engines peerDependencies dependencies exports`) para: next, react, react-dom, better-auth, @better-auth/passkey, @better-auth/core, @better-auth/cli, auth, @better-auth/redis-storage, @better-auth/drizzle-adapter, drizzle-orm, drizzle-kit, drizzle-zod, postgres, pg, tailwindcss, @tailwindcss/postcss, zod, bullmq, ioredis, @node-rs/argon2, @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, @anthropic-ai/sdk, vitest, vite, @vitejs/plugin-react, shadcn, typescript, @typescript/typescript6, typescript-eslint, eslint, eslint-config-next, eslint-plugin-react, eslint-plugin-import, eslint-plugin-jsx-a11y, eslint-plugin-react-hooks, jsdom, @testing-library/react, @testing-library/jest-dom, sharp, pino, tw-animate-css, @daveyplate/better-auth-ui, server-only, @types/node, @types/react, @types/react-dom.

Páginas:
- [Next.js — How to upgrade to version 16](https://nextjs.org/docs/app/guides/upgrading/version-16)
- [Next.js 16.3 (blog, 03/08/2026)](https://nextjs.org/blog/next-16-3)
- [Next.js — Data security guide](https://nextjs.org/docs/app/guides/data-security)
- [Next.js July 2026 Security Release](https://nextjs.org/blog/july-2026-security-release)
- [Next.js August 2026 Security Release](https://nextjs.org/blog/august-2026-security-release)
- [Better Auth 1.7 (blog)](https://better-auth.com/blog/1-7)
- [Better Auth — The account change in 1.7](https://better-auth.com/blog/1-7-account-schema)
- [Better Auth — Release v1.7.0](https://github.com/better-auth/better-auth/releases/tag/v1.7.0)
- [Better Auth — Next.js integration](https://www.better-auth.com/docs/integrations/next)
- [Better Auth — Passkey plugin](https://www.better-auth.com/docs/plugins/passkey)
- [Better Auth — Two-factor plugin](https://www.better-auth.com/docs/plugins/2fa)
- [Better Auth — Rate limit](https://www.better-auth.com/docs/concepts/rate-limit)
- [Better Auth — Database](https://www.better-auth.com/docs/concepts/database)
- [Better Auth — Session management](https://www.better-auth.com/docs/concepts/session-management)
- [Better Auth — Options reference](https://www.better-auth.com/docs/reference/options)
- [Better Auth — Security update June 2026](https://better-auth.com/blog/security-update-june-2026)
- [Better Auth — Security advisories](https://github.com/better-auth/better-auth/security/advisories)
- [Better Auth — issue #1171 (storeSessionInDatabase e deleteSession)](https://github.com/better-auth/better-auth/issues/1171)
- [Better Auth — discussão #4939 (soft delete)](https://github.com/better-auth/better-auth/discussions/4939)
- [BullMQ — Migrate from v5 to v6](https://docs.bullmq.io/guide/migrations/migrate-from-v5-to-v6)
- [BullMQ — Connections](https://docs.bullmq.io/guide/connections)
- [BullMQ — PostgreSQL backend](https://docs.bullmq.io/guide/postgresql)
- [ioredis — Upgrading from v5 to v6](https://github.com/redis/ioredis/wiki/Upgrading-from-v5-to-v6)
- [Vitest 5.0 is out](https://vitest.dev/blog/vitest-5.html)
- [Vite — Migration from v7](https://vite.dev/guide/migration)
- [Achromatic — Next.js 16.3 and TypeScript 7 upgrade guide](https://www.achromatic.dev/blog/nextjs-16-3-typescript-7-upgrade)
- [Run TypeScript 7 without breaking typescript-eslint](https://loke.dev/writing/typescript-7-typescript-eslint-side-by-side)
- [Zod 4 — Changelog](https://zod.dev/v4/changelog)
- [shadcn/ui — Tailwind v4](https://ui.shadcn.com/docs/tailwind-v4)
- [shadcnblocks — Component styles (Vega, Nova, ...)](https://www.shadcnblocks.com/blog/shadcn-component-styles-vega-nova-maia-lyra-mira)
- [React 19.3 (blog, 09/09/2026)](https://react.dev/blog/2026/09/09/react-19-3)
- [Drizzle — v0 → v1 changes](https://orm.drizzle.team/docs/v0-v1-changes)
- [Drizzle — 0.36.0: terceiro parâmetro vira array](https://www.answeroverflow.com/m/1309926868119457902)

Arquivos locais lidos (READ-ONLY): HUG Atende (`package.json`, `src/lib/auth/*`, `src/app/api/auth/[...all]/route.ts`, `src/lib/db/{client,migrate}.ts`, `src/lib/db/schema/{auth,_helpers,audit}.ts`, `src/lib/queue/*`, `src/server/worker.ts`, `src/lib/audit/auditService.ts`, `src/lib/security/{rate-limit,secrets}.ts`, `src/middleware.ts`, `src/lib/whatsapp/{provider,index,meta.adapter,uazapi.adapter}.ts`, `src/app/api/webhook/whatsapp/route.ts`, `src/lib/storage/minio.ts`, `src/lib/logger.ts`, `next.config.mjs`, `docker-compose.yml`, `drizzle.config.ts`, `docs/STATUS.md`); espaco-flow (`package.json`, `src/lib/auth/*`, `src/middleware.ts`, `src/lib/db/index.ts`, `src/lib/db/schema/{index,usuarios,auditoria,jobs}.ts`, `src/lib/audit/logger.ts`, `src/lib/actions/{_helpers,auth,clientes}.ts`, `src/lib/fila/*`, `src/lib/whatsapp/provider.ts`, `src/lib/whatsapp/telefone.test.ts`, `src/lib/storage/{minio,midia}.ts`, `src/app/api/whatsapp/webhook/route.ts`, `src/lib/validators/comum.ts`, `vitest.config.ts`, `drizzle.config.ts`, `docker-compose.yml`, `next.config.mjs`); MerlostoreChat (`package.json`, `docker-compose.yml`, `components.json`, `config/vitest.config.ts`, `docs/adr/0001,0004,0005,0006,0007`, `docs/integracoes.md` seções 356-372, 463-541, 754-796); estrutura base (`docs/seguranca-login.md`).
