# 05 — Plano de construção (executável por agentes)

- **Alvo**: `C:\Users\Paulo\Documents\MerlostoreChat`, branch `refactor/reconstrucao-estrutura-base`. O sistema atual é apagado e reconstruído; o código antigo fica no git (commit `5e902d4`) como referência de **domínio**, nunca de implementação. Banco novo, sem migração de dados.
- **Entradas obrigatórias**: `spec/final/01-dados.md`, `01-dados-dominio.md`, `02-seguranca.md`, `03-arquitetura.md`, `04-ui.md` (e `06-analise-skills.md` para as ferramentas). Onde este plano citar nome de tabela, coluna, rota, helper ou componente, ele é **cópia** daqueles documentos — em caso de divergência, vence o documento dono do assunto.
- **Regra de leitura**: o agente construtor implementa o que está escrito. Não existe "a definir". Achado novo que exija mudar decisão fechada = **para, reporta ao orquestrador, ADR** — nunca decide sozinho no meio do pacote.
- **Forma de execução**: 3 ondas. Onda 1 = **1 pacote sequencial** (FUNDAÇÃO, F0..F9). Onda 2 = **8 pacotes de módulo em paralelo**, no mesmo diretório de trabalho. Onda 3 = **1 pacote de integração**.

---

## 1. As três ondas

```
ONDA 1 (sequencial, 1 agente)          ONDA 2 (8 agentes em paralelo)        ONDA 3 (1 agente)
┌──────────────────────────┐           ┌────┬────┬────┬────┐                 ┌──────────────┐
│ FUNDAÇÃO  F0 → F9        │ ────────► │ M1 │ M2 │ M3 │ M4 │ ──────────────► │ INTEGRAÇÃO   │
│ repo, stack, ferramentas │           ├────┼────┼────┼────┤                 │ build, piso  │
│ schema, auth, borda,     │           │ M5 │ M6 │ M7 │ M8 │                 │ docs, fumaça │
│ design system, shell     │           └────┴────┴────┴────┘                 └──────────────┘
└──────────────────────────┘
```

| Onda | Pacote | Entrega |
|---|---|---|
| 1 | **FUNDAÇÃO** | repositório limpo, stack instalada, ferramentas da base, **schema completo das 48 tabelas + 17 migrações**, db client e helpers, auth endurecido, portão e escopo de loja, trilha, cofre, borda/CSP, fila e worker, design system, shell, componentes compartilhados, telas de login e de perfil, seed sem senha literal, travas base |
| 2 | **M1** Atendimento e canais | conversas, mensagens, adaptadores, envio/reenvio, SSE, tempo real |
| 2 | **M2** Contatos, consentimento e LGPD | carteira por loja, etiquetas, opt-out, dossiê, anonimização |
| 2 | **M3** Mídia e galeria | upload, leitura, miniatura, galeria, job de mídia |
| 2 | **M4** Catálogo e pedidos | Bling leitura, disponibilidade, numeração, ponte Masc |
| 2 | **M5** Plataforma e integrações | lojas, contas de canal, webhooks, OAuth Bling, modelos Meta |
| 2 | **M6** Campanhas, conteúdo e agendadas | campanhas, respostas rápidas, modelos, agendamentos |
| 2 | **M7** Equipe e acesso | administração de usuários, convites, papéis |
| 2 | **M8** Alertas, auditoria e relatórios | alertas, 4 abas de auditoria, relatórios, manutenção |
| 3 | **INTEGRAÇÃO** | build, typecheck, lint, testes, compliance, piso das travas, docs, fumaça, correção cruzada |

---

## 2. Contrato de paralelismo (regras invioláveis da onda 2)

1. **Cada pacote grava apenas nos caminhos da sua coluna "cria e é dono".** Todo o resto é **somente leitura**, inclusive "só uma linha".
2. **Nada compartilhado nasce na onda 2.** Schema, enums, permissões, navegação, tons, componentes comuns, manifesto de rotas públicas, nomes de fila, registro do worker e scripts já vêm prontos da fundação.
3. **Faltou algo num arquivo compartilhado?** O pacote **para**, reporta ao orquestrador com o caminho e o motivo. O orquestrador aplica na fundação e avisa os oito. Nunca edite por conta própria.
4. **Proibido na onda 2**: `npm install` / alterar `package.json`; `next build`; `drizzle-kit generate` ou migração nova; editar `.claude/`, `.github/`, `config/`, `scripts/`, `docs/seguranca/`, `docs/adr/`; editar `src/lib/db/**`, `src/lib/auth/**`, `src/lib/seguranca/**`.
5. **Precisa de coluna nova?** Não existe. O modelo de dados está fechado: para e reporta (exige ADR). A fórmula, o índice e o CHECK que você procura já estão em `01-dados*.md`.
6. **Import cruzado entre pacotes é proibido**, exceto pelas **costuras** da §5 (arquivos que a fundação cria com a assinatura final). Leitura de tabela de outro domínio vai direto ao schema, pelo seu próprio `_consultas.ts`.
7. **Um banco de teste e um índice Redis por pacote** (§3.3). Nunca rode testes de integração no banco de dev.
8. **Commits pequenos e frequentes**, com o escopo do pacote no título (§9). Nunca commite arquivo que você não é dono.
9. **Arquivo com no máximo 499 linhas**, sem exceção fora de `src/components/ui/**`. O que estoura por construção **nasce dividido em pasta**.
10. **Nenhuma tela de fachada**: se o backend não faz, a tela não existe ou é só leitura (U8).

---

## 3. Ambiente, banco de teste e comandos

### 3.1 Serviços locais

`npm run db:up` sobe `docker-compose.yml`: Postgres 16 na **5437**, Redis na **6382**, MinIO **9002** (API) / **9003** (console) e o `minio-init` que cria o bucket `merlostore-midia` com `mc anonymous set none`. App na **3005** (`npm run dev`), worker em `npm run worker`.

### 3.2 Banco de desenvolvimento

```
npm run db:up
npm run db:migrate        # papel merlo_migracao (DATABASE_URL_MIGRACAO)
npm run db:verificar      # scripts/verificar-schema.mjs — confere auditoria, timestamptz(3), FK RESTRICT, únicos parciais
npm run db:seed           # lojas, etiquetas, catálogo de exemplo. NUNCA cria usuário com credencial
npm run primeiro-dono     # emite o convite bootstrap e imprime o link UMA vez
```

### 3.3 Banco de teste — um por pacote

O banco de teste vive na **mesma instância** (5437) e é recriado por `scripts/db-teste.mjs`, que **não dropa banco**: executa `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` com três guardas (host local, nome contendo `test`, `NODE_ENV ≠ production`).

```
node scripts/db-teste.mjs --sufixo m1     # cria/recria merlostore_test_m1 e aplica as migrações
DATABASE_URL_TESTE=postgres://...:5437/merlostore_test_m1  REDIS_URL=redis://localhost:6382/1  npm run test:integracao
```

| Pacote | Banco de teste | Índice Redis |
|---|---|---|
| FUNDAÇÃO / INTEGRAÇÃO | `merlostore_test` | 0 |
| M1 … M8 | `merlostore_test_m1` … `_m8` | 1 … 8 |

Isolamento **por transação com rollback**, pela conexão do papel `merlo_app` (é o que prova o `REVOKE` das trilhas). `TRUNCATE` só no `globalSetup`, com `DATABASE_URL_MIGRACAO`. `db.delete()` em teste é proibido — o hook de pre-write bloqueia.

### 3.4 Comandos de verificação (os mesmos em todo pacote)

