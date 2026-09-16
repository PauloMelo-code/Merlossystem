# Regras do workspace — MerlostoreChat

Regras para o agente do Antigravity / Codex neste repositório. **A fonte completa é o
[AGENTS.md](../../AGENTS.md) na raiz**, com o comportamento em [Agente.md](../../Agente.md)
— este arquivo é o resumo operacional, não um segundo conjunto de regras. Se divergirem,
vale a raiz.

## Contexto

Atendimento multicanal (WhatsApp oficial, uazapi, Instagram) + CRM + catálogo + pedidos
da Merlo Store, **multi-loja** (Centro e Cerro Azul). O escopo de loja entra em toda
consulta — dado de uma loja não aparece na outra.

Next.js 16 App Router (porta **3005**) · TypeScript strict · **Drizzle** sobre PostgreSQL
16 (Docker na **5437**) · **Better Auth 1.7.5** endurecido · BullMQ + Redis (**6382**) ·
MinIO (**9002**) · Tailwind v4 + shadcn/ui · Vitest 5.

O repositório está em **reconstrução**: o commit `5e902d4` é o sistema antigo (Prisma,
NextAuth, ~50 route handlers) e serve só como referência de domínio. Não copie nada dele.

## Ordem de leitura

1. `AGENTS.md` na raiz — regras absolutas, inteiro
2. `docs/PROJECT_MAP.md` — o que já existe (gerado por `npm run map`)
3. `docs/adr/` — as decisões 0008 a 0024 e o porquê de cada uma
4. `docs/seguranca/caminhos-de-acesso.md` — a árvore canônica de rotas
5. `docs/modulos/<dominio>.md` do domínio que você vai tocar
6. O arquivo real que você vai alterar

## Invariantes

1. **Escopo de loja em toda consulta.** Registro de outra loja responde **404**, igual a
   inexistente. Vendedor e viewer usam a loja da sessão; o parâmetro é ignorado.
2. **Toda escrita passa por `src/lib/db/mutacoes.ts`** — `.insert(` / `.update(` em outro
   arquivo reprova na trava.
3. **Delete é lógico**, sempre. O hook de pre-write bloqueia `db.delete(`, `tx.delete(`,
   `.deleteMany(` e `DELETE FROM`, inclusive em `tests/` e `scripts/`.
4. **5 colunas de auditoria** por `...colunasAuditoria` e `timestamptz(3)` em todo
   instante. Exceção só pelos marcadores `compliance:append-only` e `compliance:framework`.
5. **Trava de colisão por `updated_at`** em toda edição; `updated_at` nunca tem
   `$onUpdate`.
6. **Toda Server Action é `export async function`** e chama `executarAcao` no corpo —
   sessão, permissão, Zod, escopo, transação e `revalidatePath` já estão lá.
7. **Trilha na mesma transação**, e **antes** do efeito quando o efeito destrói o estado
   anterior.
8. **Segundo fator obrigatório**; recusa de login em uma frase, sem motivo e sem variação
   de tempo.
9. **Ação crítica na tela** usa o modal de confirmação com block de 3 segundos; o
   reversível e interno usa desfazer por toast.
10. **Arquivo com no máximo 499 linhas**, exceto `src/components/ui/` (vendorizado).

## Proibido

- Prisma, SQLite, `pgEnum`, `middleware.ts`, NextAuth.
- Delete físico, consulta sem escopo de loja, action sem portão.
- Ler, criar ou editar `.env`, `.env.local`, `.env.production` — só `.env.example`.
- Hex, `rgb(`, `oklch(`, classe de paleta crua ou valor arbitrário em `.tsx` fora de
  `src/components/ui/`.
- `node -e "..."` ou `psql -c "..."` inline no PowerShell (cria arquivo-lixo na raiz).
- Tabela ou coluna nova sem ADR: o modelo de dados é fechado em 48 tabelas.
- Commitar arquivo de outro pacote, ou commitar na `master`.

## Comandos

`npm run dev` · `npm run worker` · `npm run build` · `npm run verificar` ·
`npm run lint` · `npm run typecheck` · `npm test` · `npm run compliance` ·
`npm run test:compliance` · `npm run docs:check` · `npm run map` · `npm run lixo` ·
`npm run db:up` · `npm run db:migrate` · `npm run db:verificar` · `npm run db:backup`

## Atenção

As skills em `.agents/skills/` são **cópia** de `.claude/skills/`. Mudou uma das duas?
Espelhe a outra no mesmo commit — espelho que sai de sincronia é pior que espelho nenhum.
