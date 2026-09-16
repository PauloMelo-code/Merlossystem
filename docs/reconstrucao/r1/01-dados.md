# 01 — Modelo de dados (FINAL, parte 1: convenções, auth, plataforma, trilhas)

- **Alvo**: MerlostoreChat v2 — Next 16.3.5, React 19.3, TypeScript strict, Drizzle 0.45.2 + drizzle-kit 0.31.10, PostgreSQL 16 (docker, 5437), Better Auth 1.7.5 endurecido, Zod 4, Vitest 5.
- **Parte 2 (domínio)**: `spec/final/01-dados-dominio.md` — contatos, conversas, mídia, catálogo, conteúdo, campanhas, CRM, pedidos, pagamentos, devoluções, LGPD.
- **Status**: este documento **substitui** os rascunhos `spec/rascunho/01-dados.md` e `01-dados-dominio.md`. Onde ele diverge de `02-seguranca.md`, `03-arquitetura.md` ou `04-ui.md`, **este documento vence** nos itens listados na §13 (nomes compartilhados) e no §16 (catálogo de nomes); nos demais, cada documento continua dono do seu assunto.
- **Regra de leitura**: **não existe "a definir" aqui.** Toda pergunta que estava aberta nos rascunhos foi fechada na §11, com o motivo. O agente construtor implementa o que está escrito; reabrir exige achado novo e ADR.
- Citações `01/D-04`, `02/C-01`, `06/INV-13`, `07/REQ-C1`, `08/§3.3` remetem aos levantamentos em `spec/levantamento/`.

---

## 1. Visão geral

**48 tabelas**, em 5 blocos:

| Bloco | Tabelas | Onde |
|---|---:|---|
| 0. Compartilhado (helpers, sem tabela) | 0 | §3 |
| 1. Autenticação e conta | 9 | §5 |
| 2. Plataforma (lojas, integrações, alertas) | 6 | §6 |
| 3. Trilhas append-only | 2 | §7 |
| 4. Domínio — contatos, conversas, mídia, catálogo, conteúdo, campanhas | 20 | parte 2, §2–§5 |
| 5. Domínio — CRM, pedidos, pós-venda, LGPD | 11 | parte 2, §6–§7 |

Conferência: 9 + 6 + 2 + 20 + 11 = **48**. Tabelas com as 5 colunas de auditoria: **40** (48 − 4 append-only − 4 de framework).

Princípios que governam o modelo inteiro:

1. **Nada de array de ids.** `media_ids`, `product_ids`, `image_urls`, `tags`, `template_vars` viram tabelas de ligação com FK (`03/A12`). Motivo: hoje não há integridade e ids mortos circulam entre lojas.
2. **Toda tabela tem as 5 colunas de auditoria**, exceto as marcadas `compliance:append-only` (4 trilhas) e `compliance:framework` (4 tabelas que o Better Auth apaga por dentro). Ver §4.3.
3. **Nenhuma coluna de status é texto livre.** Lista fechada com `CHECK` no banco + união TS + Zod, tudo de uma constante só (§4.4).
4. **Todo id secundário que vem do cliente é conferido contra a loja no `where`** (`06/INV-10`, `07/REQ-H12`); o modelo carrega `loja_id` em **toda** tabela filha **e** amarra o filho ao pai com **FK composta** `(id, loja_id)` (§4.6) — sem isso o `loja_id` redundante podia divergir do pai.
5. **Toda unicidade convive com soft delete**: índice único **parcial** com `WHERE is_deleted = false`. Exceção única e escrita: `usuarios` e `usuarios_contas`, que nunca são soft-deletados (§5.1).
6. **Uma trilha de negócio só** (`auditoria_eventos`), append-only, no lugar de `deal_events`/`order_events`/`activity_logs`.
7. **Sem conta de ambiente**: `conversas.integracao_id` é `NOT NULL` (`01/D-04`).
8. **Nenhum `DELETE` físico de linha em lugar nenhum do sistema.** A única exclusão física é de **objeto no MinIO**, na anonimização LGPD, e roda fora da transação (parte 2, §8).

---

## 2. Arquivos do schema

Arquivo com 3 tabelas ou mais **nasce dividido em pasta** (o auditor reprova 500 linhas — `scripts/check-compliance.mjs:34`, `MAX_LINES = 500`). Quebrar depois, com o CI vermelho, sai mais caro que nascer quebrado.

```
src/lib/db/
  schema/
    _compartilhado.ts      instante(), data(), dinheiro(), colunasAuditoria
    _enums/                listas fechadas (arrays as const) + emLista()
      index.ts  auth.ts  plataforma.ts  conversas.ts  catalogo.ts  pedidos.ts  auditoria.ts
    _ba-fields.ts          de-para Better Auth → coluna (fonte única, §5.10)
    auth/
      index.ts  usuarios.ts  contas.ts  sessoes.ts  verificacoes.ts  totp.ts  passkeys.ts
      convites.ts  senhas-historico.ts  trocas-email.ts
    auth-eventos.ts        auth_eventos                       (append-only)
    auditoria.ts           auditoria_eventos                  (append-only)
    lojas.ts               lojas, lojas_etiquetas
    integracoes.ts         lojas_integracoes, lojas_integracoes_eventos, lojas_integracoes_templates
    alertas.ts             alertas
    contatos.ts            contatos, contatos_etiquetas
    conversas/
      index.ts  conversas.ts  mensagens.ts  mensagens-midias.ts  agendamentos.ts
    midias.ts              lojas_midias, lojas_midias_etiquetas
    catalogo/
      index.ts  categorias.ts  produtos.ts  variacoes.ts  produtos-midias.ts
    conteudo/
      index.ts  lookbooks.ts  respostas-rapidas.ts  base-conhecimento.ts
    campanhas.ts           campanhas, campanhas_destinatarios
    negocios.ts            negocios
    pedidos/
      index.ts  numeracao.ts  pedidos.ts  itens.ts  pagamentos.ts
    devolucoes.ts          pedidos_devolucoes, pedidos_devolucoes_itens, pedidos_devolucoes_midias
    lgpd.ts                consentimentos, lgpd_solicitacoes, pesquisas_satisfacao
    index.ts               barril: uma linha de reexport por arquivo, ordem alfabética, "não reordenar"
  consultas.ts             vivos(), vivosE(), travaDeColisao(), marcaDeExclusao(), condicaoDeLoja()
  mutacoes.ts              inserirAuditado(), atualizarComTrava(), excluirLogico(),
                           atualizarContador(), atualizarEstado()
  migrations/              drizzle-kit generate + SQL manual
```

`schema/index.ts` é o barril que o Drizzle **e** o Better Auth consomem. Nasce completo no commit 0, uma linha por arquivo, em ordem alfabética, com o comentário `// não reordenar: merge de pacotes diferentes toca linhas diferentes`.

---

## 3. Helpers compartilhados (definição única e literal)

Este é o **único** lugar onde `_compartilhado.ts` está escrito. `03-arquitetura.md §6.2` cita esta definição; a versão com `$onUpdate` daquele rascunho está **rejeitada** (§15, R-02).

```ts
// src/lib/db/schema/_compartilhado.ts
import { boolean, date, numeric, timestamp, uuid } from "drizzle-orm/pg-core";

/** precisão 3 = milissegundo, igual ao Date do JS: a trava por updated_at compara exato. */
export const instante = (nome: string) =>
  timestamp(nome, { precision: 3, withTimezone: true, mode: "date" });

/** data pura (aniversário, previsão): sem hora, sem fuso, sem deslocamento de um dia. */
export const dataPura = (nome: string) => date(nome, { mode: "string" });

/** dinheiro: numeric(12,2), modo string. NUNCA mode:"number" (ponto flutuante). */
export const dinheiro = (nome: string) => numeric(nome, { precision: 12, scale: 2 });

export const colunasAuditoria = {
  created_at: instante("created_at").notNull().defaultNow(),
  updated_at: instante("updated_at").notNull().defaultNow(),
  deleted_at: instante("deleted_at"),
  is_deleted: boolean("is_deleted").notNull().default(false),
  modified_by: uuid("modified_by"), // FK declarada em SQL na migração 0016 (§4.6)
};
```

**Por que `updated_at` não tem `$onUpdate`**: `$onUpdate` dispara em **todo** `UPDATE`, inclusive no de contador (`nao_lidas`, `ultima_mensagem_em`). Com ele, o `updated_at` que a tela levou no campo oculto envelhece a cada mensagem que chega e toda edição legítima devolve "Registro alterado por outro usuário". O `updated_at` é escrito **explicitamente** por `atualizarComTrava()` e `inserirAuditado()`; contador e máquina de estado de sistema **não o tocam** (§4.7).

Restrições do auditor que **obrigam** essa forma exata (`08/§3.3`, `scripts/check-compliance.mjs:130-140,207-215`):
- `export const colunasAuditoria = {` sem anotação de tipo entre o nome e o `=`;
- importado **sem alias** e espalhado como `...colunasAuditoria`;
- as 4 strings `"created_at" | "updated_at" | "deleted_at" | "is_deleted"` precisam aparecer literalmente → **toda coluna é nomeada explicitamente**, nunca `casing: "snake_case"`;
- `pgTable("nome", { ... }, (t) => [ ... ])` — 2º argumento objeto literal (callback escapa da checagem), 3º argumento **array** (Drizzle 0.45);
- marcador de exceção é um comentário com a string literal, **nos 600 caracteres acima** do `pgTable` (`check-compliance.mjs:212`), com justificativa escrita ao lado.

Propriedade TS = nome da coluna (snake_case) em **todas** as tabelas.

```ts
// src/lib/db/consultas.ts — nomes que o auditor já reconhece (08/§3.4)
import type { EscopoLoja } from "@/lib/auth/loja";   // import de TIPO: não cria ciclo

export const vivos = (t) => eq(t.is_deleted, false);
export const vivosE = (t, ...c) => and(vivos(t), ...c);
export const travaDeColisao = (t, id: string, updatedAtOriginal: Date) =>
  and(eq(t.id, id), eq(t.updated_at, updatedAtOriginal), vivos(t));
export const marcaDeExclusao = (usuarioId: string) =>
  ({ is_deleted: true, deleted_at: new Date(), updated_at: new Date(), modified_by: usuarioId });

/** usado por TODA consulta de tabela com loja_id. `nenhuma` devolve SQL falso (fail-closed). */
export const condicaoDeLoja = (t, escopo: EscopoLoja) =>
  escopo.tipo === "todas"  ? undefined
: escopo.tipo === "uma"    ? eq(t.loja_id, escopo.lojaId)
:                            sql`false`;
```