| Comando | O que prova |
|---|---|
| `npm run lint` | `eslint .` (flat config; `next lint` não existe no Next 16) |
| `npm run typecheck` | `tsc --noEmit` com `exactOptionalPropertyTypes` |
| `npm run compliance` | auditor das regras absolutas (exit 0) |
| `npm run test:compliance` | trava do auditor (`node:assert`, fora do Vitest) |
| `npm run test:travas` | travas de fonte (portão, escopo, mutações, timestamps, rotas) |
| `npm run test:unidade` / `test:componentes` | regras puras / componentes com os 4 estados |
| `npm run test:integracao` | Postgres real + Redis |
| `npm run map` / `npm run docs:check` | `PROJECT_MAP.md` e drift de documentação |
| `npm run verificar` | tudo encadeado — **obrigatório antes de fechar qualquer pacote** |
| `npm run build` | **só na fundação e na integração** (o `.next` é único no diretório) |

---

## 4. Pacote FUNDAÇÃO (sequencial, F0 → F9)

Um agente, dez etapas, um commit por etapa. **Nenhuma etapa fecha com o CI vermelho.** A onda 2 só começa quando F9 fecha.

### F0 — Limpar o repositório

- **Objetivo**: deixar no disco só o que a reconstrução mantém; o resto vive no git.
- **Entradas**: `03-arquitetura.md §3`; `06-analise-skills.md §3, §5`.
- **Mantém**: `.git/` · `.github/` (workflow reescrito em F2) · `.claude/` (hooks e skills atualizados em F2) · `.agents/` · `.env` (**nunca ler, nunca tocar**) · `.gitignore` · `docs/integracoes.md` e `docs/adr/**` (ADRs 0001–0007 passam a "Substituído por").
- **Remove** (rastreado pelo git, recuperável): `prisma/`, `prisma.config.mjs`, `src/`, `tests/`, `templates/`, `config/`, `public/`, `scripts/`, `next.config.mjs`, `tailwind.config.ts`, `postcss.config.mjs`, `.eslintrc.json`, `components.json`, `package.json`, `package-lock.json`, `next-env.d.ts`, `tsconfig*.json`, `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `README.md`, `AGENTS.md`, `Agente.md`, `CLAUDE.md`, `.env.example`, e os demais docs que serão reescritos. `node_modules/` e `.next/` saem do disco (não estão no git).
- **Corrige de imediato**: `.claude/settings.local.json` **sai** do git; `.agents/` **entra** no git.
- **Aceite**: `git status` só mostra remoções e os arquivos mantidos; `git show 5e902d4 --stat` continua trazendo o sistema antigo; `ls .env` existe e não foi lido.
- **Riscos**: apagar `.env` (irreversível — proibido); apagar `.git`. Confira duas vezes antes do `rm`.
- **Commit**: `chore(repo): remover a aplicação legada mantendo git, .claude, .agents e .github`

### F1 — Scaffold Next 16 e dependências

- **Objetivo**: projeto compilando vazio, com as versões exatas.
- **Entradas**: `03-arquitetura.md §1, §16, §18`.
- **Cria**: `package.json` (todos os scripts de `03 §18`), `package-lock.json`, `tsconfig.json`, `next.config.ts` (`output: "standalone"`, `outputFileTracingRoot`, `serverExternalPackages`, `bodySizeLimit: "1mb"`, `poweredByHeader:false`), `eslint.config.mjs`, `postcss.config.mjs`, `drizzle.config.ts`, `config/vitest.config.ts` (4 projetos) + `config/vitest.setup.ts`, `docker-compose.yml`, `Dockerfile` (2 alvos, `UV_THREADPOOL_SIZE=8`, sem seed/migração no entrypoint), `.dockerignore`, `.gitignore` (+ `.lixo-quarentena/`), `.claude/launch.json` (dev na 3005), `src/app/layout.tsx` mínimo, `src/app/globals.css` vazio.
- **Versões** (lockfile, conferidas depois por T23): `next 16.3.5`, `react/react-dom 19.3.0`, `typescript 6.0.3`, `drizzle-orm 0.45.2`, `drizzle-kit 0.31.10`, `pg 8.23.0`, `better-auth 1.7.5` + `@better-auth/passkey 1.7.5`, `@node-rs/argon2 2.2.1`, `bullmq 6.3.6`, `ioredis 5.11.1`, `@aws-sdk/client-s3` e `s3-request-presigner 3.1133.0`, `sharp 0.35.4`, `tailwindcss 4.3.3`, `zod 4.6.5`, `vitest 5.0.1` + `vite 8.3.0`, `jsdom 29.1.1`, `@testing-library/react 16.3.3`, `pino 10.3.1`, `eslint 9.39.5`. Node **24 LTS ≥ 24.15**.
- **Aceite**: `npm ci && npm run lint && npm run typecheck && npm run build` verdes; `npm run db:up` sobe os 3 serviços com healthcheck ok.
- **Riscos**: `jsdom 30` exige Node ≥ 24.15 (fixado em 29.1.1); o bloco gerenciado que o `next dev` escreve no `AGENTS.md` (`<!-- BEGIN:nextjs-agent-rules -->`) precisa ser **commitado**, senão volta como diff a cada `dev`.
- **Commit**: `build(base): instalar Next 16.3.5, React 19.3 e a stack da reconstrução`

### F2 — Ferramentas da base e CI

- **Objetivo**: enforcement antes do primeiro arquivo de domínio.
- **Entradas**: `06-analise-skills.md §3, §5`; `01-dados.md §4.3`; `04-ui.md §3.1`; `03-arquitetura.md §19`.
- **Cria**: `scripts/check-compliance.mjs` (**fork da base** com: marcador `compliance:framework`; exceção de caminho `src/components/ui/**` **só** na regra `arquivo-grande`; regex de `tx.delete(` e `DELETE FROM`; regex de segredo ampliada para `sk-ant-`, `sk-proj-`, PKCS#8), `tests/check-compliance.test.mjs` (os 6 casos da base **+ 4 novos**: tabela marcada `compliance:framework` passa; tabela não marcada continua reprovando; primitivo de 600 linhas em `src/components/ui/` passa; arquivo de 600 linhas em `src/components/comum/` reprova), `scripts/project-map.mjs`, `scripts/docs-check.mjs` (**versão do Merlo**, que exclui `PROJECT_MAP.md` e remove blocos de código), `scripts/remove-ai-marks.mjs`, `scripts/limpar-lixo-raiz.mjs`, `.claude/settings.json`, `.claude/hooks/pre-write-guard.mjs` (base + `texto-cru` + `.env.local` + `drizzle….delete`, **sem** `MIGRACAO_ORM_EM_ANDAMENTO`), `.claude/hooks/post-write-check.mjs`, `.claude/skills/{criar-tabela,criar-crud,criar-componente,repo-docs-sync,remove-ai-marks}/` **reescritas para esta stack**, `.agents/` espelhado, `.github/workflows/deploy.yml` (12 passos de `03 §19`), `.github/pull_request_template.md`, `CLAUDE.md`, `AGENTS.md`, `Agente.md`, `README.md`.
- **Não copiar**: `how-to-use-guide` da base (é do ERP Auto Peças), `docs/oauth.md`, `docs/back.md`, `docs/front.md`, `docs/rbac.md` da base (contradizem esta stack).
- **Aceite**: `npm run compliance` exit 0 · `npm run test:compliance` 10/10 · o hook bloqueia um `db.delete(` de teste · `npm run lixo` roda em dry-run.
- **Riscos**: `SKIP_PATH` do hook casa `.claude` em qualquer ponto do caminho — worktree dentro de `.claude/worktrees/` desliga os hooks em silêncio. Confirmar onde os worktrees ficam.
- **Commit**: `ci(base): instalar auditor com marcador de framework, hooks e pipeline`

### F3 — Núcleo: env, erros, formato, db client e helpers

- **Objetivo**: os módulos que tudo importa.
- **Entradas**: `03-arquitetura.md §6.1, §14, §15`; `01-dados.md §3, §4.5, §13.3, §13.5`.
- **Cria**: `src/lib/env.ts` (Zod de **toda** variável, `throw` no boot, `process.env` só aqui, `PISO_RECUSA_MS` com `.min(300)`), `.env.example` gerado a partir dele, `src/lib/logger.ts` (pino com `redact`), `src/lib/erros.ts` (erros tipados + `Resultado<T>`), `src/lib/formato.ts` (moeda, data, hora, telefone **e** aritmética em centavos), `src/lib/marca.ts`, `src/lib/db/client.ts`, `src/lib/db/erros.ts` (`sanitizarErroBanco`), `src/types/`.
- **Aceite**: `npm run typecheck` verde; `node -e` não é usado (regra 13.1 do `AGENTS.md`); `.env.example` cobre 100% de `env.ts` (T17 roda em F9).
- **Commit**: `feat(nucleo): env validado, erros tipados, formato pt-BR e cliente do banco`

### F4 — Schema completo e migrações

- **Objetivo**: as **48 tabelas** e as **17 migrações** de uma vez. Nada de "criar na fase em que a tela existir".
- **Entradas**: `01-dados.md §2, §3, §4, §5, §6, §7, §9, §10, §16` e `01-dados-dominio.md` inteiro.
- **Cria**: `src/lib/db/schema/**` exatamente como a lista de `01 §2` (`_compartilhado.ts`, `_enums/` por domínio, `_ba-fields.ts`, `auth/`, `auth-eventos.ts`, `auditoria.ts`, `lojas.ts`, `integracoes.ts`, `alertas.ts`, `contatos.ts`, `conversas/`, `midias.ts`, `catalogo/`, `conteudo/`, `campanhas.ts`, `negocios.ts`, `pedidos/`, `devolucoes.ts`, `lgpd.ts`, `index.ts` barril alfabético com `// não reordenar`), `src/lib/db/consultas.ts`, `src/lib/db/mutacoes.ts`, `src/lib/db/migrations/0000_base` … `0016_integridade`, `src/lib/db/migrate.ts`, `scripts/verificar-schema.mjs`, `scripts/db-teste.mjs` (com `--sufixo`), `scripts/db-backup.mjs`, `tests/integracao/{enums-check,ba-fields,integridade-trilha}.test.ts`, `tests/travas/{mutacoes,migracoes,timestamps}.test.ts`.
- **Obrigatório**: `pgTable("nome", { objeto literal }, (t) => [array])`; nome de coluna explícito; `...colunasAuditoria` sem alias; `updated_at` **sem** `$onUpdate`; FK `{onDelete:"restrict", onUpdate:"restrict"}`; índice único parcial **só** com `sql` cru literal; marcadores `compliance:append-only` (4) e `compliance:framework` (4) com justificativa nos 600 caracteres acima; SQL manual dentro da migração para papéis, `trilha_imutavel()`, `REVOKE`, CHECKs, FKs compostas e FK de `modified_by`.
- **Aceite**:
  - `npm run db:teste && npm run db:migrate && npm run db:verificar` verdes;
  - `select count(*) from information_schema.tables where table_schema='public'` = **48** (+ `drizzle`);
  - `npm run test:integracao` passa `enums-check` (CHECK × constante TS, todos) e `ba-fields` (`CAMPOS_BA` × `getTableColumns()`);
  - `grep -rn "= \$" src/lib/db/migrations/` **vazio**;
  - `npm run compliance` exit 0.
- **Riscos**: predicado de índice parcial construído com `eq()` sai como `= $1` e a migração falha ao aplicar; `$onUpdate` em `updated_at` quebra a trava de colisão em silêncio; `pgTable` na forma callback escapa do auditor inteiro.
- **Commits**: `feat(schema): criar as 48 tabelas em Drizzle com auditoria, CHECK e enums` · `feat(schema): gerar as migrações 0000 a 0016 com integridade e trilhas append-only`

### F5 — Autenticação e portão

- **Objetivo**: Better Auth 1.7.5 endurecido, bloqueio, 2º fator, convite, portão e escopo de loja.
- **Entradas**: `02-seguranca.md §2 a §11`; `01-dados.md §5, §13.1`.
- **Antes de escrever**: gerar `docs/seguranca/conferencia-ba-1.7.5.md` lendo `node_modules/better-auth/dist/**/*.d.ts` e `@better-auth/passkey/dist/**/*.d.ts` — cada opção de `02 §4.4` com "existe / plano B".
- **Cria**: `src/lib/auth/{auth.ts,caminhos.ts,guard.ts,loja.ts,bloqueio.ts,politica-senha.ts,kdf.ts,senha-gravada.ts,sessoes.ts,trilha.ts,emails.ts,convites.ts}`, `src/lib/auth/permissoes/` (pasta por família + `index.ts` + `alvo.ts`), `src/app/api/auth/[...all]/route.ts`, `src/lib/actions/_base.ts` (`executarAcao`, `acao`, `acaoPublica`), `scripts/primeiro-dono.ts`, `scripts/medir-kdf.mjs`, travas `tests/seguranca/{guarda,caminhos-ba,auth-config,auth-efeito,recusa-unica,bloqueio-conta,caminhos-desligados,reset,sessoes,passkey-uv,perfil-sem-userid,rbac,admin-actions,convite}.test.ts`.
- **Não negociável**: `satisfies BetterAuthOptions`; plugins proibidos ausentes; `nextCookies()` por último; `cookieCache: false`; `disableSessionRefresh: true`; `freshAge: 900`; `expiresIn: 43200`; Argon2id com semáforo de 4; recusa única byte a byte com piso de tempo; bloqueio por conta em **um** `UPDATE`; anti-replay de TOTP **no banco**; convite criando identidade por `inserirAuditado` com o **mesmo** `kdf.hash`.
- **Aceite**: `npm run test:integracao` verde em T5, T6, T7, T8, T9, T10, T28; `GET /api/auth/get-session` = 200 (prova que o schema do BA bate — G27); `POST /api/auth/sign-up/email` = 404 **sem corpo**; `npm run primeiro-dono` imprime o link uma vez e grava `dono_semeado`.
- **Riscos**: divergência de coluna derruba **todo** `/api/auth/**` no boot; opção com nome errado passa no teste de literais e não faz nada (por isso os testes são de **efeito**).
- **Commits**: `feat(auth): configurar Better Auth 1.7.5 endurecido com 2FA, passkey e sessão curta` · `feat(auth): portão de autorização, matriz de permissão e escopo de loja` · `feat(auth): provisionamento por convite e semeadura do primeiro dono`

### F6 — Borda: IP, origem, limitador, máquina, cofre, cabeçalhos

- **Entradas**: `02-seguranca.md §7, §12, §13, §14`; `03-arquitetura.md §12.4, §16.2`.
- **Cria**: `src/lib/seguranca/{ip.ts,origem.ts,limite.ts,corpo.ts,maquina.ts,assinaturas.ts,alertas.ts,cofre.ts,rotas-publicas.ts}`, `src/lib/rede/buscarExterno.ts`, `src/proxy.ts` (só redirect + nonce; **não importa `db` nem `auth`**), `headers()` no `next.config.ts` com **CSP em enforce**, `src/app/api/{saude,pronto}/route.ts`, travas `tests/seguranca/{origem,cabecalhos,segredos,sem-segredo-em-claro,versoes,excecoes,webhooks,oauth-integracoes}.test.ts`.
- **`assinaturas.ts` é da fundação de propósito**: é o que permite ao pacote de webhooks (M5) verificar HMAC sem depender do adaptador de canal (M1).
- **Aceite**: `grep -rn "x-forwarded-for" src` só acha `ip.ts`; POST de action pública com `Origin: https://evil.example` e com `Origin` ausente → 403; CSP presente e sem `'unsafe-inline'` em `script-src`; `buscarExterno` recusa `http://169.254.169.254` e `http://127.0.0.1:9002`; 21 requisições paralelas em `/sign-in/email` → exatamente uma 429.
- **Commit**: `feat(seguranca): IP canônico, limitador, rota de máquina, cofre e cabeçalhos com CSP`

### F7 — Design system, shell e componentes compartilhados

- **Entradas**: `04-ui.md §2, §3, §4, §6.1, §9, §10, §11`.
- **Cria**: `src/app/globals.css` com os tokens **literais** de `04 §2.2`, `npx shadcn@4.21.0 add …` (a lista exata de `04 §3`; **não instalar** `sidebar`, `form`, `scroll-area`, `calendar`, `carousel`, `menubar`, `navigation-menu`, `resizable`, `pagination`, `hover-card`, `slider`), `components.json` versionado, `src/app/layout.tsx` (ThemeProvider único + Toaster + metadata), `src/app/(app)/{layout,loading,error,not-found}.tsx`, `src/components/layout/*` (7 arquivos), `src/components/comum/*` (a tabela inteira de `04 §6.1`, incluindo `modal-confirmacao-block.tsx` e `modal-reautenticacao.tsx`), `src/lib/navegacao.ts` **completo** (R1 + R2), `src/lib/ui/tons.ts` (importando os valores de `_enums`), `tests/componentes/{tokens,block-3s}.test.tsx`.
- **Aceite**: `npm run test:componentes` verde; grep sem hex/`rgb(`/`oklch(`/classe crua/valor arbitrário em `src/**/*.tsx` fora de `src/components/ui/**`; toda variável de `:root` existe em `.dark` e tem `--color-*` no `@theme`; `npm run compliance` exit 0 (a exceção de caminho cobre só `ui/`).
- **Riscos**: o CLI do shadcn pode reescrever `style` para `new-york-v4` — **aceitar e versionar**; medir o tamanho dos primitivos no mesmo commit.
- **Commits**: `feat(ui): tokens de tema claro e escuro e primitivos shadcn` · `feat(ui): shell do aplicativo, navegação por catálogo único e componentes comuns`

### F8 — Telas de acesso e de conta

- **Entradas**: `04-ui.md §5.1, §7`; `02-seguranca.md §9, §11.1`.
- **Cria**: `src/app/(publico)/{layout.tsx,entrar,entrar/verificar,primeiro-acesso,esqueci-a-senha,redefinir-senha}` (**nenhuma com `[token]`**), `src/app/(app)/perfil/{page.tsx,seguranca/page.tsx,_components/}`, `src/lib/actions/seguranca.ts`, `src/lib/validadores/comum.ts`.
- **Não negociável**: token lido de `location.hash`, limpo com `history.replaceState` e enviado no **corpo**; nenhuma action desta área aceita `usuarioId`; passkey como ação primária; recusa de login em **uma frase**, sem tempo e sem motivo; sem tela de OTP por e-mail, "reenviar código" ou "código de recuperação".
- **Aceite**: T11 e T27 verdes; `npm run test:componentes` cobre os 4 estados de cada tela; fluxo manual convite → senha → fator → login → `/perfil/seguranca` funciona com o banco de dev.
- **Commit**: `feat(acesso): telas de entrar, primeiro acesso, recuperação e meu perfil`

### F9 — Fila, worker, trilha de negócio, costuras e docs

- **Entradas**: `03-arquitetura.md §8, §9, §17, §20`; `01-dados.md §7, §12`; `02-seguranca.md §17, §20`.
- **Cria**: `src/lib/fila/{conexao.ts,filas.ts,agendamentos.ts,idempotencia.ts}` (**todos** os nomes de fila e job de `03 §8.1`), `src/lib/tempo-real/{publicar.ts,canal.ts}`, `src/server/worker.ts` (registro completo), `src/server/processadores/*.ts` (**8 arquivos-costura**, §5), `src/server/sse.ts` (costura), `src/lib/auditoria/` **só** o gravador usado por `mutacoes.ts` (a leitura é de M8), `scripts/{seed-dev.ts,fumaca-seguranca.mjs}`, `docs/adr/0008` a `0024` + índice, `docs/seguranca/{caminhos-de-acesso.md,runbook.md,matriz-req-teste.md}`, `docs/{regras-negocio.md,definition-of-done.md,git-commits.md,deploy.md,components.md}`, `templates/` reescritos (schema, action, componente, teste, webhook, job).
- **`docs/seguranca/caminhos-de-acesso.md` nasce com a árvore canônica inteira** (`01 §13.2` + `04 §4.1`), cada linha com coluna `estado`: `entregue` ou `pacote M-x`. Na onda 2, T2 só cobra a direção "rota existe ⇒ linha no doc"; a direção estrita entra no P-INT.
- **Aceite**: `npm run worker` sobe, registra as 8 filas e desliga limpo no `SIGTERM`; `npm run verificar` **verde de ponta a ponta**; `npm run map` gera o `PROJECT_MAP.md`; `npm run build` verde.
- **Commits**: `feat(fila): filas BullMQ, agendador e worker em processo separado` · `docs(adr): registrar as decisões 0008 a 0024 da reconstrução` · `test(travas): instalar as travas de fonte e a matriz REQ × teste`

**Portão de saída da fundação** (o orquestrador só libera a onda 2 com tudo isto verde): `npm run verificar` · `npm run build` · `npm run db:verificar` · 48 tabelas no banco · `GET /api/auth/get-session` = 200 · login completo com 2º fator funcionando no dev.

---

## 5. Costuras entre pacotes (arquivos que a fundação cria e outro pacote preenche)

A fundação cria o arquivo com a **assinatura final** e corpo `throw naoImplementado("…")`. Assim tudo compila desde o dia 1 e **nenhum pacote edita arquivo de outro**.

| Arquivo-costura (criado em F9) | Assinatura | Dono depois |
|---|---|---|
| `src/server/processadores/mensagens-entrada.ts` | `processarEvento(job)` | M1 |
| `src/server/processadores/mensagens-saida.ts` | `enviarMensagem(job)`, `reenviar(job)` | M1 |
| `src/server/sse.ts` | `abrirFluxo(req, sessao)`, `publicarParaLoja(...)` | M1 |
| `src/server/processadores/midia.ts` | `baixarDeUrl(job)`, `gerarMiniatura(job)` | M3 |
| `src/server/processadores/integracoes.ts` | `sincronizarBling(job)`, `sincronizarTemplates(job)`, `renovarToken(job)`, `conferirSessaoUazapi(job)` | M5 (Bling: M4 preenche `sincronizarBling` por `src/lib/catalogo/sincronizacao.ts`, chamado daqui) |
| `src/server/processadores/campanhas.ts` | `processarLote(job)` | M6 |
| `src/server/processadores/agendamentos.ts` | `enviarAgendada(job)` | M6 |
| `src/server/processadores/manutencao.ts` | `gerarAlertas`, `retencaoEventos`, `limparMidia`, `expirarConvites`, `reconciliacao`, `resumoDiario` | M8 (`limparMidia` chama `src/lib/midias/limpeza.ts`, de M3) |
| `src/lib/conversas/saida.ts` | `registrarEnvio(tx, { lojaId, contatoId, integracaoId, conteudo, chaveIdempotencia }, ctx)` | M1 — consumido por M6 |
| `src/lib/midias/ingestao.ts` | `guardarMidiaRecebida(tx, { lojaId, origem, bytes \| url }, ctx)` | M3 — consumido por M1 |
| `src/lib/catalogo/disponibilidade.ts` | `calcularDisponivel(lojaId, sku)` | M4 — consumido por M1 (painel de venda) |
| `src/app/(app)/conversas/_components/painel-venda.tsx` | `<PainelVenda conversaId lojaId contatoId />` | **M4** (arquivo dentro da pasta de M1) |
| `src/app/(app)/conversas/_components/seletor-produto.tsx` | `<SeletorProduto onEscolher />` | **M4** |
| `src/server/processadores/emails.ts` | `emailSeguranca(job)` | **fundação** (nasce completo) |

Fora desta tabela, **nenhum import cruzado entre pacotes**.

---

## 6. Pacotes de módulo (onda 2, em paralelo)

Formato fixo. Onde diz "só lê", entenda: **proibido gravar**.

### M1 — Atendimento e canais

- **Objetivo**: a tela principal do sistema. Entrada de mensagem ponta a ponta, envio, reenvio, nota interna, transferência, resolver/reabrir, tempo real.
- **Entradas**: `01-dados-dominio.md §2`; `03-arquitetura.md §9, §10, §11`; `04-ui.md §5.2, §6.2, §8.1`; `02-seguranca.md §2.2` (chaves `conversas:*`).
- **Cria e é dono**: `src/lib/conversas/**` (incl. a costura `saida.ts`) · `src/lib/canais/**` (`tipos.ts`, `registro.ts`, `whatsapp-oficial.ts`, `uazapi.ts`, `instagram.ts`, `normalizacao.ts`) · `src/lib/actions/conversas.ts` · `src/lib/validadores/conversas.ts` · `src/app/(app)/conversas/**` (exceto os 2 arquivos de M4) · `src/app/api/eventos/route.ts` · `src/server/sse.ts` · `src/server/processadores/mensagens-{entrada,saida}.ts` · `tests/{unidade,integracao,componentes}/conversas-*.test.ts` · `docs/modulos/conversas.md`.
- **Só lê**: `db/schema/conversas/**`, `mutacoes.ts` (`upsertContatoPorCanal`, `avancarStatusDeEntrega`, `reivindicarReenvio`), `auth/**`, `seguranca/assinaturas.ts`, `fila/filas.ts`, `components/comum/**`, `ui/tons.ts`, `navegacao.ts`.
- **Não negociável**: `integracao_id` da conversa decide a conta de saída (**sem fallback de ambiente**); status de entrega **monotônico**, `falhou` só sai por `reivindicarReenvio`; `deMim` é gravado, não descartado; descarte (grupo, eco, tipo não suportado) vira linha em `lojas_integracoes_eventos`; várias mídias = **uma** mensagem com N linhas; card de produto é `metadados.card`, nunca `tipo_conteudo`; mídia sempre por `/api/midias/[id]`, **nunca** `url_externa`; composer bloqueado em exatamente 4 casos, sempre com saída; conversa resolvida **reabre**, arquivada não.
- **Aceite**: `npm run lint && npm run typecheck && npm run compliance` · `node scripts/db-teste.mjs --sufixo m1` + `npm run test:integracao` verde · fluxo manual: webhook simulado cria contato, conversa e mensagem; a bolha aparece na tela sem recarregar (SSE); reenvio de mensagem falhada funciona; 2ª entrega do mesmo `externo_id` não duplica.
- **Testes obrigatórios**: parser de webhook dos 3 provedores com payload fixo (unidade) · idempotência `(loja_id, externo_id)` · `upsertContatoPorCanal` com contato de CRM sem `whatsapp_id` (`tests/integracao/contato-upsert.test.ts`) · transição de status, uma por transição · `dto-midia.test.ts` (nenhum `url_externa` em DTO) · SSE: desativar a conta com o stream aberto fecha em ≤ 30 s · teto por usuário antes do teto global · componentes: 4 bloqueios do composer, nota interna, falha com motivo visível.
- **Riscos**: um `createSubscriber()` por aba derruba o Redis — **um subscriber por processo**; paginação por `created_at` pula mensagem (use `(ocorrida_em, id)`); `interpretarWebhook` que lança derruba a ingestão (nunca lança).
- **Commits**: `feat(conversas): adaptadores de canal e ingestão de mensagens` · `feat(conversas): inbox, linha do tempo e composer` · `feat(conversas): tempo real por SSE com reconciliação`

### M2 — Contatos, consentimento e LGPD

- **Objetivo**: carteira por loja, etiquetas, opt-out com prova, dossiê e anonimização.
- **Entradas**: `01-dados-dominio.md §2.1, §2.6, §7, §8`; `04-ui.md §5.3` (contatos); `02-seguranca.md §16`.
- **Cria e é dono**: `src/lib/contatos/**` · `src/lib/lgpd/**` · `src/lib/actions/{contatos.ts,lgpd.ts}` · `src/lib/validadores/{contatos.ts,lgpd.ts}` · `src/app/(app)/contatos/**` · `tests/*/contatos-*.test.ts`, `tests/integracao/lgpd-anonimizacao.test.ts` · `docs/modulos/contatos.md`.
- **Só lê**: schema, `mutacoes.ts`, `formato.ts` (telefone E.164), `components/comum/**`.
- **Não negociável**: telefone canônico **E.164 só dígitos**; `registrarConsentimento()` é a **única** função que grava `consentimentos` e o espelho `contatos.opt_out`, sempre na mesma transação; **opt-out é de marketing** e não bloqueia resposta 1:1; anonimização grava a trilha **antes** do efeito, substitui conteúdo por marcador (nunca `NULL`), e enfileira `limpar-midia` **depois do commit**; escopo por loja, com aviso na tela; **sem exclusão em massa**.
- **Aceite**: `tests/integracao/lgpd-anonimizacao.test.ts` verde — anonimizar contato com mensagem de texto, mídia com transcrição, pesquisa respondida e pedido lançado fecha a transação e o telefone do titular não é encontrável em **nenhuma** tabela · filtro "Todos" nunca manda `all`.
- **Riscos**: `conteudo = NULL` viola o CHECK e aborta a transação em todo contato com mensagem de texto — use o marcador; IP do consentimento vindo do corpo forja a prova (vem de `ipDoCliente()`).
- **Commits**: `feat(contatos): carteira por loja, etiquetas e ficha do contato` · `feat(lgpd): dossiê do titular, consentimento e anonimização em transação`

### M3 — Mídia e galeria

- **Objetivo**: upload, leitura autenticada, miniatura, galeria e limpeza.
- **Entradas**: `01-dados-dominio.md §3`; `03-arquitetura.md §13`; `02-seguranca.md §15`; `04-ui.md §5.4` (galeria).
- **Cria e é dono**: `src/lib/midias/**` (incl. `ingestao.ts` e `limpeza.ts`) · `src/lib/armazenamento/{s3.ts,midia.ts,limites.ts}` · `src/lib/actions/midias.ts` · `src/lib/validadores/midias.ts` · `src/app/api/midias/route.ts` e `src/app/api/midias/[id]/route.ts` · `src/app/(app)/galeria/**` · `src/server/processadores/midia.ts` · `tests/*/midias-*.test.ts` · `docs/modulos/midias.md`.
- **Só lê**: `rede/buscarExterno.ts`, `seguranca/corpo.ts`, schema, `mutacoes.ts`.
- **Não negociável**: bucket privado; **a rota interna é o único endereço**; corte por `content-length` antes de ler; allowlist de MIME conferida contra **magic bytes** (sem SVG/HTML/executável); mídia de outra loja = **404**; mídia soft-deletada **referenciada por mensagem continua sendo servida** (única entrada na lista branca de T25, com `EXCECAO-SEG`); `url_externa` é limpa quando `baixada = true` e **nunca** entra em DTO; sem presigned PUT para o navegador; `unoptimized` (nada de `next/image`).
- **Aceite**: upload de 6 MB de imagem → 413; `.svg` → 415; arquivo com extensão trocada (magic bytes divergentes) → 415; mídia de outra loja → 404; mídia excluída **referenciada** → 200, **não referenciada** → 404; `baixar-de-url` com `http://127.0.0.1:9002` recusado.
- **Riscos**: gravar base64 na coluna quando o upload falha (defeito do antigo); servir a URL do provedor e contornar o portão.
- **Commits**: `feat(midias): upload autenticado, leitura por rota interna e miniatura` · `feat(galeria): grade de mídias da loja com filtros e exclusão lógica`

