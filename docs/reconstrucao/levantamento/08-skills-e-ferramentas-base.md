# 08 — Skills e ferramentas da Estrutura Base (levantamento para a reconstrução do MerlostoreChat)

- **Data**: 2026-09-15 · **Modo**: read-only · **Legenda**: **FATO** (li o arquivo ou rodei o comando) · **INFERÊNCIA** (dedução a confirmar) · **RISCO** (efeito provável se ninguém agir).
- **Lido na íntegra**: `estrutura base/` (`.claude/settings.json`, `.claude/hooks/*.mjs`, 6 `SKILL.md`, `templates/*` (4), `scripts/*.mjs` (5), `tests/check-compliance.test.mjs`, `docs/*` (10 + `adr/` 3), `AGENTS.md`, `Agente.md`, `CLAUDE.md`, `.github/*`), a skill global `~/.claude/skills/skill-authoring` (SKILL.md + `references/`), a skill `audit-auth-security` (SKILL.md), as cópias do MerlostoreChat (`.claude`, `.agents`, `scripts`, `templates`, `docs`, `.github`, `config`, `package.json`, ADRs 0002/0005) e, como referência, `HUG/hug-atende` (`_helpers.ts`, `auth.ts`, `check-compliance.mjs`, hooks).
- Caminhos relativos: `base/` = `C:\Users\Paulo\Documents\estrutura base`, `merlo/` = `C:\Users\Paulo\Documents\MerlostoreChat`, `hug/` = `C:\Users\Paulo\Documents\HUG\hug-atende`.

---

## 0. Resumo executivo

1. A base impõe as regras em **3 camadas**: hook que **bloqueia antes** de gravar (`pre-write-guard`), hook que **audita depois** e devolve erro para a IA (`post-write-check` → `check-compliance --file`), e o auditor completo (`npm run compliance`). Os hooks só existem no Claude Code; Codex/Antigravity e humanos dependem do CI, e **o `deploy.yml` da base não roda o auditor** (FATO, `base/.github/workflows/deploy.yml:48-61`).
2. O auditor cobra só **4** colunas de auditoria (`created_at`, `updated_at`, `deleted_at`, `is_deleted`), **não cobra `modified_by`** nem FK/`onDelete`/precisão de timestamp (FATO, `base/scripts/check-compliance.mjs:130`). As skills e o CLAUDE.md dizem "5 colunas". A 5ª é só convenção.
3. Os nomes das 4 colunas de auditoria precisam aparecer **literalmente em inglês** (`"created_at"`...) no corpo do `pgTable` ou num pacote `const X = { ... }` espalhado com `...X`. A regra "nomes em PT-BR" vale para tabela e coluna de domínio, **nunca** para essas 4.
4. O único escape do auditor para tabela sem auditoria é o comentário `compliance:append-only` até 600 caracteres antes do `pgTable` (FATO, `:140` e `:212`). Não existe isenção para tabela de framework (Better Auth). O HUG resolveu com uma lista fixa `EXEMPT_TABLES` que **não está na base** (FATO, `hug/scripts/check-compliance.mjs:~163`). **Decisão obrigatória** para a reconstrução.
5. Os templates são anteriores às armadilhas já conhecidas: `timestamp()` sem `precision: 3` (quebra o optimistic locking), `modified_by` uuid NOT NULL sem estratégia para job/webhook, sem escopo de loja, auditoria fora da transação, `temPermissao` com **3 assinaturas diferentes** entre template, `docs/rbac.md` e `docs/back.md`.
6. `docs/oauth.md` e `docs/front.md` da base estão **obsoletos e contraditórios** para esta stack: `db.delete(sessoes)` (`oauth.md:112`), bcrypt, middleware que só confere a presença do cookie (`oauth.md:171-178`), checagem `startsWith('/(auth)')` que nunca casa (`front.md:99`). `docs/seguranca-login.md` é a régua que vale.
7. **Cópias no Merlo**: iguais à base em settings, post-hook, skills `criar-*`, `remove-ai-marks`, templates, `project-map`, `remove-ai-marks.mjs` e `.github`. **Atrás**: `check-compliance` (sem pacotes nem helpers), `definition-of-done` (sem a seção Login), CLAUDE/AGENTS/Agente (sem as seções de segurança e de lixo na raiz). **Faltam**: `limpar-lixo-raiz.mjs`, `tests/check-compliance.test.mjs`, `docs/seguranca-login.md`. **À frente da base**: `docs-check.mjs` (2 correções) e a regra `texto-cru` do pre-hook.
8. A flag `MIGRACAO_ORM_EM_ANDAMENTO` mora em `merlo/.claude/hooks/pre-write-guard.mjs:34` e `merlo/scripts/check-compliance.mjs:57` e é citada em `CLAUDE.md:27`, ADR 0002 e ADR 0003. Some inteira, com as regras `delete-fisico-legado`, `model-sem-auditoria` e `PRISMA_EXT`.
9. Brechas reais do auditor que o código novo **não pode usar**: `tx.delete(...)` não é pego; `pgTable("x", (t) => ({...}))` (forma callback) não é analisado; `db.query.*.findMany` não entra na heurística de soft delete; chave Anthropic `sk-ant-...` e PEM PKCS#8 `BEGIN PRIVATE KEY` não são detectadas; arquivo com **500 linhas + newline final conta 501** e reprova.

---

## 1. Inventário da base

| Arquivo (base/) | Tipo | Papel | Levar para o repo novo? |
|---|---|---|---|
| `.claude/settings.json` | config | liga os 2 hooks em `Write\|Edit\|MultiEdit` | sim, igual |
| `.claude/hooks/pre-write-guard.mjs` | hook PreToolUse | bloqueia Prisma, SQLite, delete físico e edição de `.env` | sim, somando `texto-cru` (Merlo) e `.env.local` (HUG) |
| `.claude/hooks/post-write-check.mjs` | hook PostToolUse | roda `check-compliance --file <arq> --json`; exit 2 se houver ERRO | sim, igual |
| `.claude/skills/criar-tabela` | skill | fluxo de tabela Drizzle | sim, **reescrever** (ver §6) |
| `.claude/skills/criar-crud` | skill | CRUD em server action | sim, **reescrever** |
| `.claude/skills/criar-componente` | skill | componente no padrão | sim, ajustar |
| `.claude/skills/repo-docs-sync` | skill | auditar e sincronizar docs | sim (fundir as duas versões, §4) |
| `.claude/skills/remove-ai-marks` | skill | limpar marcas invisíveis | sim, igual |
| `.claude/skills/how-to-use-guide` | skill | guia PDF — **esta cópia é do ERP Auto Peças** (FATO, `SKILL.md:13`) | **não**; usar a versão do Merlo readaptada |
| `.claude/settings.local.json`, `scheduled_tasks.lock` | local | permissões pessoais | **não** |
| `templates/schema.ts`, `server-action.ts`, `component.tsx`, `component.test.tsx` | arquivos-ouro | pontos de partida (o auditor ignora `templates/`) | sim, **atualizar** (§6.3) |
| `scripts/check-compliance.mjs` | auditor | §3 | sim, versão da base |
| `scripts/project-map.mjs` | gerador | mapa de tabelas, rotas, actions e páginas | sim |
| `scripts/docs-check.mjs` | detector | drift entre código e docs | sim, **com as 2 correções do Merlo** |
| `scripts/remove-ai-marks.mjs` | limpeza | zero-width, tags, bidi | sim |
| `scripts/limpar-lixo-raiz.mjs` | higiene | move lixo de shell mal escapado para quarentena | sim |
| `scripts/seed.ts` | — | **arquivo de 0 byte** (FATO), lixo | **não** |
| `tests/check-compliance.test.mjs` | trava | prova que o auditor aceita os helpers e ainda pega violação | sim + script npm + CI |
| `docs/seguranca-login.md` | régua | portão de entrega de login | **sim, obrigatório** |
| `docs/definition-of-done.md`, `components.md`, `git-commits.md` | docs | processo | sim (DoD da base; git-commits com ressalva §6.5) |
| `docs/rbac.md`, `oauth.md`, `back.md`, `front.md` | docs | modelos genéricos | **não copiar**: reescrever para Better Auth, multi-loja e Next 16 |
| `docs/regras-negocio.md` | doc | formato RN + RN-001..005 globais | sim, e **preencher** RN-100+ (o Merlo nunca preencheu: arquivo idêntico ao da base) |
| `docs/adr/0000-template.md`, `0001-stack-base.md`, `README.md` | ADR | modelo e stack | sim |
| `AGENTS.md`, `Agente.md`, `CLAUDE.md` | instruções | regras para as IAs | sim, como base para reescrever |
| `.github/pull_request_template.md` | PR | checklist DoD | sim |
| `.github/workflows/deploy.yml` | CI/CD | lint, tsc, test, build, SSH+pm2, backup PRD | **adaptar** (§6.6) |
| raiz da base | — | ~150 arquivos de 0 byte com nomes como `y.id)`, `timestamptz(3)` (FATO) | **nunca** copiar a raiz |

