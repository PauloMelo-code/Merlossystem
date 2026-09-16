# Workflow — nova funcionalidade no MerlostoreChat

## 1. Ler antes de projetar

- `CLAUDE.md` na raiz — **seção "Estado Atual do Projeto"**, que lista honestamente o que ainda diverge do padrão da base
- `docs/api.md` — as 50 rotas, com validação, efeitos colaterais e desvios conhecidos. **Obrigatório antes de mexer em qualquer rota**
- `docs/adr/` — 0002 transição Prisma→Drizzle, 0003 multi-loja, 0005 soft delete, 0007 fila no Postgres
- `docs/regras-negocio.md` e `docs/rbac.md`
- O arquivo real que você vai alterar

A funcionalidade pode já existir com outro nome — confira a documentação antes de escrever.

## 2. Decidir onde mora

| Tipo de mudança | Onde |
| :--- | :--- |
| Regra de negócio | `src/lib/` — nunca dentro da rota ou do componente |
| Tabela ou coluna | **Drizzle**: `src/lib/db/schema/` (não estenda o `prisma/schema.prisma` legado) |
| Rota HTTP | `src/app/api/<recurso>/route.ts` + a seção correspondente em `docs/api.md` |
| Tela | `src/app/(dashboard)/<rota>/` |
| Permissão nova | `src/lib/rbac.ts` + `docs/rbac.md` |
| Escopo de loja | `src/lib/loja.ts` — toda consulta nova passa por ali |
| Decisão de arquitetura | nova ADR em `docs/adr/` |

Regra de negócio fica em **um** lugar e é consumida por todas as telas. Se você está copiando a
mesma lógica para um segundo arquivo, pare.

## 3. Implementar respeitando os invariantes

Os da seção "Invariantes" em [../rules/merlostore-chat.md](../rules/merlostore-chat.md) valem todos. Em especial:

- **Escopo de loja em toda consulta** (`src/lib/loja.ts`) — Centro e Cerro Azul não se misturam
- **Código novo que toca banco nasce em Drizzle** (`src/lib/db/schema/`). O Prisma é legado e convive até a virada — **não introduza Prisma em código novo**
- **Autoria vem da sessão** (`usuarioDaSessao()` em `src/lib/sessao.ts`), nunca de um usuário default
- **Middleware exige sessão em `/api/**`**; as 9 exceções têm gate próprio — não crie a décima sem gate

## 4. Testar

```bash
npm run typecheck
npm test
npm run compliance
npm run docs:check
```

## 5. Documentar na mesma alteração

- Módulo, integração ou invariante novo → a doc de arquitetura do projeto
- Invariante que os agentes precisam respeitar → `AGENTS.md` **e** `CLAUDE.md` (os dois)
- Decisão de arquitetura → ADR, se o projeto tiver `docs/adr/`

## 6. Reportar

Arquivos criados/alterados · invariantes tocados · saída dos comandos acima · docs atualizados ·
o que ficou fora do escopo.