### M4 — Catálogo e pedidos

- **Objetivo**: espelho do Bling (leitura), disponibilidade calculada, pedido com numeração atômica e ponte manual do Masc.
- **Entradas**: `01-dados-dominio.md §4, §6`; `03-arquitetura.md §12.1`; `04-ui.md §5.2` (nova venda) e `§5.3`.
- **Cria e é dono**: `src/lib/catalogo/**` (incl. `disponibilidade.ts` e `sincronizacao.ts`) · `src/lib/pedidos/**` · `src/lib/integracoes/bling/**` · `src/lib/actions/{catalogo.ts,pedidos.ts}` · `src/lib/validadores/{catalogo.ts,pedidos.ts}` · `src/app/(app)/produtos/**` · `src/app/(app)/pedidos/**` · os 2 componentes-costura em `conversas/_components/` · `tests/*/{catalogo,pedidos}-*.test.ts` · `docs/modulos/pedidos.md`.
- **Só lê**: schema, `mutacoes.ts` (`proximoNumeroDePedido`), `seguranca/cofre.ts`, `fila/filas.ts`.
- **Não negociável**: **não existe cadastro manual de produto** e a matriz **não tem** `produtos:criar|editar|excluir`; disponibilidade é **calculada, nunca persistida** (saldo do depósito − reservado, casando por SKU, nunca negativa); `ano_mes` em `America/Sao_Paulo`; preço e nome **do servidor**; pedido nasce `masc_status = 'pendente'`; voltar para `pendente` **preserva** `masc_venda_id`; pedido com `negocio_id` move o negócio para `ganho` na **mesma transação**; cliente Bling **somente leitura**, com cache de 60 s por depósito e limitador de 3 req/s compartilhado com a tela; `preco_custo` só sai do DTO para dono/admin/gerente.
- **Aceite**: `tests/unidade/numeracao.test.ts` (100 pedidos concorrentes → 100 números distintos, sem buraco) · `tests/unidade/disponibilidade.test.ts` (pedido cancelado/devolvido **não** reserva; SKU ausente não desconta; nunca negativo) · `tests/travas/bling-somente-leitura.test.ts` (T26) · `pedidos_total_coerente` e `itens_total_coerente` provados por teste · fila "falta lançar" usa o índice parcial.
- **Riscos**: `max(substr)` + retry para numerar (defeito do antigo); fuso do container jogando a venda das 21h para o mês seguinte; painel de venda estourando o limite da conta Bling da rede em horário de pico.
- **Commits**: `feat(catalogo): espelho do Bling somente leitura e disponibilidade calculada` · `feat(pedidos): pedido com numeração atômica, itens e ponte manual do Masc`

