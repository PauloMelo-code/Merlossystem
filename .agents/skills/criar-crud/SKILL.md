---
name: criar-crud
description: Implementa o CRUD completo de uma entidade (listar/criar/atualizar/excluir) centralizado em uma server action, com autenticacao, RBAC, validacao Zod, soft delete, optimistic locking e auditoria. Use quando o usuario pedir um CRUD, "telas de cadastro" ou operacoes de uma entidade.
---

# Criar CRUD de Entidade

Implementa a regra de negocio da entidade em UM unico lugar (SOLID-S).
Telas chamam estas funcoes — nunca duplicam logica.

## Pre-requisito

A tabela ja existe (use a skill `criar-tabela` se nao existir).

## Passos

1. **Validador Zod** em `src/lib/validators/<entidade>.ts`. Use regex para
   formatos criticos (codigos, documentos). Ver exemplo no Agente.md.

2. **Server action** em `src/lib/actions/<entidade>.ts`. Copie o template-ouro
   `templates/server-action.ts`. Implemente:
   - `listar()` — filtra `is_deleted = false`, ordena por `created_at`.
   - `criar(dados)` — valida, insere, registra auditoria.
   - `atualizar(id, dados, updatedAtOriginal)` — **optimistic locking**:
     o WHERE compara `updated_at`; se 0 linhas, lanca "alterado por outro usuario".
   - `excluir(id)` — **soft delete** (nunca `db.delete`).

3. **Toda funcao**: `getSession()` no inicio, `temPermissao()` para RBAC,
   `registrarAuditoria()` apos mutacao.

4. **Telas**: server component busca via `listar()`, client component faz as
   interacoes. Acao critica usa `ModalConfirmacaoBlock` (3s). Ver skill
   `criar-componente`.

5. **Documente a regra** em `docs/regras-negocio.md` se houver logica nova.

6. **Teste** os caminhos: soft delete real, optimistic locking rejeitando,
   auditoria gravada, RBAC negando.

7. **Valide**: `node scripts/check-compliance.mjs` verde.

## Checklist

- [ ] Logica num so arquivo (nao duplicada entre telas)?
- [ ] `listar` filtra `is_deleted`?
- [ ] `atualizar` tem optimistic locking (compara `updated_at`)?
- [ ] `excluir` e soft delete?
- [ ] Toda mutacao gera auditoria?
- [ ] RBAC + autenticacao em toda funcao?
- [ ] Entrada validada (Zod + regex)?