`mutacoes.ts` é o **único** arquivo com `.insert(` / `.update(` sobre tabela de domínio:

```ts
inserirAuditado(tx, tabela, dados, ctx, acao)
atualizarComTrava(tx, tabela, { id, escopo, updatedAtOriginal, dados }, ctx, acao)
excluirLogico(tx, tabela, { id, escopo, updatedAtOriginal }, ctx, acao)
atualizarContador(tx, tabela, { id, escopo }, incrementos)   // só pares de CONTADORES (§4.7)
atualizarEstado(tx, tabela, { id, escopo }, novoEstado)      // só pares de ESTADOS_DE_SISTEMA (§4.7)
```

---

## 4. Convenções fechadas

### 4.1 Timestamps — `timestamptz(3)`, `mode: "date"`

- `precision: 3` porque o padrão do Postgres é microssegundo e o `Date` do JS é milissegundo: `eq(updated_at, original)` nunca bateria e o optimistic locking falharia em silêncio (`07/REQ-K5`).
- `withTimezone: true` porque expiração (sessão, convite, reset) é comparada no SQL contra `now()`.
- `mode: "date"` porque a trava e a auditoria comparam `Date`.
- **Servidor e banco em UTC.** Agrupamento por dia/mês de negócio converte para `America/Sao_Paulo` na consulta (`AT TIME ZONE 'America/Sao_Paulo'`) — corrige `02/O-09`.
- Trava T19: `timestamp(` no schema sem `precision: 3` e `withTimezone: true` reprova.

### 4.2 Ids — `uuid` em tudo

`uuid("id").primaryKey().defaultRandom()`, inclusive nas tabelas do Better Auth (`advanced.database.generateId: "uuid"`).
Exceções (texto, porque o valor é de terceiro): `usuarios_sessoes.token`, `usuarios_passkeys.credential_id`, `lojas_integracoes.referencia_externa`, `conversas_mensagens.externo_id`, `pagamentos.externo_id`, `pedidos.masc_venda_id`.
Exceção estrutural: `pedidos_numeracao` tem PK composta `(loja_id, ano_mes)` — é contador, não entidade (§ parte 2, 6.2; ADR 0019).

### 4.3 Quatro categorias de tabela

| Categoria | Tabelas | Marcador | Colunas | Quem apaga fisicamente |
|---|---|---|---|---|
| Domínio e plataforma | 40 | — | 5 de auditoria | ninguém |
| Trilha | `auth_eventos`, `auditoria_eventos`, `consentimentos`, `usuarios_senhas_historico` | `compliance:append-only` | só `criado_em` | ninguém |
| Framework Better Auth | `usuarios_sessoes`, `usuarios_verificacoes`, `usuarios_totp`, `usuarios_passkeys` | `compliance:framework` | `created_at`/`updated_at` onde o BA exige | **a biblioteca**, por dentro |
| Diário de ingestão | `lojas_integracoes_eventos` | — (tabela normal) | 5 de auditoria | ninguém (§6.4) |

**Better Auth × soft delete, resolvido** (ADR 0008): o BA apaga fisicamente sessão, verificação, fator e passkey, e não há opção nativa de soft delete. Não colocamos as 5 colunas nessas 4 tabelas só para passar no auditor — `is_deleted = false` numa linha que vai sumir é mentira gravada no banco. A prova do ciclo de vida vive em `auth_eventos`, gravada **antes** do delete (`databaseHooks.session.delete.before`, armadilha G25). `usuarios` e `usuarios_contas` **têm** as 5 colunas e **nunca** são apagados (`/delete-user` desligado, plugin `admin` não registrado, desativar = `ativo = false` + revogar sessões — `06/INV-33`).

**O marcador `compliance:framework` (decisão fechada, era a pendência 8 do rascunho)**: o projeto **não espera** a mudança na ferramenta compartilhada. No commit 0, `scripts/check-compliance.mjs` do repositório novo nasce como a versão da base **mais** o marcador `compliance:framework` (mesma mecânica do `append-only`, ~3 linhas: uma constante e uma cláusula na janela de 600 caracteres de `check-compliance.mjs:212`), e `tests/check-compliance.test.mjs` ganha **dois** casos: aceita a tabela marcada, continua acusando a não marcada. O PR para a estrutura base é aberto depois, sem bloquear ninguém. `03-arquitetura.md §6.2 item 7` fala em 2 tabelas: o correto são as **4** da linha "Framework" acima.

### 4.4 Enums — `text` + `CHECK`, não `pgEnum`

```ts
// src/lib/db/schema/_enums/conversas.ts
export const STATUS_CONVERSA = ["aberta", "pendente", "resolvida", "arquivada"] as const;
export type StatusConversa = (typeof STATUS_CONVERSA)[number];

// src/lib/db/schema/_enums/index.ts
import type { PgColumn } from "drizzle-orm/pg-core";
/** referência REAL de coluna: renomear a coluna quebra no build, não na migração. */
export const emLista = (coluna: PgColumn, valores: readonly string[]) =>
  sql`${coluna} in ${valores}`;
```

A mesma constante alimenta o `CHECK`, o `z.enum()` do validador e o rótulo da UI. **Divisão de papéis**: `_enums/*` guarda os **valores**; `src/lib/ui/tons.ts` guarda **rótulo PT-BR + tom** e **importa** os valores de `_enums` — nunca redigita a lista. `selo-status.tsx` é o único componente que renderiza esse par.

Motivo de não usar `pgEnum`: remover/renomear valor de tipo enum do Postgres é migração destrutiva; com `CHECK` é `DROP CONSTRAINT / ADD CONSTRAINT`. ADR 0010.

**Trava obrigatória** (`tests/integracao/enums-check.test.ts`): lê `pg_constraint` do banco de teste e compara, constraint a constraint, a lista do `CHECK` com a constante TS correspondente. Lista fechada só é segura quando as duas pontas vêm da mesma constante.

### 4.5 Dinheiro

`numeric(12,2)`, modo string (padrão do Drizzle). Proibido `mode: "number"` e proibido `number` em Zod para valor monetário (`02/O-05`).

- Entrada validada como string `^\d{1,10}(\.\d{1,2})?$`; conversão para **centavos inteiros** para qualquer soma, e volta para string na gravação.
- **Um módulo só**: `src/lib/formato.ts` (moeda, data, hora, telefone, **e** a aritmética em centavos). `lib/formatar.ts` e `lib/dinheiro.ts` dos rascunhos **não existem**.
- **Unidade que atravessa a fronteira**: o DTO leva **string** `"1234.56"`, igual ao banco. Centavos vivem **dentro** de `formato.ts`. O componente é `<Dinheiro valor="1234.56" />`.
- Somas e relatórios em SQL (`sum(total)`), exato em `numeric`. Todo valor tem `CHECK (coluna >= 0)`.

### 4.6 FK e índices

- **Toda** FK declara `{ onDelete: "restrict", onUpdate: "restrict" }`, explícito (o auditor só acusa `cascade`, `08/§6.1 A2`).
- **`modified_by` tem FK**, declarada em **SQL puro** na migração `0016_integridade` (`ALTER TABLE <t> ADD CONSTRAINT fk_<t>_modified_by FOREIGN KEY (modified_by) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT`), nas 40 tabelas. Motivo de ser SQL e não TS: `.references()` em `_compartilhado.ts` criaria ciclo de import com `usuarios.ts`; a constraint não precisa existir no schema TS para valer no banco, e o drizzle-kit não a remove (o diff sai do snapshot dele, não de introspecção). Isso **elimina** o desvio "40 tabelas com `modified_by` sem FK" do rascunho.
- **FK composta `(id, loja_id)`** — o `loja_id` redundante (princípio 4) só fecha o vazamento se o filho não puder apontar para pai de outra loja. O pai ganha `UNIQUE (id, loja_id)` (custo zero, já tem PK) e o filho ganha a FK composta. Aplicada em, e só em, estes pares (migração `0016`):

  | Filho | Pai |
  |---|---|
  | `conversas (contato_id, loja_id)` | `contatos (id, loja_id)` |
  | `conversas (integracao_id, loja_id)` | `lojas_integracoes (id, loja_id)` * |
  | `conversas_mensagens (conversa_id, loja_id)` | `conversas (id, loja_id)` |
  | `conversas_mensagens_midias (mensagem_id, loja_id)` | `conversas_mensagens (id, loja_id)` |
  | `conversas_agendamentos (contato_id, loja_id)` | `contatos (id, loja_id)` |
  | `pedidos (contato_id, loja_id)` | `contatos (id, loja_id)` |
  | `pedidos_itens (pedido_id, loja_id)` | `pedidos (id, loja_id)` |
  | `pagamentos (pedido_id, loja_id)` | `pedidos (id, loja_id)` |
  | `pedidos_devolucoes (pedido_id, loja_id)` | `pedidos (id, loja_id)` |
  | `pedidos_devolucoes_itens (devolucao_id, loja_id)` | `pedidos_devolucoes (id, loja_id)` |
  | `campanhas_destinatarios (campanha_id, loja_id)` | `campanhas (id, loja_id)` |
  | `campanhas_destinatarios (contato_id, loja_id)` | `contatos (id, loja_id)` |
  | `produtos_midias (produto_id, loja_id)` | `produtos (id, loja_id)` |
  | `produtos_midias (midia_id, loja_id)` | `lojas_midias (id, loja_id)` |
  | `produtos_variacoes (produto_id, loja_id)` | `produtos (id, loja_id)` |
  | `negocios (contato_id, loja_id)` | `contatos (id, loja_id)` |

  \* `lojas_integracoes.loja_id` é nulo para a conta de rede (Bling); a FK composta é `MATCH SIMPLE`, que não dispara com coluna nula, e o CHECK de §6.3 garante que **canal** nunca tem loja nula.
