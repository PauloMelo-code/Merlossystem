---
name: criar-tabela
description: Cria ou altera uma tabela Drizzle do MerlostoreChat seguindo as regras fechadas do modelo de dados (5 colunas de auditoria, timestamptz(3), FK RESTRICT + RESTRICT, enum por text+CHECK, índice único parcial com SQL cru, nome hierárquico em PT-BR, migração versionada). Use quando o usuário pedir para criar/alterar tabela, entidade, coluna, índice ou constraint no banco.
---

# Criar Tabela (Drizzle + PostgreSQL)

O modelo de dados é **fechado**: as 48 tabelas nascem nas migrações `0000` a `0016`.

## Portão 0 — esta tabela pode existir?

1. Procure o nome em `docs/PROJECT_MAP.md` e em `src/lib/db/schema/`. Se já existe, você
   está **alterando**, não criando.
2. Tabela ou coluna nova fora daquelas 48 exige **ADR aprovado** e migração `0017+`.
   Se estiver num pacote de módulo (M1..M8), **pare e reporte ao orquestrador** — pacote
   de módulo não gera migração.
3. A fórmula, o índice e o CHECK que você procura provavelmente já estão no modelo.
   Leia antes de inventar coluna.

## Passos

1. **Nome hierárquico, em PT-BR, filho herda o prefixo do pai**:
   `pedidos` → `pedidos_itens` → `pedidos_devolucoes_itens`. Nome de tabela filha que
   não começa pelo nome do pai reprova na trava de fonte.

2. **Arquivo** em `src/lib/db/schema/<dominio>.ts` (ou `<dominio>/<arquivo>.ts` se o
   domínio já nasceu dividido). Máximo **499 linhas** — o que estoura por construção
   nasce dividido em pasta. Registre a linha no barril `schema/index.ts`
   (ordem alfabética, comentário `// não reordenar`).

3. **Forma exata do `pgTable`** — o auditor só enxerga esta:

   ```ts
   export const pedidosItens = pgTable("pedidos_itens", {
     id: uuid("id").primaryKey().defaultRandom(),
     loja_id: uuid("loja_id").notNull()
       .references(() => lojas.id, { onDelete: "restrict", onUpdate: "restrict" }),
     quantidade: integer("quantidade").notNull(),
     preco_unitario: dinheiro("preco_unitario").notNull(),
     ...colunasAuditoria,
   }, (t) => [
     index("pedidos_itens_loja_idx").on(t.loja_id),
     index("pedidos_itens_loja_vivos_idx").on(t.loja_id, t.is_deleted),
     check("pedidos_itens_quantidade_positiva", sql`quantidade > 0`),
   ]);
   ```

   - 2º argumento **objeto literal** (a forma callback escapa da checagem inteira);
   - 3º argumento **array** (Drizzle 0.45; a forma objeto está deprecada);
   - **nome da coluna explícito** em toda coluna; propriedade TS = nome em snake_case;
   - `...colunasAuditoria` **sem alias**, importado de `schema/_compartilhado.ts`;
   - instante sempre por `instante(...)` — `timestamptz(3)`, nunca `timestamp()` cru;
   - dinheiro sempre por `dinheiro(...)` — `numeric(12,2)` modo string, nunca `number`.

4. **`updated_at` nunca leva `$onUpdate`.** Ele dispara em todo `UPDATE`, inclusive no
   de contador, e a trava de colisão passa a recusar toda edição legítima em silêncio.
   Quem escreve `updated_at` é `atualizarComTrava()` / `inserirAuditado()`.

5. **FK**: toda FK declara `{ onDelete: "restrict", onUpdate: "restrict" }`, explícito.
   `modified_by` tem FK, mas ela é declarada em **SQL puro** na migração `0016` (evita
   ciclo de import com `usuarios.ts`). Filho de tabela com loja ganha também a FK
   composta `(id, loja_id)` na `0016`.

6. **Enum é `text` + `CHECK`**, nunca `pgEnum`: a constante vive em
   `schema/_enums/<dominio>.ts` e alimenta o CHECK, o `z.enum()` do validador e o rótulo
   em `src/lib/ui/tons.ts`. Remover valor de `pgEnum` é migração destrutiva; de CHECK é
   `DROP CONSTRAINT / ADD CONSTRAINT`.

7. **Índice único parcial**: o predicado do `.where()` usa **só template `sql` cru com
   literais** — `sql\`is_deleted = false\``. Nunca `eq()`/`inArray()`: o drizzle-kit
   emite `WHERE "t"."col" = $1` e a migração falha ao aplicar.
   Trava: `grep -n "= \$" src/lib/db/migrations/` tem de vir vazio.

8. **Exceção só por marcador escrito**, nos 600 caracteres acima do `pgTable`, com
   justificativa ao lado:
   - `compliance:append-only` — trilha (só `created_at`): `auth_eventos`,
     `auditoria_eventos`, `consentimentos`, `usuarios_senhas_historico`;
   - `compliance:framework` — tabela que o Better Auth apaga por dentro:
     `usuarios_sessoes`, `usuarios_verificacoes`, `usuarios_totp`, `usuarios_passkeys`.
   Fora dessas 8, a tabela leva as 5 colunas. Sem exceção nova sem ADR.

9. **Migração**: `npm run db:generate` → **leia o SQL gerado** (o drizzle-kit emite
   `DROP` quando acha que houve rename) → complemente à mão o que o ORM não expressa
   (CHECK, FK composta, índice parcial, `REVOKE`, trigger) → `npm run db:migrate`.
   **`drizzle-kit push` é proibido** fora de banco descartável de dev.

10. **Prove**: `npm run db:verificar` · `npm run compliance` · `npm run test:integracao`
    (`enums-check` compara o CHECK do banco com a constante TS, tabela a tabela).

## Nunca

- SQLite, Prisma, `pgEnum`, `db.delete(` / `tx.delete(` / `DELETE FROM`.
- Tabela sem as 5 colunas de auditoria e sem FK.
- `casing: "snake_case"` no lugar do nome explícito da coluna.
- `.insert(` / `.update(` fora de `src/lib/db/mutacoes.ts`.
- Coluna de contador ou de estado de sistema sem entrar em `CONTADORES` /
  `ESTADOS_DE_SISTEMA`.

## Saída esperada

- `src/lib/db/schema/<dominio>.ts` + linha no `schema/index.ts`;
- migração em `src/lib/db/migrations/` com o SQL manual dentro;
- `npm run db:verificar` e `npm run compliance` verdes.