---

## 2. (a) O que cada ferramenta faz e como a reconstrução deve usá-la

### 2.1 Hooks (enforcement a 100% no Claude Code)
- **Ligação**: `settings.json` roda `node "$CLAUDE_PROJECT_DIR/.claude/hooks/<hook>.mjs"` em PreToolUse e PostToolUse, com matcher `Write|Edit|MultiEdit`.
- **pre-write-guard** (`base/.claude/hooks/pre-write-guard.mjs`)
  - Lê o JSON do stdin e só governa arquivos dentro de `CLAUDE_PROJECT_DIR` (`:94-99`).
  - Bloqueia (exit 2) edição de `.env`, `.env.production` e `.env.prod` (`:104-109`). **`.env.local` passa.**
  - Só olha `.ts .tsx .js .jsx .mjs .cjs .sql`, e pula caminhos com `node_modules|templates|docs|.claude` (`:22`, `:111-113`).
  - Analisa **só o texto introduzido** (`content` ou `new_string`) e ignora linhas de comentário (`:121`).
  - Regras: `prisma`, `sqlite` e `delete-fisico` = `\bdb\.delete\s*\(|\.deleteMany\s*\(` (`:37`). Diferente do auditor, **não** tem `drizzle….delete`.
  - É fail-open: qualquer erro interno sai com exit 0.
- **post-write-check** (`base/.claude/hooks/post-write-check.mjs`): depois de gravar, roda o auditor **só naquele arquivo**. ERRO vira exit 2 com a lista para a IA; AVISO não bloqueia. Pula `node_modules|templates|.claude` (`:18`) e **não pula `docs`**.
  - Nuance **FATO**: no modo `--file` o auditor **não aplica `IGNORE_DIRS`**. Um `.sql` gravado à mão via Write em `migrations/` com `DROP TABLE`, ou com mais de 500 linhas, é acusado pelo hook, embora a varredura completa ignore `migrations`.
  - **RISCO**: `SKIP_PATH` casa `.claude` em qualquer ponto do caminho. Se a reconstrução usar worktrees dentro de `.claude/worktrees/`, os dois hooks ficam **desligados em silêncio** (INFERÊNCIA sobre o local padrão dos worktrees; conferir).
- **Uso na reconstrução**: instalar no commit zero, **antes** de gerar qualquer código, para que tudo nasça auditado. Testes e scripts que precisem limpar banco não podem escrever `db.delete(`/`.deleteMany(`: usar transação com rollback ou `TRUNCATE` em banco de teste, registrado em ADR.

### 2.2 `scripts/check-compliance.mjs` — detalhado no §3
Uso: `npm run compliance` local e no CI (passo novo), `--json` para a IA e `--quiet` para ver só erros. Exit 1 se houver ERRO.

### 2.3 `tests/check-compliance.test.mjs`
- Cria um projeto temporário com `src/`, roda o auditor com `--json` e confere 6 casos (FATO, `:39-63`):
  - passam: `...colunasAuditoria`, `vivos(t)` e `eq(t.isDeleted,false)`;
  - são acusados: tabela sem nada, spread de objeto que não é de auditoria e consulta sem filtro.
- Monta as fixtures concatenando `pg`+`Table` para não se autoacusar.
- **Não é Vitest** (usa `node:assert`), e o `include` do Vitest do Merlo (`tests/**/*.test.{ts,tsx}`, `merlo/config/vitest.config.ts:17`) **não o pega**.
- **Uso**: script `"test:compliance": "node tests/check-compliance.test.mjs"` no CI. Qualquer mudança nas regras do auditor (isenção de Better Auth, helper novo) exige caso novo aqui.

### 2.4 `scripts/project-map.mjs`
- Gera markdown com árvore (profundidade 3), tabelas `pgTable` e colunas, actions, rotas, páginas e componentes. Varre `src/` e só lê `.ts`/`.tsx`.
- Heurísticas (FATO):
  - action = arquivo com `^"use server"` e `export async function nome` (`:124-125`); **`export const x = async` não entra**;
  - rota = `route.ts`/`route.tsx` com `export async function GET|POST|PUT|PATCH|DELETE` (`:138-140`); `export const GET =`, HEAD e OPTIONS não entram;
  - route group removido só se o nome for `\w+` (`:143`): `(area-admin)` fica na rota.
- Não conhece `proxy.ts` nem workers (a versão do HUG mapeia `src/server`).
- **Uso**: `npm run map` gera `docs/PROJECT_MAP.md` (sempre regerar, nunca editar à mão). A IA lê o mapa antes de explorar. Convenção decorrente: actions e handlers como `export async function`.

### 2.5 `scripts/docs-check.mjs`
- Importa os extratores do `project-map`.
- Detecta:
  1. **ref quebrada**: caminho `src|scripts|config|tests|app|lib|.claude|.github|docs/...ext` citado em doc que não existe, validado só se a pasta-raiz existe (`:105-121`);
  2. **sem cobertura**: tabela, rota ou nome de action que nenhum doc menciona (`:124-135`).
- `--json` e `--strict` (exit 1).
- **Versão do Merlo é melhor** (FATO, diff):
  - exclui `PROJECT_MAP.md` do corpus (senão tudo parece documentado);
  - remove blocos de código antes de procurar refs (caminho em exemplo não é drift).
- **Uso**: `docs:check` no fim de cada fase e `--strict` no CI a partir do momento em que os docs forem reescritos.

### 2.6 `scripts/remove-ai-marks.mjs` + skill `remove-ai-marks`
- Remove zero-width, BOM, soft hyphen, tag chars `U+E0000–E007F`, variation selectors fora de emoji, bidi e espaços exóticos. Preserva ZWJ entre emoji, VS16 e acentos.
- Modos: `--write`, `--check` (CI), `--dir`, stdin e `--selftest` (FATO: 20/20 passaram).
- Pula o próprio arquivo (`NUNCA_ANALISAR`).
- **Uso**: `ai-marks --check --dir docs` no CI. Vale rodar em `src/` quando houver código colado de fora.

### 2.7 `scripts/limpar-lixo-raiz.mjs`
- Só na raiz e só arquivo regular. **Nunca toca arquivo versionado** (`git ls-files -z`, `:115`). **Move** para `.lixo-quarentena/` com `INVENTARIO.txt`; dry-run por padrão.
- Acompanha a regra 13.1 do `AGENTS.md:37-41`: nunca `node -e "..."`/`psql -c "..."` inline no PowerShell.
- **Uso**: instalar, pôr `.lixo-quarentena/` no `.gitignore` e rodar antes de cada commit de fase.

