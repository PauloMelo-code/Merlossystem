# Regras do workspace — MerlostoreChat

Regras para o agente do Antigravity / Codex neste repositório. **A fonte completa é o
[AGENTS.md](../../AGENTS.md) e o [CLAUDE.md](../../CLAUDE.md) na raiz** — este arquivo é o resumo
operacional, não um segundo conjunto de regras. Se divergirem, vale a raiz.

## Contexto

Atendimento multicanal + CRM da Merlo Store, **multi-loja** (Centro e Cerro Azul). O escopo de loja entra em toda consulta — dado de uma loja não pode aparecer na outra.

Next.js App Router (porta **3005**) · TypeScript · **Prisma legado + Drizzle para código novo** sobre PostgreSQL (Docker na porta 5437) · NextAuth · Anthropic SDK · S3/MinIO · Tailwind + shadcn · Vitest.

## Ordem de leitura

1. `CLAUDE.md` na raiz — **seção "Estado Atual do Projeto"**, que lista honestamente o que ainda diverge do padrão da base
2. `docs/api.md` — as 50 rotas, com validação, efeitos colaterais e desvios conhecidos. **Obrigatório antes de mexer em qualquer rota**
3. `docs/adr/` — 0002 transição Prisma→Drizzle, 0003 multi-loja, 0005 soft delete, 0007 fila no Postgres
4. `docs/regras-negocio.md` e `docs/rbac.md`
5. O arquivo real que você vai alterar

## Invariantes

1. **Escopo de loja em toda consulta** (`src/lib/loja.ts`) — Centro e Cerro Azul não se misturam
2. **Código novo que toca banco nasce em Drizzle** (`src/lib/db/schema/`). O Prisma é legado e convive até a virada — **não introduza Prisma em código novo**
3. **Autoria vem da sessão** (`usuarioDaSessao()` em `src/lib/sessao.ts`), nunca de um usuário default
4. **Middleware exige sessão em `/api/**`**; as 9 exceções têm gate próprio — não crie a décima sem gate
5. **RBAC por caminho + método** (`src/lib/rbac.ts`)
6. **Delete é lógico**; delete físico é bloqueado pelo hook de pre-write
7. **Optimistic locking** por `updated_at` em edição concorrente
8. **Ação crítica na tela usa o modal de confirmação com block de 3 segundos**

## Proibido

- Prisma em código novo (o hook avisa, mas a regra é essa)
- SQLite, delete físico ou comitar `.env` — o hook **bloqueia** de verdade
- Consulta sem escopo de loja
- Rota em `/api/**` sem sessão e sem gate
- Autoria por usuário default
- Tabela nova sem as colunas de auditoria e sem FK com `ON DELETE RESTRICT`

## Comandos

`npm run dev` · `npm run build` · `npm run lint` · `npm run typecheck` · `npm test` · `npm run compliance` · `npm run docs:check` · `npm run map` · `npm run db:up` · `npm run db:push` · `npm run db:studio` · `npm run db:backup`

## Atenção

A seção **"Estado Atual do Projeto"** do `CLAUDE.md` diz, sem enfeite, o que ainda está fora do padrão da base (Prisma, soft delete faltando em vários models, auditoria incompleta, RBAC ausente nas páginas). Leia antes de "consertar" alguma coisa: o que está lá é dívida **conhecida e priorizada**, não descuido — e há ADR explicando cada uma.
