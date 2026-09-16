# MerlostoreChat

Plataforma de atendimento multicanal e CRM da **Merlo Store**, rede de moda feminina com
duas lojas (Centro e Cerro Azul). Num lugar só: as conversas de WhatsApp e Instagram de
vários números por loja, a carteira de contatos por loja, o catálogo espelhado do Bling,
os pedidos com a ponte manual para o Masc (o ERP onde a venda é lançada), campanhas,
mensagens agendadas, alertas, trilha de auditoria, LGPD e relatórios.

Quem usa: **vendedora** (loja fixa), **gerente** (as duas lojas), **administrador** e
**dono**.

> **Em reconstrução.** A branch `refactor/reconstrucao-estrutura-base` refaz o sistema do
> zero. O código anterior continua no git, no commit `5e902d4`, e serve só como referência
> de domínio — nunca de implementação. Banco novo, sem migração de dados.

## Stack

| Camada | O que roda |
|---|---|
| Runtime | **Node 24 LTS** |
| Framework | Next.js 16.3.5 (App Router, Server Actions, `src/proxy.ts`), React 19.3 |
| Linguagem | TypeScript 6 strict |
| Banco | PostgreSQL 16 + Drizzle ORM 0.45 (migrações versionadas) |
| Auth | Better Auth 1.7.5 endurecido, Argon2id, passkey/TOTP obrigatório |
| Fila | BullMQ 6 + Redis, worker em processo separado |
| Mídia | MinIO (S3), bucket privado, leitura só pela rota interna do app |
| UI | Tailwind v4 (CSS-first) + shadcn/ui sobre Radix |
| Testes | Vitest 5 — unidade, travas de fonte, componentes, integração |

**Node**: a máquina de desenvolvimento e a **VPS** devem rodar o **Node 24 LTS mais
recente**. O `jsdom` está fixado em `29.1.1` porque o 30 exige Node ≥ 24.15, acima do que
há na máquina de desenvolvimento hoje (24.12); quando a VPS e a máquina estiverem no 24
LTS atual, o `jsdom` pode subir.

## Subir o ambiente

```bash
npm ci
npm run db:up        # Postgres 5437, Redis 6382, MinIO 9002 (console 9003)
npm run db:migrate   # aplica as migrações com o papel merlo_migracao
npm run db:verificar # confere auditoria, timestamptz(3), FK RESTRICT, únicos parciais
npm run db:seed      # lojas, etiquetas e catálogo de exemplo — NUNCA cria credencial
npm run primeiro-dono  # emite o convite do primeiro dono e imprime o link UMA vez

npm run dev          # app em http://localhost:3005
npm run worker       # worker da fila, em outro terminal
```

| Serviço | Porta | Observação |
|---|---|---|
| App | 3005 | `npm run dev` |
| PostgreSQL | 5437 | container `merlostore_db` |
| Redis | 6382 | container `merlostore_redis` |
| MinIO | 9002 / 9003 | container `merlostore_minio`, bucket `merlostore-midia` privado |

Variáveis de ambiente: copie `.env.example` para `.env` e preencha. O `.env` **nunca** é
versionado nem editado por agente; a fonte da verdade das variáveis é `src/lib/env.ts`,
que valida tudo com Zod e falha no boot se faltar algo.

## Verificar

```bash
npm run verificar    # lint + typecheck + compliance + travas + testes + docs
npm run build
```

| Comando | O que prova |
|---|---|
| `npm run lint` / `npm run typecheck` | ESLint flat config e `tsc --noEmit` |
| `npm run compliance` | regras absolutas: Drizzle, sem delete físico, auditoria, tamanho, segredo |
| `npm run test:compliance` | a trava do próprio auditor (10 checagens) |
| `npm run test:travas` | varreduras de fonte: portão, escopo de loja, timestamps, rotas |
| `npm run test:unidade` / `test:componentes` | regras puras / componentes com os estados |
| `npm run test:integracao` | Postgres e Redis reais |
| `npm run map` / `npm run docs:check` | mapa do projeto e drift de documentação |
| `npm run lixo` | quarentena do lixo de shell mal escapado na raiz |

## Como o repositório está organizado

```
src/app/       rotas: (publico) login e recuperação · (app) telas · api/ 10 handlers
src/components/  ui (shadcn, vendorizado) · layout (shell) · comum (compartilhados)
src/lib/       env, erros, formato, navegação · db (schema, mutações, migrações)
               auth, segurança, rede · actions, validadores · um módulo por domínio
src/server/    worker da fila, SSE e processadores
scripts/       auditor, mapa, docs-check, banco de teste, backup, fumaça
tests/         unidade · travas · componentes · integração · segurança
docs/          adr/ · seguranca/ · modulos/ · PROJECT_MAP.md (gerado)
templates/     arquivos-ouro para copiar
```

## Documentação

| Documento | Para quê |
|---|---|
| [AGENTS.md](AGENTS.md) | regras absolutas do projeto (a fonte) |
| [CLAUDE.md](CLAUDE.md) · [Agente.md](Agente.md) | resumo operacional e comportamento do agente |
| [docs/adr/](docs/adr/) | as decisões e o porquê de cada uma |
| [docs/seguranca/](docs/seguranca/) | caminhos de acesso, runbook, matriz REQ × teste |
| [docs/modulos/](docs/modulos/) | um documento por domínio |
| [docs/definition-of-done.md](docs/definition-of-done.md) | o checklist que fecha uma entrega |
| [docs/git-commits.md](docs/git-commits.md) | Conventional Commits em PT-BR |
| [docs/deploy.md](docs/deploy.md) | HML, PRD, backup obrigatório e rollback |

## Fluxo de trabalho

`refactor/reconstrucao-estrutura-base` → `develop` (deploy em HML pelo CI) → validação em
HML → `master` (deploy em PRD). Nunca se commita direto na `master`, e **backup do banco
é passo obrigatório antes de qualquer deploy em produção** — a falha do backup aborta o
deploy.
