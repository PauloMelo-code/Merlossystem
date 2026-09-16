# ADR-0003: Multi-loja implementada em Prisma, nao em Drizzle

- **Status**: Substituído por ADR-0008..0024 (reconstrução na branch `refactor/reconstrucao-estrutura-base`)
- **Data**: 2026-08-17
- **Decisores**: Paulo

## Contexto

O [ADR-0002](0002-orm-transicao-prisma-drizzle.md) determina que **codigo novo
nasce em Drizzle**. A especificacao de multi-loja
([integracoes.md](../integracoes.md)) foi escrita seguindo essa regra: as
tabelas novas (`stores`, `stores_integracoes`) aparecem la em Drizzle.

Ao comecar a etapa 1, tres fatos do repositorio contradizem esse desenho:

1. **Drizzle nao esta instalado** — zero ocorrencias em `package.json`.
2. **O workflow de schema e `prisma db push`** (`npm run db:push`). Esse comando
   sincroniza o banco com o schema Prisma; tabela criada por outro ORM no mesmo
   banco vira divergencia e candidata a ser derrubada no proximo push.
3. **A FK nao atravessa os dois ORMs.** `users.store_id -> stores.id` exige
   `users` (Prisma) e `stores` no mesmo schema declarado. Sem isso sobra coluna
   solta sem constraint — que o `CLAUDE.md` proibe.

Alem disso, a etapa 1 e majoritariamente **alteracao de tabela existente**
(`store_id` em 18 models ja escritos em Prisma), nao dominio novo.

## Decisao

A etapa 1 (multi-loja) e implementada **em Prisma**, no `prisma/schema.prisma`.

O ADR-0002 continua valendo: a direcao e Drizzle. O que muda e o gatilho —
"codigo novo nasce em Drizzle" passa a significar **dominio novo em banco
proprio ou apos a virada do ORM**, nao "qualquer tabela nova enquanto o schema
inteiro ainda e Prisma e o `db push` manda no banco".

## Alternativas Consideradas

- **Criar `stores` em Drizzle e conviver**: FK impossivel de declarar, risco real
  de `db push` derrubar a tabela, e dois sistemas de migracao sobre o mesmo
  banco. Rejeitado — o custo cai no dia do deploy, nao agora.
- **Migrar o projeto inteiro para Drizzle antes da etapa 1**: 24 models e 50
  rotas. Semanas de trabalho antes de entregar a primeira loja. Rejeitado.
- **Coluna `store_id` sem FK, para poder usar Drizzle**: viola regra absoluta do
  `CLAUDE.md` (nunca tabela sem FK configurada). Rejeitado.

## Consequencias

### Positivas
- Etapa 1 sai com FK, constraint e indice de verdade, no mesmo `db push` que a
  equipe ja usa.
- Nenhum risco de tabela sumir em deploy.
- A migracao para Drizzle continua possivel: quando acontecer, `stores` migra
  junto com as outras.

### Negativas / Trade-offs
- A divida com Prisma **cresce**: mais 3 tabelas e 18 colunas para migrar depois.
- A spec `integracoes.md` mostra os schemas em Drizzle; ficam como referencia de
  **forma** (colunas, FK, indices), nao de sintaxe a copiar.

### Neutras
- As flags `MIGRACAO_ORM_EM_ANDAMENTO` seguem `true`; o auditor continua
  tratando Prisma como aviso.

## Quando revisitar

Ao trocar `prisma db push` por migracoes versionadas. Com migracao versionada,
Drizzle e Prisma conseguem conviver no mesmo banco com fronteira clara, e a
regra do ADR-0002 volta a valer sem ressalva.
