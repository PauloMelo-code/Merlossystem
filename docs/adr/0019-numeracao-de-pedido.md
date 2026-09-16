# ADR 0019 — Numeracao de pedido por contador atomico, sigla cadastrada e PK composta

Data: 16/09/2026
Status: Aceito

## Contexto

A numeracao antiga era o maior numero mais um. Duas vendedoras fechando pedido
no mesmo segundo geravam o mesmo numero, e a sigla da loja era derivada do nome,
entao "Merlo Store Shopping" e "Merlo Store Centro" produziam a mesma sigla.

## Decisao

1. `pedidos_numeracao` com PK COMPOSTA `(loja_id, ano_mes)` e `ultimo_numero`.
   O incremento e `INSERT ... ON CONFLICT DO NOTHING` seguido de
   `UPDATE ... RETURNING`: o proprio `UPDATE` e a trava, e nao existe janela
   entre ler e gravar.
2. A **sigla e CADASTRADA** em `lojas.sigla`, tres letras maiusculas com CHECK
   de formato, e unica entre as lojas vivas. Nunca derivada do nome.
3. Excecao escrita a "uuid em tudo" (ADR 0021): esta tabela nao tem `id`. PK
   composta e a forma correta de um contador e e o que torna o `ON CONFLICT`
   atomico. Um `id uuid` ali seria uma coluna que nada referencia, e ainda
   permitiria duas linhas para o mesmo par.
4. A tabela tem CHECK `pedidos_numeracao_nunca_excluida`: contador nao e
   apagavel, nem logicamente. Um contador "excluido" reinicia a numeracao.

## Consequencias

- `proximoNumeroDePedido()` e o unico caminho, em `src/lib/db/mutacoes.ts`, e
  nao passa por `vivos()`, porque o CHECK garante que nao existe linha morta.
