# ADR 0007 — Fila de disparo no PostgreSQL, não em BullMQ

Data: 18/08/2026
Status: Substituído por ADR-0008..0024 (reconstrução na branch `refactor/reconstrucao-estrutura-base`)

## Contexto

O padrão da base (`CLAUDE.md`, seção "Fila de Processamento") manda usar BullMQ
sobre Redis para jobs longos, com FIFO obrigatório, idempotência e DLQ.

O disparo de campanha é exatamente esse tipo de trabalho: centenas de envios,
cada um com latência de rede, que não cabem numa requisição HTTP.

Três fatos pesaram na decisão:

1. **O deploy não tem Redis.** O EasyPanel roda hoje um container Next e um
   PostgreSQL. BullMQ exigiria um serviço Redis **e** um processo worker
   separado — dois componentes novos para operar, monitorar e pagar.

2. **A tabela `broadcast_recipients` já era uma fila.** Ela existe desde o
   início do projeto, com uma linha por destinatário, `status`, `external_id`,
   `sent_at` e `error_message`. Nada escrevia nela. O modelo de fila durável já
   estava desenhado; faltava o código.

3. **O volume é conhecido.** Duas lojas de moda feminina. Uma campanha grande
   fala com alguns milhares de contatos, e o limite de velocidade do WhatsApp
   é mais restritivo que qualquer fila.

## Decisão

A fila do disparo é o próprio PostgreSQL.

- **FIFO**: `order by created_at` na reserva do lote.
- **Sem envio dobrado**: `for update skip locked` reserva as linhas antes do
  envio, então duas chamadas simultâneas levam conjuntos diferentes.
- **Durável**: cada envio é gravado na hora. Pausar, fechar a aba ou o
  container reiniciar não reenvia para quem já recebeu.
- **Retomável**: retomar continua de onde parou, porque a reserva só pega
  quem está `pending`.
- **Erro registrado por destinatário**: `error_message` na linha. Não há DLQ
  separada — a própria linha `failed` é o registro, e ela é visível na tela.

O laço vive em **quem chama**, não no servidor: `POST
/api/broadcasts/[id]/disparar` processa **um** lote e devolve o progresso. Um
handler que enviasse a campanha inteira estouraria o tempo limite e deixaria a
campanha em estado desconhecido — parte enviada, sem ninguém saber onde parou.

## Consequências

**A favor:**
- Nenhum componente novo de infraestrutura.
- A durabilidade é melhor que a do Redis: o estado do disparo vive no mesmo
  banco transacional do resto do sistema, e entra no mesmo backup.
- Trocar por BullMQ depois não muda a interface: quem chama continua pedindo
  "processe o próximo lote".

**Contra, e é honesto dizer:**
- **Sem worker, alguém precisa chamar.** Hoje é a aba aberta da atendente. Se
  ela fechar no meio, o envio pausa — não corrompe, mas para. Um cron batendo
  no endereço resolve, e é o próximo passo natural.
- **Sem retentativa automática.** Um destinatário que falhou fica `failed` até
  alguém agir. BullMQ daria backoff de graça.
- **Sem agendamento.** `scheduled_for` é gravado e ninguém o observa. Campanha
  agendada continua não disparando sozinha.

## Quando revisitar

Quando aparecer o **segundo** trabalho assíncrono do sistema — envio de
mensagem agendada, geração de PDF, sincronização com o Bling. Uma fila caseira
serve um caso; três casos pedem a ferramenta de verdade, com retentativa e
agendamento prontos.

Nesse momento, o que muda é o miolo de `src/lib/broadcasts/disparo.ts`. A rota
e a tela continuam iguais.