### 2.8 Templates (arquivos-ouro)
| Template | Ensina | Defasado em (§6.3) |
|---|---|---|
| `schema.ts` | FK `restrict`, 5 colunas, índice em `is_deleted`, tipos `$inferSelect` | precisão 3, timezone, objeto de índices (Drizzle atual usa array), `modified_by` |
| `server-action.ts` | sessão, RBAC, Zod, soft delete, lock por `updated_at`, auditoria | escopo de loja, transação, sessão lida do banco, `revalidatePath`, retorno tipado, lock no excluir |
| `component.tsx` | client pequeno, props tipadas, `ModalConfirmacaoBlock` | `alert()` em vez de toast, modal não entregue como arquivo |
| `component.test.tsx` | vazio, RBAC, block de 3s | fake timers com `waitFor` (RISCO de travar no Vitest), setup inexistente na base |

### 2.9 Skills de fluxo (projeto)
| Skill | Faz | Uso na reconstrução |
|---|---|---|
| `criar-tabela` | nome hierárquico, copia template, 5 colunas, FK restrict, índices, `drizzle-kit generate`, auditor verde (`SKILL.md:10-35`) | para toda tabela, depois de reescrita com as convenções do §3 (pacote, precisão, PT-BR, loja) |
| `criar-crud` | validador Zod + action com `listar/criar/atualizar/excluir` + RBAC + auditoria + teste | para toda entidade editável; reescrever (sessão Better Auth, loja, transação) |
| `criar-componente` | server vs client, colocation, 4 estados, modal 3s, a11y | para todas as telas; ajustar a Tailwind v4, shadcn e toast |
| `repo-docs-sync` | 6 fases: descoberta, arqueologia git, gap, execução, scaffolding, relatório | ao fim de cada fase; usar `docs-check --json` como prova |
| `remove-ai-marks` | §2.6 | antes de publicar docs e PR |
| `how-to-use-guide` (Merlo) | PDF "como usar" com prints reais anonimizados; captura read-only | só depois das telas novas; readaptar seletores (§6.8) |

### 2.10 Skill global `skill-authoring` (`~/.claude/skills/skill-authoring`)
- **Decisão GLOBAL × PROJETO**:
  - skill de projeto mora em `<repo>/.claude/skills/<nome>` e é **copiada** (nunca symlink) para `<repo>/.agents/skills/<nome>`, sempre editando a canônica em `.claude`;
  - frontmatter só com `name` e `description` (até 1024 caracteres);
  - verificação obrigatória: estrutura, refs existentes, gatilho e espelho idêntico.
- Scripts (descritos no `SKILL.md:84-93`; não li o código):
  - `scaffold-skill.sh` cria o how-to-use a partir do modelo;
  - `gen-skill-md.mjs` gera o `SKILL.md` a partir de uma config;
  - `gen-agents.mjs` gera `.agents/rules/<slug>.md` + `workflows/{bugfix,feature}.md` a partir de CLAUDE/AGENTS **sem reescrevê-los**;
  - `espelhar-todas.sh` espelha, pulando origem symlink;
  - `verificar.py` audita repos.
- Armadilhas registradas: espelhamento ingênuo destruiu 13 skills; `cpSync` falha com acento no caminho; caminho do Chrome com barra normal.
- **Uso**: depois de reescrever CLAUDE/AGENTS, rodar `gen-agents.mjs` para regerar `.agents/` (hoje legado e **não versionado** no Merlo), `espelhar-todas.sh` e `verificar.py`.

### 2.11 `audit-auth-security` + `docs/seguranca-login.md`
- **Skill**: READ-ONLY e agnóstica de stack.
  - Fase 1: reconhecimento, com **versão instalada** pelo lockfile e **todos** os caminhos que criam sessão, inclusive endpoints que a lib instala sem chamador.
  - Fase 2: catálogo `REQ-A1..M6`.
  - Fase 3: ameaças simuladas só em local ou HML.
  - Fase 4: armadilhas da lib e advisories.
  - Fase 5: relatório em sinaleira em `~/Downloads/auth-audit-<repo>-<data>.md`.
- **Doc**: 5 princípios, portão de entrega em 9 blocos (guardas, senha Argon2id ≥ 15 caracteres, bloqueio por conta atômico, 2º fator obrigatório com passkey, sessão ≤ 24 h e ≤ 1 h ociosa, tela "Meu perfil › Segurança", OWNER separado, trilha append-only, cabeçalhos e versão), tabela de armadilhas reais e **3 varreduras que ficam no repo** (guarda, soft delete, recusa única).
- **Uso**: o desenho de auth usa o doc como especificação. A skill roda **antes de entregar** e a cada troca de versão do Better Auth. As 3 varreduras precisam ser **criadas** (nenhuma existe como arquivo na base; §6.9).

### 2.12 Docs, AGENTS/Agente/CLAUDE, .github
- `components.md` (válido): colocation, `_components/`, `components/ui` shadcn sem editar primitivo, kebab-case no arquivo, PascalCase e export nomeado, 4 estados, a11y mínima.
- `definition-of-done.md` (válido; a versão da base inclui "Login e Conta").
- `git-commits.md`: Conventional Commits; o rodapé `Co-Authored-By: Claude` (`:47-51`) **colide com a memória do Paulo "commits sem coautoria"**.
- `AGENTS.md`/`Agente.md`: 15 regras NUNCA, snippets de soft delete, lock, Zod, modal e checklist. `CLAUDE.md` da base é o mais novo (seção de segurança, `limpar-lixo-raiz`, helpers do auditor).
- `pull_request_template.md` espelha o DoD. `deploy.yml`: CI (Node 20: lint, `tsc`, test, build), deploy HML por SSH + pm2 e PRD com `pg_dump` + conferência de tamanho + cópia off-server.

### 2.13 Fluxo recomendado na reconstrução
1. Commit zero: hooks, auditor, trava do auditor, `limpar-lixo-raiz`, `docs-check` corrigido, `seguranca-login.md`, DoD, templates **já atualizados**, `package.json` com scripts (§5.6).
2. ADRs das decisões do §7 **antes** do primeiro schema.
3. `_compartilhado.ts` + helpers de consulta (§3.8) com teste; atualizar `HELPERS_SOFT_DELETE` se os nomes mudarem.
4. Para cada entidade: `criar-tabela` → `drizzle-kit generate` → `criar-crud` → `criar-componente`, com `compliance` verde a cada passo.
5. Auth (Better Auth endurecido) com as 3 varreduras; `audit-auth-security` antes de entregar.
6. Fim de fase: `map`, `docs:check --strict`, `repo-docs-sync`, `ai-marks --check`, `limpar-lixo-raiz`, DoD.
7. Regerar `.agents/` (`skill-authoring`) e readaptar `how-to-use-guide`.

---

## 3. (b) Convenções EXATAS que o auditor cobra (para passar limpo de primeira)

### 3.1 O que é varrido
- **Varredura completa**: se `src/` existe, **só `src/`** (`:349-351`). `tests/`, `scripts/`, `config/`, `drizzle.config.ts`, `next.config.ts` e a raiz **não** entram (mas o post-hook audita qualquer arquivo de código gravado pela IA, §2.1).
- **Extensões**: `.ts .tsx .js .jsx .mjs .cjs .sql` (`:42-43`).
- **Pastas ignoradas em qualquer nível**: `node_modules .next .git dist build coverage .turbo out .vercel templates migrations drizzle` (`:36-40`). **Não** chame pasta de domínio de `drizzle`, `build` ou `out`.
- **Arquivos pulados**: `check-compliance.mjs`, `project-map.mjs`, `pre-write-guard.mjs`, `post-write-check.mjs` (`:47-50`).
- **Pré-passada** de pacotes de auditoria sempre sobre o projeto inteiro, mesmo com `--file` (`:365`).
- Linhas que começam com `//`, `*` ou `/*` são ignoradas pelas regras de linha, **exceto `segredo`** (`:310-313`).

