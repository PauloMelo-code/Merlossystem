---
name: repo-docs-sync
description: >-
  Audita e sincroniza a documentacao tecnica da base com o estado real do
  codigo. Use quando o usuario pedir para atualizar/sincronizar docs, revisar
  se a documentacao esta desatualizada, ou garantir que as regras dos agentes
  IA batem com o projeto. Gatilhos: "atualize a documentacao", "sincronize os
  docs", "revise o README", "atualize o CLAUDE.md", "atualize o AGENTS.md",
  "os docs estao desatualizados", "atualizar documentacao do repositorio",
  "update docs", "sync documentation".
  NAO usar para: escrever feature nova, debugar, ou rodar testes.
---

# Repo Docs Sync

Audita e sincroniza a documentacao da base para que as instrucoes dos agentes
IA (`CLAUDE.md`, `AGENTS.md`, `Agente.md`), os docs de dominio (`docs/**`) e o
README reflitam o estado REAL do codigo. Evita alucinacao da IA, regras stale e
confusao do dev detectando drift entre codigo e documentacao.

> [!CAUTION]
> **READ-FIRST, WRITE-SECOND.** Nunca atualize um doc sem antes ler o codigo
> fonte que ele referencia. Nunca assuma que um padrao existe — abra o arquivo
> real e confirme. O determinismo (provar o drift) e dos scripts; o julgamento
> e a escrita sao seus.

---

## Ferramentas desta base (use SEMPRE, nao reinvente)

Esta base ja tem geradores determinísticos. Use-os em vez de `grep`/`find`
(que nem sao cross-platform no Windows da equipe):

| Comando | Para que |
|---------|----------|
| `node scripts/project-map.mjs` | Inventario do codigo: tabelas Drizzle, rotas, server actions, componentes, paginas |
| `node scripts/docs-check.mjs` | Relatorio de drift (refs quebradas + codigo sem cobertura nos docs) |
| `node scripts/docs-check.mjs --json` | Mesmo relatorio, machine-readable (para voce parsear) |
| `node scripts/docs-check.mjs --strict` | Exit 1 se houver qualquer gap (verificacao final) |
| `node scripts/check-compliance.mjs` | Auditoria de conformidade (Prisma/SQLite/delete fisico/auditoria/>500 linhas/secrets) |

---

## Fase 1: Descoberta — mapear o terreno

### 1.1 Rode os geradores (nao grepe na mao)

```bash
node scripts/project-map.mjs        # o que o codigo TEM
node scripts/docs-check.mjs --json  # o que os docs ERRAM/FALTAM
```

### 1.2 Conheca o conjunto REAL de docs desta base

Leia (somente os que existirem):

```
RAIZ
├── CLAUDE.md                 # Regras p/ Claude Code (Anthropic)
├── AGENTS.md                 # Regras universais (Codex, Cursor, Copilot, Gemini)
├── Agente.md                 # Regras de comportamento dos agentes
├── README.md                 # Overview p/ devs (pode nao existir ainda)
docs/
├── rbac.md                   # Controle de acesso e permissoes
├── oauth.md                  # Autenticacao e autorizacao
├── front.md                  # Documentacao do frontend
├── back.md                   # Documentacao do backend
├── regras-negocio.md         # Regras de negocio do cliente
├── components.md             # Padrao de componentes
├── definition-of-done.md     # Checklist de conclusao
├── git-commits.md            # Conventional Commits
└── adr/                      # Architecture Decision Records (o "porque")
.github/
└── pull_request_template.md
```

> [!NOTE]
> Esta base NAO usa `.agents/` (Antigravity), `COPILOT.md` nem `.cursorrules`.
> Nao invente esses arquivos. O `docs-check.mjs` ja descobre os docs sozinho.

### 1.3 Monte o registro

Para cada doc encontrado, anote: caminho, proposito, ultimo dominio coberto e
termos-chave (paths, nomes de tabela, funcoes) citados.

---

## Fase 2: Arqueologia — o que mudou no codigo

