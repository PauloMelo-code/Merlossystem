---
name: repo-docs-sync
description: >-
  Audita e sincroniza a documentação técnica do MerlostoreChat com o estado real
  do código. Use quando o usuário pedir para atualizar/sincronizar docs, revisar
  se a documentação está desatualizada, ou garantir que as regras dos agentes IA
  batem com o projeto. Gatilhos: "atualize a documentação", "sincronize os docs",
  "revise o README", "atualize o CLAUDE.md", "atualize o AGENTS.md", "os docs
  estão desatualizados", "atualizar documentação do repositório", "update docs",
  "sync documentation".
  NÃO usar para: escrever feature nova, debugar, ou rodar testes.
---

# Repo Docs Sync

Audita e sincroniza a documentação para que as instruções dos agentes (`CLAUDE.md`,
`AGENTS.md`, `Agente.md`, `.agents/`), os docs de domínio (`docs/**`) e o `README.md`
reflitam o estado **real** do código. Evita alucinação da IA, regra stale e confusão do
dev, detectando drift entre código e documentação.

> [!CAUTION]
> **READ-FIRST, WRITE-SECOND.** Nunca atualize um doc sem antes ler o código fonte que
> ele referencia. Nunca assuma que um padrão existe — abra o arquivo real e confirme.
> O determinismo (provar o drift) é dos scripts; o julgamento e a escrita são seus.

---

## Ferramentas deste repositório (use SEMPRE, não reinvente)

Geradores determinísticos, cross-platform — não use `grep`/`find` à mão (o time trabalha
no Windows):

| Comando | Para que |
|---------|----------|
| `npm run map` | Inventário do código em `docs/PROJECT_MAP.md`: tabelas Drizzle, rotas, actions, componentes, páginas |
| `npm run docs:check` | Relatório de drift (refs quebradas + código sem cobertura nos docs) |
| `node scripts/docs-check.mjs --json` | Mesmo relatório, machine-readable |
| `node scripts/docs-check.mjs --strict` | Exit 1 se houver qualquer gap (verificação final e passo 10 do CI) |
| `npm run compliance` | Auditoria das regras absolutas |
| `npm run ai-marks` | Marcas invisíveis de IA em `docs/` |

O `docs-check.mjs` daqui já exclui `PROJECT_MAP.md` do corpus (senão tudo pareceria
documentado) e ignora caminho citado **dentro de bloco de código** (exemplo não é link).

---

## Fase 1: Descoberta — mapear o terreno

### 1.1 Rode os geradores

```bash
npm run map                          # o que o código TEM
node scripts/docs-check.mjs --json   # o que os docs ERRAM/FALTAM
```

### 1.2 Conheça o conjunto REAL de docs

```
RAIZ
├── CLAUDE.md        # regras para o Claude Code
├── AGENTS.md        # regras universais (Codex, Cursor, Copilot, Gemini, Antigravity)
├── Agente.md        # comportamento do agente (como trabalhar, não o que construir)
├── README.md        # visão, stack, setup
.agents/             # espelho versionado: rules/, skills/, workflows/
docs/
├── seguranca/       # caminhos-de-acesso.md, runbook.md, matriz-req-teste.md
├── modulos/         # um por domínio (conversas, contatos, midias, pedidos, …)
├── adr/             # decisões 0008..0024 + índice (0001..0007 estão "Substituído por")
├── rbac.md  back.md  front.md  components.md  regras-negocio.md
├── integracoes.md  definition-of-done.md  git-commits.md  deploy.md
└── PROJECT_MAP.md   # GERADO — nunca editar à mão
.github/pull_request_template.md
```

> [!NOTE]
> Este repositório **usa** `.agents/` (Codex e Antigravity) — é espelho versionado do
> `.claude/skills/` e das regras da raiz. Ao mudar uma skill ou uma regra, **espelhe**.
> Não existem `COPILOT.md` nem `.cursorrules` aqui; não os invente.

> [!NOTE]
> O `next dev` mantém um bloco gerenciado dentro do `AGENTS.md`
> (`<!-- BEGIN:nextjs-agent-rules -->`). Ele é **commitado** e **não se edita à mão** —
> reescrever aquele trecho o faz voltar como diff no próximo `dev`.

### 1.3 Monte o registro

Para cada doc: caminho, propósito, domínio coberto e termos-chave (paths, nomes de
tabela, funções) citados.

---

## Fase 2: Arqueologia — o que mudou no código

```bash
git log --oneline --name-only -n 50
git log --diff-filter=A --name-only --pretty=format: -n 50 | sort -u   # novos
git log --diff-filter=D --name-only --pretty=format: -n 50 | sort -u   # deletados
```