### 3.2 Regras
| id | Nível | Alvo | Dispara com | Para passar | Brecha conhecida (não explorar) |
|---|---|---|---|---|---|
| `prisma` | ERRO | linha de código/SQL | `@prisma/client`, `new PrismaClient`, `from "prisma"`, `require("@prisma/client")` (`:61`) | não existe Prisma | — |
| `sqlite` | ERRO | linha | `better-sqlite3`, `drizzle-orm/better-sqlite3`, `from "sqlite"`/`"sqlite3"`, **`:memory:`** (`:67`) | não usar nem a string `:memory:` | — |
| `delete-fisico` | ERRO | linha | `db.delete(`, `.deleteMany(`, `drizzle….delete(` (`:73`) | `update(...).set(marcaDeExclusao(...))` | **`tx.delete(t)` e `sql\`DELETE ...\`` não são pegos** |
| `drop-destrutivo` | ERRO | só `.sql` | `DROP TABLE\|DATABASE\|SCHEMA` (`:80`) | migração aditiva | `migrations/` e `drizzle/` ignoradas na varredura: DROP gerado pelo drizzle-kit passa |
| `segredo` | ERRO | linha, **inclusive comentário** | `sk-`+20 alfanuméricos, `AKIA`+16, `-----BEGIN (RSA\|EC\|OPENSSH\|PRIVATE) PRIVATE KEY-----`, `ghp_`+30 (`:86`) | segredo só em env | **`sk-ant-...` (Anthropic), `sk-proj-...` e `-----BEGIN PRIVATE KEY-----` (PKCS#8) não casam** |
| `cascade` | AVISO | linha | `onDelete: "cascade"` (`:92`) | `onDelete: "restrict"` | FK **sem** `onDelete` (padrão `no action`) e tabela sem FK não são checadas |
| `arquivo-grande` | ERRO | todo arquivo varrido | `content.split("\n").length > 500` (`:296`) | **no máximo 499 linhas com newline final** (FATO: 500×`"x\n"` dá 501) | — |
| `tabela-sem-auditoria` | ERRO | TS/JS | §3.3 | §3.3 | callback `pgTable("x",(t)=>({...}))` e `pgSchema().table()` não são analisados |
| `query-sem-filtro` | AVISO | TS/JS, por **arquivo** | tem `.from(` **e** `.select(` e não tem `is_deleted`/`isDeleted` nem chamada de helper (`:254-271`) | filtrar via helper ou coluna | menção em comentário satisfaz; `db.query.x.findMany` e `.selectDistinct(` não são vistos |

### 3.3 `tabela-sem-auditoria` em detalhe (`:130-238`)
- **Localiza**: `/pgTable\s*\(\s*["'\`]nome["'\`]\s*,\s*\{/`. O **2º argumento precisa ser objeto literal**.
- **Corpo** = o `{...}` balanceado do 2º argumento. O 3º argumento (índices) não conta.
- **Passa** se cada string de `AUDIT_COLS = ["created_at","updated_at","deleted_at","is_deleted"]` aparece no corpo **ou** chega por spread `...NOME` de um pacote que a declara.
- **Pacote** = `(export )?const NOME = {` cujo corpo contém a string (`:186`). Consequências (FATO pelas regex):
  - `export const colunasAuditoria = { ... }` ✅ (inclusive com `satisfies`/`as const` depois);
  - `const colunasAuditoria: Tipo = {` ❌ (anotação de tipo entre o nome e `=`);
  - `export const audit = () => ({...})` ❌ (função; é o padrão do HUG, que **reprova** na base);
  - `import { colunasAuditoria as aud }` + `...aud` ❌ (o mapa é por nome);
  - `...colunas.auditoria` ❌ (captura só `colunas`).
- O mapa de pacotes é global por nome: dois `const colunasAuditoria` diferentes somam colunas. Use **um** pacote só.
- **Isenção**: `compliance:append-only` nos 600 caracteres antes da palavra `pgTable` (`:212`). Serve para a trilha de auditoria; a base exige justificativa escrita ao lado (`:137-138`).
- **Não é checado**: `modified_by`, FK, `onDelete`, `precision`, `withTimezone`, índice, nome hierárquico, idioma.

### 3.4 Helpers de soft delete reconhecidos (`:250-251`)
- `ativo( ativos( ativoPorId( condicaoTrava( contarAtivos( vivos( vivosE( travaDeColisao( marcaDeExclusao(`
- A regex exige **nome exato seguido de `(`**. Helper com outro nome, ou importado com alias, gera AVISO em todo arquivo que o usa.
- Para adotar nome novo, é preciso editar a regex **e** acrescentar caso em `tests/check-compliance.test.mjs`.

### 3.5 Marcadores de comentário
| Marcador | Onde existe | Efeito |
|---|---|---|
| `compliance:append-only` | base e Merlo (`:140`) | isenta um `pgTable`/`model` da checagem de auditoria |
| `compliance:delete-fisico-lgpd` | **só Merlo** (`merlo/scripts/check-compliance.mjs`, `skipIfLine`; ADR 0002 `:58-63`) | isenta uma linha de delete Prisma. **Some com a flag**; ver D5 |

### 3.6 Diferenças hook × auditor (a IA sente as duas)
| Regra | pre-write (bloqueia antes) | auditor/post-write (erro depois) |
|---|---|---|
| Prisma, SQLite | sim | sim |
| `db.delete(`, `.deleteMany(` | sim | sim |
| `drizzle….delete(` | **não** | sim |
| `.env` | `.env`, `.env.production`, `.env.prod` | — |
| DROP, segredo, >500 linhas, tabela sem auditoria | não | sim |
| Pasta `docs/` | pulada | **auditada** |

### 3.7 Nomes: o que o auditor impõe × a regra de PT-BR
- Tabelas e colunas de domínio em PT-BR hierárquico (`lojas`, `lojas_integracoes`, `contatos`, `conversas_mensagens`). O auditor não verifica.
- **As 4 colunas de auditoria ficam com o nome literal em inglês** (`created_at`, `updated_at`, `deleted_at`, `is_deleted`): é o que o auditor procura. `modified_by` também, por consistência com templates, DoD e PR template.
- Se o Drizzle usar `casing: "snake_case"` sem nome explícito na coluna, a string `"created_at"` não aparece e a tabela **reprova**. **Sempre nomear a coluna explicitamente.**

### 3.8 Código que passa de primeira (ilustrativo; nomes de função a confirmar pela arquitetura)

```ts
// src/lib/db/schema/_compartilhado.ts
import { boolean, timestamp, uuid } from "drizzle-orm/pg-core";

// precision 3 = milissegundo, igual ao Date do JS: a trava por updated_at compara exato.
const instante = (nome: string) => timestamp(nome, { precision: 3, withTimezone: true, mode: "date" });

export const colunasAuditoria = {
  created_at: instante("created_at").notNull().defaultNow(),
  updated_at: instante("updated_at").notNull().defaultNow(),
  deleted_at: instante("deleted_at"),
  is_deleted: boolean("is_deleted").notNull().default(false),
  modified_by: uuid("modified_by"), // sem FK aqui: evita ciclo de import com usuarios (ver D3)
};
```

```ts
// src/lib/db/schema/lojas.ts
import { index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { colunasAuditoria } from "./_compartilhado";

export const lojas = pgTable("lojas", {
  id: uuid("id").primaryKey().defaultRandom(),
  nome: text("nome").notNull(),
  ...colunasAuditoria,
}, (t) => [index("lojas_is_deleted_idx").on(t.is_deleted)]);

export const lojasIntegracoes = pgTable("lojas_integracoes", {
  id: uuid("id").primaryKey().defaultRandom(),
  loja_id: uuid("loja_id").notNull().references(() => lojas.id, { onDelete: "restrict" }),
  provedor: text("provedor").notNull(),
  ...colunasAuditoria,
});
```

```ts
// src/lib/db/schema/auditoria.ts
// compliance:append-only — trilha de auditoria: so INSERT. A role da app nao tem
// UPDATE/DELETE nesta tabela (GRANT na migracao). Ver ADR da trilha.
export const auditoriaEventos = pgTable("auditoria_eventos", {
  id: uuid("id").primaryKey().defaultRandom(),
  ator_id: uuid("ator_id"),
  loja_id: uuid("loja_id"),
  acao: text("acao").notNull(),
  tabela: text("tabela").notNull(),
  registro_id: text("registro_id"),
  antes: jsonb("antes"),
  depois: jsonb("depois"),
  created_at: timestamp("created_at", { precision: 3, withTimezone: true }).notNull().defaultNow(),
});
```

```ts
// src/lib/db/consultas.ts — nomes que o auditor ja reconhece
import { and, eq, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
type ComAuditoria = { id: PgColumn; is_deleted: PgColumn; updated_at: PgColumn };

export const vivos = (t: ComAuditoria) => eq(t.is_deleted, false);
export const vivosE = (t: ComAuditoria, ...c: (SQL | undefined)[]) => and(vivos(t), ...c);
export const travaDeColisao = (t: ComAuditoria, id: string, updatedAtOriginal: Date) =>
  and(eq(t.id, id), eq(t.updated_at, updatedAtOriginal), vivos(t));
export const marcaDeExclusao = (usuarioId: string) =>
  ({ is_deleted: true, deleted_at: new Date(), updated_at: new Date(), modified_by: usuarioId });
```

```ts
// src/lib/actions/contatos.ts (esqueleto)
"use server";
export async function excluirContato(entrada: unknown) {
  const sessao = await exigirSessao();                 // Better Auth + papel/is_active lidos do banco
  const { id, loja_id, updated_at } = excluirContatoSchema.parse(entrada); // Zod: uuid + z.coerce.date()
  exigirPermissao(sessao, "contatos:excluir", loja_id); // escopo de loja no servidor
  return db.transaction(async (tx) => {
    const [linha] = await tx.update(contatos)
      .set(marcaDeExclusao(sessao.usuarioId))
      .where(and(travaDeColisao(contatos, id, updated_at), eq(contatos.loja_id, loja_id)))
      .returning();
    if (!linha) throw new ErroDeColisao();             // "Registro alterado por outro usuario..."
    await registrarAuditoria(tx, { acao: "excluir", tabela: "contatos", registro_id: id, antes: null, depois: linha });
    return linha;
  });
}
```

**Reprovam ou escapam (proibido escrever):**
- `pgTable("x", (t) => ({...}))`: escapa da checagem.
- `const cols: X = {...}` ou `...audit()`: ERRO de tabela sem auditoria.
- `tx.delete(t)`: escapa, mas viola a regra absoluta.
- Arquivo de 500 linhas: ERRO.
- `// sk-ant-...` em comentário: não detectado e mesmo assim é vazamento.

### 3.9 Checklist "passa de primeira"
- [ ] `pgTable("nome_pt", { ... })` com objeto literal e `...colunasAuditoria` (import sem alias) ou as 4 colunas escritas.
- [ ] Pacote único `export const colunasAuditoria = {` sem anotação de tipo.
- [ ] Trilha append-only com `compliance:append-only` + justificativa até 600 caracteres acima.
- [ ] Nenhum `db.delete(`, `.deleteMany(`, `drizzle….delete(`, `tx.delete(`, `DELETE` cru, `DROP` em `.sql` à mão, `onDelete: "cascade"`.
- [ ] Arquivo com 499 linhas ou menos (medir com newline final).
- [ ] Todo arquivo com `.select(...).from(...)` usa `vivos`/`vivosE`/`travaDeColisao` ou cita `is_deleted`.
- [ ] Nenhuma string `:memory:`, nenhum segredo (nem em comentário, nem em teste).
- [ ] `node scripts/check-compliance.mjs` exit 0 **e** `node tests/check-compliance.test.mjs` OK.

---

## 4. Cópias do MerlostoreChat × base (o que está desatualizado)

Comparação byte a byte (`cmp`) e `git diff --no-index`. "Atrás" = a base tem algo que o Merlo não tem; "à frente" = o contrário.

| Arquivo | Estado | Detalhe | Ação no repo novo |
|---|---|---|---|
| `.claude/settings.json` | igual | — | manter |
| `.claude/hooks/post-write-check.mjs` | igual | — | manter |
| `.claude/hooks/pre-write-guard.mjs` | **diverge** | Merlo: flag `MIGRACAO_ORM_EM_ANDAMENTO` + `warnOnly` (`:24-41`, `:147-150`) → **remover**. Regra `texto-cru` (escape `\u00XX` e mojibake, `:48-58`) → **manter, à frente da base** | base + `texto-cru` + `.env.local` (HUG) |
| `.claude/skills/criar-*`, `remove-ai-marks` | igual | idênticas à base e defasadas para a stack (§6.4) | reescrever as 3 `criar-*` |
| `.claude/skills/repo-docs-sync` | **diverge** | Merlo (17/08): PT-BR adaptada, usa os geradores, mas diz "esta base NÃO usa `.agents/`" (falso no Merlo). Base (19/08): EN genérica, com nota de espelhos `.maestri` e varredura do working tree | fundir: base + tabela de geradores da versão Merlo; corrigir a nota de `.agents` |
| `.claude/skills/how-to-use-guide` | só Merlo (**não versionado**) | amarrado a NextAuth (`/login`, `#email`, `#password`, `capturar-prints.mjs:210-216`), porta 3005, grep de vazamento com `NextAuth\|prisma` (`SKILL.md:179`) | readaptar depois das telas (§6.8) |
| `.claude/launch.json` | só Merlo | dev na 3005 | manter |
| `.claude/settings.local.json` | só Merlo, **versionado no git** | permissões locais pessoais | tirar do git + `.gitignore` |
| `.agents/rules/merlostore-chat.md`, `workflows/{bugfix,feature}.md`, `skills/*` | só Merlo (**não versionado**) | invariantes do legado (Prisma, `docs/api.md` 50 rotas, `src/lib/loja.ts`, `sessao.ts`, `rbac.ts`, `/api/activity-logs`). Skills = espelho de `.claude` (difere só em CRLF) | apagar e regerar com `gen-agents.mjs` + `espelhar-todas.sh` |
| `scripts/check-compliance.mjs` | **atrás + legado** | falta pré-passada de pacotes, `HELPERS_SOFT_DELETE`, `isDeleted`. Sobra `PRISMA_EXT`, `NIVEL_LEGADO`, `delete-fisico-legado`, `checkPrismaModels`, `skipIfLine`/LGPD. O `.deleteMany` saiu da regra principal | **substituir pela base** (+ decisão D1/D5) |
| `scripts/docs-check.mjs` | **à frente** | exclui `PROJECT_MAP.md` + ignora code fence | manter a versão Merlo (propor à base) |
| `scripts/project-map.mjs`, `remove-ai-marks.mjs` | igual | — | manter |
| `scripts/limpar-lixo-raiz.mjs` | **falta** | — | instalar |
| `scripts/db-backup.mjs` | só Merlo | `pg_dump` no padrão do CLAUDE.md, lê `DATABASE_URL` do env | manter |
| `scripts/db-bootstrap.mjs`, `db-constraints.mjs` | só Merlo | contornos de Prisma 7 (SQL gerado por `prisma migrate diff`; CHECK que o Prisma não declara) | **remover** (Drizzle declara `check()` e aplica com `drizzle-kit migrate`) |
| `tests/check-compliance.test.mjs` | **falta** | — | instalar + script + CI |
| `tests/*.test.ts` (24) + `tests/rotas.ts` | só Merlo | legado; padrões aproveitáveis: `rotas.ts` (inventário lido do disco para teste de guarda/RBAC), `soft-delete.test.ts` (varredura do fonte), `estrutura.test.tsx` (smoke do auditor + jsdom) | apagar e **reescrever** as varreduras sobre Drizzle e Server Actions |
| `config/vitest.config.ts`, `vitest.setup.ts` | só Merlo (base não tem, embora o template cite) | jsdom, alias `@`, include `tests/**` + `src/**` | manter e adaptar |
| `templates/*` | igual | idênticos e defasados (§6.3) | atualizar |
| `docs/definition-of-done.md` | **atrás** | sem a seção "Login e Conta" | base |
| `docs/seguranca-login.md` | **falta** | — | instalar |
| `docs/components.md`, `git-commits.md`, `adr/0000`, `adr/0001` | igual | — | manter (git-commits: ver §6.5) |
| `docs/regras-negocio.md` | igual à base | **nenhuma RN do cliente registrada** | preencher RN-100+ a partir de `integracoes.md` e ADR 0004 |
| `docs/adr/README.md` | diverge | índice só lista 0002 e 0003; **0004–0007 existem e não estão no índice** | refazer o índice |
| `docs/adr/0002`, `0003`, `0005` | só Merlo | decisões de Prisma, multi-loja em Prisma, soft delete via extensão do Prisma | marcar "Substituído por ADR-XXXX" (ADR é imutável) |
| `docs/adr/0004`, `0006`, `0007` | só Merlo | fontes da verdade (vale), mídia no MinIO, fila no Postgres | reavaliar (0007 × Redis na 6382) |
| `docs/back.md`, `front.md`, `oauth.md`, `rbac.md` | Merlo customizado sobre o legado | Prisma/NextAuth | reescrever do zero |
| `docs/api.md` (50 rotas), `deploy-easypanel.md`, `integracoes.md`, `PROJECT_MAP.md` | só Merlo | api = referência do legado; deploy cita Prisma e porta 3000; integracoes = fonte das decisões; PROJECT_MAP gerado | api: arquivar; deploy: reescrever; integracoes: manter; PROJECT_MAP: regerar |
| `.github/*` | igual | `deploy.yml` assume SSH + pm2, mas o Merlo publica no EasyPanel | adaptar (§6.6) |
| `CLAUDE.md` | **atrás + legado** | sem "Segurança de Login e Conta", sem as linhas `tests/check-compliance.test.mjs`, `limpar-lixo-raiz`, `/audit-auth-security` e `seguranca-login.md`. Com a tabela "Estado Atual" do legado e a flag (`:6-32`) | reescrever a partir da base |
| `AGENTS.md` | **atrás + legado** | sem a regra 13.1 (PowerShell inline), sem higiene da raiz, sem checklist de login; "Next.js 14", "Prisma no legado" | reescrever a partir da base |
| `Agente.md` | legado | +14 linhas de "ordem de leitura" do legado | base + ordem de leitura nova |

---

## 5. (c) Instalar, atualizar e remover no repo novo

### 5.1 Copiar da base sem mudança
`.claude/settings.json` · `.claude/hooks/post-write-check.mjs` · `.claude/skills/remove-ai-marks/` · `scripts/project-map.mjs` · `scripts/remove-ai-marks.mjs` · `scripts/limpar-lixo-raiz.mjs` · `tests/check-compliance.test.mjs` · `docs/seguranca-login.md` · `docs/definition-of-done.md` · `docs/components.md` · `docs/adr/0000-template.md` · `.github/pull_request_template.md`

### 5.2 Copiar da base com ajuste
| Arquivo | Ajuste |
|---|---|
| `.claude/hooks/pre-write-guard.mjs` | + `texto-cru` (Merlo) + `.env.local` e `drizzle….delete` (HUG). **Sem** flag |
| `scripts/check-compliance.mjs` | versão base + isenção de Better Auth (D1) + nomes de helper (D6) + casos novos na trava |
| `scripts/docs-check.mjs` | base + as 2 correções do Merlo |
| `.claude/skills/criar-tabela`, `criar-crud`, `criar-componente` | reescrever com §3 e §6.4 |
| `.claude/skills/repo-docs-sync` | fusão (§4) |
| `templates/*` | §6.3 |
| `CLAUDE.md`, `AGENTS.md`, `Agente.md` | base + stack real (Next 16/`proxy.ts`, Better Auth, Tailwind v4, Zod 4, portas 3005/5437/6382/9002-9003) + multi-loja; sem tabela de "Estado atual" do legado |
| `docs/adr/0001-stack-base.md`, `README.md` | índice novo |
| `docs/regras-negocio.md` | RN globais + RN-100+ do cliente |
| `docs/git-commits.md` | decidir o rodapé de coautoria (§6.5) |
| `.github/workflows/deploy.yml` | §6.6 |

### 5.3 Manter do Merlo (com ajuste)
`.claude/launch.json` · `config/vitest.config.ts` + `vitest.setup.ts` · `scripts/db-backup.mjs` · `docs/integracoes.md` · `docs/adr/0004-fontes-da-verdade.md` (e 0006/0007 se reconfirmados) · `docs/deploy-easypanel.md` (reescrito) · `.claude/skills/how-to-use-guide` (readaptado e **versionado**) · padrão de `tests/rotas.ts`.

### 5.4 Remover
- **Flag `MIGRACAO_ORM_EM_ANDAMENTO`** e tudo que depende dela:
  - em `check-compliance`: `NIVEL_LEGADO`, `PRISMA_EXT`, `delete-fisico-legado`, `checkPrismaModels`, `skipIfLine`;
  - em `pre-write-guard`: `warnOnly`;
  - as menções em `CLAUDE.md:26-29`, ADR 0002 e ADR 0003:61.
- Prisma inteiro: `prisma/`, `prisma.config.mjs`, `postinstall: prisma generate`, scripts `db:push/db:generate/db:migrate/db:seed/db:studio` (versões Prisma), dependências `@prisma/*` e `prisma`, linhas de Prisma no `Dockerfile` (`:3-46`, `:79-89`) e no `.gitignore` (`/src/generated/prisma`, `prisma/schema.sql`), `scripts/db-bootstrap.mjs`, `scripts/db-constraints.mjs`.
- NextAuth e `bcryptjs` (a régua pede Argon2id), `next lint`/`.eslintrc.json` (Next 16 → ESLint flat config), `tailwind.config.ts` (Tailwind v4 CSS-first). Estes estão fora do escopo de ferramentas; cito só pelo impacto nos scripts.
- `.agents/` legado; `tests/*` legados; `docs/api.md` (arquivar), `back/front/oauth/rbac.md` do legado; `docs/PROJECT_MAP.md` (regerar); `.claude/settings.local.json` do git; `tsconfig.tsbuildinfo` e `.next/` do disco.

### 5.5 Criar (não existe em lugar nenhum)
- `src/lib/db/schema/_compartilhado.ts` e `src/lib/db/consultas.ts` (§3.8) + teste unitário.
- `src/components/modal-confirmacao-block.tsx` como arquivo de verdade (hoje só existe como snippet em `Agente.md` e `AGENTS.md`), com focus trap, ESC e clique-fora bloqueados, contador, `carregando` e teste.
- As **3 varreduras** do `seguranca-login.md` como testes: (1) toda Server Action e todo route handler de escrita chama o portão de sessão (identidade de função); (2) nenhum `select` sem soft delete e nenhum delete em tabela de auditoria; (3) recusa de login única (resposta byte a byte e tempo).
- Varredura de **escopo de loja** (toda consulta a tabela com `loja_id` passa pelo helper de escopo).
- ADRs do §7. `eslint.config.mjs`. `drizzle.config.ts` com `out` em `src/lib/db/migrations`.

### 5.6 `package.json` sugerido (só a parte de ferramentas)
```json
"lint": "eslint .",
"typecheck": "tsc --noEmit",
"test": "vitest run --config config/vitest.config.ts",
"compliance": "node scripts/check-compliance.mjs",
"test:compliance": "node tests/check-compliance.test.mjs",
"map": "node scripts/project-map.mjs --out docs/PROJECT_MAP.md",
"docs:check": "node scripts/docs-check.mjs",
"ai-marks": "node scripts/remove-ai-marks.mjs --check --dir docs",
"lixo": "node scripts/limpar-lixo-raiz.mjs",
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate",
"db:studio": "drizzle-kit studio",
"db:backup": "node scripts/db-backup.mjs",
"verificar": "npm run lint && npm run typecheck && npm run compliance && npm run test:compliance && npm test && npm run docs:check"
```

---

## 6. (d) Lacunas das skills e ferramentas

### 6.1 Auditor (`check-compliance.mjs`)
| # | Lacuna | Consequência | Tratamento sugerido |
|---|---|---|---|
| A1 | Não cobra `modified_by` (`:130`) | tabela nasce sem autoria e passa | pôr no pacote + varredura/teste; ou acrescentar ao auditor com isenção explícita |
| A2 | Não checa FK/`onDelete` ausente, só `cascade` (aviso) | FK `no action` ou tabela sem FK passam | revisar na skill `criar-tabela` + teste de schema |
| A3 | Não checa `precision`/`withTimezone` | lock por `updated_at` falha em silêncio (armadilha 1) | pacote único + teste que lê o SQL da migração e exige `timestamp(3) with time zone` |
| A4 | `tx.delete(`, `sql\`DELETE\`` escapam | delete físico em transação passa | acrescentar `\btx\.delete\s*\(` e `DELETE\s+FROM` em template SQL (com trava) |
| A5 | `pgTable` com callback, `pgSchema().table()` | tabela fora do radar | proibir por convenção + regra que acusa `pgTable\(\s*["'].+["']\s*,\s*\(` |
| A6 | Sem isenção de tabela de framework | Better Auth reprova ou vira gambiarra de `append-only` | D1 |
| A7 | `migrations/` e `drizzle/` ignoradas | `DROP` gerado por `drizzle-kit` passa na varredura | revisão obrigatória do SQL gerado (já está na `criar-tabela`, passo 7) + grep no CI |
| A8 | Varre só `src/` | `tests/`, `scripts/` e `drizzle.config.ts` fora da varredura completa | varrer também `tests` e `scripts` (o HUG já faz; FATO, header `:10`) |
| A9 | Heurística de soft delete por arquivo e por texto | comentário satisfaz; `db.query` e `selectDistinct` invisíveis | varredura de verdade (§5.5) |
| A10 | Regex de segredo sem Anthropic, `sk-proj` ou PKCS#8 | chave do SDK Anthropic e chaves `.p8` passam | ampliar a regex + caso na trava |
| A11 | `split("\n").length > 500` | 500 linhas reprovam | documentar "≤ 499" ou trocar para contar sem a última vazia |
| A12 | Nomes de helper fixos na regex | helper novo gera aviso falso em massa | D6 |

### 6.2 Hooks
- Só Claude Code: Codex, Antigravity e humanos não passam por eles. **O CI é a única barreira comum** e hoje não roda o auditor.
- São fail-open: hook quebrado = regra desligada sem aviso.
- `pre-write` não bloqueia `.env.local` e não tem `drizzle….delete`. `SKIP_PATH` com `.claude` desliga os hooks em worktree dentro de `.claude/` (RISCO, §2.1).
- Bloqueiam `db.delete(`/`.deleteMany(` também em `tests/` e `scripts/`: falta estratégia escrita de limpeza de banco em teste.

### 6.3 Templates
1. `schema.ts:27-30`: `timestamp()` sem `precision: 3`/`withTimezone`; índices no formato objeto `(t) => ({...})` (`:33-36`), quando o Drizzle recente usa array; `modified_by` uuid NOT NULL sem FK nem estratégia para webhook/job; import de `./contratos` inexistente.
2. `server-action.ts`:
   - `temPermissao(session,"operador")` (`:38`) × `temPermissao(role, recurso, acao)` (`docs/rbac.md:50`) × `session.user.role` (`docs/back.md:129`);
   - sem escopo de loja;
   - auditoria **fora da transação** (`:47`, `:92`);
   - `excluir` sem trava de colisão (`:105-132`);
   - `id: string` sem validação; sem `revalidatePath`; erros como `throw new Error` texto, sem resultado tipado para a UI;
   - sessão genérica, sem a regra "papel e `is_active` lidos do banco".
3. `component.tsx`: `alert()` (`:47`) contra o toast de `front.md`; importa `@/components/modal-confirmacao-block`, que a base não entrega (`components.md:22` põe em `components/`, `front.md:35` põe em `components/ui/`).
4. `component.test.tsx:45-56`: `vi.useFakeTimers()` + `waitFor` (INFERÊNCIA/RISCO: a Testing Library só detecta fake timers do `jest`; com Vitest o `waitFor` pode travar, e o avanço fora de `act()` gera warning). Cita `config/vitest.config.ts`, que a base não tem.
5. Não há template de: route handler de webhook (assinatura HMAC em tempo constante, idempotência), worker/fila, helper de escopo de loja, `proxy.ts`, página server com RBAC, formulário com `updated_at` oculto para o lock, paginação.

### 6.4 Skills `criar-*`
- `criar-tabela` diz "5 colunas" (`SKILL.md:18-25`), mas o auditor cobra 4. Não fala de pacote, precisão, PT-BR, `loja_id`, `check()` constraints, índices únicos parciais `WHERE is_deleted = false` (e-mail/telefone únicos por loja), nem de `generate` × `push` (o `AGENTS.md:247` manda `drizzle-kit push`).
- `criar-crud` não cobre: sessão Better Auth, escopo por loja (vendedor/viewer com loja; admin/gerente sem), transação com auditoria, **Server Action como POST aberto** (armadilha 3: validar tudo dentro), route handlers (webhooks WhatsApp oficial, uazapi, Meta, TikTok), integração **somente leitura** (Bling), ponte manual Masc (pedido "pendente de lançamento"), mídia no MinIO, filas, teste da trilha.
- `criar-componente`: Tailwind v4, tokens e shadcn atuais, toast, formatação PT-BR (moeda e data), telas em tempo real (chat), estado otimista × lock.
- Nenhuma skill cobre: **auth** (Better Auth endurecido, 2FA/passkey, "Meu perfil › Segurança"), **LGPD**, **seed seguro** (sem senha literal, fora do entrypoint), **proxy.ts**, **observabilidade**.

### 6.5 Docs da base obsoletos ou contraditórios para esta stack
| Doc | Problema (FATO) |
|---|---|
| `oauth.md` | `db.delete(sessoes)` (`:112`); bcrypt 12 (`:194`) × Argon2id da régua; tabela `sessoes` sem as colunas de auditoria (`:42-50`); middleware que só vê o cookie (`:171-178`), a armadilha que o `seguranca-login.md` condena |
| `front.md` | `startsWith('/(auth)')` (`:99`): route group não aparece na URL, a guarda nunca dispara; `middleware.ts` (Next 16 usa `proxy.ts`) |
| `back.md` | tabela `auditoria` sem marcador (`:253-263`), reprova no auditor; `atualizarEntidade` sem lock (`:192-198`); `getSession()` sem checar nulo |
| `rbac.md` | papéis `super_admin/admin/operador/visualizador` × Merlo `admin/gerente/vendedor/viewer` com escopo de loja; regra "tenant" genérica |
| `AGENTS.md` | Docker na 5432 (`:234`); `drizzle-kit push` (`:247`); RBAC de 4 papéis |
| `git-commits.md` | rodapé `Co-Authored-By: Claude` (`:47-51`) × memória do Paulo "commits sem coautoria" |
| `CLAUDE.md` (base) | árvore com `middleware`; a regra de colunas de auditoria diz 4 no bloco SQL e cita `modified_by` à parte |

### 6.6 CI/deploy (`deploy.yml`)
- Não roda `compliance`, `test:compliance`, `docs:check` nem `ai-marks --check`.
- `npm run lint` pressupõe `next lint`, **removido no Next 16** (usar `eslint .`; conferir nas notas da versão instalada).
- Node 20 fixo (`:45`); Next 16 exige ≥ 20.9. Avaliar Node 22.
- Deploy por SSH + `git reset --hard` + pm2, enquanto o Merlo roda no **EasyPanel com Dockerfile** (`merlo/docs/deploy-easypanel.md`). Precisa de decisão (D8).
- A regra "backup antes de PRD" está implementada só para o fluxo SSH.

### 6.7 `project-map` / `docs-check`
Não veem `export const GET =`, `export const acao = async`, `proxy.ts`, workers, route groups com hífen. `docs-check` da base conta `PROJECT_MAP.md` como doc e cobra caminho dentro de code fence (corrigido só no Merlo).

### 6.8 `how-to-use-guide` e `skill-authoring`
- A captura faz login só com e-mail e senha. **Com 2º fator obrigatório o roteiro quebra**: precisa de conta de teste com TOTP ou modo dev controlado, sem afrouxar a régua.
- Seletores novos, rotas novas, termos do grep de vazamento (`Better Auth`, `drizzle`, `uazapi`, `Bling`, `Masc`), `anonimizar.js` com nomes da Merlo.
- `.agents/` precisa ser regerado e **versionado** (hoje não está no git).

### 6.9 Segurança (`seguranca-login.md` × o que existe)
As 3 varreduras obrigatórias não existem como código na base. O Merlo tem o padrão de inventário por disco (`tests/rotas.ts`), mas para route handlers e Prisma; é preciso estendê-lo a **Server Actions** (armadilha 3) e ao Drizzle.

### 6.10 Better Auth × regras da base (armadilha 2)
- **FATO**: o HUG isenta `user/session/account/verification/audit_log` por lista fixa e nomes em inglês (`hug/scripts/check-compliance.mjs:~163`; `hug/src/lib/db/schema/auth.ts:1-13`). A base não tem esse mecanismo.
- A lib apaga fisicamente sessões e verificações dentro de `node_modules`: o auditor não vê, **mas a regra é violada**.
- Precisa de ADR + trilha de login append-only própria (o funil de sessão grava login, falha, bloqueio e logout).

---

## 7. Decisões que os arquitetos precisam fechar (derivadas deste levantamento)

| ID | Decisão | Opções | Recomendação (INFERÊNCIA, não decidido) |
|---|---|---|---|
| D1 | Tabelas do Better Auth no auditor | (a) `modelName` PT-BR + `...colunasAuditoria` nelas (a lib ignora colunas extras com default); (b) marcador novo `compliance:framework` na base + trava; (c) lista fixa como no HUG | (a) para usuários e contas; (b) para sessões e verificações, com ADR explicando o delete físico da lib |
| D2 | Tipo dos timestamps | `timestamp(3)` sem tz × `timestamptz(3)`; `mode: "date"` × `"string"` | `timestamptz(3)` + `mode: "date"` em **todas** as colunas via pacote único |
| D3 | `modified_by` | NOT NULL + usuário "sistema" × nullable; FK por tabela × sem FK (ciclo de import `usuarios` ↔ pacote) | nullable no pacote sem FK + teste de autoria; job/webhook grava o ator de sistema |
| D4 | Tipo do `id` | `uuid defaultRandom` × `text` (padrão do Better Auth) | uuid em tudo; configurar a geração de ID do Better Auth para uuid (conferir a opção na 1.7.x) |
| D5 | LGPD (exclusão do titular) | delete físico com marcador × anonimização (sobrescreve PII, mantém a linha) | anonimização: dispensa marcador e preserva a trilha; validar com o jurídico do cliente |
| D6 | Nomes dos helpers | usar `vivos/vivosE/travaDeColisao/marcaDeExclusao` × nomes novos na regex | usar os já reconhecidos |
| D7 | Escopo do auditor | só `src/` × `src/`+`tests/`+`scripts/` | ampliar (A8), com caso na trava |
| D8 | Pipeline | GitHub Actions SSH/pm2 (base) × EasyPanel (Merlo) | CI do Actions para verificação + deploy EasyPanel; backup PRD como passo obrigatório nos dois |
| D9 | `.agents/` | versionar espelho × não usar | versionar (base `skill-authoring`) |
| D10 | Rodapé de coautoria | manter `git-commits.md` × memória do Paulo | seguir a memória do Paulo; ajustar o doc |
| D11 | Devolver melhorias à base | `texto-cru`, correções do `docs-check`, `.env.local`, isenção de framework, regex de segredo | registrar como tarefa separada (fora do escopo do repo) |

---

## Apêndice — citações rápidas (caminho:linha)
- `base/scripts/check-compliance.mjs`
  - escopo: `:36-50`, `:102-124`, `:349-365`
  - regras de linha: `:57-95`
  - auditoria: `:130`, `:140`, `:146-199`, `:205-238`
  - helpers: `:250-251`; filtro: `:254-271`
  - tamanho e comentário: `:296`, `:310-313`
- `base/.claude/hooks/pre-write-guard.mjs:22,24-40,94-99,104-109,121` · `post-write-check.mjs:18,54-56,78-87`
- `base/tests/check-compliance.test.mjs:39-63,86-103`
- `base/scripts/project-map.mjs:124-125,138-143` · `docs-check.mjs:105-121,124-135` · `limpar-lixo-raiz.mjs:115,99`
- `base/templates/schema.ts:27-36` · `server-action.ts:38,47,92,105-132` · `component.tsx:23,47` · `component.test.tsx:45-56`
- `base/docs/oauth.md:42-50,112,171-178,194` · `front.md:35,99` · `back.md:129,192-198,253-263` · `rbac.md:50` · `git-commits.md:47-51`
- `base/.github/workflows/deploy.yml:45,51-61` · `base/AGENTS.md:37-41,234,247` · `base/.claude/skills/criar-tabela/SKILL.md:18-25`
- `merlo/.claude/hooks/pre-write-guard.mjs:34,48-58` · `merlo/scripts/check-compliance.mjs:57-59` · `merlo/CLAUDE.md:6-32` · `merlo/docs/adr/0002-orm-transicao-prisma-drizzle.md:48-63` · `merlo/config/vitest.config.ts:17`
- `hug/src/lib/db/schema/_helpers.ts:35-52` · `hug/src/lib/db/schema/auth.ts:1-13` · `hug/scripts/check-compliance.mjs:~163-181`
