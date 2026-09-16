# MerlostoreChat — instruções para agentes IA (Codex, Cursor, Copilot, Gemini, Antigravity)

> Leia este arquivo INTEGRALMENTE antes de qualquer tarefa. Ele é a fonte das regras
> absolutas; `CLAUDE.md` e `.agents/rules/merlostore-chat.md` são resumos que apontam
> para cá.

## Estado do projeto

Atendimento multicanal (WhatsApp oficial, uazapi, Instagram) + CRM + catálogo + pedidos
da **Merlo Store**, **multi-loja** (Centro e Cerro Azul). Em **reconstrução completa** na
branch `refactor/reconstrucao-estrutura-base`.

O sistema antigo vive no commit `5e902d4` e é referência de **domínio** — nunca de
implementação. Não replique nada dele: Prisma, NextAuth, as ~69 rotas de API, delete
físico e ausência de escopo de loja foram exatamente o que se veio reconstruir. Banco
novo, sem migração de dados.

## Stack (fechada, não reabrir)

- **Linguagem**: TypeScript 6 strict (`exactOptionalPropertyTypes`)
- **Framework**: Next.js 16.3.5, App Router, Server Actions; `src/proxy.ts` (não
  `middleware.ts`) e ele **não é fronteira de segurança**
- **ORM**: Drizzle ORM 0.45 — NUNCA Prisma
- **Banco**: PostgreSQL 16 na porta 5437 — NUNCA SQLite, nem em teste
- **Auth**: Better Auth 1.7.5 + passkey, Argon2id — NUNCA NextAuth
- **Fila**: BullMQ 6 + Redis na 6382, worker em processo separado
- **Mídia**: MinIO na 9002, bucket privado, leitura só pela rota interna
- **UI**: Tailwind v4 (CSS-first, sem `tailwind.config.ts`) + shadcn/ui
- **Testes**: Vitest 5 com 4 projetos (unidade, travas, componentes, integração)
- **Princípios**: SOLID — alta coesão, baixo acoplamento

App na 3005. Código, comentário, documentação, UI, mensagem de erro e commit em **PT-BR**.

## Regras Absolutas

### Banco de dados
1. NUNCA usar SQLite em nenhum ambiente (nem dev, nem teste).
2. NUNCA usar Prisma. Drizzle em tudo.
3. NUNCA fazer DELETE físico. `db.delete(`, `tx.delete(`, `.deleteMany(` e `DELETE FROM`
   são bloqueados pelo hook e reprovam no auditor — inclusive em `tests/` e `scripts/`.
   Limpeza de banco de teste é por transação com rollback (e `TRUNCATE` no `globalSetup`).
4. NUNCA criar tabela sem as 5 colunas de auditoria, por `...colunasAuditoria`:
   `created_at`, `updated_at`, `deleted_at`, `is_deleted`, `modified_by`.
5. NUNCA usar `timestamp()` cru: todo instante é `timestamptz(3)` pelo helper
   `instante()`. O microssegundo do Postgres nunca bate com o milissegundo do `Date` e a
   trava de colisão falharia em silêncio.
6. NUNCA pôr `$onUpdate` em `updated_at` — o contador o envelheceria e toda edição
   legítima passaria a ser recusada.
7. NUNCA criar FK sem `{ onDelete: "restrict", onUpdate: "restrict" }` explícitos.
8. NUNCA usar `pgEnum`: enum é `text` + `CHECK`, com a constante em `schema/_enums/`.
9. NUNCA escrever `.insert(` ou `.update(` fora de `src/lib/db/mutacoes.ts`.
10. NUNCA construir predicado de índice único parcial com `eq()`/`inArray()` — só
    template `sql` cru com literais.

### Código
11. NUNCA duplicar regra de negócio: ela mora no módulo de domínio `src/lib/<dominio>/`,
    uma vez. A action orquestra; a tela chama a action.
12. NUNCA criar action ou handler sem validação de entrada (Zod `strictObject`) e sem
    portão de sessão e permissão. Server Action é POST alcançável direto.
13. NUNCA espalhar o corpo sobre a linha (`{ ...input }`): `papel`, `loja_id`, `ativo` e
    preço entram por campo explícito, vindos do servidor.
14. NUNCA consultar sem escopo de loja e sem filtro de `is_deleted`.
15. NUNCA expor erro cru do banco, token de sessão, e-mail em claro na trilha de
    segurança ou `url_externa` de mídia em DTO.
16. NUNCA comitar segredo, `.env` ou senha literal — nem em seed, README ou doc.

### Estrutura
17. NUNCA criar arquivo na raiz: use `src/`, `tests/`, `docs/`, `config/`, `scripts/`,
    `templates/`.
17.1. NUNCA rodar `node -e "..."` ou `psql -c "..."` inline no PowerShell/Git Bash com
    parêntese ou aspas. O shell interpreta um pedaço do código como **redirecionamento**
    e cria na raiz um arquivo com o nome daquele fragmento (`y.id)`, `console.log('`,
    `{`). Escreva um `.mjs` e rode com `node <arquivo>`. Para limpar o que já acumulou:
    `npm run lixo` (dry-run) e `node scripts/limpar-lixo-raiz.mjs --aplicar`.
18. NUNCA criar arquivo com mais de 499 linhas — exceto `src/components/ui/`, que é
    código vendorizado do shadcn e não se edita. O que estoura por construção **nasce
    dividido em pasta**.
19. NUNCA criar documentação sem pedido, e NUNCA pular a regra de negócio nova em
    `docs/regras-negocio.md` nem a decisão nova em `docs/adr/`.
20. NUNCA editar `docs/PROJECT_MAP.md` à mão (é gerado) nem o bloco
    `<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
