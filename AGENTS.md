# MerlostoreChat — instruções para agentes IA (Codex, Cursor, Copilot, Gemini, Antigravity)

> Leia este arquivo INTEGRALMENTE antes de qualquer tarefa. Ele é a fonte das regras
> absolutas; `CLAUDE.md` e `.agents/rules/merlostore-chat.md` são resumos que apontam
> para cá.

## Estado do projeto

Atendimento multicanal (WhatsApp oficial, uazapi, Instagram) + CRM + catálogo + pedidos
da **Merlo Store**, **multi-loja** (Centro e Cerro Azul). Em **reconstrução completa** na
branch `refactor/reconstrucao-estrutura-base`.

O sistema antigo vive no commit `5e902d4` e é referência de **domínio** — nunca de
implementação. Não replique nada dele: Prisma, NextAuth, as ~69 rotas de API, delete
físico e ausência de escopo de loja foram exatamente o que se veio reconstruir. Banco
novo, sem migração de dados.

## Stack (fechada, não reabrir)

- **Linguagem**: TypeScript 6 strict (`exactOptionalPropertyTypes`)
- **Framework**: Next.js 16.3.5, App Router, Server Actions; `src/proxy.ts` (não
  `middleware.ts`) e ele **não é fronteira de segurança**
- **ORM**: Drizzle ORM 0.45 — NUNCA Prisma
- **Banco**: PostgreSQL 16 na porta 5437 — NUNCA SQLite, nem em teste
- **Auth**: Better Auth 1.7.5 + passkey, Argon2id — NUNCA NextAuth
- **Fila**: BullMQ 6 + Redis na 6382, worker em processo separado
- **Mídia**: MinIO na 9002, bucket privado, leitura só pela rota interna
- **UI**: Tailwind v4 (CSS-first, sem `tailwind.config.ts`) + shadcn/ui
- **Testes**: Vitest 5 com 4 projetos (unidade, travas, componentes, integração)
- **Princípios**: SOLID — alta coesão, baixo acoplamento

App na 3005. Código, comentário, documentação, UI, mensagem de erro e commit em **PT-BR**.

## Regras Absolutas

### Banco de dados
1. NUNCA usar SQLite em nenhum ambiente (nem dev, nem teste).
2. NUNCA usar Prisma. Drizzle em tudo.
3. NUNCA fazer DELETE físico. `db.delete(`, `tx.delete(`, `.deleteMany(` e `DELETE FROM`
   são bloqueados pelo hook e reprovam no auditor — inclusive em `tests/` e `scripts/`.
   Limpeza de banco de teste é por transação com rollback (e `TRUNCATE` no `globalSetup`).
4. NUNCA criar tabela sem as 5 colunas de auditoria, por `...colunasAuditoria`:
   `created_at`, `updated_at`, `deleted_at`, `is_deleted`, `modified_by`.
5. NUNCA usar `timestamp()` cru: todo instante é `timestamptz(3)` pelo helper
   `instante()`. O microssegundo do Postgres nunca bate com o milissegundo do `Date` e a
   trava de colisão falharia em silêncio.
6. NUNCA pôr `$onUpdate` em `updated_at` — o contador o envelheceria e toda edição
   legítima passaria a ser recusada.
7. NUNCA criar FK sem `{ onDelete: "restrict", onUpdate: "restrict" }` explícitos.
8. NUNCA usar `pgEnum`: enum é `text` + `CHECK`, com a constante em `schema/_enums/`.
9. NUNCA escrever `.insert(` ou `.update(` fora de `src/lib/db/mutacoes.ts`.
10. NUNCA construir predicado de índice único parcial com `eq()`/`inArray()` — só
    template `sql` cru com literais.

### Código
11. NUNCA duplicar regra de negócio: ela mora no módulo de domínio `src/lib/<dominio>/`,
    uma vez. A action orquestra; a tela chama a action.
12. NUNCA criar action ou handler sem validação de entrada (Zod `strictObject`) e sem
    portão de sessão e permissão. Server Action é POST alcançável direto.
13. NUNCA espalhar o corpo sobre a linha (`{ ...input }`): `papel`, `loja_id`, `ativo` e
    preço entram por campo explícito, vindos do servidor.
14. NUNCA consultar sem escopo de loja e sem filtro de `is_deleted`.
15. NUNCA expor erro cru do banco, token de sessão, e-mail em claro na trilha de
    segurança ou `url_externa` de mídia em DTO.