> [!IMPORTANT]
> Esta base pode NAO ser um repositorio git. Verifique antes:
> `git rev-parse --is-inside-work-tree`

### 2.1 Se FOR repo git

```bash
git log --oneline --name-only -n 50            # arquivos alterados
git log --diff-filter=A --name-only --pretty=format: -n 50 | sort -u  # novos
git log --diff-filter=D --name-only --pretty=format: -n 50 | sort -u  # deletados
```

### 2.2 Se NAO for repo git (fallback)

Use o `docs-check.mjs --json` como verdade absoluta do drift, e ordene por
data de modificacao para achar o que mudou recentemente:

```bash
node scripts/docs-check.mjs --json
# PowerShell: Get-ChildItem -Recurse src -Include *.ts,*.tsx | Sort-Object LastWriteTime -Descending | Select-Object -First 20
```

### 2.3 Classifique cada mudanca

| Categoria | Impacto | Acao |
|-----------|---------|------|
| Novo dominio/modulo | ALTO | Criar secao no doc de dominio |
| Nova tabela/schema | ALTO | Atualizar docs de schema + `back.md` |
| Nova rota de API | ALTO | Atualizar `back.md` |
| Nova permissao/RBAC | ALTO | Atualizar `rbac.md` |
| Nova regra de negocio | ALTO | Atualizar `regras-negocio.md` + invariante em AGENTS/CLAUDE |
| Refactor de modulo | MEDIO | Verificar precisao dos docs existentes |
| Bug fix / dep bump / estilo | BAIXO/NENHUM | Pular salvo se mudou um padrao |

### 2.4 Deep-dive nos ALTO impacto — LEIA O CODIGO REAL

Para cada mudanca de alto impacto, abra o arquivo fonte e extraia: o que faz,
funcoes/classes-chave, invariantes/constraints, dependencias, config (env vars).
**Nunca documente com base em mensagem de commit.**

---

## Fase 3: Gap analysis — o que falta ou esta errado

### 3.1 Consuma o relatorio do docs-check

```bash
node scripts/docs-check.mjs --json
```

O JSON traz:
- `staleRefs[]` — caminho citado nos docs que nao existe no disco
- `missingCoverage[]` — tabela/rota/action no codigo sem mencao em nenhum doc
- `summary` — contagens

### 3.2 Cruze codigo vs docs (julgamento humano sobre o que o script aponta)

- **Completude**: todo dominio/modulo tem secao em ao menos um doc?
- **Precisao**: paths, nomes de funcao e detalhes batem com o codigo?
- **Atualidade**: nenhuma ref a arquivo deletado / funcao renomeada?
- **Consistencia**: a mesma info nao se contradiz entre dois docs?

### 3.3 Produza o gap report (use as categorias do docs-check + seu julgamento)

```markdown
## Gap Report
### Falta documentar (codigo existe, doc nao)
- [ ] <item de missingCoverage>
### Stale (doc cita codigo que mudou/sumiu)
- [ ] <item de staleRefs>
### Inconsistencia (docs se contradizem)
- [ ] <ex: CLAUDE.md diz X, AGENTS.md diz Y>
```

---

## Fase 4: Execucao — atualizar os docs

### 4.1 Ordem OBRIGATORIA

1. **Docs de dominio** (`docs/**`) — mais profundo e detalhado
2. **Regras de agente** (`AGENTS.md`, `CLAUDE.md`, `Agente.md`) — invariantes
3. **README.md** — overview (por ultimo; ele resume tudo)

> [!WARNING]
> Nunca atualize o README primeiro. Ele resume os docs profundos.

### 4.2 Regras por camada

- **Docs de dominio (`docs/**`)**: referencia tecnica profunda. Tom preciso,
  sem marketing. Estrutura sugerida: Objetivo → Visao geral → Arquivos fonte de
  verdade → Modelo de dados/fluxo → Invariantes criticos → O que revisar antes
  de alterar → Anti-padroes → Checklist final.