### M5 — Plataforma e integrações

- **Objetivo**: lojas, contas conectadas por canal, borda de webhook, OAuth Bling, modelos da Meta.
- **Entradas**: `01-dados.md §6`; `03-arquitetura.md §11, §12.2`; `02-seguranca.md §12`; `04-ui.md §5.6`.
- **Cria e é dono**: `src/lib/lojas/**` · `src/lib/integracoes/{catalogo-provedores.ts,roteamento.ts,oauth.ts,meta/**}` · `src/lib/actions/{lojas.ts,integracoes.ts}` · `src/lib/validadores/{lojas.ts,integracoes.ts}` · `src/app/api/webhooks/**` (whatsapp, instagram, uazapi) · `src/app/api/integracoes/bling/callback/route.ts` · `src/app/(app)/configuracoes/{page.tsx,lojas/**,integracoes/**}` · `src/server/processadores/integracoes.ts` · `tests/*/integracoes-*.test.ts`, `tests/seguranca/webhooks.test.ts` (preenche o esqueleto de F6) · `docs/modulos/integracoes.md`.
- **Só lê**: `seguranca/{maquina,assinaturas,cofre,limite,corpo}.ts`, schema, `mutacoes.ts` (`registrarProcessamentoEvento`), `fila/filas.ts`.
- **Não negociável**: ordem fixa de `rotaDeMaquina` e **nenhum `JSON.parse` antes de autenticar** (o roteamento extrai **só** a chave de roteamento, nunca a normalização); `401` com **corpo nulo** e mesmo piso de tempo para inexistente, revogada e assinatura inválida; segredo **por integração** no header, nunca `?segredo=`; lote com contas diferentes é **agrupado por conta**; falha ao persistir = **500** (o provedor reentrega), falha ao processar = 200; credencial só no cofre (AES-256-GCM, AAD = id); a tela mostra só os 4 últimos caracteres; `sincronizar-templates` a cada 30 min por WABA; conta de rede (Bling) tem `loja_id` nulo e o CHECK impede canal sem loja.
- **Aceite**: T15 e T16 verdes · POST forjado não escreve linha · evento repetido processado uma vez só · `state` reutilizado/expirado/adulterado recusado · desconectar apaga a credencial cifrada e marca a linha excluída.
- **Riscos**: token de challenge compartilhado entre canais (falha do antigo); `META_GRAPH_VERSION` cravado no código; credencial gravada em claro quando a chave falta (tem de responder 503).
- **Commits**: `feat(lojas): cadastro de lojas com sigla e depósito do Bling` · `feat(integracoes): contas por canal, cofre e telas de conexão` · `feat(webhooks): borda de máquina com assinatura, idempotência e diário de ingestão`

