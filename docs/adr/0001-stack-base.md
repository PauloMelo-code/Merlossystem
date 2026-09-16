# ADR-0001: Stack base — Next.js + Drizzle + PostgreSQL

- **Status**: Substituído por ADR-0008..0024 (reconstrução na branch `refactor/reconstrucao-estrutura-base`)
- **Data**: 2026-05-30
- **Decisores**: Lucas (lead tecnico), equipe Bah! Tech

## Contexto

Precisamos de uma base unica e reutilizavel para novos projetos, com forte
exigencia de auditoria, compliance e seguranca de dados (soft delete,
rastreabilidade). Multiplos desenvolvedores e agentes de IA atuam no mesmo
codigo, entao as regras precisam ser consistentes e, idealmente, automaticas.

## Decisao

A stack padrao e:

- **TypeScript** (strict) + **Next.js** (App Router, server-side nativo).
- **Drizzle ORM** para schema e queries.
- **PostgreSQL 16** em todos os ambientes (dev = prod via Docker).
- **SOLID**, regra de negocio centralizada em server actions.
- Soft delete + colunas de auditoria obrigatorias em toda tabela.

## Alternativas Consideradas

- **Prisma**: DX boa, mas abstrai demais, gera client pesado e da menos controle
  sobre o SQL. Rejeitado — padronizamos Drizzle.
- **SQLite em dev**: simples, mas diverge de producao (tipos, concorrencia,
  funcoes). Rejeitado — dev deve ser identico a prod.
- **API separada (NestJS/Express)**: mais camadas para manter. Rejeitado —
  Next.js server actions cobrem o caso sem servidor separado.

## Consequencias

### Positivas
- Dev identico a prod elimina bugs "so acontece em producao".
- Drizzle da SQL previsivel e tipagem ponta a ponta.
- Regras de auditoria/soft delete aplicaveis por hooks + checker automatico.

### Negativas / Trade-offs
- Projetos legados que usam Prisma/SQLite precisam de plano de migracao
  (documentar como divergencia ate migrar).
- Drizzle tem ecossistema menor que Prisma; algumas coisas sao mais manuais.

### Neutras
- Exige Docker no ambiente de todo dev.
