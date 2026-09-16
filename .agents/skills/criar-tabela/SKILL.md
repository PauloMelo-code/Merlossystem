---
name: criar-tabela
description: Cria uma nova tabela Drizzle seguindo as regras absolutas da base (colunas de auditoria, FK RESTRICT, soft delete, nomenclatura hierarquica). Use quando o usuario pedir para criar/adicionar uma tabela, entidade ou model no banco.
---

# Criar Tabela (Drizzle)

Workflow para adicionar uma tabela respeitando TODAS as regras da base.

## Passos

1. **Confirme o nome hierarquico**. Tabelas filhas herdam o prefixo do pai:
   `contratos` -> `contratos_lancamentos` -> `contratos_lancamentos_categorias`.

2. **Copie o template-ouro** `templates/schema.ts` para
   `src/lib/db/schema/<entidade>.ts` e ajuste as colunas de dominio.

3. **Garanta as 5 colunas de auditoria** (NUNCA omitir nenhuma):
   ```
   created_at  timestamp NOT NULL DEFAULT now()
   updated_at  timestamp NOT NULL DEFAULT now()
   deleted_at  timestamp NULL
   is_deleted  boolean   NOT NULL DEFAULT false
   modified_by uuid      NOT NULL
   ```

4. **FK sempre com `onDelete: "restrict"`** — nunca cascade em dado critico.

5. **Adicione indices** para colunas de busca frequente e para `is_deleted`.

6. **Exporte os tipos**: `$inferSelect` e `$inferInsert`.

7. **Gere a migracao**: `npx drizzle-kit generate` e revise o SQL.

8. **Valide**: `node scripts/check-compliance.mjs` deve passar limpo.

## Regras que NAO podem ser quebradas

- PostgreSQL, nunca SQLite.
- Drizzle, nunca Prisma.
- Sem coluna de auditoria = tabela invalida.
- Sem FK configurada = invalido.

## Saida esperada

- `src/lib/db/schema/<entidade>.ts` com todas as colunas.
- Migracao gerada em `src/lib/db/migrations/`.
- `check-compliance.mjs` verde.