### M6 — Campanhas, conteúdo e agendadas

- **Objetivo**: disparo em lote pela conta certa, respostas rápidas, modelos e mensagens programadas.
- **Entradas**: `01-dados-dominio.md §5, §2.5`; `03-arquitetura.md §8.4`; `04-ui.md §5.4`.
- **Cria e é dono**: `src/lib/campanhas/**` · `src/lib/agendamentos/**` · `src/lib/conteudo/**` · `src/lib/actions/{campanhas.ts,conteudo.ts}` · `src/lib/validadores/{campanhas.ts,conteudo.ts}` · `src/app/(app)/{campanhas/**,modelos/**,respostas-rapidas/**,agendadas/**}` · `src/server/processadores/{campanhas.ts,agendamentos.ts}` · `tests/*/campanhas-*.test.ts` · `docs/modulos/campanhas.md`.
- **Só lê**: `conversas/saida.ts` (costura), schema, `mutacoes.ts` (`reservarDestinatarios`, `atualizarEstado`), `fila/filas.ts`.
- **Não negociável**: `integracao_id` é a conta de saída e é **obrigatória**; a campanha não sai de `rascunho` se `variaveis.length ≠ template.variaveis_contagem`; materialização lê a **verdade** (`consentimentos`), não o espelho; reserva com `FOR UPDATE SKIP LOCKED` + **lease** (reservado há mais de N minutos volta a `pendente`); único `(campanha_id, contato_id)`; contadores são `count(*)`, **nunca** colunas; a mensagem da campanha entra na conversa da cliente (`mensagem_id`); agendamento promocional respeita opt-out, os demais não; `campanhas:criar|disparar|excluir` é **gerente para cima**.
- **Aceite**: disparo de 500 destinatários com 2 workers não duplica ninguém · pausar no meio e retomar não reenvia · template com 2 variáveis e campanha com 1 é recusada na validação · ritmo por conta respeitado (1 msg/s uazapi, 10 msg/s oficial).
- **Riscos**: corrida na materialização mandando a campanha duas vezes (defeito do antigo); lote enviado pela conta errada.
- **Commits**: `feat(conteudo): respostas rápidas e modelos do WhatsApp com contagem de variáveis` · `feat(campanhas): assistente, segmento com prévia e disparo em lote com lease` · `feat(agendadas): mensagens programadas com gatilhos e opt-out`

