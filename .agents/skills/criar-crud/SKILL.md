---
name: criar-crud
description: Implementa as operações de uma entidade do MerlostoreChat (listar, criar, atualizar, excluir) com módulo de domínio, Server Action por executarAcao, validador Zod, escopo de loja, soft delete, trava de colisão, trilha de auditoria e a trava de teste correspondente. Use quando o usuário pedir um CRUD, telas de cadastro ou operações de uma entidade.
---

# Criar CRUD de Entidade

A regra de negócio mora **uma vez**, no módulo de domínio. A action só orquestra; a tela
só chama a action. Se a regra muda, muda num arquivo só (SOLID-S).

## Pré-requisitos

- A tabela já existe (o modelo é fechado — veja a skill `criar-tabela`).
- Você sabe a permissão do recurso (`<recurso>:<acao>`) e o papel mínimo, em
  `src/lib/auth/permissoes/`. Permissão nova exige entrada na matriz, não `if` solto.

## Camadas (nesta ordem, sem pular)

1. **Validador** — `src/lib/validadores/<dominio>.ts`, com `z.strictObject`.
   Reutilize `validadores/comum.ts` (uuid, paginação, `updated_at`, telefone, dinheiro).
   Dinheiro é **string** `"1234.56"`, nunca `number`. Telefone é **E.164 só dígitos**.
   Toda edição carrega o `updated_at` original (`z.coerce.date()`) — é a trava de colisão.

2. **Domínio** — `src/lib/<dominio>/`. É o único lugar que importa `db` e que conhece a
   regra. Leitura por `<dominio>/_consultas.ts`, sempre com `vivos(t)` e
   `condicaoDeLoja(t, escopo)`. Escrita **só** pelos cinco de `src/lib/db/mutacoes.ts` (implementação em `src/lib/db/mutacoes/`):

   ```ts
   inserirAuditado(tx, tabela, dados, ctx, acao)
   atualizarComTrava(tx, tabela, { id, escopo, updatedAtOriginal, dados }, ctx, acao)
   excluirLogico(tx, tabela, { id, escopo, updatedAtOriginal }, ctx, acao)
   atualizarContador(tx, tabela, { id, escopo }, incrementos)   // só pares de CONTADORES
   atualizarEstado(tx, tabela, { id, escopo }, novoEstado)      // só ESTADOS_DE_SISTEMA
   ```

   `.insert(` / `.update(` fora de `mutacoes.ts` reprova na trava. `excluirLogico` é o
   único "delete" que existe.

3. **Action** — `src/lib/actions/<dominio>.ts`, arquivo com `"use server"` no topo.
   **Toda action é `export async function`** (o `project-map.mjs` e o `docs-check.mjs`
   só enxergam essa forma; `export const x = acao({...})` faria o mapa nascer vazio).
   O wrapper é chamado **dentro do corpo**:

   ```ts
   export async function excluirContato(dadosBrutos: unknown): Promise<Resultado<void>> {
     return executarAcao(
       { permissao: "contatos:excluir", entrada: excluirContatoSchema, loja: "grava",
         revalidar: ["/contatos"] },
       dadosBrutos,
       (dados, ctx, tx) => removerContato(dados, ctx, tx),
     );
   }
   ```

   `executarAcao` já faz, nesta ordem: sessão (ou `exigirSessaoFresca` com
   `fresca: true`) → permissão → Zod → escopo de loja → transação → `Resultado<T>` →
   `revalidatePath`. **Não repita nada disso à mão** e não devolva linha crua do banco.

4. **Telas** — `page.tsx` server busca pelo domínio e passa props; o client component
   faz a interação. Veja a skill `criar-componente`.

## Regras que este sistema cobra e a base genérica não

- **Escopo de loja em toda consulta.** `vendedor` e `viewer` usam a loja da sessão e o
  parâmetro de loja é **ignorado**; `dono`/`admin`/`gerente` usam a loja escolhida.
  Registro de outra loja responde **404**, idêntico a inexistente — nunca 403.
- **Server Action é POST alcançável direto.** Valide **tudo** que chega, inclusive ids
  secundários do corpo, contra a loja resolvida. Nenhuma action aceita `usuarioId` do
  corpo para agir sobre a própria conta.
- **Nunca espalhe o corpo sobre a linha** (`{ ...input }`): `papel`, `loja_id`, `ativo` e
  `preco` entram por campo explícito, do servidor.
- **Trilha antes do efeito** quando o efeito destrói o estado anterior (promoção,
  reset por admin, anonimização), na **mesma transação**, fail-closed.
- **Ação sobre conta alheia** exige `exigirSessaoFresca()` + `exigirAlvoPermitido()` +
  **motivo de 8 a 255 caracteres**.
- **Enfileirar job só depois do commit**; dentro da transação, nunca.

## Provar (sem isto o CRUD não está pronto)

| Teste | Onde | O que prova |
|---|---|---|
| soft delete real | `tests/integracao/` | a linha continua existindo com `is_deleted = true` |
| trava de colisão | `tests/integracao/` | 2º `UPDATE` com `updated_at` velho devolve `ErroDeColisao` |
| escopo de loja | `tests/integracao/` | id de outra loja responde 404 |
| trilha gravada | `tests/integracao/` | `auditoria_eventos` tem a linha, na mesma transação |
| RBAC | `tests/seguranca/` | papel sem a permissão recebe 403 e gera `recusa_403` |
| portão | `tests/travas/` | a action passa por `executarAcao` (identidade de função) |

```bash
npm run lint && npm run typecheck && npm run compliance
node scripts/db-teste.mjs --sufixo <pacote> && npm run test:integracao
```

## Checklist

- [ ] Regra num arquivo só, no módulo de domínio (não duplicada entre telas)?
- [ ] Leitura com `vivos()` + `condicaoDeLoja()`; escrita só por `mutacoes.ts`?
- [ ] Action é `export async function` e chama `executarAcao` no corpo?
- [ ] Entrada validada com `z.strictObject`, dinheiro string, telefone E.164?
- [ ] `updated_at` original trafega e trava a edição?
- [ ] Exclusão é lógica e a trilha é gravada na mesma transação?
- [ ] Ação crítica da tela com `ModalConfirmacaoBlock` (3 s)?
- [ ] Trava de teste escrita junto, não "depois"?
