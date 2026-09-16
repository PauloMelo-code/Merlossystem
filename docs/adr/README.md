# Architecture Decision Records (ADR)

Registro das decisoes de arquitetura do projeto. Cada decisao significativa
(escolha de tecnologia, padrao estrutural, trade-off relevante) vira um ADR
numerado e imutavel — se a decisao muda, cria-se um novo ADR que supersede o anterior.

## Por que

- Novos devs (e a IA) entendem **por que** o codigo e do jeito que e.
- Evita rediscutir decisoes ja fechadas.
- Da contexto historico para mudancas futuras.

## Como criar

1. Copie `0000-template.md` para `NNNN-titulo-curto.md` (proximo numero).
2. Preencha contexto, decisao, consequencias.
3. Status inicial: `Proposto`. Apos aprovado: `Aceito`.
4. Se uma decisao nova substitui esta, marque como `Substituido por ADR-XXXX`.

## Indice

| ADR | Titulo | Status |
|-----|--------|--------|
| [0001](0001-stack-base.md) | Stack base: Next.js + Drizzle + PostgreSQL | Substituído por |
| [0002](0002-orm-transicao-prisma-drizzle.md) | Transicao de Prisma para Drizzle | Substituído por |
| [0003](0003-multi-loja-em-prisma.md) | Multi-loja implementada em Prisma | Substituído por |