### M7 — Equipe e acesso

- **Objetivo**: administração de contas, papéis e loja, com cerimônia completa.
- **Entradas**: `02-seguranca.md §2.3, §9.2, §9.3, §11.2`; `04-ui.md §5.6` (usuários); `01-dados.md §5.7, §5.9`.
- **Cria e é dono**: `src/lib/usuarios/**` · `src/lib/actions/{usuarios.ts,convites.ts}` · `src/lib/validadores/usuarios.ts` · `src/app/(app)/configuracoes/usuarios/**` · `tests/*/usuarios-*.test.ts`, completa `tests/seguranca/admin-actions.test.ts` · `docs/modulos/usuarios.md`.
- **Só lê**: `auth/**` (`convites.ts`, `sessoes.ts`, `bloqueio.ts`, `permissoes/alvo.ts`), schema, `mutacoes.ts`.
- **Não negociável**: `exigirSessaoFresca()` + `exigirPermissao` + `exigirAlvoPermitido` + **motivo (8–255)** em toda ação sobre conta alheia; alvo de papel **estritamente inferior**; ninguém age sobre `dono` exceto outro `dono`; **auto-alvo recusado**; trilha **antes** do efeito, na mesma transação, fail-closed; admin **nunca** define senha; `dono` não é convidável; convite de `admin` só pelo `dono`, com ciência versionada digitada; `FOR UPDATE` garantindo ≥ 1 dono, ≤ 2 donos e ≥ 1 admin ativos; desativar conta em provisionamento fecha o provisionamento; modal block de 3 s nas 8 ações da lista de `04 §9.1`.
- **Aceite**: T14 verde — `admin` A sobre `admin` B e sobre o `dono` → 403 com trilha; `dono` sobre `admin` → 200; corrida de rebaixamento não deixa zero dono nem três donos; sessões do alvo revogadas.
- **Riscos**: espalhar o corpo (`...input`) sobre a linha e deixar `papel` passar pelo formulário; gravar a trilha depois do efeito numa ação que destrói o estado anterior.
- **Commits**: `feat(usuarios): administração de acessos com escada de papéis e trilha antes do efeito` · `feat(convites): emissão, reenvio e ciência versionada para admin`