- **Regras de agente (`AGENTS.md`/`CLAUDE.md`/`Agente.md`)**: imperativo,
  direto. Ordem de leitura, invariantes ("nunca faca X"), regras por dominio,
  checklist de saida. Lembre das regras absolutas da base: PostgreSQL+Drizzle,
  soft delete, colunas de auditoria, optimistic locking, modal block 3s.
- **README.md**: visao do produto, stack, setup, mapa de pastas (real), padroes,
  links para os docs de dominio.

### 4.3 Regras de consistencia

1. **Mesmos termos** em todos os docs (se a funcao e `criarContrato`, use exato).
2. **Mesmos paths** — se um arquivo moveu, atualize em TODOS os docs.
3. **Mesmas contagens** — se ha 30 tabelas, todo doc que citar deve dizer 30.
4. **Cross-reference** — ao criar `docs/<dominio>.md`, linke nele a partir de
   `AGENTS.md`, `CLAUDE.md` e README.
5. **PT-BR sempre** — esta base e PT-BR. Nunca misture idiomas nos docs.

### 4.4 Verificacao (rode SEMPRE no fim)

```bash
node scripts/docs-check.mjs --strict   # deve sair 0; se sair 1, ainda ha gap
node scripts/check-compliance.mjs      # garante que nada violou as regras da base
```

---

## Fase 5: Scaffolding — quando falta arquivo

Crie um doc faltante quando: nao ha `README.md`; um dominio existe no codigo mas
nao tem doc dedicado em `docs/`; ou falta um ADR para uma decisao tomada.

Ordem: docs de dominio → `AGENTS.md`/`CLAUDE.md`/`Agente.md` → `README.md`.
Minimo viavel para uma base nova: `README.md` + `AGENTS.md` + `docs/` com os
dominios principais. Sempre seguir a estrutura de pastas definida no `CLAUDE.md`.

---

## Fase 6: Saida — reportar o que foi feito

Produza um relatorio com:

1. **Arquivos alterados** — caminho, linhas antes/depois, resumo
2. **Arquivos criados** — caminho, proposito
3. **Gaps resolvidos** — itens do gap report da Fase 3 que foram corrigidos
4. **Gaps remanescentes** — o que precisa de input do usuario
5. **Refs corrigidas** — paths/funcoes stale arrumados
6. **Verificacao** — saida de `docs-check.mjs --strict` e `check-compliance.mjs`
7. **Riscos** — o que pode estar errado e precisa revisao manual

---

## Erros comuns a evitar

1. **Documentar de memoria** — sempre leia o arquivo fonte real antes.
2. **Atualizar so um arquivo** — se mudou `AGENTS.md`, provavelmente muda
   `CLAUDE.md` e talvez o README. Atualize TODOS os afetados.
3. **Inventar padrao** — nao documente convencao que nao existe no codigo.
   Se ver inconsistencia, sinalize; nao normalize.
4. **Referenciar arquivo deletado** — `docs-check.mjs` pega isso; rode antes.
5. **Pular a verificacao** — sempre rode `docs-check.mjs --strict` no fim.
6. **README primeiro** — README resume; atualize por ultimo.
7. **Doc para mudanca trivial** — bug fix / estilo / dep bump raramente precisam.
8. **Misturar idioma** — esta base e PT-BR. Mantenha PT-BR.
9. **Usar `grep`/`find` na mao** — use os scripts Node (cross-platform).
10. **Inventar `.agents/`, `COPILOT.md`, `.cursorrules`** — nao existem aqui.

---

## Decision tree

```
"atualize a documentacao" / "sincronize os docs"
│
├─ Fase 1 DESCOBRIR: node project-map.mjs + node docs-check.mjs --json; ler docs reais
├─ Fase 2 ANALISAR: git log (se repo) OU docs-check + mtime (fallback); classificar
├─ Fase 3 GAP: consumir docs-check --json; cruzar codigo vs docs; gap report
├─ Fase 4 EXECUTAR: docs/** -> AGENTS/CLAUDE/Agente -> README; consistencia; verificar
├─ Fase 5 SCAFFOLD (se faltar arquivo)
└─ Fase 6 REPORTAR: mudancas + saida de docs-check --strict + check-compliance
```
