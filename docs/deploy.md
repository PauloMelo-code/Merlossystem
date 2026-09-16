# Deploy

O pipeline esta em `.github/workflows/deploy.yml`. Este documento explica a
ordem e o porque de cada passo; o runbook (`docs/seguranca/runbook.md`) explica
o que fazer quando algo da errado.

O alvo e o **EasyPanel**, acionado por **webhook**: o CI verifica, faz backup
(PRD), migra e chama o webhook de deploy de cada servico. Quem constroi a imagem
a partir do `Dockerfile` e o proprio EasyPanel.

---

## 1. Caminho

```
push em qualquer branch  ->  job verificar (12 passos)
push em develop          ->  verificar -> migrar -> webhook app + worker -> espera -> fumaca
push em master           ->  verificar -> BACKUP -> migrar -> webhook app + worker -> espera -> fumaca -> tag
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
3. **webhook do EasyPanel** do servico **app** e do servico **worker**
4. **espera** de `EASYPANEL_ESPERA_S` segundos (padrao 300)
5. `node scripts/fumaca-seguranca.mjs --alvo <HML_APP_URL>`

O passo 3 e **fail-closed**: ele confere os DOIS webhooks antes de disparar
qualquer um. Faltou um, nenhum servico e chamado e o job fica vermelho.
Publicar so o app sobe um sistema sem quem processe a fila, e o sintoma aparece
na loja: a mensagem chega no WhatsApp e nao aparece na tela.

A URL do webhook **e a credencial** — o token vai no caminho. Por isso o passo
recusa URL que nao comece com `https://`, nunca imprime o valor e deixa o
Actions mascara-lo no log. Falha de rede tem 3 tentativas com 5 s de intervalo;
chamar o webhook duas vezes so enfileira o mesmo deploy de novo.

**Por que a espera existe**: o webhook so ENFILEIRA o deploy. O EasyPanel ainda
vai construir a imagem e trocar o container. Sem esperar, a fumaca testaria a
versao anterior e daria um verde que nao vale nada. A espera e fixa porque
nenhuma rota publica expoe a versao no ar — `/api/saude` nao responde versao, de
proposito. Quando `/api/pronto` (que exige segredo) devolver o commit, a espera
vira conferencia de versao.

---

## 4. PRD (branch `master`)

1. **exigir `PRD_BACKUP_DEST`** — destino FORA do servidor do banco. Sem ele o
   deploy aborta antes de tudo.
2. **`npm run db:backup`** — passo OBRIGATORIO. Falhou, aborta.
3. `npm run db:migrate`
4. webhook do EasyPanel: app e worker (mesmas regras do HML)
5. espera de `EASYPANEL_ESPERA_S`
6. fumaca de seguranca
7. tag `prd-AAAAMMDD-HHMM` (por isso o job tem `contents: write`)

O backup vem ANTES de qualquer coisa que mude o ambiente. Se um webhook falhar
depois da migracao, o banco migrado tem copia e o caminho de volta esta na
secao 8.

O dump nao vira artifact do Actions: qualquer pessoa com leitura no repositorio
baixaria nome, telefone e valor de venda de cliente real. E ele e cifrado com
`age` antes de sair do servidor, junto com o bucket do MinIO — as duas coisas
estao no runbook, secao 3.

---

## 5. Secrets e variaveis do GitHub

Cadastrados por **Environment** (`hml` e `prd`, em Settings > Environments).
`<AMB>` e `HML` ou `PRD`.

| Nome | Tipo | Para que |
|---|---|---|
| `<AMB>_DATABASE_URL_MIGRACAO` | secret | papel `merlo_migracao`: migracao e backup |
| `<AMB>_EASYPANEL_WEBHOOK_APP` | secret | URL `https://` do webhook de deploy do servico app |
| `<AMB>_EASYPANEL_WEBHOOK_WORKER` | secret | URL `https://` do webhook de deploy do servico worker |
| `<AMB>_APP_URL` | secret | endereco publico do ambiente, alvo da fumaca |
| `<AMB>_SONDA_SEGREDO` | secret | o mesmo `SONDA_SEGREDO` do app; a fumaca manda em `x-merlo-sonda` |
| `PRD_BACKUP_DEST` | secret | destino do backup, fora do servidor do banco |
| `EASYPANEL_ESPERA_S` | variavel | segundos entre o webhook e a fumaca; padrao 300 |

**Calibrar `EASYPANEL_ESPERA_S`**: no primeiro deploy de cada ambiente, medir no
painel quanto tempo vai do webhook ate o container novo responder, e gravar
esse tempo com folga. Build que cresce sem ninguem mexer na espera volta a
testar a versao anterior.

O **ambiente do aplicativo** (as chaves de `.env.example`) NAO fica no GitHub:
fica em cada servico do EasyPanel. O GitHub so guarda o que o proprio pipeline
usa.

---

## 6. Configurar o EasyPanel (uma vez por ambiente)

Um projeto por ambiente (`merlostore-hml`, `merlostore-prd`), cada um com:

| Servico | Origem | Observacao |
|---|---|---|
| `app` | GitHub, `Dockerfile`, **alvo `app`** | porta 3005; `HEALTHCHECK` em `/api/saude` ja esta na imagem |
| `worker` | GitHub, `Dockerfile`, **alvo `worker`** | sem porta publica; mesmo ambiente do app, menos `PORT` |
| `postgres` | servico gerenciado, Postgres 16 | papeis `merlo_app` e `merlo_migracao` (runbook) |
| `redis` | servico gerenciado, Redis 7 | com persistencia ligada (a fila nao pode viver so em memoria) |
| `minio` | servico | bucket `merlostore-midia` privado |

