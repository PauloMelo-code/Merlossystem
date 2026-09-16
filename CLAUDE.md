# MerlostoreChat — instruções para o Claude Code

Atendimento multicanal (WhatsApp oficial, uazapi, Instagram) + CRM + catálogo + pedidos
da **Merlo Store**, **multi-loja**. Reconstrução completa na branch
`refactor/reconstrucao-estrutura-base`: o sistema antigo (commit `5e902d4`) é referência
de **domínio**, nunca de implementação. Banco novo, sem migração de dados.

> As regras absolutas valem para todo agente e estão escritas uma vez em
> **[AGENTS.md](AGENTS.md)**. Este arquivo é o resumo operacional + o que é específico do
> Claude Code. Se divergirem, vale o `AGENTS.md`.

## Stack (fechada, não reabrir)

| Camada | Versão exata |
|---|---|
| Runtime | Node **24 LTS** (local v24.12; a VPS roda o 24 LTS mais recente) |
| Framework | `next 16.3.5` (App Router, `src/proxy.ts`), `react`/`react-dom 19.3.0` |
| Linguagem | `typescript 6.0.3` strict, `eslint 9.39.5` flat config |
| Banco | PostgreSQL **16** na **5437**, `drizzle-orm 0.45.2`, `drizzle-kit 0.31.10`, driver `pg` |
| Auth | `better-auth 1.7.5` + `@better-auth/passkey 1.7.5`, `@node-rs/argon2` |
| Fila | `bullmq 6.3.6` + Redis na **6382**, worker em processo separado |
| Mídia | MinIO **9002** (console 9003), bucket `merlostore-midia` privado, `sharp` |
| UI | Tailwind **v4** (CSS-first, sem `tailwind.config.ts`) + shadcn/ui sobre Radix |
| Testes | `vitest 5` + `vite 8`, `jsdom 29.1.1` (o 30 exigiria Node ≥ 24.15) |

App na **3005**. Código, banco, docs, UI e commits em **PT-BR**.

## Ordem de leitura antes de mexer

1. `AGENTS.md` — regras absolutas, inteiro
2. `docs/PROJECT_MAP.md` — o que já existe (gerado por `npm run map`)
3. `docs/adr/` — o "porquê" das decisões (0008..0024)
4. `docs/seguranca/caminhos-de-acesso.md` — a árvore canônica de rotas
5. `docs/modulos/<dominio>.md` do domínio que você vai tocar
6. O arquivo real que você vai alterar

## As dez regras que não se negociam

1. **PostgreSQL + Drizzle.** Nunca SQLite, nunca Prisma, nunca `pgEnum`.
2. **Delete é sempre lógico.** `db.delete(`, `tx.delete(`, `.deleteMany(` e `DELETE FROM`
   são bloqueados pelo hook e reprovam no auditor — inclusive em `tests/` e `scripts/`.
3. **Toda tabela de domínio tem as 5 colunas** (`created_at`, `updated_at`, `deleted_at`,
   `is_deleted`, `modified_by`) por `...colunasAuditoria`, e `timestamptz(3)` em todo
   instante. Exceção só pelos marcadores `compliance:append-only` (4 trilhas) e
   `compliance:framework` (4 tabelas do Better Auth).
4. **Escrita só por `src/lib/db/mutacoes.ts`.** `.insert(` / `.update(` em qualquer outro
   arquivo reprova na trava.
5. **Escopo de loja em toda consulta.** Registro de outra loja responde **404**, igual a
   inexistente. Vendedor e viewer usam a loja da sessão; o parâmetro é ignorado.
6. **Toda Server Action é `export async function` e chama `executarAcao` no corpo.**
   Server Action é POST alcançável direto: valide tudo, inclusive ids do corpo.
7. **Trilha de auditoria na mesma transação** — e **antes** do efeito quando o efeito
   destrói o estado anterior (promoção a dono, reset por admin, anonimização).
8. **Segundo fator é obrigatório** e não se flexibiliza. Recusa de login em **uma frase**,
   sem motivo e sem variação de tempo.
9. **Arquivo com no máximo 499 linhas**, exceto `src/components/ui/` (vendorizado).
   O que estoura por construção **nasce dividido**.
10. **Nunca leia, crie ou edite `.env`, `.env.local`, `.env.production`.** O único arquivo
    de ambiente que se escreve é `.env.example`, gerado a partir de `src/lib/env.ts`.
    Para rodar comando que precisa de ambiente, passe a variável **inline**.

## Higiene de shell (Windows)

**Nunca** rode `node -e "..."` ou `psql -c "..."` inline no PowerShell/Git Bash com
parêntese ou aspas: o shell interpreta um pedaço do código como redirecionamento e cria
na raiz um arquivo com o nome daquele fragmento (`y.id)`, `console.log('`, `{`).
Escreva um `.mjs` e rode com `node <arquivo>`. Para limpar o que já acumulou:
`npm run lixo` (dry-run) e `node scripts/limpar-lixo-raiz.mjs --aplicar`.

