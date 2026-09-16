# ADR 0033 — Alcance completo da anonimizacao LGPD

Data: 16/09/2026
Status: Aceito (complementa a ADR 0013)

## Contexto

A tabela de alcance de `01-dados-dominio.md` secao 8 nao cobria quatro
depositos de texto livre que a onda 2 encontrou (M2): a previa da ultima
mensagem na lista de conversas, o nome original do arquivo recebido, o
conteudo das mensagens agendadas e os campos livres do pedido. Com eles, o
telefone citado numa mensagem sobrevivia a eliminacao e o teste de aceitacao
("o telefone nao aparece em tabela nenhuma") falhava.

## Decisao

A anonimizacao tambem limpa, na mesma transacao:

| Deposito | Tratamento |
|---|---|
| `conversas.ultima_mensagem_previa` | marcador (cache: sem carimbo de `updated_at`) |
| `lojas_midias.nome_original` das midias recebidas do titular | `NULL`, e a midia vira excluida |
| `conversas_agendamentos.conteudo` e `variaveis` | marcador e `[]`; o que estava `agendada` vira `cancelada` |
| `pedidos.observacoes` e `pedidos.endereco_entrega` | `NULL`; o pedido, valores, numero e SKU ficam |

O pedido permanece porque a venda de verdade (o registro fiscal) mora no Masc;
o endereco e a observacao nao sao necessarios para provar a venda.

A parte de banco e `anonimizarTitular()` em `src/lib/db/mutacoes-sistema.ts`:
so os UPDATEs em lote. A regra de negocio continua no modulo LGPD
(`src/lib/lgpd`): trilha `lgpd_anonimizado` ANTES do efeito, a linha de
`contatos` por trava de colisao, a solicitacao com a contagem por tabela e o
job `limpar-midia` depois do commit.

`lgpd_solicitacoes.motivo` entrou em `CAMPOS_PII`: e texto livre e pode trazer
o nome do titular para dentro da trilha.

## Consequencias

- O agendamento cancelado grava `cancelada_por` com o autor da anonimizacao.
- A contagem por tabela em `lgpd_solicitacoes.resultado` ganha
  `conversas_agendamentos` e `pedidos`.
