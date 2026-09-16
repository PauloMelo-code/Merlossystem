# ADR-0002: Transicao de Prisma para Drizzle no MerlostoreChat

- **Status**: Substituído por ADR-0008..0024 (reconstrução na branch `refactor/reconstrucao-estrutura-base`)
- **Data**: 2026-08-17
- **Decisores**: Paulo

## Contexto

O MerlostoreChat foi construido antes da adocao da Estrutura Base. O estado
encontrado no dia da instalacao da base (auditado por `npm run compliance`):

| Achado | Qtde |
|--------|------|
| Arquivos usando `@prisma/client` | 14 |
| Delete fisico (`prisma.X.delete` / `deleteMany`) | 25 linhas em 10 rotas |
| Models sem colunas de auditoria completas | 24 de 24 |
| Arquivo acima de 500 linhas | 1 (`prisma/schema.prisma`, 628) |

A base determina Drizzle + soft delete + auditoria em toda tabela. Aplicar o
bloqueio de imediato travaria a manutencao dos 50 route handlers existentes,
que continuam em producao. Ignorar a regra faria a base virar decoracao.

## Decisao

Adotar transicao gradual, com a regra ligada mas graduada:

1. ~~**Codigo novo nasce em Drizzle** (`src/lib/db/schema/`), convivendo com o
   Prisma legado no mesmo banco PostgreSQL.~~

   > [!WARNING]
   > **Isto NAO aconteceu, e o registro estava mentindo ate 17/08/2026.**
   >
   > O Drizzle nunca foi instalado (`package.json` nao tem nenhum pacote
   > `drizzle-*`), e todo o codigo novo das etapas 1 a 8 — multi-loja, cofre de
   > credenciais, roteamento por conta, Bling, TikTok Shop, uazapi, ponte com o
   > Masc, tela de venda, soft delete — foi escrito em **Prisma**.
   >
   > O motivo esta no [ADR 0003](0003-multi-loja-em-prisma.md) e continuou
   > valendo em todas as etapas seguintes: a FK `users.store_id -> stores.id`
   > nao cruza ORM, e `prisma db push` derrubaria tabelas que o Drizzle
   > gerenciasse no mesmo banco. Escrever uma parte em Drizzle criaria um
   > split-brain pior do que a divida atual.
   >
   > **Estado real**: Prisma em 100% do codigo. A troca para Drizzle e um
   > projeto proprio, com o schema inteiro de uma vez, nao uma transicao
   > gradual — a transicao gradual foi tentada no papel e nao sobreviveu ao
   > primeiro conflito tecnico.
2. Prisma e delete fisico via Prisma sao reportados como **AVISO**, controlados
   por uma unica flag (`MIGRACAO_ORM_EM_ANDAMENTO`) presente em dois arquivos:
   - `.claude/hooks/pre-write-guard.mjs`
   - `scripts/check-compliance.mjs`
3. Regras que **nunca** afrouxam: SQLite, `db.delete()` em codigo Drizzle novo,
   `DROP TABLE`, secrets hardcoded, edicao direta de `.env`.
4. Tabela nova em Drizzle sem coluna de auditoria continua sendo **ERRO**.
5. Ao remover a ultima referencia a `@prisma/client`, mudar as duas flags para
   `false` e marcar este ADR como substituido.

### Excecao permanente: exclusao LGPD

O direito ao esquecimento (LGPD art. 18, VI) exige apagamento real — soft delete
nao satisfaz a lei. `src/app/api/lgpd/route.ts` continua fazendo delete fisico.
Marcar essas linhas com o comentario `compliance:delete-fisico-lgpd` para isentar
do auditor. Nenhuma outra rota pode usar esse marcador.

## Alternativas Consideradas

- **Migrar tudo agora**: 24 models + 50 rotas + migracao de dados. Semanas de
  trabalho e risco alto em sistema com atendimento ao vivo. Rejeitado.
- **Manter Prisma e adaptar a base**: quebraria o padrao compartilhado com os
  demais projetos e a promessa de "uma regra, um lugar". Rejeitado.
- **Bloquear Prisma desde ja**: impediria corrigir bug em rota legada sem antes
  reescrever a rota inteira. Rejeitado.

## Consequencias

### Positivas
- Base instalada e util no dia 1, sem travar manutencao.
- O auditor mede a divida: `npm run compliance` mostra quanto falta migrar.
- Codigo novo ja nasce no padrao — a divida para de crescer.

### Negativas / Trade-offs
- Dois ORMs no mesmo projeto durante a transicao (mais dependencias, dois modos
  de escrever query).
- Enquanto a flag estiver `true`, a regra de Prisma nao e enforcement de verdade
  — depende de disciplina no review.

### Neutras
- O banco continua PostgreSQL; a migracao e de camada de acesso, nao de banco.

## Ordem de migracao sugerida

1. Adicionar `deleted_at`, `is_deleted`, `modified_by` aos models (migration
   aditiva, sem perda de dados).
2. Trocar os 25 deletes fisicos por soft delete (exceto LGPD).
3. Migrar dominio a dominio para Drizzle: `products` -> `contacts` ->
   `orders` -> `conversations`/`messages` (o maior volume por ultimo).
4. Quebrar `prisma/schema.prisma` conforme cada dominio sai.
5. Remover `@prisma/client`, virar as flags, fechar este ADR.