- Exceção escrita (ADR 0012, título: *"Trilhas append-only sem FK"*): `auth_eventos`, `auditoria_eventos` e `consentimentos` **não têm FK nenhuma** — precisam sobreviver à anonimização LGPD e a qualquer ordem de gravação, e FK em tabela de alto volume é custo puro. Compensação: `tests/integracao/integridade-trilha.test.ts` confere periodicamente ator/alvo órfãos.
- Índices mínimos por tabela de domínio: `(loja_id)` e `(loja_id, is_deleted)`, mais os listados em cada tabela.
- **Índice único parcial**: o predicado do `.where()` usa **somente template `sql` cru com literais** (`sql\`is_deleted = false\``), **nunca** `eq()`/`inArray()`. Motivo: bug conhecido e reincidente do drizzle-kit (issues drizzle-orm #3349, #2506, #560; drizzle-kit-mirror #461) — predicado construído com helpers sai na migração como `WHERE "t"."active" = $1` e falha ao aplicar. Trava de CI: `grep -n "= \$" src/lib/db/migrations/` tem de vir vazio (ADR 0009).

### 4.7 Optimistic locking — trava por padrão, exceção por lista

**Regra invertida em relação ao rascunho**: **toda** tabela de domínio com as 5 colunas é atualizada por `atualizarComTrava(t, id, updated_at)`; zero linhas devolvidas = `ErroDeColisao` ("Registro alterado por outro usuário. Recarregue e tente novamente."). O `updated_at` vai à tela em campo oculto e volta validado por `z.coerce.date()`.

**Lista fechada de exceções** (e o motivo de cada uma):

| Exceção | Tabelas | Motivo |
|---|---|---|
| Ligação pura (só cria/exclui, nunca edita) | `contatos_etiquetas`, `lojas_midias_etiquetas`, `produtos_midias`, `lookbooks_midias`, `lookbooks_produtos`, `base_conhecimento_artigos_etiquetas`, `pedidos_devolucoes_itens`, `pedidos_devolucoes_midias`, `conversas_mensagens_midias` | não há duas pessoas editando o mesmo vínculo; o único parcial já resolve a corrida |
| Linha escrita uma vez + estado de sistema | `conversas_mensagens`, `campanhas_destinatarios`, `lojas_integracoes_eventos` | quem muda o estado é o provedor/worker, não uma pessoa; usa `atualizarEstado()` (monotônico) |
| Contador de sistema | `pedidos_numeracao` | `UPDATE ... RETURNING` atômico é a própria trava |
| Trilha | 4 tabelas append-only | não se atualiza |

**Contadores e caches — relógio separado do relógio da trava.** `atualizarContador()` **nunca** escreve `updated_at`, `modified_by` nem grava trilha, e só aceita pares desta lista fechada (constante `CONTADORES`, lida também pela trava de fonte):

| Tabela | Colunas de contador/cache |
|---|---|
| `conversas` | `ultima_mensagem_em`, `ultima_mensagem_previa`, `ultima_entrada_em`, `nao_lidas`, `primeira_resposta_em`, `sla_estourado_em` |
| `contatos` | `ultimo_contato_em`, `ultima_compra_em`, `pedidos_contagem`, `pedidos_valor_total` |
| `negocios` | `ultima_atividade_em` |
| `lojas_integracoes` | `ultima_sincronizacao`, `ultimo_erro` |

`atualizarEstado()` só aceita a constante `ESTADOS_DE_SISTEMA`: `conversas_mensagens.status_entrega` (+ `status_atualizado_em`, `falha_motivo`), `campanhas_destinatarios.status` (+ carimbos), `lojas_integracoes_eventos.(tipo, processado_em, erro, corpo, cabecalhos)`.

**Travas de fonte**: (a) `.insert(`/`.update(` fora de `mutacoes.ts` reprova; (b) `atualizarContador`/`atualizarEstado` chamados com par fora das constantes reprovam em tempo de execução **e** no teste de fonte; (c) `db.delete(`, `.deleteMany(`, `tx.delete(` ou `DELETE FROM` em qualquer lugar do repositório reprova (T25).

### 4.8 JSON

Nenhuma coluna `jsonb` sem `.$type<T>()` e sem schema Zod no ponto de escrita. Lista completa na §10.

---

## 5. Bloco 1 — Autenticação e conta (9 tabelas)

### 5.1 `usuarios` (BA `user`)

| Coluna | Tipo Drizzle | Nulo | Default | Nota |
|---|---|---|---|---|
| id | `uuid` PK | não | `defaultRandom()` | |
| nome | `text` | não | | BA `name` |
| email | `text` | não | | normalizado `trim().toLowerCase()` na escrita |
| email_verificado | `boolean` | não | `false` | BA `emailVerified`; convite grava `true` |
| avatar_url | `text` | sim | | BA `image` |
| papel | `text` | não | `'viewer'` | CHECK de **5 papéis** (abaixo) |
| loja_id | `uuid` → `lojas.id` restrict | sim | | |
| ativo | `boolean` | não | `false` | nasce inativo; só vira `true` com 2º fator (`07/REQ-D1`) |
| precisa_trocar_senha | `boolean` | não | `false` | |
| precisa_configurar_fator | `boolean` | não | `true` | |
| two_factor_enabled | `boolean` | não | `false` | exigido pelo plugin twoFactor |
| falhas_login | `integer` | não | `0` | bloqueio por conta (`07/REQ-C1`) |
| ultima_falha_em | `timestamptz(3)` | sim | | |
| bloqueado_ate | `timestamptz(3)` | sim | | |
| ultimo_login_em | `timestamptz(3)` | sim | | |
| anonimizado_em | `timestamptz(3)` | sim | | LGPD de colaborador |
| ...colunasAuditoria | | | | `created_at`/`updated_at` mapeados para `createdAt`/`updatedAt` |

**`email_pendente` não existe** (era espelho do que `usuarios_trocas_email` já guarda; duas fontes divergem no primeiro erro de fluxo). "Troca de e-mail em andamento" = existe linha em `usuarios_trocas_email` com `confirmado_em IS NULL AND cancelado_em IS NULL AND expira_em > now()`.

- CHECK `usuarios_papel_loja` (migração, `06/INV-14`):
  ```sql
  CHECK (
    papel IN ('dono','admin','gerente','vendedor','viewer') AND (
      (papel IN ('dono','admin','gerente') AND loja_id IS NULL) OR
      (papel IN ('vendedor','viewer')      AND loja_id IS NOT NULL)
    )
  )
  ```
- CHECK `usuarios_bloqueio_coerente`: `falhas_login >= 0`.
- **Únicos**: `uniqueIndex().on(sql\`lower(email)\`)` — **TOTAL, sem `WHERE is_deleted = false`**. Exceção escrita à regra 5 do §1: `usuarios` nunca é soft-deletado (`06/INV-33`), e o Better Auth busca `user` por e-mail **sem** filtrar `is_deleted` — um único parcial deixaria duas linhas com o mesmo e-mail e o `findOne` resolveria para a errada.
- Índices: `(loja_id, papel)`, `(ativo)`.
- Papel/loja/`ativo` entram no BA como `additionalFields` com `input: false`.

### 5.2 `usuarios_contas` (BA `account`)

`id uuid PK`, `usuario_id uuid NOT NULL → usuarios.id restrict`, `conta_id text NOT NULL` (BA `accountId`), `provedor_id text NOT NULL` (BA `providerId`, sempre `'credential'`), `senha_hash text` (Argon2id), e — obrigatórias pelo schema do BA mesmo sem login social — `access_token`, `refresh_token`, `id_token`, `access_token_expira_em`, `refresh_token_expira_em`, `escopo`, todas nulas; `...colunasAuditoria`.
Único `(provedor_id, conta_id)` **TOTAL** (mesmo motivo de `usuarios`). Índice `(usuario_id)`. `accountLinking.enabled: false`.

### 5.3 `usuarios_sessoes` (BA `session`) — `compliance:framework`

`id uuid PK`, `token text NOT NULL` (único), `usuario_id uuid NOT NULL → usuarios restrict`, `expira_em timestamptz(3) NOT NULL`, `ip text`, `agente text`, `ultimo_uso_em timestamptz(3)` (inatividade 60 min), `reautenticada_em timestamptz(3)` (frescor), `created_at`, `updated_at`.
Índices: `unique(token)`, `(usuario_id)`, `(expira_em)`. A trilha grava `sessao_encerrada` **antes** do delete da biblioteca (G25).

### 5.4 `usuarios_verificacoes` (BA `verification`) — `compliance:framework`

`id uuid PK`, `identificador text NOT NULL` (hash — `storeIdentifier: "hashed"`), `valor text NOT NULL`, `expira_em timestamptz(3) NOT NULL`, `created_at`, `updated_at`. Índices `(identificador)`, `(expira_em)`. O valor **nunca** é espelhado na trilha.

### 5.5 `usuarios_totp` (BA `twoFactor`) — `compliance:framework`

`id uuid PK`, `usuario_id → usuarios restrict`, `secret text NOT NULL` (cifrado pelo BA), `backup_codes text NOT NULL DEFAULT '[]'` (sempre vazio — G4), `ultimo_passo_totp bigint` (anti-replay), `created_at`. Índice `(usuario_id)`.

### 5.6 `usuarios_passkeys` (BA `passkey`) — `compliance:framework`

`id uuid PK`, `usuario_id → usuarios restrict`, `nome text`, `chave_publica text NOT NULL`, `credential_id text NOT NULL` (único), `contador integer NOT NULL DEFAULT 0`, `tipo_dispositivo text`, `backed_up boolean`, `transportes text`, `aaguid text`, `created_at`. Índices: `unique(credential_id)`, `(usuario_id)`.

### 5.7 `usuarios_convites`

`id uuid PK`, `email text NOT NULL`, `papel text NOT NULL`, `loja_id uuid → lojas restrict`, `token_hash text NOT NULL` (SHA-256 de 32 bytes CSPRNG; único parcial), `expira_em timestamptz(3) NOT NULL`, `usado_em`, `usado_por_usuario_id uuid → usuarios restrict`, `criado_por uuid → usuarios restrict` (**nulo só quando `bootstrap = true`**), `ciencia_versao text`, `bootstrap boolean NOT NULL DEFAULT false`, `motivo text`, `...colunasAuditoria`.

- **CHECK `convites_papel` (próprio, NÃO é cópia do de `usuarios`)**: `papel IN ('admin','gerente','vendedor','viewer')` — **`dono` não é convidável**; posse só se transfere (`02/§9.2`). A barreira é do banco, não da action: `INSERT` direto com papel `dono` viola o CHECK.
- CHECK `convites_papel_loja`: mesma regra papel × loja de `usuarios`, sem `dono`.
- CHECK `convites_ciencia_admin`: `(papel <> 'admin') OR (ciencia_versao IS NOT NULL)` — convite de admin sem ciência registrada não entra.
- CHECK `convites_bootstrap`: `(bootstrap = false) OR (papel = 'admin' AND loja_id IS NULL AND criado_por IS NULL)`.
- Único parcial: `lower(email)` `WHERE usado_em IS NULL AND is_deleted = false`; **único parcial** `(bootstrap) WHERE bootstrap = true AND usado_em IS NULL AND is_deleted = false` — no máximo um convite de semeadura vivo.
- Consumo atômico: `UPDATE usuarios_convites SET usado_em = now() WHERE token_hash = $1 AND usado_em IS NULL AND expira_em > now() RETURNING *`.
- **Semeadura do primeiro dono** (fecha a contradição dos rascunhos): `scripts/primeiro-dono.ts` roda só se `count(*) FROM usuarios WHERE papel = 'dono' AND is_deleted = false` for 0, emite um convite `bootstrap = true, papel = 'admin'`, imprime o link uma vez e grava `auth_eventos` (`dono_semeado`, `ator_tipo = 'sistema'`). No consumo, **dentro da mesma transação**, se o convite é `bootstrap` **e** `count(dono ativo) = 0`, o usuário criado nasce com `papel = 'dono'`. É o único caminho que cria um dono sem outro dono, é auditado e só funciona uma vez. `scripts/primeiro-admin.ts` de `03-arquitetura.md §3/§16` **não existe**; o script do `package.json` é `"primeiro-dono": "tsx scripts/primeiro-dono.ts"`.

### 5.8 `usuarios_senhas_historico` — `compliance:append-only`

`id uuid PK`, `usuario_id uuid NOT NULL`, `senha_hash text NOT NULL`, `criado_em timestamptz(3) NOT NULL DEFAULT now()`. Índice `(usuario_id, criado_em DESC)`.
A política **compara contra as 5 mais recentes** (`ORDER BY criado_em DESC LIMIT 5`); leitura fail-closed. **A tabela não é podada** — podar exigiria `DELETE`, que é proibido. Uma linha de ~100 bytes por troca de senha é crescimento aceitável e escrito.

### 5.9 `usuarios_trocas_email`

`id uuid PK`, `usuario_id → usuarios restrict`, `email_novo text NOT NULL`, `codigo_hash text NOT NULL`, `expira_em timestamptz(3) NOT NULL`, `tentativas integer NOT NULL DEFAULT 0`, `confirmado_em`, `cancelado_em`, `cancelado_motivo text`, `solicitado_por uuid NOT NULL → usuarios restrict`, `motivo text NOT NULL`, `...colunasAuditoria`.
Índice `(usuario_id, created_at DESC)`. **Único parcial** `(usuario_id) WHERE confirmado_em IS NULL AND cancelado_em IS NULL AND is_deleted = false` — uma troca aberta por usuário. Só admin inicia; o próprio usuário confirma (`07/REQ-E12`).

### 5.10 De-para Better Auth → coluna (FONTE ÚNICA)

A 1.7 valida o schema no boot: divergência derruba **todo** `/api/auth/**` (`07/G27`). Por isso o de-para vive numa constante só, e o `auth.ts` é montado a partir dela — nenhum dos dois documentos redigita nome de coluna.

```ts
// src/lib/db/schema/_ba-fields.ts  — importado por auth.ts e pelo teste T4
export const CAMPOS_BA = {
  user: { modelName: "usuarios", fields: {
    name: "nome", email: "email", emailVerified: "email_verificado", image: "avatar_url",
    createdAt: "created_at", updatedAt: "updated_at" } },
  account: { modelName: "usuarios_contas", fields: {
    userId: "usuario_id", accountId: "conta_id", providerId: "provedor_id", password: `senha_hash`,
    accessToken: "access_token", refreshToken: "refresh_token", idToken: "id_token",
    accessTokenExpiresAt: "access_token_expira_em", refreshTokenExpiresAt: "refresh_token_expira_em",
    scope: "escopo", createdAt: "created_at", updatedAt: "updated_at" } },
  session: { modelName: "usuarios_sessoes", fields: {
    userId: "usuario_id", token: "token", expiresAt: "expira_em", ipAddress: "ip",
    userAgent: "agente", createdAt: "created_at", updatedAt: "updated_at" } },
  verification: { modelName: "usuarios_verificacoes", fields: {
    identifier: "identificador", value: "valor", expiresAt: "expira_em",
    createdAt: "created_at", updatedAt: "updated_at" } },
  twoFactor: { modelName: "usuarios_totp" },
  passkey:   { modelName: "usuarios_passkeys" },
} as const;
```

O mapeamento de `02-seguranca.md §4` (`image: "avatar_url"` ✔, `providerId: "provedor"` ✘, `accountId: "conta_externa_id"` ✘, `password` → `senha_hash` ✔) fica **substituído** por esta constante.

**Trava T4 (caso novo)**: o teste importa `CAMPOS_BA` e `getTableColumns()` de cada tabela e reprova se algum valor do de-para não for um nome de coluna existente — a divergência aparece no CI, não no boot de produção.

### 5.11 Sem tabela de rate limit

O limitador é Redis (`INCR` + `EXPIRE NX`), plugado como `rateLimit.customStorage`. A tabela `rateLimit` do BA **não é criada**. O bloqueio por **conta** não é tabela: são as colunas `falhas_login`/`ultima_falha_em`/`bloqueado_ate` em `usuarios`, atualizadas em **um** `UPDATE` condicional (`07/REQ-C1`).

---

## 6. Bloco 2 — Plataforma (6 tabelas)

### 6.1 `lojas`

`id uuid PK`, `nome text NOT NULL`, `slug text NOT NULL`, `sigla text NOT NULL` (3 letras, **cadastrada**, não derivada do nome — corrige `06/D-19`), `bling_deposito_id text`, `...colunasAuditoria`.
- CHECK `lojas_sigla_formato`: `sigla ~ '^[A-Z]{3}$'`.
- Únicos parciais (`is_deleted = false`): `lower(slug)`, `sigla`.
- **Sem coluna `ativo`**: duplicava `is_deleted`. Onde `02-seguranca.md §2.3` diz "loja existe e está **ativa**", leia-se `is_deleted = false`.

### 6.2 `lojas_etiquetas`

`id uuid PK`, `loja_id uuid NOT NULL → lojas restrict`, `nome text NOT NULL`, `slug text NOT NULL`, `cor text` (CHECK `^#[0-9a-f]{6}$`), `...colunasAuditoria`. Único parcial `(loja_id, slug) WHERE is_deleted = false`.
Substitui `contacts.tags text[]`, `media_files.tags text[]` e `knowledge_articles.tags text[]`. Etiqueta decide audiência de campanha (`02/RN-CT8`) — com `text[]` não havia normalização nem FK.

### 6.3 `lojas_integracoes`

Uma linha por **conta conectada** (N números de WhatsApp por loja).

| Coluna | Tipo | Nulo | Nota |
|---|---|---|---|
| id | uuid PK | não | |
| loja_id | uuid → lojas restrict | **sim** | nulo = conta da rede (hoje só Bling) |
| provedor | text | não | CHECK `IN ('whatsapp_oficial','uazapi','instagram','facebook','tiktok_shop','bling')` |
| rotulo | text | não | "WhatsApp Vendas Centro" — aparece na inbox (`01/D-37`) |
| status | text | não | CHECK `IN ('desconectado','conectado','expirado','erro')`, default `'desconectado'` |
| credenciais_cifradas | text | sim | envelope `v1:<iv>:<tag>:<cifrado>` (AES-256-GCM) |
| credenciais_aad | text | sim | = `id` da linha, AAD do GCM (`04/S28`) |
| referencia_externa | text | sim | chave de roteamento do webhook |
| segredo_webhook_hash | text | sim | SHA-256 do segredo **por integração** (`01/D-12`) |
| expira_em / ultimo_erro / ultima_sincronizacao / revogada_em | | sim | |
| ...colunasAuditoria | | | |

- **CHECK `integracoes_rede`** (corrigido — o do rascunho só fechava um lado):
  ```sql
  CHECK ((provedor = 'bling') = (loja_id IS NULL))
  ```
  Assim **canal sem loja é impossível no banco**, e a regra de aplicação vira defesa em profundidade, não a única.
- Único parcial: `(provedor, referencia_externa) WHERE referencia_externa IS NOT NULL AND is_deleted = false` (corrige `04/F01`).
- Índices: `(loja_id, provedor)`, `(provedor, status)`. Único `(id, loja_id)` para as FKs compostas.
- Regra de aplicação: evento de canal só é aceito se `status <> 'erro'`; senão descarta com registro (`06/INV-53`).

### 6.4 `lojas_integracoes_eventos` — diário de ingestão (tabela normal, 5 colunas)

`id uuid PK`, `provedor text NOT NULL`, `integracao_id uuid` (nulo quando não resolvida), `loja_id uuid`, `tipo text NOT NULL` CHECK `IN ('recebido','recusado','descartado','processado','falhou')`, `evento_externo_id text`, `assinatura_ok boolean NOT NULL`, `ip text`, `corpo jsonb NOT NULL`, `cabecalhos jsonb NOT NULL DEFAULT '{}'` (lista branca; nunca `authorization`), `erro text`, `processado_em timestamptz(3)`, `...colunasAuditoria`.

**Mudança em relação ao rascunho, e o motivo**: o rascunho marcava a tabela `compliance:append-only` e dava `REVOKE UPDATE` ao papel da aplicação — **e mesmo assim tinha coluna `processado_em`**, que só existe para ser escrita depois. Além disso a retenção era um `DELETE` físico, proibido pela regra da casa, bloqueado por `.claude/hooks/pre-write-guard.mjs` e reprovado pela trava T25. Decisão fechada:

- A tabela é um **diário de ingestão**, não uma trilha. Tem as 5 colunas de auditoria, nenhum marcador, e **nenhum `DELETE`** — nem da app, nem de job, nem de papel de manutenção. Ninguém a soft-deleta: o `is_deleted` fica `false` para sempre.
- A app escreve por **uma** função (`registrarProcessamentoEvento()`, via `atualizarEstado()`), que só toca `tipo`, `processado_em`, `erro`, `corpo` e `cabecalhos`.
- **PII tem prazo curto, não 30 dias**: assim que o evento é processado com sucesso, o **mesmo** `UPDATE` que grava `processado_em` substitui `corpo` pela projeção mascarada (`{ "mascarado": true, "tipo": …, "externo_id": …, "telefone_final": "…0000", "tamanho_texto": 38 }`). O corpo cru inteiro só sobrevive enquanto `processado_em IS NULL` ou `tipo = 'falhou'` — que é exatamente quando ele serve de prova para depurar.
- **Retenção de 30 dias por anonimização**: job diário `retencao-eventos` (fila `manutencao`) faz `UPDATE ... SET corpo = '{"anonimizado":true}', cabecalhos = '{}', ip = NULL WHERE created_at < now() - interval '30 days' AND corpo <> '{"anonimizado":true}'`. Nenhuma linha some; a idempotência por `evento_externo_id` continua valendo para sempre.
- Único parcial: `(provedor, evento_externo_id) WHERE evento_externo_id IS NOT NULL` → idempotência da ingestão (`06/INV-139`). Índices: `(created_at)`, `(integracao_id, created_at)`, `(tipo, created_at)`.

### 6.5 `lojas_integracoes_templates`

`id uuid PK`, `loja_id uuid NOT NULL → lojas restrict`, `integracao_id uuid NOT NULL → lojas_integracoes restrict`, `nome text NOT NULL` (CHECK `^[a-z0-9_]{1,512}$`), `categoria text NOT NULL` CHECK `IN ('marketing','utility','authentication')`, `idioma text NOT NULL DEFAULT 'pt_BR'`, `cabecalho_tipo text` CHECK `IN ('texto','imagem','video','documento')`, `cabecalho_conteudo text`, `corpo text NOT NULL`, `rodape text`, `botoes jsonb NOT NULL DEFAULT '[]'`, `variaveis_contagem integer NOT NULL DEFAULT 0` (extraído de `{{n}}` — corrige `03/10.7.9`), `meta_template_id text`, `status text NOT NULL DEFAULT 'rascunho'` CHECK `IN ('rascunho','enviado','aprovado','rejeitado','pausado')`, `motivo_rejeicao text`, `enviado_em`, `aprovado_em`, `...colunasAuditoria`.
Único parcial `(integracao_id, nome, idioma) WHERE is_deleted = false`. Índice `(loja_id, status)`. **Com trava de colisão** (é editado por gerente e admin).

### 6.6 `alertas`

`id uuid PK`, `loja_id uuid NOT NULL → lojas restrict`, `tipo text NOT NULL` CHECK `IN ('sla_estourado','risco_avaliacao','negocio_parado','pagamento_pendente','primeiro_contato','cliente_retornando','follow_up_atrasado','sessao_uazapi_caiu','integracao_com_erro')`, `severidade text NOT NULL` CHECK `IN ('baixa','media','alta','critica')`, `mensagem text NOT NULL`, `conversa_id`, `contato_id`, `pedido_id`, `negocio_id` (todos uuid, FK restrict), `chave_deduplicacao text NOT NULL`, `reconhecido_por uuid → usuarios restrict`, `reconhecido_em`, `resolvido_em`, `...colunasAuditoria`.
- Único parcial: `(loja_id, chave_deduplicacao) WHERE resolvido_em IS NULL AND is_deleted = false` (corrige `04/F05`).
- Índices: `(loja_id, reconhecido_em, created_at DESC)`, `(loja_id, tipo)`. **Com trava de colisão** (duas pessoas reconhecem ao mesmo tempo).
- **Quem escreve `resolvido_em`: o gerador, nunca a pessoa.** O job `gerar-alertas` reavalia a condição de cada alerta aberto e carimba `resolvido_em` quando ela deixa de valer (conversa respondida, integração reconectada, pedido lançado). A pessoa só **reconhece** (`reconhecido_por`/`reconhecido_em`). É isso que mantém a dedupe honesta e conserta de verdade `04/F05` — alerta reconhecido que volta.
- **Sem tabela de configuração de SLA** nesta entrega: o SLA por canal é constante no código (5/15/30/60 min). A tela `/configuracoes/sla` **não existe** no R1 (`04-ui.md` U8: tela que o backend não sustenta não nasce).

---

## 7. Bloco 3 — Trilhas append-only (2 tabelas)

### 7.1 `auth_eventos` — `compliance:append-only`

Funil único de tudo que cria, nega ou destrói acesso (`07/§15.3`).

| Coluna | Tipo | Nulo | Nota |
|---|---|---|---|
| id | uuid PK | não | |
| criado_em | timestamptz(3) | não | `defaultNow()` |
| tipo | text | não | CHECK gerado de `TIPOS_AUTH_EVENTO` (abaixo) |
| ator_tipo | text | não | `DEFAULT 'usuario'`, CHECK `IN ('usuario','sistema','integracao')` — usado pela semeadura do dono |
| usuario_id | uuid | sim | sem FK |
| email_hash | text | sim | HMAC do e-mail (chave `AUTH_EMAIL_HASH_KEY`) |
| sessao_id | uuid | sim | |
| meio | text | sim | CHECK `IN ('senha','senha+totp','passkey','convite','reset','admin','sistema')` |
| resultado | text | não | CHECK `IN ('sucesso','falha','recusado')` |
| ip | text | sim | de `ipDoCliente()` |
| agente | text | sim | |
| ator_id | uuid | sim | quem executou, quando ≠ alvo |
| alvo_id | uuid | sim | |
| motivo | text | sim | obrigatório na aplicação em ação administrativa (zod 8–255) |
| detalhes | jsonb | não | `'{}'`, lista branca de campos (§10) |

**`TIPOS_AUTH_EVENTO`** (`_enums/auth.ts` — a mesma constante gera o `CHECK` e é usada por `registrarEventoAuth`; um teste compara as duas pontas):

`login_sucesso, senha_aceita_aguardando_2fa, login_falha, conta_bloqueada, conta_destravada, logout, sessao_criada, sessao_encerrada, reset_solicitado, reset_concluido, senha_trocada, fator_adicionado, fator_removido, passkey_adicionada, passkey_removida, papel_alterado, admin_promovido, admin_rebaixado, posse_transferida, dono_semeado, usuario_desativado, usuario_reativado, convite_emitido, convite_usado, email_trocado, recusa_403, sonda_caminho_desligado, webhook_recusado, recuperacao_assistida, limitador_indisponivel, hibp_indisponivel, email_seguranca_falhou, ip_cadeia_inesperada`

Os quatro que faltavam no rascunho e derrubavam funcionalidade — `posse_transferida` (a transferência de posse grava a trilha **fail-closed na mesma transação**: sem o tipo no CHECK, o sistema **nunca** trocaria de dono), `email_seguranca_falhou`, `ip_cadeia_inesperada` e `dono_semeado` — estão na lista.
`lgpd_anonimizado` e `integracao_conectada/desconectada` **não** são eventos de auth: vivem em `auditoria_eventos` (§7.4).
Índices: `(usuario_id, criado_em DESC)`, `(tipo, criado_em DESC)`, `(email_hash, criado_em DESC)`.

### 7.2 `auditoria_eventos` — `compliance:append-only`

Trilha de negócio. Substitui `activity_logs`, `deal_events` e `order_events`.

`id uuid PK`, `criado_em timestamptz(3) NOT NULL DEFAULT now()`, `ator_tipo text NOT NULL` CHECK `IN ('usuario','sistema','integracao')`, `ator_id uuid` (nulo só quando `ator_tipo <> 'usuario'` — CHECK), `loja_id uuid` (nulo = ação de rede), `acao text NOT NULL` (CHECK de `ACOES_AUDITADAS`, §7.4), `entidade text NOT NULL`, `entidade_id text`, `antes jsonb`, `depois jsonb`, `motivo text`, `ip text`, `agente text`, `detalhes jsonb NOT NULL DEFAULT '{}'`.

**`antes`/`depois` não guardam PII** (fecha o buraco da LGPD): para campo da lista `CAMPOS_PII` (`contatos`: `nome`, `telefone`, `email`, `whatsapp_id`, `instagram_id`, `facebook_id`, `tiktok_id`, `avatar_url`, `endereco`, `aniversario`, `observacoes`; `usuarios`: `nome`, `email`, `avatar_url`; `pedidos.endereco_entrega`; `pesquisas_satisfacao.comentario`), o diff grava **só o nome do campo**: `{ "telefone": "(alterado)" }`. Valor a valor só para campo não-PII (status, preço, papel, etapa). Filtro de segredo (`senha|password|token|secret|credencia|authorization|apikey`) em profundidade continua valendo.

Índices: `(entidade, entidade_id, criado_em DESC)` — é o que desenha a linha do tempo do pedido e do negócio; `(loja_id, criado_em DESC)`; `(ator_id, criado_em DESC)`; `(acao, criado_em DESC)`.

### 7.3 Append-only de verdade (na migração, não só no ORM)

```sql
REVOKE UPDATE, DELETE, TRUNCATE ON auth_eventos, auditoria_eventos,
  consentimentos, usuarios_senhas_historico FROM merlo_app;
CREATE OR REPLACE FUNCTION trilha_imutavel() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'trilha e append-only'; END; $$ LANGUAGE plpgsql;
-- trigger BEFORE UPDATE OR DELETE nas 4 tabelas acima, e SOMENTE nelas
```

**`lojas_integracoes_eventos` não entra nem no REVOKE nem no trigger** (§6.4): a app precisa marcar `processado_em` e mascarar o corpo. Trigger dispara por tabela, não por papel — se ele existisse ali, a própria ingestão quebraria.

Dois papéis de banco: `merlo_app` (aplicação e worker) e `merlo_migracao` (migração e backup, string em `DATABASE_URL_MIGRACAO`). O papel `merlo_manutencao` do rascunho **não existe mais** — ele só servia para o `DELETE` de retenção, que foi eliminado.

### 7.4 `ACOES_AUDITADAS` (lista fechada inicial)

`loja_criada|alterada|desativada`, `usuario_criado|alterado|desativado|reativado|papel_alterado`, `integracao_conectada|alterada|desconectada|pareada`, `conversa_resolvida|reaberta|transferida|prioridade_alterada`, `mensagem_enviada|reenviada|nota_interna`, `midia_enviada|excluida`, `contato_criado|alterado|excluido|etiqueta_alterada`, `negocio_criado|estagio_alterado|valor_alterado|excluido`, `pedido_criado|status_alterado|cancelado|lancado_masc|dispensado_masc|voltou_fila_masc`, `pagamento_gerado|confirmado|estornado`, `devolucao_criada|status_alterado|estorno_aprovado|concluida`, `campanha_criada|iniciada|pausada|concluida|excluida`, `template_enviado|aprovado|rejeitado`, `produto_sincronizado|preco_alterado`, `lgpd_exportado|lgpd_anonimizado|lgpd_solicitacao_registrada|consentimento_registrado`.

Ampliar a lista é mudança de código + migração do CHECK — de propósito.

**Política de gravação**:
- regra geral: mesma transação da mutação; falha da trilha derruba a operação;
- exceção explícita (gravar **antes** do efeito, fail-closed, na mesma transação): promoção a admin, transferência de posse, reset iniciado por admin, recuperação assistida, anonimização LGPD, dispensa do Masc;
- `auth_eventos` é o único best-effort (nunca lança, teto de 3 s) — não pode impedir alguém de entrar (`07/REQ-L3`) — **com as exceções fail-closed acima**, que gravam na transação.

---

## 8. Diagrama (parte 1)

```
                         lojas ──1:N── lojas_etiquetas
                           │
        ┌──────────────────┼───────────────────┬────────────────────┐
        │                  │                   │                    │
   usuarios            lojas_integracoes    alertas             [domínio: parte 2]
  (5 papéis, loja_id,    │  │  │            (dedup por chave;
   ativo, bloqueio)      │  │  │             gerador resolve)
        │                │  │  └── lojas_integracoes_templates ──N:1── campanhas
        │                │  └───── lojas_integracoes_eventos (diário; corpo mascarado ao processar)
        │                └──1:N─── conversas (integracao_id NOT NULL)  → parte 2
        │
        ├── usuarios_contas        (BA account; Argon2id em senha_hash)
        ├── usuarios_sessoes       (BA session; framework)
        ├── usuarios_verificacoes  (BA verification; framework)
        ├── usuarios_totp          (BA twoFactor; framework)
        ├── usuarios_passkeys      (BA passkey; framework)
        ├── usuarios_convites      (sem papel 'dono'; bootstrap p/ semear o 1º dono)
        ├── usuarios_senhas_historico (append-only, nunca podada)
        └── usuarios_trocas_email  (única troca aberta por usuário)

   auth_eventos       (append-only, SEM FK)  ← funil único de sessão/acesso
   auditoria_eventos  (append-only, SEM FK)  ← linha do tempo de pedido, negócio, conversa
```

---

## 9. Ordem de criação (migrações)

Uma migração por bloco, aditiva, gerada com `drizzle-kit generate` e **revisada à mão** (o `DROP` gerado passa despercebido pelo auditor — `08/§6.1 A7`; a pasta `migrations/` é ignorada por ele, `check-compliance.mjs:39`).

| # | Migração | Conteúdo |
|---|---|---|
| 1 | `0000_base` | papéis `merlo_app`/`merlo_migracao`, função `trilha_imutavel()` |
| 2 | `0001_lojas` | `lojas`, `lojas_etiquetas` |
| 3 | `0002_auth` | `usuarios` (FK loja), `usuarios_contas`, `usuarios_sessoes`, `usuarios_verificacoes`, `usuarios_totp`, `usuarios_passkeys` |
| 4 | `0003_auth_conta` | `usuarios_convites`, `usuarios_senhas_historico`, `usuarios_trocas_email` |
| 5 | `0004_trilhas` | `auth_eventos`, `auditoria_eventos` + REVOKE + triggers |
| 6 | `0005_integracoes` | `lojas_integracoes`, `lojas_integracoes_eventos` |
| 7 | `0006_midias` | `lojas_midias`, `lojas_midias_etiquetas` |
| 8 | `0007_contatos` | `contatos`, `contatos_etiquetas` |
| 9 | `0008_catalogo` | `produtos_categorias`, `produtos`, `produtos_variacoes`, `produtos_midias` |
| 10 | `0009_conteudo` | `lookbooks` (+2 ligações), `respostas_rapidas`, `base_conhecimento_artigos` (+ligação) |
| 11 | `0010_conversas` | `conversas`, `conversas_mensagens`, `conversas_mensagens_midias` |
| 12 | `0011_campanhas` | `lojas_integracoes_templates`, `campanhas`, `campanhas_destinatarios`, `conversas_agendamentos` |
| 13 | `0012_negocios` | `negocios` |
| 14 | `0013_pedidos` | `pedidos_numeracao`, `pedidos`, `pedidos_itens`, `pagamentos` |
| 15 | `0014_devolucoes` | `pedidos_devolucoes` (+itens, +mídias) |
| 16 | `0015_apoio` | `alertas`, `pesquisas_satisfacao`, `consentimentos`, `lgpd_solicitacoes` |
| 17 | `0016_integridade` | `UNIQUE (id, loja_id)` nos pais + **FKs compostas** (§4.6) + **FK de `modified_by`** nas 40 tabelas + GRANTs finais |

**Todas as 48 tabelas nascem nas migrações iniciais**, inclusive as de funcionalidade que fica fora do R1 (`negocios`, `lookbooks`, `base_conhecimento_artigos`, `pedidos_devolucoes*`, `pesquisas_satisfacao`). Motivo escrito: entre "tabela sem tela" e "tela sem tabela", o primeiro é o que se reverte de graça; o segundo custa migração em produção. Isto **substitui** a frase "criar só na fase em que a tela existir" do rascunho.

**Depois da 17**, `scripts/verificar-schema.mjs` (não é migração) confere: toda tabela tem as 4 colunas de auditoria ou marcador; todo `timestamp` é `timestamptz(3)`; toda FK é `RESTRICT`; todo índice único de tabela com soft delete é parcial; nenhum `WHERE ... = $` na pasta de migrações.

---

## 10. Formato tipado de cada coluna JSON

| Tabela.coluna | Tipo TS (`$type<…>()`) | Validação |
|---|---|---|
| `auth_eventos.detalhes` | `{ rota?: string; acao?: string; papel?: string; tentativas?: number; contagem?: number }` | lista branca no `registrarEventoAuth` (o **motivo** é coluna própria, não vai aqui) |
| `auditoria_eventos.antes` / `.depois` | `Record<string, string \| number \| boolean \| null>` | só campos que mudaram; campo de `CAMPOS_PII` grava `"(alterado)"` |
| `auditoria_eventos.detalhes` | `{ motivo?: string; protocolo?: string; quantidade?: number; origem?: string }` | Zod |
| `lojas_integracoes_eventos.corpo` | `unknown` | cru enquanto não processado; depois, projeção mascarada (§6.4) |
| `lojas_integracoes_eventos.cabecalhos` | `Record<string, string>` | lista branca: `content-type`, `user-agent`, `x-hub-signature-256` (só presença), `x-request-id` |
| `lojas_integracoes_templates.botoes` | `Array<{ tipo: "url" \| "telefone" \| "resposta_rapida"; texto: string; valor?: string }>` | Zod |
| `contatos.endereco` | `{ cep: string; logradouro: string; numero: string; complemento?: string; bairro: string; cidade: string; uf: string }` | Zod (`cep` `^\d{8}$`, `uf` 2 letras) |
| `conversas_mensagens.metadados` | `{ tipo_original?: string; story_url?: string; encaminhada?: boolean; citacao_externa_id?: string; erro_provedor?: { codigo: string; mensagem: string }; card?: { tipo: "produto" \| "pedido" \| "pagamento"; id: string } }` | Zod |
| `campanhas.segmento` | `{ etiquetas_ids?: string[]; tamanho?: "slim" \| "plussize" \| "ambos"; gasto_minimo?: string; dias_sem_compra?: number }` | Zod; `etiquetas_ids` conferidas contra a loja |
| `campanhas.variaveis` / `conversas_agendamentos.variaveis` | `Array<{ indice: number; valor: string \| "{nome_contato}" }>` | Zod; **contagem tem de bater com `variaveis_contagem` do template** |
| `pedidos.endereco_entrega` | mesmo tipo de `contatos.endereco` | Zod |
| `lgpd_solicitacoes.resultado` | `{ tabelas: Record<string, number>; objetos_removidos: number; concluido_em: string }` | Zod |

Nenhuma outra coluna `jsonb` existe no modelo.

---

## 11. Decisões que estavam abertas e agora estão fechadas

| # | Pergunta do rascunho | **Decisão** | Como reverter, se o cliente mudar |
|---|---|---|---|
| 1 | `admin` é o máximo ou nasce `dono`? | **5 papéis: `dono, admin, gerente, vendedor, viewer`.** Sem `dono`, quem promove admin é o próprio admin — auto-escalonamento (`07/REQ-H1`) | `ALTER` do CHECK + migrar as linhas |
| 2 | SKU por modelo ou por tamanho no Bling? | `produtos_variacoes.sku` nulo enquanto o cliente não confirmar; a reserva **degrada para o nível do produto** (comportamento de hoje) | nenhuma migração: é só passar a preencher |
| 3 | Pagamento entra no R1? | **Não.** `pagamentos` é criada e fica sem escrita | nenhuma migração |
| 4 | LGPD: anonimizar ou apagar pedido? | **Anonimizar** (ADR 0013). Pedido com efeito fiscal permanece | reabrir o ADR |
| 5 | Número da venda no Masc é único por loja ou rede? | **Por loja** (índice `(loja_id, masc_venda_id)`) | trocar o índice |
| 6 | CSAT, lookbooks, base de conhecimento, agendadas no R1? | **Tabelas criadas na migração inicial; telas conforme §13.4** | ligar a tela |
| 7 | Facebook e TikTok existem? | Valores ficam no CHECK de `provedor` (custo zero). **Fora do R1: sem rota, sem adaptador** | criar rota + adaptador |
| 8 | Marcador `compliance:framework` no auditor | **Fork local no commit 0** (§4.3); PR para a base depois, sem bloquear | — |
| 9 | Conversa resolvida que recebe mensagem | **Reabre** (§ parte 2, 2.2) | trocar a regra do gateway |
| 10 | Opt-out bloqueia mensagem 1:1? | **Não. Opt-out é de marketing** (§ parte 2, 7.2) | — |
| 11 | Quem alimenta o catálogo | **Job `sincronizar-bling`, tela 100% leitura** (§ parte 2, 4) | — |

---

## 12. ADRs necessários (antes do primeiro schema)

| ADR | Título |
|---|---|
| 0008 | Better Auth 1.7 endurecido: tabelas em PT-BR, de-para único, delete físico de framework e marcador `compliance:framework` |
| 0009 | Timestamps `timestamptz(3)`, optimistic locking por `updated_at` e predicado literal em índice parcial |
| 0010 | Listas fechadas como `text` + `CHECK`, não `pgEnum` |
| 0011 | Dinheiro em `numeric(12,2)`, string na fronteira, centavos em `formato.ts` |
| 0012 | Trilha única append-only, papéis de banco e **trilhas append-only sem FK** (desvio nomeado) |
| 0013 | LGPD por **anonimização** (fim do delete físico), alcance e marcador de conteúdo |
| 0014 | Fila BullMQ + Redis 6382, sem tabela genérica de jobs |
| 0015 | Catálogo local alimentado pelo Bling (somente leitura) e variação por tamanho |
| 0016 | Sem conta de ambiente: `conversas.integracao_id NOT NULL`, falha fechada |
| 0017 | `lojas_integracoes_eventos` como **diário de ingestão**: corpo mascarado ao processar, retenção por anonimização |
| 0018 | Etiquetas como catálogo por loja; fim dos `text[]` de ids |
| 0019 | Numeração de pedido por contador atômico, sigla cadastrada e PK composta |
| 0020 | **5 papéis**, escopo de loja, CHECK papel × loja e semeadura do primeiro dono |
| 0021 | `uuid` como id em todas as tabelas, inclusive Better Auth |
| 0022 | FK composta `(id, loja_id)` e FK de `modified_by` por SQL na migração |

Os ADRs 0002, 0003, 0005 e 0007 do repositório antigo ficam "Substituído por".

---

## 13. Nomes compartilhados fora do modelo de dados (decisão do consolidador)

Os quatro desenhos usavam nomes diferentes para a mesma coisa. Estes valem para **todos**.

### 13.1 Contrato do portão (`src/lib/auth/guard.ts` e `loja.ts`)

Publicado como arquivo de interface (só tipos e assinaturas) no commit 0, **antes** de qualquer action. A política continua sendo do desenho de segurança; a **forma** é esta:

```ts
export type Papel = "dono" | "admin" | "gerente" | "vendedor" | "viewer";
export type Sessao = {
  usuarioId: string; sessaoId: string; papel: Papel;
  lojaId: string | null; ativo: true;
  precisaTrocarSenha: boolean; precisaConfigurarFator: boolean;
};
export type EscopoLoja = { tipo: "todas" } | { tipo: "uma"; lojaId: string } | { tipo: "nenhuma" };
export type Contexto = { sessao: Sessao; escopo: EscopoLoja; autorId: string; origem: "ui" | "webhook" | "worker" };

export function pode(papel: Papel, recurso: string, acao: string): boolean;   // PURO: sem I/O, sem trilha
export function exigirSessao(opcoes?): Promise<Sessao>;
export function exigirSessaoFresca(): Promise<Sessao>;
export function exigirPermissao(s: Sessao, chave: `${string}:${string}`, lojaId?: string): void;
export function ehPrivilegioMaximo(papel: Papel): boolean;   // papel === "dono", comparação literal
export function escopoDeLoja(s: Sessao, lojaPedida?: string): EscopoLoja;
export function lojaParaGravar(s: Sessao, lojaPedida?: string): string;
export function contextoDe(s: Sessao, lojaPedida?: string): Contexto;
export function rotaDeMaquina(cfg: ConfigMaquina): (req: Request) => Promise<Response>;
export function rotaPublica(cfg: ConfigPublica): (req: Request) => Promise<Response>;
```

`escopoDeLeitura()` e `exigirLoja()` (nomes de `02-seguranca.md`) **não existem**. `pode()` é exportado porque a navegação e o índice de Configurações renderizam no servidor já filtrados: usar `exigirPermissao()` para montar menu inundaria `auth_eventos` de `recusa_403` a cada page view. `condicaoDeLoja()` fica em `src/lib/db/consultas.ts` (§3).

### 13.2 Rotas (a UI é a dona; estas são as canônicas)

`/entrar` · `/entrar/verificar` · `/primeiro-acesso` · `/esqueci-a-senha` · `/redefinir-senha` · `/conversas` · `/contatos` · `/pedidos` · `/produtos` · `/galeria` · `/campanhas` · `/modelos` · `/respostas-rapidas` · `/alertas` · `/relatorios` · `/auditoria` (abas `qualidade`, `excluidos`, **e `seguranca`** para `auth_eventos`) · `/perfil` · `/perfil/seguranca` · `/configuracoes` (`lojas`, `integracoes`, `usuarios`).

- `/atendimento`, `/catalogo`, `/midias`, `/meu-perfil/seguranca`, `/configuracoes/equipe`, `/configuracoes/auditoria`, `/configuracoes/lgpd`, `/configuracoes/sla`, `/configuracoes/seguranca` e `/login` **não existem**.
- **Token nunca em segmento de rota**: `/primeiro-acesso` e `/redefinir-senha` **sem `[token]`**. O componente cliente lê de `location.hash`, limpa com `history.replaceState` e envia o token no **corpo** do POST. Token em path vai para log de proxy, `Referer` e histórico — é a armadilha G15/F12 que o desenho de segurança passou páginas evitando. Trava: `[token]` em segmento de rota pública reprova.
- Rota de mídia: **`/api/midias/[id]`** (`?miniatura=1`). `/api/media/[id]/raw` de `02-seguranca.md §15` **não existe**.
- A tabela única de rotas (caminho, pública/privada, permissão) vive em `docs/seguranca/caminhos-de-acesso.md` e é a fonte da trava T2.

### 13.3 Módulos e componentes

| Assunto | Nome canônico | Nomes que somem |
|---|---|---|
| Formatação (moeda, data, hora, telefone, centavos) | `src/lib/formato.ts` | `lib/formatar.ts`, `lib/dinheiro.ts` |
| Rótulo + tom de enum | `src/lib/ui/tons.ts` (importa valores de `_enums`) | qualquer segundo mapa de status |
| Componentes de padrão único | `src/components/comum/` | os mesmos arquivos na raiz de `src/components/` |
| Campo de formulário | `components/comum/campo.tsx` | `campo-formulario.tsx` |
| Confirmação de exclusão | `components/comum/confirmar-exclusao.tsx` | `botao-excluir.tsx` |
| Script do primeiro operador | `scripts/primeiro-dono.ts` | `scripts/primeiro-admin.ts` |
| Enums | `src/lib/db/schema/_enums/` (pasta) | `_enums.ts` (arquivo único) |
| Matriz de permissão | `src/lib/auth/permissoes/` (pasta por família) | `permissoes.ts` (arquivo único) |

**Resultado das actions** (um tipo só, em `src/lib/erros.ts`, contemplando o que a UI usa de fato):

```ts
export type Resultado<T> =
  | { ok: true; dados: T }
  | { ok: false; codigo: string; mensagem: string;
      erros?: Record<string, string[]>;      // Zod devolve lista
      valores?: Record<string, string> };    // o formulário nunca é limpo
```

### 13.4 Escopo do R1 (lista única)

**Dentro**: autenticação endurecida + equipe/convite · lojas · integrações (WhatsApp oficial, uazapi, Instagram, Bling leitura) · contatos · conversas/atendimento com tempo real · mídia e galeria · catálogo (leitura, alimentado pelo Bling) + disponibilidade · pedidos + ponte Masc · campanhas · mensagens agendadas · alertas · auditoria (trilha, qualidade, excluídos, segurança) · LGPD (exportar/consentimento/anonimizar) · relatórios básicos.

**Fora (tabela criada, sem tela, sem rota, sem item de navegação)**: trocas/devoluções · funil (negócios) · lookbooks · base de conhecimento · CSAT (pesquisas de satisfação) · pagamentos · IA · transcrição · TikTok · Facebook · SLA configurável.

A navegação sai de um catálogo único `src/lib/navegacao.ts` com campo `fase: "R1" | "R2"`; item `R2` não renderiza e não tem rota. Mudar o corte é editar uma linha, não cinco arquivos.

### 13.5 Variáveis de ambiente

`src/lib/env.ts` é a **dona da verdade**; `.env.example` e a §18 do desenho de segurança são conferidos a partir dela. Além do bloco de `03-arquitetura.md §13`, são obrigatórias (e faltavam): `AUTH_EMAIL_HASH_KEY` (HMAC do e-mail em `auth_eventos`), `PISO_RECUSA_MS` (default 450), `DATABASE_URL_MIGRACAO` (papel `merlo_migracao`, usado por `db:migrate` e `db:backup`). **Não** existe `DATABASE_URL_MANUTENCAO` (o papel de manutenção foi eliminado com o `DELETE` de retenção). A trava T17 passa a reprovar **variável citada em documento e ausente de `env.ts`**.

---

## 14. Travas que este modelo exige (além das já listadas em 02/§20)

| Trava | Reprova quando |
|---|---|
| `tests/integracao/enums-check.test.ts` | `CHECK` do banco diverge da constante TS correspondente (todos os enums, inclusive `TIPOS_AUTH_EVENTO` e `ACOES_AUDITADAS`) |
| `tests/integracao/ba-fields.test.ts` (T4) | valor de `CAMPOS_BA` que não é nome de coluna existente |
| `tests/travas/mutacoes.test.ts` | `.insert(`/`.update(` fora de `mutacoes.ts`; `atualizarContador`/`atualizarEstado` com par fora das constantes; tabela de domínio atualizada sem `travaDeColisao` e fora da lista de exceções do §4.7 |
| `tests/travas/migracoes.test.ts` | `= $` na pasta de migrações (índice parcial quebrado); `DROP` não revisado |
| `tests/integracao/lgpd-anonimizacao.test.ts` | anonimizar contato com mensagem de texto, mídia, comentário de pesquisa e pedido **não** fecha a transação; telefone do titular ainda encontrável em qualquer tabela depois |
| `tests/integracao/contato-upsert.test.ts` | duas entradas simultâneas do mesmo telefone criam duas linhas; contato do CRM sem `whatsapp_id` faz a mensagem se perder |
| `tests/travas/dto-midia.test.ts` | `url_externa` presente em DTO de mensagem |
| `tests/integracao/integridade-trilha.test.ts` | ator/alvo órfão nas trilhas sem FK |

---

## 15. Problemas rejeitados (e por quê)

| ID | O que a crítica pediu | Decisão | Motivo |
|---|---|---|---|
| R-01 | Exceção formal (`EXCECAO-SEG` + ADR + papel `merlo_manutencao`) para o `DELETE` de retenção | **Rejeitado** | A outra opção do mesmo achado (anonimizar) resolve sem exceção nenhuma: nenhum `DELETE`, nenhum papel extra, nenhuma string de conexão a mais, e o hook e a trava T25 seguem em enforcement total (§6.4) |
| R-02 | `updated_at` com `$onUpdate` (`03-arquitetura.md §6.2`) | **Rejeitado** | `$onUpdate` dispara no `UPDATE` de contador e envelhece o `updated_at` em segundos — é exatamente o que torna a trava de colisão inutilizável (§3) |
| R-03 | `lib/formatar.ts` como nome do módulo de formatação | **Rejeitado** | Duas recomendações da própria crítica conflitavam; escolhido `lib/formato.ts` (substantivo, e é o nome que a arquitetura já usava em duas seções) |
| R-04 | Acrescentar `id uuid` a `pedidos_numeracao` | **Rejeitado** | PK composta `(loja_id, ano_mes)` é a forma correta de um contador e é o que torna o `ON CONFLICT` atômico. A exceção a "uuid em tudo" fica escrita no ADR 0019; o CHECK do formato foi corrigido |
| R-05 | Remover `correcao` do CHECK de `lgpd_solicitacoes` | **Rejeitado** | É direito do art. 18, III. O fluxo mínimo custa nada: registra a solicitação, a correção sai pela edição normal do contato, o `resultado` guarda o que mudou |
| R-06 | Convite com papel `dono` quando não existe nenhum dono | **Rejeitado** | Colocaria `dono` no CHECK de `usuarios_convites` e derrubaria a barreira de banco que H1 pede. O `bootstrap = true` (§5.7) semeia o dono com o CHECK intacto |
| R-07 | Trocar o CHECK de mensagem por `(… OR anonimizado)` com coluna nova | **Rejeitado** | O marcador `'[removido a pedido do titular]'` resolve sem coluna nova e sem migração do CHECK — e ainda deixa a tela honesta sobre o que aconteceu |
| R-08 | `compliance:framework` como pré-requisito decidido pelo Paulo antes do commit 0 | **Rejeitado como bloqueio** | Decisão em ferramenta de terceiro não pode travar o commit 0. O auditor do repositório novo nasce com o marcador e os dois testes; o PR para a base é assíncrono (§4.3) |
| R-09 | Manter `url_externa` fora do banco de vez | **Rejeitado em parte** | A coluna continua como **coluna de trabalho** do job de download (o gateway precisa dela para baixar), mas é limpa quando `baixada = true` e **nunca** entra em DTO (parte 2, §2.4) |

---

## 16. CATÁLOGO DE NOMES (fonte única para os demais documentos)

### 16.1 Tabelas (48)

**Auth (9)**: `usuarios` · `usuarios_contas` · `usuarios_sessoes` · `usuarios_verificacoes` · `usuarios_totp` · `usuarios_passkeys` · `usuarios_convites` · `usuarios_senhas_historico` · `usuarios_trocas_email`

**Plataforma (6)**: `lojas` · `lojas_etiquetas` · `lojas_integracoes` · `lojas_integracoes_eventos` · `lojas_integracoes_templates` · `alertas`

**Trilhas (2)**: `auth_eventos` · `auditoria_eventos`

**Domínio — canais, mídia, catálogo, conteúdo, campanhas (20)**: `contatos` · `contatos_etiquetas` · `conversas` · `conversas_mensagens` · `conversas_mensagens_midias` · `conversas_agendamentos` · `lojas_midias` · `lojas_midias_etiquetas` · `produtos_categorias` · `produtos` · `produtos_variacoes` · `produtos_midias` · `lookbooks` · `lookbooks_midias` · `lookbooks_produtos` · `respostas_rapidas` · `base_conhecimento_artigos` · `base_conhecimento_artigos_etiquetas` · `campanhas` · `campanhas_destinatarios`

**Domínio — CRM, pedidos, pós-venda, LGPD (11)**: `negocios` · `pedidos_numeracao` · `pedidos` · `pedidos_itens` · `pagamentos` · `pedidos_devolucoes` · `pedidos_devolucoes_itens` · `pedidos_devolucoes_midias` · `pesquisas_satisfacao` · `consentimentos` · `lgpd_solicitacoes`

Nomes que **não existem** (e apareciam nos rascunhos ou no sistema antigo): `integracoes_eventos`, `jobs`, `negocios_eventos`, `pedidos_eventos`, `deal_events`, `order_events`, `activity_logs`, `rateLimit`, `lojas_canais_sla`.

### 16.2 Papéis (5, ordem de privilégio)

`dono` (loja `NULL`) > `admin` (`NULL`) > `gerente` (`NULL`) > `vendedor` (loja obrigatória) > `viewer` (loja obrigatória).
`dono` não é convidável. `ehPrivilegioMaximo(papel)` é `papel === "dono"`, por comparação literal.

### 16.3 Enums (valor exato, por constante)

| Constante (`_enums/…`) | Valores |
|---|---|
| `PAPEIS` (auth) | `dono, admin, gerente, vendedor, viewer` |
| `PAPEIS_CONVIDAVEIS` (auth) | `admin, gerente, vendedor, viewer` |
| `MEIOS_AUTH` (auth) | `senha, senha+totp, passkey, convite, reset, admin, sistema` |
| `RESULTADOS_AUTH` (auth) | `sucesso, falha, recusado` |
| `ATOR_TIPOS` (auth) | `usuario, sistema, integracao` |
| `TIPOS_AUTH_EVENTO` (auth) | §7.1 (33 valores) |
| `PROVEDORES` (plataforma) | `whatsapp_oficial, uazapi, instagram, facebook, tiktok_shop, bling` |
| `STATUS_INTEGRACAO` (plataforma) | `desconectado, conectado, expirado, erro` |
| `TIPOS_EVENTO_INTEGRACAO` (plataforma) | `recebido, recusado, descartado, processado, falhou` |
| `CATEGORIAS_TEMPLATE` (plataforma) | `marketing, utility, authentication` |
| `STATUS_TEMPLATE` (plataforma) | `rascunho, enviado, aprovado, rejeitado, pausado` |
| `TIPOS_CABECALHO_TEMPLATE` (plataforma) | `texto, imagem, video, documento` |
| `TIPOS_BOTAO` (plataforma) | `url, telefone, resposta_rapida` |
| `TIPOS_ALERTA` (plataforma) | `sla_estourado, risco_avaliacao, negocio_parado, pagamento_pendente, primeiro_contato, cliente_retornando, follow_up_atrasado, sessao_uazapi_caiu, integracao_com_erro` |
| `SEVERIDADES` (plataforma) | `baixa, media, alta, critica` |
| `STATUS_CONVERSA` (conversas) | `aberta, pendente, resolvida, arquivada` |
| `PRIORIDADES` (conversas) | `baixa, media, alta, urgente` |
| `DIRECOES` (conversas) | `entrada, saida` |
| `AUTOR_TIPOS` (conversas) | `contato, usuario, sistema, campanha` |
| `TIPOS_CONTEUDO` (conversas) | `texto, imagem, video, audio, documento, sticker, localizacao, template, sistema` |
| `STATUS_ENTREGA` (conversas) | `pendente, enviada, entregue, lida, falhou` |
| `TIPOS_ARQUIVO_MENSAGEM` (conversas) | `imagem, video, audio, documento, sticker` |
| `STATUS_TRANSCRICAO` (conversas) | `pendente, processando, concluida, falhou` |
| `TIPOS_CONTEUDO_AGENDAMENTO` (conversas) | `texto, template, midia` |
| `GATILHOS_AGENDAMENTO` (conversas) | `manual, follow_up, pos_venda, abandono, reativacao, aniversario, promocao` |
| `STATUS_AGENDAMENTO` (conversas) | `agendada, enviada, cancelada, falhou` |
| `ORIGENS_ETIQUETA` (conversas) | `manual, importacao, automacao` |
| `TIPOS_GRADE` (catalogo) | `slim, plussize, ambos` |
| `TAMANHOS_SLIM` (catalogo) | `PP, P, M, G, GG` |
| `TAMANHOS_PLUS` (catalogo) | `46, 48, 50, 52, 54, 56, 58` |
| `TIPOS_ARQUIVO_MIDIA` (catalogo) | `imagem, video, audio, documento` |
| `ORIGENS_MIDIA` (catalogo) | `upload, recebida, gerada` |
| `PASTAS_MIDIA` (catalogo) | `produtos, lookbooks, stories, geral` |
| `CATEGORIAS_RESPOSTA` (catalogo) | `frete, medidas, troca, pagamento, rastreio, geral` |
| `CATEGORIAS_ARTIGO` (catalogo) | `medidas, frete, troca, pagamento, tecidos, combinacoes, procedimentos` |
| `STATUS_CAMPANHA` (catalogo) | `rascunho, agendada, enviando, pausada, concluida, cancelada` |
| `STATUS_DESTINATARIO` (catalogo) | `pendente, reservado, enviado, entregue, lido, respondido, falhou` |
| `ESTAGIOS_NEGOCIO` (pedidos) | `lead, interessada, negociando, fechando, ganho, perdido` |
| `MOTIVOS_PERDA` (pedidos) | `preco, tamanho_indisponivel, concorrente, sem_resposta, mudou_de_ideia, outro` |
| `STATUS_PEDIDO` (pedidos) | `confirmado, preparando, enviado, entregue, devolvido, cancelado` |
| `STATUS_PAGAMENTO_PEDIDO` (pedidos) | `pendente, pago, estornado, cancelado` |
| `FORMAS_PAGAMENTO` (pedidos) | `pix, cartao, boleto, link, dinheiro` |
| `MASC_STATUS` (pedidos) | `pendente, lancado, dispensado` |
| `PROVEDORES_PAGAMENTO` (pedidos) | `mercadopago, asaas, pagbank, manual` |
| `STATUS_PAGAMENTO` (pedidos) | `pendente, aprovado, recusado, estornado, expirado, cancelado` |
| `TIPOS_DEVOLUCAO` (pedidos) | `troca, devolucao, reembolso` |
| `MOTIVOS_DEVOLUCAO` (pedidos) | `tamanho_errado, defeito, diferente_do_esperado, mudou_de_ideia, outro` |
| `STATUS_DEVOLUCAO` (pedidos) | `solicitada, aprovada, em_transito, recebida, concluida, negada` |
| `METODOS_ESTORNO` (pedidos) | `pix, cartao, credito_loja` |
| `ACOES_AUDITADAS` (auditoria) | §7.4 |
| `TIPOS_CONSENTIMENTO` (auditoria) | `tratamento_dados, marketing, opt_out, opt_in` |
| `ORIGENS_CONSENTIMENTO` (auditoria) | `mensagem, tela, importacao, contato_direto` |
| `TIPOS_LGPD` (auditoria) | `acesso, eliminacao, correcao` |
| `GATILHOS_PESQUISA` (auditoria) | `conversa_encerrada, pedido_entregue` |

### 16.4 Helpers e funções (nome exato)

`instante()` · `dataPura()` · `dinheiro()` · `colunasAuditoria` · `emLista()` · `vivos()` · `vivosE()` · `travaDeColisao()` · `marcaDeExclusao()` · `condicaoDeLoja()` · `inserirAuditado()` · `atualizarComTrava()` · `excluirLogico()` · `atualizarContador()` · `atualizarEstado()` · `pode()` · `exigirSessao()` · `exigirSessaoFresca()` · `exigirPermissao()` · `ehPrivilegioMaximo()` · `escopoDeLoja()` · `lojaParaGravar()` · `contextoDe()` · `rotaDeMaquina()` · `rotaPublica()` · `registrarEventoAuth()` · `registrarProcessamentoEvento()` · `anonimizarContato()`.