16. NUNCA comitar segredo, `.env` ou senha literal — nem em seed, README ou doc.

### Estrutura
17. NUNCA criar arquivo na raiz: use `src/`, `tests/`, `docs/`, `config/`, `scripts/`,
    `templates/`.
17.1. NUNCA rodar `node -e "..."` ou `psql -c "..."` inline no PowerShell/Git Bash com
    parêntese ou aspas. O shell interpreta um pedaço do código como **redirecionamento**
    e cria na raiz um arquivo com o nome daquele fragmento (`y.id)`, `console.log('`,
    `{`). Escreva um `.mjs` e rode com `node <arquivo>`. Para limpar o que já acumulou:
    `npm run lixo` (dry-run) e `node scripts/limpar-lixo-raiz.mjs --aplicar`.
18. NUNCA criar arquivo com mais de 499 linhas — exceto `src/components/ui/`, que é
    código vendorizado do shadcn e não se edita. O que estoura por construção **nasce
    dividido em pasta**.
19. NUNCA criar documentação sem pedido, e NUNCA pular a regra de negócio nova em
    `docs/regras-negocio.md` nem a decisão nova em `docs/adr/`.
20. NUNCA editar `docs/PROJECT_MAP.md` à mão (é gerado) nem o bloco
    `<!-- BEGIN:nextjs-agent-rules -->` deste arquivo (é mantido pelo `next dev` e
    **commitado** como está).

## Soft delete

```ts
// CORRETO — sempre por mutacoes.ts, que já grava a trilha na mesma transação
await excluirLogico(tx, contatos, { id, escopo, updatedAtOriginal }, ctx, "contato.excluir");

// PROIBIDO
// await db.delete(contatos).where(eq(contatos.id, id));

// TODA leitura filtra deletados e escopo de loja
.where(vivosE(contatos, condicaoDeLoja(contatos, escopo)))
```

## Trava de colisão (optimistic locking)

Toda tabela de domínio é atualizada por `atualizarComTrava()`; zero linhas devolvidas é
`ErroDeColisao` ("Registro alterado por outro usuário. Recarregue e tente novamente.").
O `updated_at` original vai à tela em campo oculto e volta validado por `z.coerce.date()`.

Exceções fechadas (tabela de ligação pura, linha escrita uma vez, contador de sistema e
trilha) usam `atualizarContador()` / `atualizarEstado()`, que **não** tocam `updated_at`,
`modified_by` nem gravam trilha, e só aceitam os pares das constantes `CONTADORES` e
`ESTADOS_DE_SISTEMA`.

## Anatomia de uma Server Action

```ts
// src/lib/actions/pedidos.ts
"use server";

export async function lancarNoMasc(dadosBrutos: unknown): Promise<Resultado<{ numero: string }>> {
  return executarAcao(
    { permissao: "pedidos:lancar_masc", entrada: lancarNoMascSchema,
      loja: "grava", revalidar: ["/pedidos"] },
    dadosBrutos,
    (dados, ctx, tx) => registrarLancamentoMasc(dados, ctx, tx),
  );
}
```

`executarAcao` faz, nesta ordem: sessão (ou sessão **fresca**) → permissão → Zod →
escopo de loja → transação → `Resultado<T>` → `revalidatePath`. Não repita nada disso à
mão e não devolva linha crua do banco.

**Toda action é `export async function`.** `export const x = acao({...})` faria o
`PROJECT_MAP.md` nascer sem actions e o `docs-check` acusar "sem cobertura" em série.

## Papéis e escopo de loja

`dono` > `admin` > `gerente` > `vendedor` > `viewer`.
`dono`, `admin` e `gerente` não têm loja fixa; `vendedor` e `viewer` têm loja obrigatória
e o parâmetro de loja que chega do cliente é **ignorado**. `dono` não é convidável.

Permissão é `<recurso>:<acao>`, declarada na matriz de `src/lib/auth/permissoes/` e
avaliada por `pode()`, que é **fail-closed**. Nada de `if (papel === "admin")` solto.

Ação sobre conta alheia exige, junto: sessão fresca, permissão, alvo de papel
estritamente inferior, **motivo de 8 a 255 caracteres** e trilha **antes** do efeito.

## Segurança que não se flexibiliza

- Segundo fator **obrigatório**, ligado no provisionamento; passkey como opção resistente
  a phishing. Conta só vira ativa com fator verificado.
