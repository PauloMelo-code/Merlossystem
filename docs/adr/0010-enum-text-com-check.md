# ADR 0010 — Listas fechadas como text mais CHECK, nao pgEnum

Data: 16/09/2026
Status: Aceito

## Contexto

`pgEnum` parece a escolha obvia, e e a escolha errada aqui. Acrescentar valor a
um enum do Postgres e DDL, e DDL em migracao de release trava a tabela; REMOVER
valor exige recriar o tipo, reescrever toda coluna que o usa e derrubar as
views. Este sistema tem 25 listas fechadas e elas mudam: status de entrega,
tipo de alerta, categoria de resposta, forma de pagamento.

## Decisao

Toda lista fechada e `text` com `CHECK (coluna in (...))`, e o CHECK e GERADO a
partir da constante TypeScript por `checkLista()`. A constante e a fonte unica;
o banco e o espelho.

## Alternativas consideradas

- **pgEnum**: o custo de mudar ja foi descrito. Alem disso, o valor do enum nao
  aparece no `information_schema` de um jeito que o teste compare
  mecanicamente com a constante TS.
- **Sem CHECK, so validacao na aplicacao**: um `UPDATE` manual, um script de
  correcao ou um pacote da onda 2 grava "enviada" onde a constante diz
  "enviado", e a tela passa a mostrar em branco sem erro nenhum.

## Consequencias

- `tests/integracao/enums-check.test.ts` compara CADA `CHECK` do banco com a
  constante correspondente, incluindo `TIPOS_AUTH_EVENTO` e `ACOES_AUDITADAS`.
  Divergiu, reprova, e o teste aponta o valor que sobra ou falta.
- Acrescentar valor e uma migracao `ALTER TABLE ... DROP CONSTRAINT / ADD
  CONSTRAINT`, barata e sem reescrita de tabela.