## Ferramentas deste repositório

| Recurso | Para que | Como |
|---|---|---|
| `scripts/check-compliance.mjs` | Audita as regras absolutas. Fork da base com `compliance:framework`, exceção de caminho em `src/components/ui/`, `tx.delete(`/`DELETE FROM` e regex de segredo ampliada | `npm run compliance` |
| `tests/check-compliance.test.mjs` | Trava do auditor: 10 checagens. **Toda mudança na regra exige caso novo aqui** | `npm run test:compliance` |
| `scripts/project-map.mjs` | Mapa do projeto (tabelas, rotas, actions, componentes) | `npm run map` |
| `scripts/docs-check.mjs` | Drift entre código e documentação | `npm run docs:check` (`--json` / `--strict`) |
| `scripts/remove-ai-marks.mjs` | Marcas invisíveis de texto gerado por IA | `npm run ai-marks` |
| `scripts/limpar-lixo-raiz.mjs` | Quarentena do lixo de shell mal escapado (move, não apaga; nunca toca arquivo versionado) | `npm run lixo` |
| `.claude/hooks/` | **Bloqueiam** a gravação que viola as regras (Pre/PostToolUse) | automático |
| Skills `/criar-tabela`, `/criar-crud`, `/criar-componente`, `/repo-docs-sync`, `/remove-ai-marks` | Workflows guiados já no padrão desta stack | invocar a skill |
| Skill `/audit-auth-security` | Auditoria READ-ONLY de login e conta (`REQ-A1..M6`) | antes de entregar, e a cada minor do Better Auth/Next |
| `templates/` | Arquivos-ouro para copiar (schema, action, componente, teste, webhook, job) | copiar e ajustar |

Fluxo: `npm run map` (orientar) → skill correspondente → `npm run compliance` (validar) →
`docs/definition-of-done.md`.

## Hooks e skills (específico do Claude Code)

- `.claude/settings.json` liga `pre-write-guard.mjs` (PreToolUse) e `post-write-check.mjs`
  (PostToolUse) em `Write|Edit|MultiEdit`. O primeiro **bloqueia** Prisma, SQLite, texto
  com mojibake/escape unicode, delete físico e edição de arquivo `.env`. O segundo roda o
  auditor no arquivo gravado e devolve o erro para você corrigir.
- Os dois pulam `node_modules/`, `templates/`, `docs/` e o conteúdo de `.claude/` —
  **menos** `.claude/worktrees/`, onde as regras continuam valendo.
- Os hooks são fail-open: erro interno passa em silêncio. Por isso as mesmas regras são
  passos do CI (`.github/workflows/deploy.yml`), que é a barreira comum de quem não usa
  Claude Code.
- `.agents/` é o espelho versionado (Codex e Antigravity). Mudou skill ou regra da raiz?
  **Espelhe.**

## Comandos

```bash
npm run db:up            # Postgres 5437, Redis 6382, MinIO 9002/9003
npm run dev              # app na 3005
npm run worker           # worker da fila, processo separado

npm run verificar        # lint + typecheck + compliance + travas + testes + docs
npm run build

npm run db:migrate       # papel merlo_migracao
npm run db:verificar     # confere auditoria, timestamptz(3), FK RESTRICT, únicos parciais
npm run db:seed          # dados de exemplo; NUNCA cria usuário com credencial
npm run primeiro-dono    # emite o convite de semeadura e imprime o link UMA vez
node scripts/db-teste.mjs --sufixo m1   # recria o schema de merlostore_test_m1
```

`npm run build` só na fundação e na integração — o `.next` é único no diretório.

## Git

- Branch: tudo entra por `refactor/reconstrucao-estrutura-base` → `develop` → HML →
  `master` → PRD. **Nunca commitar direto na `master`.**
- Conventional Commits em PT-BR, escopo igual ao nome do módulo, assunto no imperativo,
  minúsculo, sem ponto final, ≤ 72 caracteres. **Sem rodapé de coautoria e sem assinatura
  de IA.**
- Nunca commite arquivo de outro pacote. Se o `git status` mostrar arquivo alheio, **não
  commite** — avise.
- Backup do banco (`npm run db:backup`) é passo obrigatório antes de qualquer deploy em
  PRD; a falha do backup aborta o deploy.

## Antes de dizer que terminou

- [ ] `npm run verificar` verde (a saída literal, não "deve passar")
- [ ] `npm run compliance` exit 0 e `npm run lixo` sem resíduo na raiz
- [ ] Teste do caminho crítico escrito **junto** com o código
- [ ] Regra de negócio nova em `docs/regras-negocio.md`; decisão nova em `docs/adr/`
- [ ] Nada fora do escopo do pacote no diff
