# ADR 0024 — Excecao de caminho no auditor: src/components/ui/ fica fora da regra de 499 linhas

Data: 16/09/2026
Status: Aceito

## Contexto

`src/components/ui/` e codigo de terceiro, vendorizado pelo CLI do shadcn. A
regra da casa proibe editar primitivo vendorizado: atualizar o componente
sobrescreveria a edicao, e a diferenca so apareceria num comportamento sutil de
teclado meses depois. Ao mesmo tempo, a regra `arquivo-grande` do auditor
reprova alguns desses primitivos.

Exigir que o arquivo caiba em 499 linhas e, na pratica, exigir que ele seja
editado.

## Decisao

No mesmo fork do auditor que introduziu o marcador `compliance:framework`, a
regra `arquivo-grande`, e SO ela, passa a ignorar caminhos iniciados por
`src/components/ui/`. Prisma, SQLite, delete fisico e segredo continuam valendo
ali integralmente.

`tests/check-compliance.test.mjs` ganhou dois casos que provam os dois lados:

- primitivo de 600 linhas em `src/components/ui/` passa;
- arquivo de 600 linhas em `src/components/comum/` continua reprovando.

## Consequencias

- O segundo caso e o que impede a excecao de virar carimbo. Sem ele, um
  descuido no caminho liberaria o repositorio inteiro.
- O PR que leva a excecao para a estrutura base e assincrono e nao bloqueia
  este repositorio.
