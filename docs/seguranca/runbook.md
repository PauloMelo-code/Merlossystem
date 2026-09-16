# Runbook de operacao e seguranca

O que fazer, na ordem, quando algo precisa ser feito em HML ou PRD. Procedimento
que nao esta aqui nao foi ensaiado; procedimento ensaiado que mudou tem de ser
corrigido aqui no mesmo PR.

**Nenhum valor de segredo aparece neste arquivo.** Ele diz ONDE o segredo mora
e COMO trocar, nunca qual e. A trava T17 varre `docs/` em busca de credencial
literal.

---

## 1. Provisionar um ambiente novo

Ordem obrigatoria. Pular um passo deixa o sistema num estado que parece de pe e
nao e.

1. **Subir os servicos**: Postgres 16, Redis 7 e MinIO. Em dev, `npm run db:up`
   (`docker-compose.yml`: portas 5437, 6382, 9002 e console 9003).
2. **Criar o banco** e conceder ao papel que vai migrar.
3. **Definir a credencial dos dois papeis de banco.** `merlo_app` e
   `merlo_migracao` nascem SEM credencial na migracao 0000, de proposito:
   credencial em migracao e credencial versionada. Quem provisiona define as
   duas AQUI, fora do repositorio, e as guarda no cofre de segredos do
   ambiente. `merlo_app` nunca e dono das tabelas — e isso que faz o `REVOKE`
   das trilhas valer.
4. **Preencher as variaveis de ambiente.** A lista completa e `.env.example`,
   que e o espelho de `src/lib/env.ts` (a trava T17 reprova divergencia).
   Segredos dedicados de 32 bytes ou mais, DIFERENTES em HML e PRD:
   `BETTER_AUTH_SECRETS`, `AUTH_EMAIL_HASH_KEY`, `INTEGRATIONS_KEY`,
   `INTEGRATIONS_STATE_KEY`, `META_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`,
   `INSTAGRAM_VERIFY_TOKEN`, `SONDA_SEGREDO`.
5. **Migrar**: `npm run db:migrate` (usa `DATABASE_URL_MIGRACAO`).
6. **Conferir o schema**: `npm run db:verificar`. Ele confere as 48 tabelas, as
   FKs, os CHECKs e o `REVOKE` das trilhas depois da migracao 0016.
7. **Subir o app e o worker**, os dois, da mesma imagem. Subir so o app deixa a
   fila sem consumidor: a mensagem chega no WhatsApp e nao aparece na tela.
8. **Semear o primeiro dono**: `npm run primeiro-dono -- <e-mail>`. Ele imprime
   o link UMA vez; copie e entregue por canal seguro. O script nao aceita
   credencial, nao cria usuario e nunca roda no entrypoint do container.
9. **Rodar a fumaca**: `node scripts/fumaca-seguranca.mjs https://<ambiente>`.

Em DEV, e so em dev, `npm run db:seed` carrega duas lojas, quatro integracoes
desconectadas, quatro contatos e um catalogo. Ele aborta com ambiente de
producao e aborta se o host do banco nao for local.

---

## 2. Medir o custo do KDF antes do primeiro deploy em PRD

`node scripts/medir-kdf.mjs` na VPS de destino. O resultado define
`PISO_RECUSA_MS`, que precisa ficar ACIMA do p95 do Argon2id — senao a recusa
de "conta que existe" demora mais que a de "conta que nao existe", e o piso
deixa de esconder a diferenca.

Enquanto a medicao nao acontece vale o default: `PISO_RECUSA_MS=450`, semaforo
em 4 e `UV_THREADPOOL_SIZE=8` (ja no Dockerfile).

---

## 3. Backup e restauracao

**Antes de TODO deploy em PRD**, sem excecao. A falha do backup ABORTA o deploy.

```
npm run db:backup
```