### M8 — Alertas, auditoria e relatórios

- **Objetivo**: os painéis de gestão e a manutenção que os alimenta.
- **Entradas**: `01-dados.md §6.6, §7`; `01-dados-dominio.md §7.2`; `03-arquitetura.md §8.1`; `04-ui.md §5.5`.
- **Cria e é dono**: `src/lib/alertas/**` · `src/lib/auditoria/**` (leitura) · `src/lib/relatorios/**` · `src/lib/actions/{alertas.ts,relatorios.ts}` · `src/lib/validadores/{alertas.ts,relatorios.ts}` · `src/app/(app)/{alertas/**,relatorios/**,auditoria/**}` · `src/server/processadores/manutencao.ts` · `tests/*/{alertas,auditoria,relatorios}-*.test.ts` · `docs/modulos/auditoria.md`.
- **Só lê**: schema das trilhas, `mutacoes.ts`, `fila/agendamentos.ts`.
- **Não negociável**: **quem resolve alerta é o gerador**, a pessoa só reconhece; dedupe por `(loja_id, chave_deduplicacao) WHERE resolvido_em IS NULL`; `retencao-eventos` anonimiza por `UPDATE` (**nenhum `DELETE`**); `reconciliacao` **gera alerta**, não corrige em silêncio; `/auditoria/excluidos` é **somente leitura** (não existe restaurar no R1); campo de `CAMPOS_PII` aparece como `"(alterado)"`; `/auditoria/seguranca` mostra `email_hash`, nunca e-mail em claro, e é `seguranca:ler_eventos` (gerente **não** alcança); as duas definições de relatório são as fixadas em `04 §5.5`; SLA aparece como **texto somente leitura**.
- **Aceite**: `UPDATE`/`DELETE` em trilha **falha** pelo papel `merlo_app` (prova do `REVOKE`) · alerta reconhecido que volta a valer não duplica · `retencao-eventos` não remove linha nenhuma · os 4 indicadores de `/auditoria/qualidade` vêm das fontes reais listadas.
- **Riscos**: inventar coluna para preencher cartão de painel; job de retenção com `DELETE` (o hook bloqueia e T25 reprova).
- **Commits**: `feat(alertas): geração, reconhecimento e resolução pelo gerador` · `feat(auditoria): trilha, qualidade, excluídos e trilha de acesso` · `feat(relatorios): indicadores por loja e período com definição explícita`

---

## 7. Pacote INTEGRAÇÃO (onda 3)

- **Objetivo**: fechar o sistema como um todo. É o único pacote que pode tocar em arquivo de qualquer pacote, e só para **corrigir**, nunca para acrescentar funcionalidade.
- **Entradas**: todos os documentos finais; `docs/definition-of-done.md`.
- **Faz, nesta ordem**:
  1. `npm run lint && npm run typecheck` — corrige o que a onda 2 deixou;
  2. `npm run compliance && npm run test:compliance`;
  3. **liga o piso mínimo das travas**: cria `tests/travas/piso.json` (≥ 40 actions, ≥ 10 handlers, ≥ 15 módulos de domínio) e roda `npm run test:travas`;
  4. **T2 em modo estrito**: toda linha de `docs/seguranca/caminhos-de-acesso.md` com `estado = entregue` e casada com `src/app`; nenhum item `pacote M-x` restante;
  5. `node scripts/db-teste.mjs && npm run db:migrate && npm run db:verificar && npm run test:integracao` (todos os pacotes no mesmo banco, agora sem sufixo);
  6. `npm run test:componentes` + passada de acessibilidade (`vitest-axe`, teclado, NVDA nas telas-alvo de `04 §12`);
  7. `npm run map` e **documentação**: índice em `docs/back.md` e `docs/front.md` apontando para `docs/modulos/*.md`, `docs/rbac.md` com os 5 papéis reais, `docs/deploy.md`; depois `npm run docs:check -- --strict` e `npm run ai-marks`;
  8. `npm run build` + `npm run worker` subindo junto;
  9. `npm run lixo` e revisão da raiz;
  10. `npm audit --omit=dev --audit-level=high` + `gitleaks detect`;
  11. **verificação visual** da matriz de `04 §12` (6 combinações de viewport/tema), fechando os itens **P1**;
  12. **skill `/audit-auth-security`** rodada contra o repositório, com o relatório versionado em `docs/seguranca/` (sem dado sensível);
  13. `scripts/fumaca-seguranca.mjs` contra o ambiente local e, depois do deploy, contra HML.
- **Aceite (portão de entrega)**: `npm run verificar` verde · `npm run build` verde · CI verde nos 12 passos · **28 travas** (T1–T28) + CI-1..CI-3 verdes · 48 tabelas e `db:verificar` limpo · `SELECT count(*) FROM usuarios WHERE ativo AND two_factor_enabled = false` = **0** · nenhum item P1 aberto · nenhum `EXCECAO-SEG` sem as 4 partes ou com data vencida · `docs/definition-of-done.md` todo marcado.
- **Riscos**: descobrir na onda 3 que dois pacotes implementaram a mesma leitura de forma diferente — a correção é **consolidar no dono declarado**, nunca duplicar; travas com piso mínimo passando vazias (por isso o piso entra aqui).
- **Commits**: `test(travas): ligar o piso mínimo e o inventário estrito de rotas` · `docs(repo): sincronizar documentação com o código e gerar o mapa do projeto` · `fix(integracao): correções cruzadas apontadas pela verificação completa` · `chore(release): fechar o R1 da reconstrução`

---

## 8. Quem é dono de quê (mapa rápido)

