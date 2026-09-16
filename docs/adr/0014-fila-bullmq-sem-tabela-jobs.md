# ADR 0014 — Fila BullMQ sobre Redis, sem tabela generica de jobs

Data: 16/09/2026
Status: Aceito

## Contexto

O ADR 0007 decidiu fila no PostgreSQL porque o deploy nao tinha Redis e havia
UM trabalho assincrono. Ele mesmo escreveu quando revisitar: "quando aparecer o
segundo trabalho assincrono". Agora sao oito filas (entrada de mensagem, saida,
midia, campanhas, agendadas, integracoes, manutencao e e-mails) e tres coisas
que a fila caseira nao dava: retentativa com backoff, agendamento e worker.

## Decisao

**BullMQ 6.3.6 sobre Redis, worker em processo separado.** E **nenhuma tabela
`jobs`**: a idempotencia e `jobId` deterministico do BullMQ mais os indices
unicos que ja existem no modelo, e o estado da DLQ e consultado no proprio
BullMQ. Uma tabela generica de jobs seria uma segunda verdade sobre o que ja
aconteceu, e ela discorda da primeira no dia do incidente.

Garantias fechadas: FIFO com uma prioridade so por fila; cinco tentativas com
backoff exponencial de 2 s a 32 s; erro classificado em permanente e
transitorio; DLQ em `<fila>:dlq` com `removeOnFail: false`; agendamento por
`upsertJobScheduler` com fuso `America/Sao_Paulo`; `SIGTERM` esperando o job
corrente.

## Alternativas consideradas

- **Manter o PostgreSQL como fila**: escreveriamos backoff, agendador e worker
  a mao. Tres componentes caseiros para nao subir um Redis.
- **Fila na aba do navegador** (o que existia): a campanha parava quando a
  atendente fechava a aba.

## Consequencias

- Redis passa a ser dependencia de producao. Plano B escrito: o backend
  PostgreSQL do BullMQ 6 (`createPostgresBackend`, PG 13 ou maior) tem a MESMA
  API e o mesmo worker, com throughput de 1,5 a 2 vezes menor.
- O worker e publicado JUNTO com o app. Publicar so o app sobe um sistema em
  que a mensagem chega no WhatsApp e nao aparece na tela.
- O ritmo POR CONTA (1 msg/s uazapi, 10 msg/s oficial, 3 req/s Bling) nao e do
  BullMQ, cujo limitador e por fila: e aplicado no processador, com o limitador
  Redis de `src/lib/seguranca/limite.ts`.
- O BullMQ 6 recusa nome de fila com dois-pontos; a DLQ usa o PREFIXO para
  chegar ao mesmo namespace `<fila>:dlq` no Redis.