O commit `5e902d4` é o **sistema antigo**, referência de domínio e nunca de
implementação. Não documente comportamento lido de lá.

### Classifique cada mudança

| Categoria | Impacto | Ação |
|-----------|---------|------|
| Domínio/módulo novo | ALTO | `docs/modulos/<dominio>.md` + índice em `back.md`/`front.md` |
| Tabela ou coluna nova | ALTO | ADR + `docs/modulos/` + `PROJECT_MAP` |
| Rota nova | ALTO | linha em `docs/seguranca/caminhos-de-acesso.md` (a trava T2 cobra) |
| Permissão ou papel novo | ALTO | `docs/rbac.md` + matriz em `src/lib/auth/permissoes/` |
| Regra de negócio nova | ALTO | `docs/regras-negocio.md` + invariante em AGENTS/CLAUDE |
| Mudança em auth, borda ou webhook | ALTO | `docs/seguranca/` + rodar `/audit-auth-security` |
| Refactor de módulo | MÉDIO | conferir precisão do que já está escrito |
| Bug fix, bump, estilo | BAIXO | pular, salvo se mudou um padrão |

**Nunca documente com base em mensagem de commit.** Abra o arquivo.

---

## Fase 3: Gap analysis

O JSON do `docs-check` traz `staleRefs[]` (caminho citado que não existe),
`missingCoverage[]` (tabela/rota/action sem menção em doc nenhum) e `summary`.
Sobre isso aplique julgamento:

- **Completude**: todo domínio tem seção em ao menos um doc?
- **Precisão**: paths, nomes de função e contagens batem?
- **Atualidade**: nenhuma ref a arquivo deletado ou função renomeada?
- **Consistência**: dois docs não se contradizem?

```markdown
## Gap Report
### Falta documentar (código existe, doc não)
- [ ] <missingCoverage>
### Stale (doc cita código que mudou/sumiu)
- [ ] <staleRefs>
### Inconsistência
- [ ] <ex: CLAUDE.md diz X, AGENTS.md diz Y>
```

---

## Fase 4: Execução

### Ordem obrigatória

1. **Docs de domínio** (`docs/**`) — mais profundo
2. **Regras de agente** (`AGENTS.md`, `CLAUDE.md`, `Agente.md`) — invariantes
3. **Espelho** `.agents/` — rules e skills
4. **README.md** — por último, porque resume tudo

> [!WARNING]
> Nunca atualize o README primeiro.

### Regras de consistência

1. **Mesmos termos** em todos os docs. Glossário do produto: "Conversa" (não "ticket"),
   "Modelo" (não "template"), "Campanha" (não "broadcast"), "Loja" (não "tenant").
2. **Mesmos paths** — arquivo que moveu, atualiza em TODOS os docs.
3. **Mesmas contagens** — se são 48 tabelas e 5 papéis, todo doc que citar diz isso.
4. **Cross-reference** — doc novo em `docs/modulos/` entra no índice de `back.md`/`front.md`.
5. **PT-BR sempre.** Contrato de biblioteca (shadcn, Better Auth, Drizzle) fica em inglês.
6. **Nada de segredo, dado de cliente ou senha literal** em doc nenhum.

### Verificação (rode SEMPRE no fim)

```bash
node scripts/docs-check.mjs --strict
npm run compliance
npm run ai-marks
```

---

## Fase 5: Scaffolding

Crie doc faltante quando: um domínio existe no código e não tem `docs/modulos/<x>.md`;
falta ADR para uma decisão tomada; uma rota nova não tem linha em
`docs/seguranca/caminhos-de-acesso.md`. Nunca crie doc "para depois".

---

## Fase 6: Saída

1. Arquivos alterados e criados, com o porquê
2. Gaps resolvidos e gaps remanescentes (o que precisa de decisão do Paulo)
3. Refs corrigidas
4. Saída literal de `docs-check --strict`, `compliance` e `ai-marks`
5. Risco residual

---

## Erros comuns

1. Documentar de memória em vez de ler o arquivo.
2. Atualizar só um arquivo quando a mudança afeta três.
3. Inventar padrão que não existe no código — sinalize a inconsistência, não normalize.
4. Documentar o sistema antigo (`5e902d4`) como se fosse o atual.
5. Editar `docs/PROJECT_MAP.md` à mão, ou o bloco gerenciado do `AGENTS.md`.
6. Esquecer de espelhar em `.agents/`.
7. Atualizar o README primeiro.
8. Misturar idioma.
9. `grep`/`find` à mão em vez dos scripts.
10. Pular a verificação final.