| Caminho | Dono |
|---|---|
| `package.json`, `tsconfig`, `next.config.ts`, `config/**`, `scripts/**`, `.claude/**`, `.github/**`, `docker-compose.yml`, `Dockerfile` | FUNDAÇÃO |
| `src/lib/{env,logger,erros,formato,marca,navegacao}.ts`, `src/lib/ui/tons.ts`, `src/types/**` | FUNDAÇÃO |
| `src/lib/db/**` (schema, migrações, consultas, mutações, client) | FUNDAÇÃO |
| `src/lib/auth/**`, `src/lib/seguranca/**`, `src/lib/rede/**`, `src/proxy.ts`, `src/app/api/auth/**`, `src/app/api/{saude,pronto}/**` | FUNDAÇÃO |
| `src/app/layout.tsx`, `globals.css`, `src/app/(app)/{layout,loading,error,not-found}.tsx`, `src/app/(publico)/**`, `src/app/(app)/perfil/**` | FUNDAÇÃO |
| `src/components/{ui,layout,comum}/**`, `src/lib/actions/{_base,seguranca}.ts`, `src/lib/validadores/comum.ts` | FUNDAÇÃO |
| `src/lib/fila/**`, `src/lib/tempo-real/**`, `src/server/worker.ts`, `src/server/processadores/emails.ts` | FUNDAÇÃO |
| `src/lib/conversas/**`, `src/lib/canais/**`, `src/app/(app)/conversas/**`*, `src/app/api/eventos/**`, `src/server/sse.ts`, `processadores/mensagens-*.ts` | M1 |
| `src/lib/{contatos,lgpd}/**`, `src/app/(app)/contatos/**` | M2 |
| `src/lib/{midias,armazenamento}/**`, `src/app/api/midias/**`, `src/app/(app)/galeria/**`, `processadores/midia.ts` | M3 |
| `src/lib/{catalogo,pedidos}/**`, `src/lib/integracoes/bling/**`, `src/app/(app)/{produtos,pedidos}/**` + os 2 componentes-costura | M4 |
| `src/lib/lojas/**`, `src/lib/integracoes/**` (fora de `bling/`), `src/app/api/webhooks/**`, `src/app/api/integracoes/**`, `src/app/(app)/configuracoes/{page,lojas,integracoes}/**`, `processadores/integracoes.ts` | M5 |
| `src/lib/{campanhas,agendamentos,conteudo}/**`, `src/app/(app)/{campanhas,modelos,respostas-rapidas,agendadas}/**`, `processadores/{campanhas,agendamentos}.ts` | M6 |
| `src/lib/usuarios/**`, `src/app/(app)/configuracoes/usuarios/**` | M7 |
| `src/lib/{alertas,auditoria,relatorios}/**`, `src/app/(app)/{alertas,relatorios,auditoria}/**`, `processadores/manutencao.ts` | M8 |
| `src/lib/actions/<dominio>.ts` e `src/lib/validadores/<dominio>.ts` | o pacote do domínio |
| `docs/modulos/<dominio>.md` | o pacote do domínio |
| `tests/travas/piso.json`, `docs/{back,front,rbac,deploy}.md`, `docs/PROJECT_MAP.md` | INTEGRAÇÃO |

\* exceto `painel-venda.tsx` e `seletor-produto.tsx`, de M4.

---

## 9. Ordem de commits (Conventional Commits em PT-BR)

Tipos: `feat`, `fix`, `refactor`, `test`, `docs`, `build`, `ci`, `chore`. Escopo em PT-BR e igual ao nome do módulo. Assunto no imperativo, minúsculo, sem ponto final, ≤ 72 caracteres. Corpo explicando **por quê** quando a decisão não é óbvia. **Sem rodapé de coautoria.** Nunca commitar na `master`; tudo entra pela `develop` (aqui, por `refactor/reconstrucao-estrutura-base`).

**Onda 1 — sequencial, nesta ordem exata**

```
 1  chore(repo): remover a aplicação legada mantendo git, .claude, .agents e .github
 2  build(base): instalar Next 16.3.5, React 19.3 e a stack da reconstrução
 3  ci(base): instalar auditor com marcador de framework, hooks e pipeline
 4  feat(nucleo): env validado, erros tipados, formato pt-BR e cliente do banco
 5  feat(schema): criar as 48 tabelas em Drizzle com auditoria, CHECK e enums
 6  feat(schema): gerar as migrações 0000 a 0016 com integridade e trilhas append-only
 7  feat(auth): configurar Better Auth 1.7.5 endurecido com 2FA, passkey e sessão curta
 8  feat(auth): portão de autorização, matriz de permissão e escopo de loja
 9  feat(auth): provisionamento por convite e semeadura do primeiro dono
10  feat(seguranca): IP canônico, limitador, rota de máquina, cofre e cabeçalhos com CSP
11  feat(ui): tokens de tema claro e escuro e primitivos shadcn
12  feat(ui): shell do aplicativo, navegação por catálogo único e componentes comuns
13  feat(acesso): telas de entrar, primeiro acesso, recuperação e meu perfil
14  feat(fila): filas BullMQ, agendador e worker em processo separado
15  docs(adr): registrar as decisões 0008 a 0024 da reconstrução
16  test(travas): instalar as travas de fonte e a matriz REQ × teste
```

**Onda 2 — em paralelo; dentro de cada pacote, na ordem listada na §6.** Cada pacote fecha com `docs(<dominio>): documentar o módulo <dominio>` e `test(<dominio>): cobrir <o que>`. Um pacote nunca commita arquivo de outro; se o `git status` mostrar arquivo alheio, **não commite** — avise o orquestrador.

**Onda 3 — fechamento**

```
41  test(travas): ligar o piso mínimo e o inventário estrito de rotas
42  fix(integracao): correções cruzadas apontadas pela verificação completa
43  docs(repo): sincronizar documentação com o código e gerar o mapa do projeto
44  chore(release): fechar o R1 da reconstrução
```

**Regras de merge/deploy**: `develop` → HML pelo CI; merge em `master` só depois de validado em HML; **backup do banco (`npm run db:backup`) é passo obrigatório antes de qualquer deploy em PRD** e a falha do backup aborta o deploy.

---

## 10. Riscos gerais e planos B

| Risco | Sinal | Plano B |
|---|---|---|
| Schema fechado descobre falta de coluna na onda 2 | um pacote pede migração | **para o pacote**, ADR, a fundação aplica a migração `0017_*` e avisa os oito; nenhum pacote gera migração |
| Dois agentes gravam o mesmo arquivo | `git status` com arquivo alheio | ownership da §8 é a fonte da verdade; desfaz e reporta. Costuras da §5 existem exatamente para evitar isso |
| Testes de integração colidindo no mesmo banco | falhas intermitentes e dados de outro pacote | banco e índice Redis por pacote (§3.3); nunca rodar sem `--sufixo` na onda 2 |
| `next build` concorrente corrompendo `.next` | build falhando sem motivo | build só na fundação e na integração |
| Opção do Better Auth com nome errado passando no teste | tudo verde e nada acontece | testes de **efeito** (§F5) e a conferência do `dist` antes do commit 0 |
| Better Auth minor novo instalando rota | T3 vermelha | releitura da régua a cada minor (REQ-M5); item no PR template |
| `vitest-axe` incompatível com Vitest 5 / Vite 8 | teste de a11y não roda | chamar `axe-core` direto no teste (5 linhas) |
| Redis indisponível em produção | fila sem backend | backend PostgreSQL do BullMQ 6 (`createPostgresBackend`), mesma API, throughput ~1,5–2× menor |
| Vendedora sem aparelho para 2º fator | primeiro acesso trava na entrega | chave de segurança física (FIDO2) por pessoa, comprada **antes** do deploy — decidir 30 dias antes |
| Lixo na raiz por shell mal escapado | arquivos de 0 byte com nomes estranhos | `npm run lixo` antes de cada commit de fase; nunca `node -e "…"` nem `psql -c "…"` inline no PowerShell |
