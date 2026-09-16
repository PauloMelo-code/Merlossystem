# Deploy

O pipeline esta em `.github/workflows/deploy.yml`. Este documento explica a
ordem e o porque de cada passo; o runbook (`docs/seguranca/runbook.md`) explica
o que fazer quando algo da errado.

---

## 1. Caminho

```
push em qualquer branch  ->  job verificar (12 passos)
push em develop          ->  verificar -> deploy HML
push em master           ->  verificar -> BACKUP -> deploy PRD -> tag
```

`develop` e `master` sao os unicos gatilhos de deploy. Merge em `master` so
depois de validado em HML.

---

## 2. Os 12 passos de `verificar`

Rodam em TODO push e TODA PR, nesta ordem.

| # | Passo | Por que aqui |
|---|---|---|
| 1 | `npm run lint` | mais barato primeiro |
| 2 | `npm run typecheck` | idem |
| 3 | `npm run compliance` | auditor da casa: Prisma, SQLite, delete fisico, tabela sem auditoria, arquivo grande, segredo |
| 4 | `npm run test:compliance` | a trava do auditor: prova que ele aceita os helpers E ainda pega as violacoes |
| 5 | `npm run test:travas` | travas de FONTE, antes de subir servico: e o retorno mais rapido |
| 6 | `npm run test:unidade` | regra pura, sem banco |
| 7 | `npm run test:componentes` | jsdom, com os quatro estados e o modal de bloqueio |
| 8 | `db-teste` + `db:migrate` + `db:verificar` | so aqui o Postgres e o Redis sobem |
| 9 | `npm run test:integracao` | actions e handlers ponta a ponta, com banco real |
| 10 | `docs-check --strict` + `ai-marks` | drift entre codigo e documentacao, e marca invisivel de texto gerado |
| 11 | `npm run build` | o build roda com `NODE_ENV=production`, entao cobra o ambiente de producao inteiro |
| 12 | `npm audit --omit=dev --audit-level=high` + `gitleaks` | vulnerabilidade em dependencia de runtime e segredo no historico |

**Por que o auditor roda no CI e nao so no hook**: os hooks de `.claude/hooks/`
so existem dentro do Claude Code. Outra ferramenta de IA, qualquer pessoa da
equipe e qualquer commit vindo de fora passam por baixo deles. O CI e a unica
barreira comum.

**O ambiente de teste do CI e gerado na hora**, num passo que escreve em
`$GITHUB_ENV` com `openssl rand`. Segredo literal no workflow viraria achado do
gitleaks e, pior, um valor de teste que alguem copia para producao.

---

## 3. HML (branch `develop`)

1. `npm ci`
2. `npm run db:migrate` com `HML_DATABASE_URL_MIGRACAO` (papel `merlo_migracao`)
3. publicar o **app** e publicar o **worker**
4. `node scripts/fumaca-seguranca.mjs --alvo <HML_APP_URL>`

O passo 3 aborta se o gatilho do worker nao estiver configurado. Publicar so o
app sobe um sistema sem quem processe a fila, e o sintoma aparece na loja: a
mensagem chega no WhatsApp e nao aparece na tela.

---

## 4. PRD (branch `master`)

1. **exigir `PRD_BACKUP_DEST`** — destino FORA do servidor do banco. Sem ele o
   deploy aborta antes de tudo.
2. **`npm run db:backup`** — passo OBRIGATORIO. Falhou, aborta.
3. `npm run db:migrate`
4. publicar app e worker
5. fumaca de seguranca
6. tag `prd-AAAAMMDD-HHMM`

O dump nao vira artifact do Actions: qualquer pessoa com leitura no repositorio
baixaria nome, telefone e valor de venda de cliente real. E ele e cifrado com
`age` antes de sair do servidor, junto com o bucket do MinIO — as duas coisas
estao no runbook, secao 3.

---

## 5. Imagem

Uma imagem, dois alvos (`Dockerfile`):

- **`app`** — Next em modo standalone, porta 3005, `HEALTHCHECK` em
  `/api/saude`.
- **`worker`** — `dist/worker.mjs`, empacotado com esbuild no mesmo build.
  Roda com `node --conditions=react-server`, porque o bundle mantem
  `import "server-only"` como externo e esse pacote lanca no import fora do
  runtime do Next.

`node:24-slim`, e nao alpine: `sharp` e `@node-rs/argon2` sao addons nativos
compilados contra a glibc. `UV_THREADPOOL_SIZE=8` porque os dois bloqueiam
thread do libuv, e o padrao de 4 estrangula o login.

**NADA de seed, migracao ou bootstrap no entrypoint.** Migrar e passo de
release, e a falha do passo aborta o deploy. Seed no entrypoint e o caminho
classico para uma conta padrao ficar viva em producao.

---

## 6. Infraestrutura

Frontend e backend em VPS separadas, por ambiente:

| Servidor | vCPU | RAM | Disco | Funcao |
|---|---|---|---|---|
| VPS frontend | 2 | 8 GB | 100 GB | Next (app) |
| VPS backend | 4 | 16 GB | 240 GB | worker, PostgreSQL, Redis, MinIO |

HML e replica exata de PRD: mesmas versoes, mesma configuracao. Ambiente de
homologacao que difere do de producao valida o ambiente errado.

Portas em desenvolvimento: Postgres 5437, Redis 6382, MinIO 9002 com console
9003.

---

## 7. Rollback

1. Pausar o deploy.
2. Identificar o ultimo backup valido.
3. Restaurar em HML PRIMEIRO e validar (`npm run db:verificar` mais um login
   completo com segundo fator).
4. Se ok, restaurar em PRD.
5. Registrar o incidente na trilha.

Migracao nunca e revertida por `DOWN`: a correcao e uma migracao nova. Reverter
DDL em producao com dado dentro e como se perde dado.

---

## 8. O que e proibido

- `drizzle-kit push` em HML ou PRD. So em banco descartavel de desenvolvimento.
- Deploy em PRD sem backup.
- Subir o app sem o worker.
- Backup no mesmo servidor do banco.
- Credencial no nome do arquivo de backup ou em `argv`.
