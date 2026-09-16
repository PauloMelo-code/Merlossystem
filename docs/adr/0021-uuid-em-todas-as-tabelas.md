# ADR 0021 — uuid como id em todas as tabelas, inclusive as do Better Auth

Data: 16/09/2026
Status: Aceito

## Contexto

A biblioteca de autenticacao gera id como string aleatoria, e o modelo antigo
misturava `cuid`, `serial` e `uuid`. Id sequencial em rota (`/pedidos/128`)
entrega o volume do negocio para quem olha a barra de endereco, e id de tipo
diferente por tabela impede uma FK generica de `modified_by`.

## Decisao

`uuid` como chave primaria de toda tabela, incluindo as do Better Auth: a
biblioteca e configurada para gerar `uuid`, e ha teste de EFEITO que confere o
formato do id gravado, nao a presenca da opcao.

Uma excecao, escrita no ADR 0019: `pedidos_numeracao`, cuja chave e a composta
`(loja_id, ano_mes)`.

## Consequencias

- `modified_by uuid` aponta para `usuarios.id` nas tabelas de dominio, com FK
  declarada por SQL na migracao.
- O numero que a cliente ve no pedido nao e o id: e o contador por loja e mes.