Regras que o painel nao impoe sozinho:

1. **Deploy automatico DESLIGADO** nos servicos `app` e `worker`. Com ele
   ligado, o push em `master` publica ANTES do backup e da migracao, e o
   pipeline inteiro vira enfeite. Quem publica e o webhook, chamado pelo CI.
2. **Branch do servico** = a do ambiente: `develop` em HML, `master` em PRD.
3. **Alvo do build conferido**. O `Dockerfile` tem dois alvos, e o ULTIMO e o
   `worker`: build sem alvo explicito entrega o worker no lugar do app. Se o
   painel nao oferecer o campo de alvo, o deploy NAO sobe — registrar como
   pendencia antes de seguir (ver secao 10).
4. **Ambiente de cada servico** preenchido a partir de `.env.example`, com os
   segredos gerados para aquele ambiente (nunca os de outro).
5. **Webhook de deploy** de `app` e de `worker` copiado para os secrets da
   secao 5.
6. **NADA de comando de seed, migracao ou bootstrap** no painel. O primeiro
   dono sai de `npm run primeiro-dono`, rodado uma vez, a mao.

---

## 7. Imagem

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

### E-mail em HML e PRD

`src/lib/env.ts` exige `EMAIL_PROVEDOR`, `EMAIL_REMETENTE` e `EMAIL_API_KEY`
em producao. **O provedor ainda nao foi escolhido**: o transporte em
`src/server/processadores/emails.ts` so reconhece "sem provedor". Com qualquer
valor em `EMAIL_PROVEDOR`, o app sobe, mas todo e-mail de seguranca (convite,
redefinicao, avisos) falha, e o job vai para a DLQ com
`email_seguranca_falhou` na trilha e alerta. Ou seja: **sem provedor, nenhum
convite chega por e-mail em HML nem em PRD**. O que preencher quando o provedor
for escolhido esta no `README.md`.

---

## 8. Rollback

### Codigo

1. Pausar: nao fazer mais merge em `master`.
2. `git revert` do merge problematico em `master` e push. O pipeline roda
   INTEIRO de novo — inclusive o backup, antes de qualquer outra coisa.
3. As tags `prd-AAAAMMDD-HHMM` marcam cada versao que passou pela fumaca: e
   por elas que se sabe para onde voltar.

Nao existe "redeploy do container antigo" como atalho: o servico constroi a
partir da branch, e o caminho de volta e o mesmo caminho de ida.

### Banco

1. Identificar o ultimo backup valido (o do deploy que falhou foi feito ANTES
   da migracao).
2. Restaurar em HML PRIMEIRO e validar (`npm run db:verificar` mais um login
   completo com segundo fator).
3. Se ok, restaurar em PRD, com o servico `worker` parado durante a restauracao
   (senao ele processa fila contra um banco pela metade).
4. Registrar o incidente na trilha.

Migracao nunca e revertida por `DOWN`: a correcao e uma migracao nova. Reverter
DDL em producao com dado dentro e como se perde dado.

---

## 9. Infraestrutura

Frontend e backend em VPS separadas, por ambiente:

| Servidor | vCPU | RAM | Disco | Funcao |
|---|---|---|---|---|
| VPS frontend | 2 | 8 GB | 100 GB | Next (app) |
| VPS backend | 4 | 16 GB | 240 GB | worker, PostgreSQL, Redis, MinIO |

HML e replica exata de PRD: mesmas versoes, mesma configuracao. Ambiente de
homologacao que difere do de producao valida o ambiente errado. O desenho nao
muda entre EasyPanel e as duas VPS: mesma imagem, mesmos dois processos.

Portas em desenvolvimento: Postgres 5437, Redis 6382, MinIO 9002 com console
9003.

---

## 10. Pendencias antes do primeiro deploy

| Pendencia | Dono | Sem ela |
|---|---|---|
| Conferir se o EasyPanel aceita o **alvo** do `Dockerfile` por servico | Paulo | o servico `app` sobe com a imagem do worker |
| Medir `EASYPANEL_ESPERA_S` no primeiro deploy de HML | Paulo | a fumaca testa a versao anterior |
| Escolher o provedor de e-mail e o dominio com SPF/DKIM/DMARC | Paulo | nenhum convite chega por e-mail (secao 7) |
| Medir se o Traefik do EasyPanel apenda ou sobrescreve o `x-forwarded-for` | Paulo + infra | o IP canonico de `src/lib/seguranca/ip.ts` cai para o socket, com alerta |
| Medir o p95 do Argon2id na VPS (`npm run medir-kdf`) | Paulo | `PISO_RECUSA_MS` fica no padrao; ver `docs/seguranca/runbook.md`, secao 2 |

---

## 11. O que e proibido

- `drizzle-kit push` em HML ou PRD. So em banco descartavel de desenvolvimento.
- Deploy em PRD sem backup.
- Subir o app sem o worker.
- Deploy automatico do EasyPanel ligado nos servicos `app` e `worker`.
- Webhook de deploy em `http://`, em log ou em arquivo versionado.
- Backup no mesmo servidor do banco.
- Credencial no nome do arquivo de backup ou em `argv`.
