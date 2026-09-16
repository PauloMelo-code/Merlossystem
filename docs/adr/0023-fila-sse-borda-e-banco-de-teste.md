# ADR 0023 — Fila sem tabela de jobs, SSE com assinante unico, teto de corpo, anti-SSRF, worker empacotado e db-teste recriando schema

Data: 16/09/2026
Status: Aceito

## Contexto

Seis decisoes da camada de aplicacao que nao cabem no modelo de dados e que,
sem registro, seriam reabertas na primeira revisao.

## Decisoes

1. **Fila BullMQ sem tabela `jobs`**, detalhada no ADR 0014.
2. **SSE com UM assinante por processo.** `src/server/sse.ts` mantem uma
   conexao Redis em `psubscribe` de `loja:*` e `usuario:*` e faz o fan-out em
   memoria. Um assinante por aba seriam 200 conexoes Redis por instancia, e o
   Redis cairia muito antes do teto de conexoes SSE. A sessao e REAVALIADA a
   cada heartbeat de 25 s: o portao na abertura nao basta porque o stream vive
   horas.
3. **Teto de 1 MB para TODA Server Action**, inclusive as publicas. O upload de
   midia vai por Route Handler dedicado, que nao tem esse limite. Trava de
   fonte reprova valor maior.
4. **`src/lib/rede/buscarExterno.ts` e a unica porta de saida HTTP** para
   endereco vindo de terceiro: allowlist de host por provedor, somente https, e
   recusa de faixa interna depois do DNS. Sem ela, o container alcanca Postgres
   5437, Redis 6382, MinIO 9002 e a rede interna do provedor, e o job
   `baixar-de-url` recebe a URL do provedor. Ha UMA excecao nomeada e testada:
   a chamada ao HIBP, cujo host e literal e cujo teto e de 1,5 s.
5. **O worker e empacotado na imagem** com esbuild (`dist/worker.mjs`), porque
   o modo standalone nao copia `src/` nem o `tsx`, e resolver `tsx` pela rede a
   cada boot e inaceitavel. O bundle mantem `server-only` como externo, entao o
   processo sobe com `node --conditions=react-server`: sem a condicao, o pacote
   lanca no import e o worker nao sobe. O mesmo vale para `npm run worker`.
6. **`scripts/db-teste.mjs` NAO dropa banco.** Ele recria o SCHEMA `public` do
   banco de TESTE, com tres guardas que abortam antes de qualquer comando: host
   local, nome do banco contendo `test`, e ambiente diferente de producao. E a
   excecao escrita a regra "nunca dropar banco de dados": `scripts/` fica fora
   da varredura do auditor e a regra de DROP destrutivo dele so vale para `.sql`.

## Consequencias

- O nonce da CSP por requisicao obriga renderizacao dinamica: nenhuma rota de
  `(app)` usa `generateStaticParams` nem cache estatico. O app e 100%
  autenticado e ja era dinamico, entao o custo e conhecido e aceito.
