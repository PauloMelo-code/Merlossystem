# ADR 0022 — FK composta (id, loja_id) e FK de modified_by por SQL na migracao

Data: 16/09/2026
Status: Aceito

## Contexto

FK simples para o pai nao impede o registro de trocar de loja. Um pedido da
loja A apontando para um contato da loja B passa em qualquer FK de uma coluna
so, e e exatamente o vazamento que o escopo de loja existe para impedir.

## Decisao

1. Onde pai e filho tem `loja_id`, a FK e **composta**: `(contato_id, loja_id)`
   referencia `(contatos.id, contatos.loja_id)`. Isso exige um indice unico
   `(id, loja_id)` no pai, que e barato e nunca e usado para ler.
2. `ON DELETE RESTRICT` e `ON UPDATE RESTRICT` em tudo. `CASCADE` e inaceitavel
   num sistema sem delete fisico: se algum dia alguem apagar, o CASCADE apaga
   junto o que deveria ter recusado.
3. A FK de `modified_by` e declarada **por SQL na migracao**, nao no schema
   Drizzle. Declarar no schema criaria dependencia circular entre `usuarios` e
   as demais tabelas, e o barril nao compilaria.

## Consequencias

- A trava de escopo de loja fica sendo defesa em profundidade: o banco ja
  recusa o cruzamento.
- `scripts/verificar-schema.mjs` confere as FKs depois da migracao 0016.