O script usa `DATABASE_URL_MIGRACAO` e `pg_dump` com `--no-owner --no-acl
--clean --if-exists`. O arquivo sai como `backup_DD_MM_AAAA_HH_MM.sql`, sem
credencial nenhuma no nome.

Duas coisas que o comando NAO faz sozinho e que fazem parte do procedimento:

1. **Cifrar antes de sair do servidor** (`age`). O dump carrega o token de
   sessao em claro — e a compensacao escrita da excecao REQ-K3 (ADR 0008).
2. **Copiar o bucket do MinIO junto.** Banco sem midia e restauracao que abre a
   conversa com o clipe quebrado.

**Restaurar** e sempre em HML primeiro, e a validacao e o proprio
`npm run db:verificar` mais um login completo. Backup so conta como testado
depois de um restore executado com sucesso em HML.

Politica: diario por 30 dias, semanal comprimido por 90 dias, e um snapshot
manual permanente antes de cada deploy em PRD. Nunca no mesmo servidor do banco.

---

## 4. Deploy

O procedimento completo esta em `docs/deploy.md`. O resumo do que nao pode
mudar de ordem:

`verificar` (lint, tipos, compliance, travas, testes, build) → backup em PRD →
`db:migrate` → publicar app → publicar worker → `fumaca-seguranca.mjs` → tag.

`drizzle-kit push` e PROIBIDO em HML e PRD. O CI reprova `push` em script de
deploy.

---

## 5. Rotacionar segredo

### 5.1 `BETTER_AUTH_SECRETS`

E a unica variavel versionada por desenho: o formato e
`v2:<novo>,v1:<antigo>`, do mais novo para o mais velho. O novo assina; os
antigos ainda validam. Depois que a ultima sessao assinada com `v1` expirar
(teto absoluto de 12 h), remova `v1` num segundo deploy.

Trocar em um passo so derruba TODA sessao ativa no meio do expediente.

### 5.2 `INTEGRATIONS_KEY`

**Nao rotacione sem plano.** E a chave do cofre AES-256-GCM, e as credenciais
das integracoes estao cifradas com ela. Trocar sem re-cifrar transforma toda
integracao em `{erro: "ilegivel"}` na tela e derruba os webhooks de saida.

O plano e: decifrar com a chave velha e re-cifrar com a nova, integracao por
integracao, com o AAD (o id da linha) inalterado, numa janela sem trafego.

### 5.3 `DISCORD_WEBHOOK_ALERTAS`

Rotacione livremente. Quem tem a URL escreve no canal; ela e segredo de baixo
valor e alta exposicao. O alerta que vai para la NAO carrega nome, e-mail, IP
nem alvo — so `"Evento de seguranca: <tipo>. Veja em /auditoria/seguranca"`.

### 5.4 `META_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `INSTAGRAM_VERIFY_TOKEN`

Trocar exige atualizar no painel da Meta ANTES de trocar aqui. Na janela entre
os dois, o webhook e recusado (`webhook_recusado` na trilha, com alerta).

`FACEBOOK_VERIFY_TOKEN` e `TIKTOK_SHOP_APP_SECRET` nao existem: os dois canais
estao fora do R1, sem rota e sem adaptador.

---

## 6. Incidente de conta

### 6.1 Conta bloqueada

O bloqueio e por CONTA, atomico e persistido: cinco falhas em quinze minutos.
Ele se solta sozinho. Para soltar antes, `usuarios:destravar` na tela de
usuarios, com motivo obrigatorio — a acao grava a trilha antes do efeito.

Passkey entra MESMO com a conta bloqueada e zera o contador: o bloqueio existe
contra adivinhacao de senha, e a passkey nao e adivinhavel.

### 6.2 Pessoa perdeu os dois fatores

`usuarios:recuperar_fator`, por dono ou admin, com identidade registrada e
motivo. A trilha (`recuperacao_assistida`) e gravada ANTES do efeito e na mesma
transacao. Nao existem codigos de resgate — a decisao esta no ADR 0008, e este
e o caminho que a substitui.