- Recusa de login em **uma frase**, mesmo corpo, mesmos cabeçalhos, mesmo piso de tempo —
  não existe e senha errada e conta desativada respondem igual.
- Bloqueio **por conta**, atômico e persistido; o teto por IP é a segunda linha, em Redis.
- IP do cliente só por `src/lib/seguranca/ip.ts` — `x-forwarded-for` cru não aparece em
  mais lugar nenhum.
- Segredo de máquina em header, nunca em query string, comparado com `timingSafeEqual`.
- Credencial de integração só no cofre (AES-256-GCM); a tela mostra 4 caracteres.
- Trilha é **append-only**: sem `UPDATE`, sem `DELETE`, garantido por `REVOKE` e trigger.
- Toda busca HTTP a endereço vindo de terceiro passa por `src/lib/rede/buscarExterno.ts`.

## UI

- Tokens semânticos do `globals.css`. **Proibido** em `.tsx` fora de
  `src/components/ui/`: hex, `rgb(`, `oklch(`, classe de paleta crua (`bg-white`) e valor
  arbitrário (`text-[10px]`).
- Rótulo e tom de enum só por `src/lib/ui/tons.ts`; moeda, data, hora e telefone só por
  `src/lib/formato.ts`. Dinheiro atravessa a fronteira como **string** `"1234.56"`.
- 8 estados obrigatórios: carregando, vazio, erro, sucesso, sem permissão, reautenticação,
  dado desatualizado, desconectado.
- **Modal block de 3 s** para o irreversível ou visível para fora; **desfazer por toast**
  para o reversível e interno. Nunca os dois, nunca nenhum.
- Acessibilidade AA (WCAG 2.2) é critério de aceite, não polimento.

## Estrutura de pastas

```
CLAUDE.md  AGENTS.md  Agente.md  README.md  .env.example
docker-compose.yml  Dockerfile  next.config.ts  drizzle.config.ts
.claude/{settings.json,hooks/,skills/}   .agents/ (espelho)   .github/workflows/
config/  scripts/  templates/  tests/{unidade,travas,componentes,integracao,seguranca}/
docs/{adr,seguranca,modulos}/  docs/PROJECT_MAP.md (gerado)
src/
  proxy.ts                só UX: redireciona sem cookie e injeta nonce da CSP
  app/{(publico),(app),api}/
  components/{ui,layout,comum}/
  lib/
    env.ts logger.ts erros.ts formato.ts marca.ts navegacao.ts ui/tons.ts
    db/{client.ts,schema/,consultas.ts,mutacoes.ts,migrations/,migrate.ts}
    auth/  seguranca/  rede/  fila/  tempo-real/  actions/  validadores/
    <dominio>/          um módulo por domínio, com a regra de negócio
  server/{worker.ts,sse.ts,processadores/}
  types/
```

## Comandos

```bash
npm run db:up        # Postgres 5437, Redis 6382, MinIO 9002/9003
npm run dev          # app na 3005
npm run worker       # worker da fila

npm run verificar    # lint + typecheck + compliance + travas + testes + docs
npm run build
npm run compliance   # auditor das regras absolutas
npm run map          # regenera docs/PROJECT_MAP.md
npm run lixo         # quarentena do lixo de shell na raiz

npm run db:migrate   # papel merlo_migracao (drizzle-kit push é PROIBIDO)
npm run db:verificar # confere o banco depois das migrações
npm run db:backup    # obrigatório antes de qualquer deploy em PRD
```

## Checklist antes de finalizar

- [ ] Tabela nova com as 5 colunas, `timestamptz(3)` e FK `restrict`/`restrict`?
- [ ] Exclusão lógica, leitura filtrando `is_deleted` **e** escopo de loja?
- [ ] Escrita só por `mutacoes.ts`, com trava por `updated_at`?
- [ ] Action é `export async function` e passa por `executarAcao`?
- [ ] Permissão na matriz e trilha gravada na mesma transação?
- [ ] Ação crítica com modal block de 3 s (ou desfazer, se reversível)?
- [ ] Entrada validada; nada de `{ ...input }` sobre a linha?
- [ ] Arquivo com no máximo 499 linhas; nada novo na raiz?
- [ ] `npm run verificar` e `npm run build` verdes, com a saída colada no relatório?
- [ ] Commit em Conventional Commits PT-BR, **sem rodapé de coautoria**?