### 6.3 Suspeita de sessao roubada

1. `usuarios:encerrar_sessoes` no alvo (modal de bloqueio de 3 s);
2. `usuarios:iniciar_reset` — o admin NUNCA define a senha;
3. `/auditoria/seguranca`, filtrando por usuario e periodo. A aba mostra
   `email_hash`, nunca e-mail em claro.

### 6.4 Desativar alguem que saiu da empresa

`usuarios:desativar`. Isso revoga as sessoes na hora, pelo canal
`usuario:<id>:revogar`, e o papel e o `ativo` sao lidos do BANCO a cada
requisicao — nao ficam so no token.

---

## 7. Fila e worker

### 7.1 Job na DLQ

Job que esgotou as cinco tentativas vai para `bull:<fila>:dlq` e sai um log
`fatal`. Job morto na `mensagens-saida` e cliente sem resposta: trate como
incidente, nao como ruido.

Ordem: ler o log (`fila`, `job`, `id`, `erro`), corrigir a causa, e so entao
reenfileirar. Reenfileirar sem corrigir gera o mesmo job morto.

### 7.2 Redis indisponivel

- O limitador passa FAIL-OPEN e grava `limitador_indisponivel` com alerta. O
  controle real do login continua de pe: o bloqueio por conta e banco.
- A fila para de aceitar job novo. `enfileirar()` nao lanca — devolve `null` e
  loga. Nada na tela quebra; o trabalho fica para quando voltar.
- O tempo real para. A tela reconcilia com leitura completa ao reconectar, e
  degrada para polling de 15 s depois de duas falhas seguidas.

Plano B escrito, se o ambiente nao puder ter Redis: o backend PostgreSQL do
BullMQ 6 (`createPostgresBackend`), mesma API e mesmo worker, com throughput de
1,5 a 2 vezes menor (ADR 0014).

### 7.3 Desligar o worker

`SIGTERM`. Ele espera o job corrente, fecha as filas e as conexoes. Nunca
`SIGKILL` no meio de um envio: a linha fica `pendente` e a cliente sem a
mensagem.

---

## 8. Conferencia periodica

| Quando | O que |
|---|---|
| A cada minor do Better Auth ou do Next | reler `docs/seguranca/conferencia-ba-1.7.5.md`; rodar `tests/seguranca/caminhos-ba.test.ts` (caminho novo instalado pelo minor reprova) |
| A cada trimestre em PRD | `node scripts/fumaca-seguranca.mjs` e uma passada na skill `/audit-auth-security` |
| Semanal | `npm audit --omit=dev --audit-level=high` (o Renovate abre o PR) |
| Antes de cada deploy em PRD | backup, e o backup restaurado em HML |
| Quando uma `EXCECAO-SEG` vence | a trava T24 reprova o CI; renove com decisao escrita ou remova a excecao |

---

## 9. Pendencias que bloqueiam o deploy

Estao em `02-seguranca.md` secao 22, com dono e prazo. Resumo do que impede
entregar:

1. **Comportamento do `x-forwarded-for` no proxy do ambiente** — medir em HML
   antes do primeiro deploy. Enquanto isso vale `MAX_SALTOS_CONFIAVEIS = 1` com
   queda para o socket e evento `ip_cadeia_inesperada`.
2. **p95 do Argon2id na VPS** — secao 2 deste runbook.
3. **Provedor de e-mail transacional e dominio com SPF, DKIM e DMARC** — sem
   ele o convite e o reset nao saem. A fila `emails` esta pronta e o
   processador confere o retorno do provedor; falta o transporte. A fumaca
   reprova `_dmarc` vazio.
4. **Todas as vendedoras com aparelho para passkey ou TOTP** — confirmar 30
   dias antes do deploy em PRD. Plano B: chave de seguranca fisica por pessoa,
   comprada antes. Aparelho compartilhado da loja e INACEITAVEL: e fator unico
   com dono coletivo.
