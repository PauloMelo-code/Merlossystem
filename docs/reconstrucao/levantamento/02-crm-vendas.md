# Levantamento 02 — CRM e Vendas (sistema antigo, commit 5e902d4)

> Referência de **domínio e regra de negócio** para a reconstrução. Não é modelo
> de implementação. Todo caminho é relativo a `C:\Users\Paulo\Documents\MerlostoreChat`.
> Citações no formato `arquivo:linha`. Levantamento só de leitura, feito em 15/09/2026.

## 0. Escopo e como ler

Cobre: contatos (tags, opt-out, isolamento por loja), pipeline (deals e eventos),
pedidos (número, itens, status, ponte Masc, reserva), pagamentos (Pix, link,
provedor mock, webhook), trocas/devoluções, CSAT, LGPD/consentimento e analytics.

Arquivos lidos por inteiro:

| Camada | Arquivos |
|--------|----------|
| Rotas | `src/app/api/contacts/route.ts`, `contacts/[id]/route.ts`, `contacts/[id]/tags/route.ts`, `deals/route.ts`, `deals/[id]/route.ts`, `orders/route.ts`, `orders/[id]/route.ts`, `orders/[id]/masc/route.ts`, `payments/pix/route.ts`, `payments/link/route.ts`, `returns/route.ts`, `returns/[id]/route.ts`, `surveys/route.ts`, `lgpd/route.ts`, `analytics/route.ts`, `webhooks/payments/route.ts` |
| Lib | `src/lib/pedidos/numero.ts`, `pedidos/reservado.ts`, `payments/{index,mock-provider,types}.ts`, `webhook-auth.ts`, `loja.ts`, `rbac.ts`, `sessao.ts`, `auditoria.ts`, `paginacao.ts`, `db/soft-delete.ts`, `alerts/{engine,rules}.ts`, trechos de `channels/gateway.ts`, `broadcasts/disparo.ts` e `api/ai/classify/route.ts` |
| Telas | `src/app/(dashboard)/{contacts,pipeline,orders,returns,analytics}/page.tsx`, `settings/lgpd/page.tsx`, `inbox/_components/painel-venda.tsx`, `src/components/inbox/ContactPanel.tsx`, `src/components/chat/{OrderCard,PaymentCard}.tsx` |
| Dados/infra | `prisma/schema.prisma`, `prisma/sql/constraints.sql`, trechos de `prisma/seed.ts`, `src/middleware.ts`, `src/lib/api-publica.ts` |
| Docs | `docs/integracoes.md` (decisões 1–8, isolamento de contato), `docs/adr/0004-fontes-da-verdade.md`, `docs/adr/0005-soft-delete.md`, `docs/rbac.md`, trechos de `docs/api.md` e `docs/regras-negocio.md` |

Legenda de severidade dos defeitos: **CRÍTICO** (perda/vazamento de dado, dinheiro, violação legal),
**ALTO** (regra de negócio quebrada ou dado inconsistente), **MÉDIO** (robustez/UX que engana),
**BAIXO** (higiene).

---

## 1. Visão geral do domínio

```
                 (webhook de canal)                         (tela Contatos)
                        |                                          |
                        v                                          v
   stores ---1:N--- contacts (carteira isolada por loja) <---- POST /api/contacts
                        |  tags[], opt_out, preferred_size, total_orders/total_spent (desnormalizados)
         +--------------+-------------+-------------------+-------------------+
         |              |             |                   |                   |
       deals ---1:N-- deal_events   orders ---1:N-- order_events         consent_logs
   (funil 6 estágios)   (from/to)     |  items JSON, masc_status             (LGPD)
         |                            +---1:N-- payments (pix/link, provider mock)
         +----(pedido com dealId marca deal "won")
                                      +---1:N-- returns (troca/devolução/reembolso)
                                      +---1:N-- satisfaction_surveys (CSAT)
                                      +---0:N-- alerts (payment_pending ...)

   Masc (ERP/PDV, dono da venda)  <-- pessoa digita a venda e anota o número --  PUT /api/orders/[id]/masc
   Bling (estoque, conta única, depósito por loja) -- saldo lido --> "disponível" = saldo - reservado
```

Fluxo principal de venda pelo canal (o único ponta a ponta que funciona hoje):

1. Mensagem entra por webhook → `processIncomingMessage` acha/cria o contato **dentro da loja da conta que recebeu** (`src/lib/channels/gateway.ts:55-77`) e atualiza `last_contact_at` (`gateway.ts:212-216`).
2. Vendedora abre o **Painel de Venda** dentro da conversa (`src/app/(dashboard)/inbox/_components/painel-venda.tsx`), vê o catálogo com `disponível = saldo Bling − reservado` e monta o carrinho.
3. "Fechar venda" → modal com bloqueio de 3 s → `POST /api/orders` (`painel-venda.tsx:139-170`, `330-376`).
4. Pedido nasce `status=confirmed`, `payment_status=pending`, `masc_status=pendente`, número sequencial por loja/mês (`src/app/api/orders/route.ts:106-158`).
5. Alguém lança a venda no Masc e registra o número em `/orders` (modal 3 s) → `PUT /api/orders/[id]/masc` (`orders/page.tsx:143-174`, `323-355`).
6. Opcional: "Gerar Pix" (mock) em `/orders` → `POST /api/payments/pix`; confirmação só chegaria por webhook de gateway real, que não existe.

Todo o resto (deals, trocas, CSAT, LGPD, link de pagamento) está parcial, sem tela, ou só de fachada — detalhado abaixo.

---

## 2. Modelo de dados atual do domínio

Todas as tabelas usam `id` uuid texto. `DateTime` do Prisma vira `timestamp(3) without time zone`.
Nenhuma tabela deste domínio tem controle de colisão (optimistic locking) em uso.

### 2.1 `contacts` (`prisma/schema.prisma:149-198`)

| Coluna | Tipo | Observação de domínio |
|--------|------|----------------------|
| store_id | text NOT NULL FK stores | carteira isolada por loja (decisão 5) |
| name, phone, email | text null | `phone` sem normalização (livre) |
| instagram_id, facebook_id, tiktok_id, whatsapp_id | text null | identificador do remetente por canal; WhatsApp também grava `phone` (`gateway.ts:67-68`) |
| avatar_url | text null | vem do canal |
| preferred_size | text null | `slim` \| `plussize` \| `both` (loja de moda com grade plus size) — sem CHECK |
| tags | text[] default `{}` | livre; alimenta segmentação de campanha |
| notes | text null | |
| total_orders | int default 0 | **desnormalizado**, incrementado na criação do pedido |
| total_spent | decimal(10,2) default 0 | **desnormalizado**, idem |
| last_contact_at | timestamp null | atualizado a cada mensagem recebida |
| birthday | date null | não há campo na tela; existe gatilho `birthday` em agendadas |
| address | jsonb null | nunca escrito por rota do domínio |
| opt_out | boolean default false | só vira `true` por `POST /api/lgpd`; nunca volta a `false` |
| created_at, updated_at, deleted_at, is_deleted, modified_by | auditoria | `modified_by` só é gravado no soft delete |

Unicidades (`schema.prisma:191-195`): `(store_id, whatsapp_id)`, `(store_id, instagram_id)`,
`(store_id, facebook_id)`, `(store_id, tiktok_id)`, `(store_id, phone)`. **São índices únicos
totais** — incluem linhas com `is_deleted=true`. O desenho em `docs/integracoes.md:306-316`
previa índice **parcial** (`WHERE <campo> IS NOT NULL AND is_deleted = false`), que não foi aplicado
(ver defeito C-01).

### 2.2 `deals` (`schema.prisma:401-432`) e `deal_events` (`schema.prisma:434-447`)

| Coluna (deals) | Tipo | Observação |
|---------|------|-----------|
| store_id, contact_id | FK NOT NULL | loja herdada do contato |
| conversation_id | FK null | não validado contra a loja |
| assigned_to | FK users null | responsável; não validado |
| stage | text default `lead` | `lead` \| `interested` \| `negotiating` \| `closing` \| `won` \| `lost` — sem CHECK |
| value | decimal(10,2) default 0 | aceita negativo |
| products | jsonb default `[]` | formato livre; seed usa `{name,size,qty}` (`prisma/seed.ts` ~164-169), pedido usa `{productId,name,size,quantity,unitPrice}` |
| notes, loss_reason, loss_notes | text null | `loss_reason` livre; a tela oferece lista fechada |
| expected_close_date | date null | |
| last_activity_at | timestamp default now | atualizado em qualquer PUT |
| created_at, updated_at, deleted_at, is_deleted, modified_by | auditoria | |

`deal_events`: `deal_id`, `from_stage`, `to_stage`, `changed_by` (FK users null), `notes`, `created_at`.
Sem `store_id`, sem `updated_at`/soft delete (ADR 0005 §5: filho alcançado pelo pai, é rastro).

### 2.3 `orders` (`schema.prisma:453-508`) e `order_events` (`schema.prisma:510-521`)

| Coluna (orders) | Tipo | Observação |
|---------|------|-----------|
| store_id, contact_id | FK NOT NULL | loja = loja do contato |
| deal_id, conversation_id | FK null | não validados contra a loja |
| order_number | text | único por `(store_id, order_number)` (`schema.prisma:503`) |
| status | text default `confirmed` | `confirmed` \| `preparing` \| `shipped` \| `delivered` \| `returned` \| `cancelled` — sem CHECK |
| items | jsonb NOT NULL | `[{productId, name, size, quantity, unitPrice}]` — preço e nome vêm do cliente |
| subtotal, shipping_cost, discount, total | decimal(10,2) | calculados no servidor a partir do JSON do cliente |
| payment_method | text null | `pix` \| `credit_card` \| `boleto` \| `link` (livre) |
| payment_status | text default `pending` | `pending` \| `paid` \| `refunded` (UI) — livre |
| shipping_method, tracking_code, tracking_url | text null | |
| shipping_address | jsonb null | livre |
| notes | text null | |
| masc_status | text default `pendente` | `pendente` \| `lancado` \| `dispensado` |
| masc_venda_id | text null | número da venda no Masc — **sem unicidade** |
| masc_lancado_em, masc_lancado_por, masc_observacao | | `masc_lancado_por` não é FK |
| created_by, modified_by, created_at, updated_at | | **sem `deleted_at`/`is_deleted`** |

Índices: `(store_id)`, `(store_id, masc_status)` — a fila "falta lançar" (`schema.prisma:505-506`).

`order_events`: `order_id`, `status` (mistura status do pedido com `paid` e com o status corrente no
evento de Masc), `description`, `created_by` (não é FK), `created_at`.

### 2.4 `payments` (`schema.prisma:527-546`)

`order_id` FK, `provider` (`mock` hoje; comentário prevê mercadopago|asaas|pagbank), `external_id`
(sem unicidade, sem índice), `method` (`pix`|`credit_card`|`boleto`|`link`), `status`
(`pending`|`approved`|`rejected`|`refunded`|`expired`), `amount`, `pix_qrcode_base64` (data-URI inteiro no banco),
`pix_copy_paste`, `payment_link`, `paid_at`, `expires_at`, `refunded_at`, `created_at`.
**Sem `store_id`, sem `updated_at`, sem soft delete, sem autor.**

### 2.5 `returns` (`schema.prisma:552-580`)

`store_id`, `order_id`, `contact_id`, `conversation_id`, `type` (`exchange`|`return`|`refund`),
`reason` (`wrong_size`|`defect`|`not_as_expected`|`changed_mind`|`other`), `reason_detail`,
`items` jsonb livre, `status` (`requested`|`approved`|`shipping_back`|`received`|`completed`|`denied`),
`tracking_code`, `refund_amount`, `refund_method`, `media_ids` text[] (sem FK), `resolved_by` FK users,
`created_at`, `resolved_at`. **Sem `updated_at`, `deleted_at`, `is_deleted`, `modified_by`.**

### 2.6 `satisfaction_surveys` (`schema.prisma:785-806`)

`store_id`, `contact_id`, `conversation_id`, `order_id`, `score` int null (sem faixa), `feedback`,
`trigger_type` (`conversation_closed`|`order_delivered`), `sent_at`, `responded_at`, `created_at`.
Sem colunas de auditoria.

### 2.7 `consent_logs` (`schema.prisma:840-855`)

`store_id`, `contact_id`, `type` (`data_processing`|`marketing`|`opt_out`), `granted` boolean,
`channel` text null, `ip_address` text null (**vem do corpo da requisição**), `created_at`.
Sem autor (quem registrou), sem versão/texto do termo, sem colunas de auditoria.

### 2.8 Tabelas de apoio tocadas pelo domínio

- `activity_logs` (`schema.prisma:861-883`): trilha genérica. Nenhuma rota deste domínio escreve nela (seção 3.4).
- `alerts` (`schema.prisma:586-609`): recebe `deal_stale`, `payment_pending`, `first_contact`, `returning_customer` (seção 12).
- `broadcast_recipients`, `scheduled_messages`: apagados fisicamente pela eliminação LGPD.

### 2.9 Lacunas contra as regras absolutas da base (para o redesenho)

| Tabela | Falta |
|--------|-------|
| orders | `deleted_at`, `is_deleted`; itens como tabela (hoje JSON); FK de `masc_lancado_por` e `order_events.created_by` |
| order_events, deal_events | colunas de auditoria (ou decisão explícita de tabela append-only) e `store_id` |
| payments | `store_id`, `updated_at`, soft delete, autor |
| returns | `updated_at`, soft delete, `modified_by`; itens como tabela |
| satisfaction_surveys, consent_logs | 5 colunas de auditoria; autor do consentimento |
| contacts | tags como tabela/catálogo (hoje `text[]` livre); unicidade parcial por `is_deleted` |
| todas | CHECK/enum para status e tipos; nenhuma usa optimistic locking |

---

## 3. Mecanismos transversais que o domínio usa

### 3.1 Sessão e autoria

- `usuarioDaSessao()` lê o JWT do NextAuth, sem ir ao banco (`src/lib/sessao.ts:22-30`). `role` e `storeId` valem até o token expirar: usuário rebaixado ou desativado continua operando.
- Autoria (`created_by`, `changed_by`, `resolved_by`, `modified_by`, `masc_lancado_por`) sempre vem da sessão, nunca do corpo (regra correta, preservar).

### 3.2 RBAC (`src/lib/rbac.ts`, aplicado em `src/middleware.ts:64`)

Regra padrão por método (`rbac.ts:34-40`): `GET` todos; `POST/PUT/PATCH` admin+gerente+vendedor;
`DELETE` admin+gerente. **Nenhuma exceção** afeta as rotas deste domínio (`rbac.ts:47-89`; LGPD
explicitamente segue o padrão, `rbac.ts:86-88`). Efeito prático:

| Rota | GET | POST | PUT | DELETE |
|------|-----|------|-----|--------|
| /api/contacts, /[id] | todos | adm/ger/vend | adm/ger/vend | adm/ger |
| /api/contacts/[id]/tags | — | — | adm/ger/vend | — |
| /api/deals, /[id] | todos | adm/ger/vend | adm/ger/vend | adm/ger |
| /api/orders, /[id], /[id]/masc | todos | adm/ger/vend | adm/ger/vend (inclui marcar pago e lançar Masc) | — |
| /api/payments/pix, /link | — | adm/ger/vend | — | — |
| /api/returns, /[id] | todos | adm/ger/vend | adm/ger/vend (inclui aprovar estorno) | — |
| /api/surveys | todos | adm/ger/vend | — | — |
| /api/lgpd | **todos, inclusive viewer e vendedor** (exporta dossiê) | adm/ger/vend | — | adm/ger (eliminação física) |
| /api/analytics | todos (inclui receita) | — | — | — |
| /api/webhooks/payments | pública (`src/lib/api-publica.ts:17`), autentica por segredo | | | |

Páginas não têm RBAC (qualquer logado abre `/settings/lgpd`, `/analytics`) — `docs/rbac.md:103-105`.

### 3.3 Escopo de loja (`src/lib/loja.ts`)

- `escopoDaLoja(usuario, lojaAtiva(req))` (`loja.ts:58-68`): vendedor/viewer → `{storeId: loja do cadastro}` (ou `"__sem_loja__"` se nulo, fecha); admin/gerente → `{}` (as duas lojas) ou `{storeId: ?loja=|cookie loja_ativa}`.
- `lojaParaGravar` (`loja.ts:77-83`): gestão sem loja escolhida → `null` → 400 `faltaLoja()`.
- `lojaAtiva` (`loja.ts:98-109`): `?loja=` ou cookie `loja_ativa`; para vendedor é ignorado.
- Fora do escopo responde **404** (`foraDaLoja`, `loja.ts:131-136`), nunca 403 — para não confirmar existência.
- Padrão de escrita deste domínio: **a loja do registro filho vem do contato**, resolvido dentro do escopo (`deals/route.ts:66-73`, `orders/route.ts:86-94`, `returns/route.ts:50-57`, `surveys/route.ts:51-58`, `lgpd/route.ts:55-61`).
- Falha recorrente: ids **secundários** do corpo (`dealId`, `conversationId`, `orderId`, `assignedTo`, `productId`, `mediaIds`) não são conferidos contra a loja — exatamente o alerta de `docs/rbac.md:67-72`.

### 3.4 Trilha de auditoria (`src/lib/auditoria.ts`)

- Lista fechada `ACOES` contém `pedido_lancado_masc` e `contato_apagado_lgpd` (`auditoria.ts:32-33`), mas **nenhuma rota deste domínio chama `registrar()`**. As únicas chamadas no sistema estão em broadcasts, conversations, integracoes e usuarios.
- Consequência: criar/editar/excluir contato, mover deal, criar pedido, lançar no Masc, gerar cobrança, marcar pago, aprovar estorno, exportar dossiê LGPD e **eliminar dados LGPD** não deixam registro em `activity_logs`. O único rastro são `deal_events`/`order_events` (parciais).
- `registrar()` engole erro (`auditoria.ts:85-88`): a trilha nunca derruba a operação.

### 3.5 Soft delete (`src/lib/db/soft-delete.ts`, ADR 0005)

- Guard no cliente Prisma injeta `isDeleted: false` em `findMany/findFirst/findFirstOrThrow/count/aggregate` dos models `Contact`, `Deal` e outros 6 (`soft-delete.ts:18-27`, `38`). `update`, `create`, `findUnique` e **leituras aninhadas (`include`, filtro por relação)** não são filtrados (comportamento de extensão de query do Prisma).
- Neste domínio só `contacts` e `deals` têm soft delete. `orders`, `payments`, `returns`, `surveys`, `consent_logs` não têm e não têm rota de exclusão.
- Única exclusão física: `DELETE /api/lgpd`, marcada linha a linha com `compliance:delete-fisico-lgpd` (ADR 0005 "A exceção: LGPD").

### 3.6 Paginação (`src/lib/paginacao.ts`)

`limiteDaPagina` grampeia em 1..100 (`paginacao.ts:19`, `25-37`). Usada em contatos e pedidos.
**Não usada** em `GET /api/deals`, `GET /api/returns` (sem limite nenhum) e `GET /api/surveys` (teto fixo 50).

### 3.7 Tratamento de erro

Padrão: `try { zod.parse } catch ZodError → 400 {error: issues} | outro → 500 genérico`.
Rotas **sem** try/catch: `PUT /api/contacts/[id]/tags`, `PUT /api/orders/[id]`, `PUT /api/returns/[id]`,
`POST/DELETE /api/lgpd`, `GET /api/analytics` — erro de Prisma vira 500 cru do Next.
Violação de unicidade (P2002) em contato vira 500 "Erro ao criar contato" sem explicar duplicidade.

---

## 4. Contatos

### 4.1 `GET /api/contacts` (`src/app/api/contacts/route.ts:22-57`)

- **Entrada**: query `search`, `tag`, `preferredSize`, `page`, `limit` (padrão 20, teto 100).
- **Validação**: nenhuma além da paginação.
- **Efeito**: lista escopada; `search` casa `name` (insensitive), `phone` (contains, sensitive), `email` (insensitive) (`36-42`); `tag` usa `has` (`43`); ordena por `last_contact_at desc nulls last` (`49`). Devolve `{contacts, total, page, limit}`.
- **Regra**: carteira isolada — vendedor vê só a loja dele; gestão vê as duas ou filtra.

### 4.2 `POST /api/contacts` (`route.ts:59-85`)

- **Entrada**: `name`, `phone`, `email`, `instagramId`, `facebookId`, `tiktokId`, `whatsappId`, `preferredSize`, `tags[]`, `notes`, `birthday` (string) — schema `route.ts:8-20`.
- **Validação**: Zod — `name` min 1 se presente, `email` formato e-mail, resto string livre. Sem regex de telefone, sem enum de `preferredSize`, sem normalização de tags, sem tamanho máximo.
- **Efeito**: `lojaParaGravar` (gestão precisa de loja; `64-65`); `contact.create` com `storeId` e `birthday = new Date(string)` (`70-76`). Não grava `modified_by`, não audita.

### 4.3 `GET/PUT/DELETE /api/contacts/[id]` (`src/app/api/contacts/[id]/route.ts`)

- **GET** (`39-58`): `findFirst` escopado; fora da loja/soft-deleted → 404.
- **PUT** (`60-89`): confere escopo (`69`), Zod com todos os campos opcionais (`17-29`), `update` por id (`74-80`). Permite trocar `phone`/`whatsappId`/`instagramId` etc. Não grava `modified_by`, sem controle de colisão, sem auditoria. `birthday: null` vira `undefined` (não limpa a data, `78`).
- **DELETE** (`91-111`): confere escopo; soft delete `{isDeleted, deletedAt, modifiedBy}` (`105-108`). Não mexe em conversas, deals, pedidos (histórico preservado — intencional, comentário `101-104`).

### 4.4 `PUT /api/contacts/[id]/tags` (`src/app/api/contacts/[id]/tags/route.ts:17-58`)

- **Entrada**: `{tags: string[]}` substitui tudo, **ou** `{add: string}`, **ou** `{remove: string}` (`38-49`).
- **Validação**: nenhuma (sem Zod, sem try/catch). `tags` pode chegar como string/objeto.
- **Efeito**: lê tags escopado, calcula e grava (`51-55`). Sem autor, sem auditoria.
- **Regra (comentário `12-15`)**: tag alimenta segmentação e disparo em massa — marcar cliente é decidir audiência de campanha.
- **Uso**: nenhuma tela chama esta rota.

### 4.5 Outros escritores de contato

| Quem | O que faz | Onde |
|------|-----------|------|
| Gateway de mensagem | acha por `(store_id, <campo do canal>)`; cria com `name`, `avatar_url`, id do canal e `phone` (WhatsApp); completa `name` se vazio; atualiza `last_contact_at` a cada mensagem | `src/lib/channels/gateway.ts:55-77`, `212-216` |
| `POST /api/orders` | `total_orders += 1`, `total_spent += total` na criação | `orders/route.ts:145-148` |
| `POST /api/ai/classify` | **acrescenta tags sugeridas pelo modelo** ao contato (sem normalização, sem teto) | `src/app/api/ai/classify/route.ts:56-67` |
| `POST /api/lgpd` | `opt_out = true` | `lgpd/route.ts:75-80` |

### 4.6 Leitores de contato fora do CRUD

| Quem | Campos | Onde |
|------|--------|------|
| Segmentação de campanha | `opt_out=false`, `store_id`, `is_deleted=false`, `tags hasEvery`, `preferred_size`, `total_spent >= min_spent`, `last_contact_at >= hoje - max_days_since_purchase` | `src/lib/broadcasts/disparo.ts:87-107` |
| Envio de campanha | re-confere `opt_out` no momento do envio de cada destinatário | `disparo.ts:180-198` |
| Alertas | `first_contact` (criado há ≤5 min e `total_orders=0`), `returning_customer` (conversa nova e `last_contact_at` > 30 dias e `total_orders>0`) | `src/lib/alerts/engine.ts:176-262` |
| Painel do contato no inbox | leitura: telefone, e-mail, ids de canal, `total_orders`, `total_spent`, tags, notas (sem edição) | `src/components/inbox/ContactPanel.tsx:41-167` |

### 4.7 Tela `/contacts` (`src/app/(dashboard)/contacts/page.tsx`)

- Lista (sem paginação na UI; usa só a primeira página de 20) com nome, telefone, e-mail, tamanho, até 3 tags, total gasto.
- Busca por texto e filtro de tamanho (`249-261`). Filtro por tag existe na API e não na tela. Opção "Todos" manda `preferredSize=all`, que a API trata como valor literal e retorna vazio (`175`, API `44`).
- Formulário (dialog) cria/edita: nome, telefone (placeholder `5511999999999`), e-mail, tamanho, WhatsApp ID, Instagram ID, tags separadas por vírgula, notas (`97-160`). Sem aniversário, Facebook, TikTok, endereço, opt-out.
- Excluir usa `window.confirm()` (`187-194`) — **não** usa o modal com bloqueio de 3 s.
- Sem estado de erro na carga (`171-181`); erro de API vira tela vazia/quebra em `data.contacts`.
- Diretórios vazios `contacts/placeholder` e `orders/placeholder` (lixo).

### 4.8 Regras de negócio de contato (preservar)

- **RN-CT1** Carteira isolada por loja: a mesma pessoa no Centro e no Cerro Azul são **dois contatos**; não sugerir merge (`docs/integracoes.md` decisão 5; seed `prisma/seed.ts` semeia a mesma cliente nas duas lojas de propósito).
- **RN-CT2** Unicidade por loja de cada identificador de canal e do telefone.
- **RN-CT3** O gateway só procura/cria contato **depois** de saber a loja da conta que recebeu o evento.
- **RN-CT4** Contato fora do escopo responde igual a inexistente (404).
- **RN-CT5** Excluir contato na operação = soft delete; conversas, pedidos e histórico continuam apontando para ele.
- **RN-CT6** `preferred_size` ∈ {slim, plussize, both} é atributo de negócio (moda com grade plus size), usado em filtro, IA e segmentação.
- **RN-CT7** Opt-out retira o contato de campanhas, conferido na montagem da lista **e** a cada envio.
- **RN-CT8** Tags segmentam campanha; alterar tag de contato de outra loja é incluir cliente alheio em campanha.

### 4.9 Defeitos de contato

| ID | Sev. | Defeito | Evidência |
|----|------|---------|-----------|
| C-01 | CRÍTICO | Unicidade total (inclui soft-deleted). Contato excluído + nova mensagem do mesmo número: o gateway não acha (guard filtra `is_deleted`) e tenta criar → P2002 → mensagem da cliente perdida. O mesmo impede recriar o contato pela tela | `schema.prisma:191-195`; `gateway.ts:56-70`; `soft-delete.ts:42-47`; contraste com `docs/integracoes.md:306-316` |
| C-02 | ALTO | Telefone sem normalização/regex: `5511999...`, `+55 (11) 9...` e `11 9...` passam como distintos, burlando a unicidade e quebrando a busca | `contacts/route.ts:10`; `[id]/route.ts:19` |
| C-03 | ALTO | `total_orders`/`total_spent` somam na criação do pedido, independentemente de pagamento; nunca subtraem em cancelamento/devolução; sem reconciliação. Alimentam alerta e segmentação `min_spent` | `orders/route.ts:145-148`; `disparo.ts:101`; `engine.ts:183,228` |
| C-04 | ALTO | Filtro de campanha "dias desde a compra" usa `last_contact_at` (última mensagem), não data de compra | `disparo.ts:102-106` |
| C-05 | ALTO | IA grava tags livres direto no cadastro; tags decidem audiência de campanha | `ai/classify/route.ts:56-67` |
| C-06 | MÉDIO | Rota de tags sem Zod e sem try/catch; `tags` não-array ou `add` objeto → 500 cru ou dado torto | `tags/route.ts:38-55` |
| C-07 | MÉDIO | `birthday` string inválida → `Invalid Date` → 500; PUT não consegue limpar a data | `contacts/route.ts:74`; `[id]/route.ts:78` |
| C-08 | MÉDIO | P2002 (duplicado) responde 500 genérico em vez de 409 com explicação | `contacts/route.ts:79-84` |
| C-09 | MÉDIO | Nenhuma escrita audita; PUT não grava `modified_by`; sem controle de colisão | `[id]/route.ts:74-80` |
| C-10 | MÉDIO | Leituras aninhadas mostram contato soft-deleted (card do deal, lista de pedidos, conversas) | `deals/route.ts:33-39`; `orders/route.ts:64-67` |
| C-11 | MÉDIO | Excluir contato usa `confirm()` e não modal bloqueante | `contacts/page.tsx:188` |
| C-12 | BAIXO | Filtro "Todos" de tamanho manda `all` e zera a lista | `contacts/page.tsx:175,254`; `contacts/route.ts:44` |
| C-13 | BAIXO | Tags sem normalização (maiúscula, espaço, duplicata) nem catálogo | `contacts/page.tsx:73` |
| C-14 | BAIXO | Busca por telefone é `contains` sensível e sem normalização | `contacts/route.ts:39` |

---

## 5. Pipeline de vendas (deals)

### 5.1 `GET /api/deals` (`src/app/api/deals/route.ts:19-55`)

- **Entrada**: `stage`, `assignedTo` (`all` ignora).
- **Efeito**: `findMany` escopado **sem limite/paginação**, inclui contato (nome, telefone, avatar, tamanho, tags), conversa (canal), responsável; ordena por `last_activity_at desc`. Agrupa em memória nos 6 estágios fixos com `count` e `totalValue` (`44-52`). Deal com estágio fora da lista some do quadro.

### 5.2 `POST /api/deals` (`route.ts:57-108`)

- **Entrada**: `contactId` (obrigatório), `conversationId`, `assignedTo`, `stage` (padrão `lead`), `value` (padrão 0), `products[]` (objetos livres), `notes`, `expectedCloseDate` (`8-17`).
- **Validação**: Zod de tipo; `stage` é `z.string()` livre; `value` aceita negativo; datas não validadas.
- **Efeito**: loja = loja do contato escopado (`68-73`); cria deal (`75-90`); **fora de transação** cria `deal_event` `toStage` + "Deal criado" **sem `changed_by`** (`93-99`).

### 5.3 `GET/PUT/DELETE /api/deals/[id]` (`src/app/api/deals/[id]/route.ts`)

- **GET** (`38-68`): deal + contato completo + conversa + responsável + últimos 20 eventos com autor.
- **PUT** (`70-140`):
  - Entrada opcional: `value`, `products`, `notes`, `assignedTo`, `expectedCloseDate`, `stage`, `lossReason`, `lossNotes` (`17-28`).
  - Sempre atualiza `last_activity_at` (`89-91`).
  - Mudança de estágio (`102-122`): se `lost`, grava `loss_reason`/`loss_notes` (podem ser nulos); cria `deal_event` `from→to` com `changed_by` da sessão e nota `Motivo: <reason|não informado>` (perda) ou `notes`. **O evento é criado antes do update e fora de transação.**
  - Alterações de valor, produtos, responsável e data **não** geram evento nem auditoria.
- **DELETE** (`142-163`): escopo, soft delete. Eventos preservados. Comentário em `150-151` ainda diz "o delete é físico" (desatualizado).

### 5.4 Efeito cruzado: pedido marca deal como ganho

`POST /api/orders` com `dealId` faz `deal.update({stage: "won", lastActivityAt})` dentro da transação do
pedido (`orders/route.ts:150-155`) — **sem `deal_event`**, sem conferir se o deal é da mesma loja ou do mesmo contato.
O Painel de Venda do inbox **não envia `dealId`** (`painel-venda.tsx:145-155`), então na prática
nenhum deal é ganho automaticamente.

### 5.5 Alerta de deal parado

`checkStaleDeals` (`src/lib/alerts/engine.ts:129-171`): deals em `negotiating`/`closing` sem atividade há 3+ dias → alerta `deal_stale` severidade alta. Deduplicação por **contato** (não por deal) nos últimos 3 dias (`146-153`); roda sobre todas as lojas, `take: 50`.

### 5.6 Tela `/pipeline` (`src/app/(dashboard)/pipeline/page.tsx`)

- Kanban de 6 colunas com rótulos PT: Lead, Interessada, Negociando, Fechando, Ganhou, Perdeu (`51-58`); cabeçalho mostra soma em negociação (estágios abertos, `179-181`).
- Arrastar para coluna → `PUT {stage}` (`93-110`), sem checar resposta (toast de sucesso mesmo com erro).
- Arrastar para "Perdeu" abre dialog de motivo: Preço, Tamanho indisponível, Concorrente, Sem resposta, Mudou de ideia, Outro + observações (`60-67`, `306-341`). Sem motivo escolhido envia `other` (`120`).
- "Novo Deal": pede para **colar o UUID do contato** (`350-356`), valor e notas.
- Não há detalhe do deal, edição de valor/responsável/data, histórico de eventos, exclusão, filtro por responsável, nem vínculo com pedido.

### 5.7 Regras de negócio do pipeline (preservar)

- **RN-DL1** Funil de 6 estágios: `lead → interested → negotiating → closing → won | lost` (rótulos PT acima).
- **RN-DL2** Toda mudança de estágio gera evento com estágio de origem, destino, autor (sessão) e momento.
- **RN-DL3** Perder exige motivo de uma lista fechada (preço, tamanho indisponível, concorrente, sem resposta, mudou de ideia, outro) + observação livre.
- **RN-DL4** Deal pertence à loja do contato.
- **RN-DL5** Pedido originado de um deal fecha o deal como ganho.
- **RN-DL6** Deal em negociação/fechamento parado 3+ dias gera alerta.
- **RN-DL7** Excluir deal é lógico; eventos permanecem como rastro.

### 5.8 Defeitos do pipeline

| ID | Sev. | Defeito | Evidência |
|----|------|---------|-----------|
| D-01 | ALTO | `POST /api/orders` fecha qualquer deal por id: sem escopo de loja, sem conferir contato, sem `deal_event` | `orders/route.ts:150-155` |
| D-02 | ALTO | `stage` livre (`z.string()`): estágio inválido some do quadro | `deals/route.ts:12`; `[id]/route.ts:25`; `route.ts:44-52` |
| D-03 | ALTO | Evento de estágio gravado antes do update e fora de transação; evento "Deal criado" sem autor | `[id]/route.ts:111-124`; `route.ts:93-99` |
| D-04 | ALTO | Perda sem motivo aceita pela API; motivo antigo não é limpo ao reabrir; `won`/`lost` reabríveis sem regra | `[id]/route.ts:105-108` |
| D-05 | MÉDIO | `assignedTo` e `conversationId` não conferidos contra a loja (cruzamento de loja; FK inválida → 500) | `route.ts:79-80`; `[id]/route.ts:96` |
| D-06 | MÉDIO | Mudança de valor/responsável/produtos sem evento nem auditoria | `[id]/route.ts:93-99` |
| D-07 | MÉDIO | `GET /api/deals` sem paginação e acumula ganhos/perdidos para sempre | `route.ts:31-41` |
| D-08 | MÉDIO | Sem controle de colisão: dois arrastos simultâneos, último vence | `[id]/route.ts:124-131` |
| D-09 | MÉDIO | Tela não checa erro no arrastar; criar deal exige colar UUID | `pipeline/page.tsx:101-109`, `350-356` |
| D-10 | BAIXO | `products` sem formato (seed usa `qty`, pedido usa `quantity`); `value` negativo aceito | `route.ts:13-14`; `prisma/seed.ts` ~164-169 |
| D-11 | BAIXO | Alerta `deal_stale` deduplica por contato: dois deals parados do mesmo contato geram um alerta | `engine.ts:146-153` |

---

## 6. Pedidos

### 6.1 `GET /api/orders` (`src/app/api/orders/route.ts:37-76`)

- **Entrada**: `status`, `contactId`, `search` (número do pedido ou nome do contato), `masc` (`pendente`|`lancado`|`dispensado`), `page`, `limit` (20, teto 100).
- **Efeito**: lista escopada, inclui contato (id, nome, telefone) e pagamentos (id, método, status, valor); ordena por `created_at desc`. `?masc=pendente` é a fila "falta lançar no Masc" (`51-53`).

### 6.2 `POST /api/orders` (`route.ts:78-180`)

- **Entrada** (`10-30`): `contactId`; `dealId?`; `conversationId?`; `items[]` (mín. 1) com `productId`, `name`, `size`, `quantity ≥ 1`, `unitPrice ≥ 0`; `shippingCost` (0); `discount` (0); `paymentMethod?`; `shippingMethod?`; `shippingAddress?` (objeto livre); `notes?`. `createdBy` vem da sessão.
- **Validação**: Zod de tipo. Não confere `productId` contra o catálogo da loja, não usa preço do catálogo (preço e nome vêm do cliente), não valida tamanho contra a grade, `shippingCost`/`discount` sem mínimo (desconto > subtotal → total negativo), `quantity` aceita fracionário, dinheiro em `number` de ponto flutuante.
- **Efeito** (transação `106-158`):
  1. Loja = loja do contato escopado (`89-94`).
  2. `subtotal = Σ unitPrice × quantity`; `total = subtotal + shippingCost − discount` (`96-97`).
  3. `order.create` com `status=confirmed`, `payment_status=pending`, `masc_status=pendente`, `order_number = proximoNumero(...)`, `created_by` (`108-134`).
  4. `order_event` `confirmed` "Pedido criado" (`136-143`).
  5. Contato: `total_orders += 1`, `total_spent += total` (`145-148`).
  6. Se `dealId`: deal → `won` (`150-155`).
- **Concorrência**: até 5 tentativas quando P2002 (colisão do número) (`162-170`).
- **Não faz**: auditoria em `activity_logs`, reserva por tamanho, checagem de disponibilidade no servidor, escrita em ERP (proibida por ADR 0004).

### 6.3 Número do pedido (`src/lib/pedidos/numero.ts`)

- Formato `MS{AA}{MM}-{SIGLA}-{seq}` → ex. `MS2608-CEN-0001` (`26-29`, `43-47`).
- `siglaDaLoja`: remove acento/espaço/pontuação, 3 primeiras letras maiúsculas, completa com `X`, fallback `LOJ` (`32-40`). Centro → `CEN`, Cerro Azul → `CER`.
- Sequência: `max(substr(order_number, len(prefixo)+1)::int)` entre números da loja com o prefixo do mês e sufixo só dígitos, +1 (`65-87`). Ordena como número (não como texto) para o 10000 não travar a sequência; usa `substr` e não `substring from` (armadilha do Postgres documentada em `75-77`); sufixo fora do padrão é ignorado.
- Colisão entre requisições simultâneas é resolvida pelo índice único + retry no chamador.
- Racional de negócio (`numero.ts:12-24`): número sequencial permite ver **buraco na sequência** ao conferir a fila do Masc; o número aleatório anterior colidia (paradoxo do aniversário).
- **Mês e ano calculados no fuso do servidor** (`getFullYear`/`getMonth`, `44-45`).

### 6.4 `GET/PUT /api/orders/[id]` (`src/app/api/orders/[id]/route.ts`)

- **GET** (`14-36`): pedido escopado + contato (com e-mail) + todos os pagamentos + eventos (desc).
- **PUT** (`38-81`), **sem Zod e sem try/catch**:
  - Aceita `status`, `paymentStatus`, `trackingCode` (+`trackingUrl`), `shippingMethod`, `notes`, `description` (`51-59`).
  - Sempre grava `modified_by`.
  - Se veio `status`, cria `order_event` com `description` do corpo **depois** do update e fora de transação (`69-78`).
  - Qualquer status é aceito (inclusive fora da lista); nenhuma máquina de estados; `paymentStatus` pode ser marcado `paid` manualmente por vendedor, sem pagamento e sem evento.
  - Não mexe em `total_spent` ao cancelar/devolver; não mexe em `masc_status` (proposital, `61-62`).

### 6.5 Ponte com o Masc — `PUT /api/orders/[id]/masc` (`src/app/api/orders/[id]/masc/route.ts`)

- **Contexto (ADR 0004)**: Masc (ERP/PDV da Informezz) é o dono da venda; Bling é o dono do estoque (conta única, depósito por loja) e é alimentado pelo Masc em tempo real; este sistema **não escreve em ERP**. Não há API do Masc: o ciclo fecha quando **uma pessoa** digita a venda no Masc e anota o número aqui (`route.ts:7-18`).
- **Entrada** (`20-34`): `status` ∈ {`lancado`, `dispensado`, `pendente`}; `vendaId` (trim, mín. 1) **obrigatório** se `lancado`; `observacao` (trim, máx. 500) **obrigatória** se `dispensado`.
- **Validação/regra**:
  - Pedido escopado (`45-49`).
  - **409** se `lancado` com `vendaId` diferente de um `masc_venda_id` já registrado, independentemente do status atual (`57-71`): dois números = venda digitada duas vezes = estoque baixado em dobro. O guard não olha `masc_status` para não ser contornado voltando a `pendente`.
- **Efeito** (transação `74-108`):
  - `masc_status = status`; `masc_venda_id` = novo número se `lancado`, senão **preserva o anterior** ("pendente + número" = foi lançado como X e está sendo refeito, `79-83`).
  - `masc_lancado_em`/`masc_lancado_por` = agora/sessão se `lancado`, senão `null` (`84-85`).
  - `masc_observacao = observacao ?? null` (sobrescreve) (`86`).
  - `order_event` com `status` = status **do pedido** e descrição `Lancado no Masc — venda X` | `Nao vai para o Masc — <obs>` | `Voltou para a fila do Masc` (`94-105`).
- **Não faz**: `registrar("pedido_lancado_masc")`; conferir unicidade do `vendaId` entre pedidos; tratar pedido cancelado.

### 6.6 Reservado e disponível para prometer (`src/lib/pedidos/reservado.ts`)

- `reservadoPorSku(storeId)` (`32-66`): soma `quantity` dos itens de pedidos da loja com `masc_status = pendente` e `status ∉ {cancelled, returned}` (`33-41`), agrupa por `productId` (ignora quantidade inválida ou ≤ 0), traduz para SKU via `products.sku` e descarta produto sem SKU (`55-65`). Nunca escreve.
- Usado por `GET /api/products/disponibilidade` e `GET /api/integracoes/bling/catalogo`: `disponivel = saldo do depósito no Bling − reservado`, nunca negativo; saldo desconhecido continua `null` (`docs/api.md:230-252`; testes em `tests/etapa8-fontes-da-verdade.test.ts:123-165`).
- A janela de oversell é exatamente o tempo em que o pedido fica `pendente` (ADR 0004 "A única janela de furo que sobra").
- Granularidade: **por SKU de produto, não por tamanho**. `items[].size` é ignorado.

### 6.7 Telas de pedido

**Painel de Venda no inbox** (`painel-venda.tsx`) — único ponto de criação de pedido:
- Busca catálogo em `/api/products/disponibilidade?busca=` (nome ou SKU) a cada abertura, com debounce de 300 ms (`77-100`).
- Mostra selo `N disp.`, `esgotado` ou `estoque ?`; tooltip com saldo do Bling e reservado (`382-402`); aviso quando o estoque não está ao vivo (`180-189`).
- Carrinho por (produto, tamanho); tamanho "único" quando o produto não tem grade (`227`).
- **Permite vender acima do disponível**, só com aviso (`135-137`, `300-304`, `357-368`).
- "Fechar venda" abre `ModalConfirmacaoBlock` (3 s) com resumo e aviso da fila do Masc (`330-376`) → `POST /api/orders` com `contactId`, `conversationId`, itens. **Não envia frete, desconto, forma de pagamento, endereço, `dealId`.**

**`/orders`** (`src/app/(dashboard)/orders/page.tsx`):
- Lista com número, cliente, status, pagamento, badge Masc (`Falta lançar`/`Lançado`/`Não vai`) + número da venda, total, data relativa (`238-318`). Sem paginação na UI.
- Filtros: busca, status, Masc (`200-232`).
- Ações por linha: ver detalhe; "Gerar Pix" se `payment_status = pending` (**sem modal**, `296-300`, `176-189`); "Registrar lançamento no Masc" só se `pendente` (`301-310`).
- Modal Masc com bloqueio de 3 s pede o número da venda (`323-355`). Só envia `lancado`: **não há UI para `dispensado` nem para voltar à fila.**
- Detalhe (dialog `358-463`): itens, subtotal, frete, desconto, total, pagamentos, timeline; botões `Preparando` → `Enviado` → `Entregue` (`371-385`) sem modal. **Não há UI para cancelar, devolver, informar rastreio, endereço ou marcar pago.**
- Timeline rotula evento com o label de status do pedido (evento de Masc aparece como "Confirmado"/"Enviado").

**Componentes mortos**: `src/components/chat/OrderCard.tsx` e `PaymentCard.tsx` não são importados em lugar nenhum.

### 6.8 Regras de negócio de pedido (preservar)

- **RN-PD1** Pedido pertence à loja do contato; autor vem da sessão.
- **RN-PD2** Pedido do canal nasce `confirmado`, pagamento `pendente` e **pendente de lançamento no Masc**.
- **RN-PD3** `total = Σ(preço unitário × quantidade) + frete − desconto`.
- **RN-PD4** Número sequencial por loja e por mês `MS{AA}{MM}-{SIGLA3}-{0001}`, sem aleatoriedade; a sequência precisa permitir ver buraco.
- **RN-PD5** Este sistema não escreve pedido, estoque ou produto em ERP (Bling nem Masc). Travado por teste (`tests/etapa8-fontes-da-verdade.test.ts:26-65`).
- **RN-PD6** Lançar no Masc exige o número da venda; dispensar exige justificativa escrita; relançar com outro número → 409; voltar à fila preserva o número; toda mudança entra na linha do tempo do pedido; ação passa por modal de 3 s.
- **RN-PD7** Disponível para prometer = saldo do Bling por depósito − quantidade em pedidos pendentes de lançamento e não cancelados/devolvidos; produto sem SKU não é descontado; nunca negativo; desconhecido segue desconhecido.
- **RN-PD8** Venda acima do disponível é permitida com aviso explícito (não bloqueia a vendedora).
- **RN-PD9** Estoque indisponível (Bling fora ou loja sem depósito) degrada para catálogo sem saldo, com aviso; não trava a venda.
- **RN-PD10** Fluxo operacional `confirmed → preparing → shipped → delivered`, com `returned` e `cancelled`; cada mudança gera evento.
- **RN-PD11** Fechar venda é ação crítica: modal com bloqueio de 3 s e resumo dos itens e total.

### 6.9 Defeitos de pedido

| ID | Sev. | Defeito | Evidência |
|----|------|---------|-----------|
| O-01 | CRÍTICO | Preço, nome e produto do item vêm do cliente; nenhum confronto com o catálogo da loja → pedido com preço arbitrário e `productId` de outra loja (que ainda entra no cálculo de reserva) | `orders/route.ts:10-16`, `96`; `reservado.ts:55-58` |
| O-02 | CRÍTICO | O mesmo `masc_venda_id` pode ser anotado em dois pedidos diferentes: uma venda no Masc "cobre" dois pedidos, um nunca é lançado e sai da fila (e da reserva) | `schema.prisma:482`; `masc/route.ts:57-71` só compara com o próprio pedido |
| O-03 | ALTO | Guard 409 do Masc lê fora da transação: duas requisições simultâneas com números diferentes passam | `masc/route.ts:45-71` vs `74` |
| O-04 | ALTO | `PUT /api/orders/[id]` sem Zod: status livre, sem máquina de estados, vendedor marca `paid` sem pagamento e sem evento; evento fora de transação | `[id]/route.ts:51-78` |
| O-05 | ALTO | `discount`/`shippingCost` sem mínimo → total negativo; dinheiro em ponto flutuante; `quantity` fracionária | `orders/route.ts:14-24`, `96-97` |
| O-06 | ALTO | Pedido cancelado continua na fila `pendente` do Masc (poluição da fila) e pedido já lançado que é cancelado não sinaliza estorno no Masc | `reservado.ts:38`; `orders/page.tsx:106` |
| O-07 | ALTO | Nenhuma escrita audita (criar pedido, mudar status, marcar pago, lançar no Masc), apesar de `pedido_lancado_masc` existir | `auditoria.ts:32`; ausência de `registrar(` nas rotas |
| O-08 | ALTO | Reserva por SKU de produto e não por tamanho: vender o M reserva "o produto", e o saldo por grade não é considerado | `reservado.ts:18-22`, `43-52` |
| O-09 | MÉDIO | Número do pedido usa mês do fuso do servidor (container em UTC): pedido após 21h do último dia do mês (BRT) cai no mês seguinte | `numero.ts:44-45` |
| O-10 | MÉDIO | Voltar para `pendente` ou `dispensado` apaga `masc_lancado_em/por`; `masc_observacao` é sobrescrita; quem lançou só sobra na descrição do evento | `masc/route.ts:84-86` |
| O-11 | MÉDIO | `conversationId` e `dealId` do corpo não conferidos contra a loja | `orders/route.ts:112-113` |
| O-12 | MÉDIO | `trackingUrl` e `shippingAddress` sem validação (URL arbitrária, JSON livre) | `[id]/route.ts:54-57`; `orders/route.ts:27` |
| O-13 | MÉDIO | UI sem cancelar, devolver, rastreio, dispensar Masc, voltar à fila; "Gerar Pix" e mudança de status sem modal | `orders/page.tsx:296-310`, `371-385` |
| O-14 | MÉDIO | `order_events.status` mistura status do pedido, `paid` e evento de Masc; a timeline rotula errado | `webhooks/payments/route.ts:92`; `masc/route.ts:97`; `orders/page.tsx:448` |
| O-15 | BAIXO | Painel de venda não coleta frete, desconto, pagamento, endereço nem deal | `painel-venda.tsx:145-155` |
| O-16 | BAIXO | Seed usa número fora do padrão atual (`MS2608-0001`) | `prisma/seed.ts` ~175 |
| O-17 | BAIXO | `OrderCard`/`PaymentCard` mortos | sem import em `src/` |

---

## 7. Pagamentos

### 7.1 Provedor (`src/lib/payments/`)

- Interface `PaymentProvider` (`types.ts:24-42`): `generatePix({amount, description, expirationMinutes})`, `generatePaymentLink({amount, description, items})`, `getPaymentStatus(externalId)`, `refund(externalId, amount?)`.
- `getPaymentProvider()` lê `PAYMENT_PROVIDER` mas **sempre devolve o mock** (casos reais comentados, `index.ts:4-13`).
- Mock (`mock-provider.ts`): Pix com id `pix_<ts>_<rand>`, expiração padrão 30 min, copia-e-cola falso, QR em SVG base64 com valor e descrição (`10-23`); link `https://pay.mock.dev/<id>?amount=...` válido 24 h (`25-34`); `getPaymentStatus` sempre `pending`; `refund` sempre `success`. `getPaymentStatus` e `refund` não são chamados por ninguém.

### 7.2 `POST /api/payments/pix` (`src/app/api/payments/pix/route.ts:16-68`)

- **Entrada**: `orderId`, `expirationMinutes` (padrão 30, sem mínimo/máximo) (`8-11`).
- **Efeito**: pedido escopado (`26-31`); chama o provedor com `total` do pedido e descrição `Pedido <n> — Merlos Store` (`34-38`); cria `payment` `pix/pending` com QR, copia-e-cola e expiração (`40-52`); **fora de transação** marca `orders.payment_method = pix` (`55-58`).
- **Não confere**: status do pedido (cancelado/devolvido), se já está pago, se há cobrança pendente não expirada (gera N cobranças), idempotência. Sem autor, sem auditoria.
- **Tela**: botão "Gerar Pix" em `/orders` (`orders/page.tsx:176-189`). O QR/copia-e-cola **não é exibido** em lugar nenhum (`PaymentCard` morto) nem enviado à cliente pela conversa.

### 7.3 `POST /api/payments/link` (`src/app/api/payments/link/route.ts:15-66`)

Igual ao Pix, com `method = link`, itens do pedido repassados ao provedor, validade 24 h, `payment_method = link`.
**Nenhuma tela chama esta rota.**

### 7.4 Webhook `POST /api/webhooks/payments` (`src/app/api/webhooks/payments/route.ts:12-104`)

- **Autenticação**: segredo compartilhado `PAYMENT_WEBHOOK_SECRET` no header `x-webhook-secret` ou `asaas-access-token`, comparação em tempo constante; sem segredo configurado → 403 (`webhook-auth.ts:135-144`). Não é HMAC do provedor (anotado como `ponytail`).
- **Entrada**: JSON; `externalId` = `data.id` | `payment.id` | `id` (`23-30`).
- **Efeito**:
  - `payment.findFirst({externalId})` **global** (sem provedor, sem loja) (`33-40`); desconhecido → 200 silencioso (`42-45`).
  - Status deduzido por substring em `action|type|event` ou `body.status` (`48-69`): `approved`/`payment.confirmed`/`PAYMENT_RECEIVED` → `approved`; `rejected`/`cancelled` → `rejected`; `refund` → `refunded`.
  - `approved`: payment `approved` + `paid_at`; pedido `payment_status = paid`; `order_event` `paid` "Pagamento confirmado via <método>" (`71-96`). `rejected`/`refunded` só atualizam o payment.
  - Qualquer exceção → **200** (`100-103`).

### 7.5 Alerta de Pix pendente

`checkPendingPayments` (`engine.ts:267-313`): Pix `pending` criado há 20+ min e ainda não expirado → alerta `payment_pending` média, deduplicado por pedido não reconhecido.

### 7.6 Regras de negócio de pagamento (preservar ou decidir)

- **RN-PG1** Cobrança sobre o `total` do pedido, por Pix (expira em 30 min por padrão) ou link (24 h).
- **RN-PG2** Gerar cobrança grava o pagamento `pendente` e registra a forma no pedido.
- **RN-PG3** Só o gateway confirma pagamento; webhook sem segredo configurado recusa (falha fechada).
- **RN-PG4** Confirmação aprovada marca o pedido como pago e entra na linha do tempo.
- **RN-PG5** Pix pendente há 20+ min, ainda válido, gera alerta para a vendedora cobrar.
- **Decisão aberta**: não há provedor real; tudo é demo. Ver seção 14.

### 7.7 Defeitos de pagamento

| ID | Sev. | Defeito | Evidência |
|----|------|---------|-----------|
| P-01 | CRÍTICO | Provedor é sempre mock; cobrança falsa grava `payments` real | `payments/index.ts:4-13` |
| P-02 | CRÍTICO | Webhook não confere valor, não confere provedor, busca `external_id` global e sem unicidade | `webhooks/payments/route.ts:33-40`; `schema.prisma:531` |
| P-03 | CRÍTICO | Webhook devolve 200 em qualquer erro: o gateway não reentrega e a confirmação some | `webhooks/payments/route.ts:100-103` |
| P-04 | ALTO | Sem idempotência: evento `approved` repetido duplica `order_event` e reescreve `paid_at`; status regride (`approved` → `rejected`) | `route.ts:71-96` |
| P-05 | ALTO | Classificação por substring (`includes("approved")`); `action` não-string lança e cai no 200 silencioso | `route.ts:48-69` |
| P-06 | ALTO | `refunded` não atualiza o pedido; expiração nunca é marcada (`expired` não existe na prática) | `route.ts:83-96`; `engine.ts:276` |
| P-07 | ALTO | Cobrança gerada para pedido cancelado/pago, múltiplas pendentes, sem idempotência; update do pedido fora de transação | `pix/route.ts:26-58`; `link/route.ts:25-56` |
| P-08 | ALTO | Autenticação por segredo compartilhado, não por assinatura do provedor | `webhook-auth.ts:126-144` |
| P-09 | MÉDIO | `payments` sem `store_id`, autor e `updated_at`; nenhuma auditoria | `schema.prisma:527-546` |
| P-10 | MÉDIO | QR Pix não é mostrado nem enviado à cliente; link sem UI | `PaymentCard.tsx` morto; nenhum `fetch("/api/payments/link")` |
| P-11 | BAIXO | QR em data-URI completo dentro do banco | `pix/route.ts:48` |

---

## 8. Trocas e devoluções

### 8.1 `GET /api/returns` (`src/app/api/returns/route.ts:19-39`)

Filtro `status`; escopado; inclui contato (nome, telefone) e pedido (número); **sem paginação nem limite**.

### 8.2 `POST /api/returns` (`route.ts:41-79`)

- **Entrada**: `orderId`, `contactId`, `conversationId?`, `type` (string; comentário: exchange|return|refund), `reason` (string; comentário: wrong_size|defect|not_as_expected|changed_mind|other), `reasonDetail?`, `items[]` (objetos livres), `mediaIds[]` (`8-17`).
- **Validação**: só tipos. `type` e `reason` livres; `orderId` não é conferido contra a loja nem contra o contato; `items` não confrontados com os itens do pedido; `mediaIds` sem verificação.
- **Efeito**: loja = loja do contato escopado; `...data` espalhado no create com `status = requested` (`59-70`). Não muda o pedido, não audita.
- **Nenhuma tela chama esta rota.**

### 8.3 `PUT /api/returns/[id]` (`src/app/api/returns/[id]/route.ts:6-39`)

- **Entrada**: `status`, `trackingCode`, `refundAmount`, `refundMethod` — **sem Zod, sem try/catch** (`26-30`).
- **Efeito**: `resolved_by = sessão` e `resolved_at = agora` quando `completed` ou `denied` (`32-35`); update por id (`37`).
- **Não faz**: máquina de estados; limite de `refundAmount` (pode passar do total do pedido); estorno no provedor (`refund` nunca chamado); atualizar `orders.status = returned` ou `payment_status`; ajustar `total_spent`; registrar quem aprovou; auditoria; considerar o Masc (devolução de venda já lançada).

### 8.4 Tela `/returns` (`src/app/(dashboard)/returns/page.tsx`)

- Lista com pedido, cliente, tipo (Troca/Devolução/Reembolso), motivo (Tamanho errado/Defeito/Diferente do esperado/Mudou de ideia/Outro), status, data (`47-51`, `101-158`).
- Filtro por status (`87-95`).
- Ações: `requested` → Aprovar/Negar; `approved` → "Em trânsito" (`shipping_back`); `received` → Concluir (`132-151`). **Não há ação para `shipping_back → received`**, então pela tela o fluxo trava em "Enviando" e nunca conclui.
- Sem modal nas ações (aprovar/negar/concluir movem dinheiro); não checa resposta da API (`69-78`); sem criação, detalhe, valor de estorno, rastreio ou mídia.

### 8.5 Regras de negócio de troca (preservar)

- **RN-TR1** Tipos: troca, devolução, reembolso. Motivos: tamanho errado, defeito, diferente do esperado, mudou de ideia, outro (+ detalhe livre e fotos).
- **RN-TR2** Fluxo: `solicitado → aprovado → enviando (cliente devolve) → recebido → concluído`, ou `negado`.
- **RN-TR3** Quem conclui/nega e quando vem da sessão.
- **RN-TR4** A solicitação pertence à loja do contato e referencia um pedido.
- Política comercial semeada na base de conhecimento: "Prazo: 7 dias. Peça com etiqueta. Frete por nossa conta" (`prisma/seed.ts` ~96-104) — **não é aplicada em código**.

### 8.6 Defeitos de troca

| ID | Sev. | Defeito | Evidência |
|----|------|---------|-----------|
| T-01 | CRÍTICO | `refundAmount` livre e sem teto; aprovação de estorno por vendedor sem modal nem auditoria | `returns/[id]/route.ts:29-37`; RBAC padrão |
| T-02 | ALTO | `orderId` não conferido contra loja/contato: devolução pendurada em pedido de outra loja | `returns/route.ts:9`, `59-63` |
| T-03 | ALTO | Sem máquina de estados; sem efeito no pedido (`returned`), no pagamento, em `total_spent`, na reserva ou no Masc | `returns/[id]/route.ts:26-37` |
| T-04 | ALTO | Fluxo da tela trava em `shipping_back` (sem botão para `received`) | `returns/page.tsx:142-151` |
| T-05 | MÉDIO | `type`/`reason`/`items` livres; prazo de 7 dias não validado | `returns/route.ts:12-15` |
| T-06 | MÉDIO | GET sem paginação; PUT sem Zod/try-catch; tabela sem colunas de auditoria | `returns/route.ts:29-36`; `schema.prisma:552-580` |
| T-07 | MÉDIO | Não há como criar solicitação pela interface | nenhum `fetch` POST para `/api/returns` |

---

## 9. Pesquisa de satisfação (CSAT)

### 9.1 `GET /api/surveys` (`src/app/api/surveys/route.ts:14-40`)

Filtro `contactId`; escopado; inclui contato; **últimas 50** por `created_at`; `avgScore` = média de `score` das respondidas **dentre essas 50**; `totalResponses`.

### 9.2 `POST /api/surveys` (`route.ts:42-75`)

- **Entrada**: `contactId`, `conversationId?`, `orderId?`, `triggerType` (string livre) (`7-12`).
- **Efeito**: loja do contato escopado; cria registro com `sent_at = agora` (`60-66`). **Não envia mensagem nenhuma à cliente.**

### 9.3 Estado real

- Não existe rota para registrar `score`/`feedback` nem `responded_at`; nenhum gatilho automático (`conversation_closed`, `order_delivered`) cria pesquisa; nenhuma tela chama `/api/surveys`; `score` sem faixa definida.
- **Conclusão**: CSAT é esqueleto de dados sem fluxo. Decisão de manter ou cortar é do negócio (seção 14).

### 9.4 Regras declaradas (se mantido)

- **RN-CS1** Gatilhos: conversa encerrada, pedido entregue.
- **RN-CS2** Média CSAT calculada só sobre respostas com nota.

### 9.5 Defeitos

| ID | Sev. | Defeito | Evidência |
|----|------|---------|-----------|
| S-01 | ALTO | Feature inexistente na prática: `sent_at` gravado sem envio; sem coleta de resposta; sem tela | `surveys/route.ts:60-66` |
| S-02 | MÉDIO | Média sobre as 50 últimas (não período); `triggerType` livre; `orderId`/`conversationId` não conferidos contra a loja | `route.ts:24-37`, `11` |

---

## 10. LGPD e consentimento

### 10.1 `GET /api/lgpd?contactId=` — direito de acesso (`src/app/api/lgpd/route.ts:12-47`)

- **Entrada**: `contactId` obrigatório (400 se faltar).
- **Validação**: contato no escopo (`27-31`) — com o guard de soft delete, contato excluído logicamente dá 404.
- **Efeito**: devolve JSON com contato, **todas** as conversas com **todas** as mensagens, todos os pedidos, todos os consentimentos e `exportedAt` (`33-46`).
- **Não inclui**: deals, eventos, pagamentos, trocas, pesquisas, alertas, binários de mídia.
- **RBAC**: `GET` padrão → **qualquer papel, inclusive `viewer` e `vendedor`**, exporta o dossiê completo da loja. Sem auditoria da exportação.

### 10.2 `POST /api/lgpd` — registrar consentimento (`route.ts:49-83`)

- **Entrada** (sem Zod, sem try/catch): `contactId`, `type` (`data_processing`|`marketing`|`opt_out`), `granted` (boolean), `channel?`, `ipAddress?` (vindo do **corpo**).
- **Efeito**: contato escopado (`57-61`); cria `consent_log` com a loja do contato (`63-72`); se `type = opt_out` e `granted`, marca `contacts.opt_out = true` (`75-80`), fora de transação.
- **Não faz**: desfazer opt-out (`granted=false` não volta `opt_out` a `false`); guardar quem registrou; guardar texto/versão do termo; auditoria.
- **RBAC**: vendedor pode registrar.
- **Nenhuma tela chama esta rota**; também não há palavra-chave de opt-out/opt-in tratada nas mensagens recebidas (busca por `optin`, `meus-dados`, `excluir-dados`, `parar`, `descadastr` em `src/` só encontra o texto da tela de configurações).

### 10.3 `DELETE /api/lgpd?contactId=` — eliminação (`route.ts:85-154`)

- **Entrada**: `contactId` obrigatório.
- **Validação**: contato no escopo (`99-102`); RBAC `DELETE` → admin e gerente.
- **Efeito**: **exclusão física**, marcada `compliance:delete-fisico-lgpd`, filhos antes dos pais, em ~20 comandos **fora de transação** (`117-151`):
  `consent_logs` → `satisfaction_surveys` → `broadcast_recipients` → `scheduled_messages` → `alerts` (por contato) → por pedido: `payments`, `order_events` → `returns` → `orders` → por deal: `deal_events` → `deals` → por conversa: `message_media` de cada mensagem, `messages` → `conversations` → `contacts`.
- **Regra de negócio (decisão 5)**: eliminação é **por loja**; se a titular for cliente das duas lojas, são duas operações; a rota **não** procura a mesma pessoa na outra loja; a tela deveria avisar (`docs/integracoes.md:342-354`). Gerente pode eliminar (decisão 7).
- **Não faz**: transação; auditoria (`contato_apagado_lgpd` existe e não é chamado); confirmação; apagar `media_files` e objetos no MinIO; apagar alertas ligados por `conversation_id`/`order_id` sem `contact_id`; checar pedidos já lançados no Masc; tratar contato já soft-deleted.
- **Nenhuma tela chama esta rota.**

### 10.4 Tela `/settings/lgpd` (`src/app/(dashboard)/settings/lgpd/page.tsx`)

**Totalmente de fachada.** Estado só local e "Salvar" apenas mostra toast (`41-43`). Mostra:
- Consentimento: "Solicitar consentimento antes de armazenar dados" + mensagem editável (`56-85`).
- Retenção: período 6 meses / 1 ano / 2 anos / indefinido + exclusão automática (`88-124`).
- Direitos do titular: permitir exclusão e exportação via chat; comandos `/meus-dados` e `/excluir-dados` (`127-165`).
- Opt-out: respeitar opt-out de marketing + mensagem mencionando `/optin` (`168-197`).

Nada disso existe no backend (sem tabela de configuração, sem rotina de retenção, sem comandos).

### 10.5 Regras de negócio LGPD (preservar)

- **RN-LG1** Direito de acesso: exportar os dados do titular por loja.
- **RN-LG2** Consentimento é registro de log por tipo (`tratamento de dados`, `marketing`, `opt-out`) com concessão/revogação, canal e momento.
- **RN-LG3** Opt-out vale da próxima mensagem em diante e é respeitado em campanha (montagem e envio).
- **RN-LG4** Eliminação (art. 18, VI) apaga de verdade; é a única exceção ao soft delete (ADR 0002 e 0005); por loja; gerente e admin podem; vendedor e viewer não.
- **RN-LG5** Exclusão operacional (tirar da tela) e eliminação legal são ações distintas e a interface deve deixar isso claro (ADR 0005 "A exceção: LGPD").

### 10.6 Defeitos LGPD

| ID | Sev. | Defeito | Evidência |
|----|------|---------|-----------|
| L-01 | CRÍTICO | `POST /api/lgpd` sem `contactId`: `findFirst({id: undefined, storeId})` — o Prisma ignora `undefined` e devolve **qualquer contato da loja**; consentimento/opt-out cai em cliente errado | `lgpd/route.ts:57-61`, `66` |
| L-02 | CRÍTICO | Exportação do dossiê completo liberada para `viewer` e `vendedor`, sem auditoria | `rbac.ts:34-40`, `86-88`; `lgpd/route.ts:12-47` |
| L-03 | CRÍTICO | Eliminação em ~20 comandos fora de transação: falha no meio deixa o titular parcialmente apagado | `lgpd/route.ts:117-151` |
| L-04 | CRÍTICO | Eliminação não auditada: não há prova de que o pedido do titular foi atendido (nem registro sem PII) | `auditoria.ts:33` sem uso |
| L-05 | CRÍTICO | Contato já excluído logicamente não pode ser exportado nem eliminado (404 pelo guard) | `lgpd/route.ts:27-31`, `99-102`; `soft-delete.ts:42-47` |
| L-06 | ALTO | Eliminação incompleta: `media_files` e binários no MinIO ficam; `activity_logs.details` pode conter PII; alerta sem `contact_id` ligado a conversa/pedido quebra a FK no meio (ver L-03) | `lgpd/route.ts:117-151` |
| L-07 | ALTO | Eliminação apaga pedidos já lançados no Masc sem ponderar retenção legal/comercial (decisão pendente: apagar ou anonimizar) | `lgpd/route.ts:124-130` |
| L-08 | ALTO | Opt-out irreversível; sem opt-in; sem palavra-chave; sem tela; `ip_address` do corpo (forjável) e sem autor | `lgpd/route.ts:63-80` |
| L-09 | ALTO | Tela de configurações LGPD promete recursos inexistentes (retenção, exclusão automática, comandos no chat) | `settings/lgpd/page.tsx:41-43`, `160-161` |
| L-10 | MÉDIO | `POST` sem Zod/try-catch: `granted` não booleano → 500 | `lgpd/route.ts:49-83` |
| L-11 | MÉDIO | Exportação sem limite (todas as mensagens em uma resposta) e incompleta (sem deals, trocas, pagamentos) | `lgpd/route.ts:33-38` |
| L-12 | MÉDIO | Contadores de campanha (`sent_count` etc.) ficam inconsistentes após apagar `broadcast_recipients` | `lgpd/route.ts:119` |

---

## 11. Analytics

### 11.1 `GET /api/analytics?days=` (`src/app/api/analytics/route.ts:6-147`)

- **Entrada**: `days` (padrão 7) via `parseInt` sem validação (`11-12`).
- **Escopo**: todas as 10 consultas usam `escopoDaLoja` (`16`).
- **KPIs e gráficos**:

| Métrica | Como é calculada | Onde |
|---------|------------------|------|
| Conversas abertas | `conversations.status = open` (sem período) | `31` |
| Conversas no período | criadas desde `since` | `34` |
| Mensagens no período | criadas desde `since` | `37` |
| Contatos | total (sem período; soft delete filtrado) | `40` |
| Valor do pipeline | soma de `value` dos deals fora de won/lost | `43-46`, `86` |
| Deals ganhos | `stage = won` e **`updated_at`** ≥ since | `49-51` |
| Receita | soma de `total` de pedidos `payment_status = paid` **criados** no período | `54-57` |
| Taxa de conversão | deals ganhos ÷ conversas criadas no período × 100 (string, 1 casa) | `110-112` |
| Conversas por canal | `groupBy channel` no período | `71-75`, `94-97` |
| Volume por dia | **todas** as mensagens do período em memória, dia em UTC, `customer` = recebidas, resto = enviadas | `78-82`, `100-107` |
| Funil | contagem e valor por estágio aberto | `87-91` |
| "Tempo médio de resposta" | média de `last_message_at − created_at` de até 100 conversas, descartando > 24 h | `60-68`, `115-127` |

### 11.2 Tela `/analytics` (`src/app/(dashboard)/analytics/page.tsx`)

Seletor Hoje (últimas 24 h) / 7 / 30 / 90 dias (`114-124`); 8 cards de KPI (`128-137`); área de volume, pizza por canal, barras do funil, barras de "tempo médio de resposta" (`140-238`). Sem estado de erro: resposta não-ok deixa skeleton para sempre (`73-84`). Não mostra qual loja está sendo vista.

### 11.3 Regras (preservar)

- **RN-AN1** Painel escopado: vendedor vê a loja dele; gestão vê a soma ou filtra por loja.
- **RN-AN2** Indicadores de atendimento e venda por período: conversas, mensagens, contatos, pipeline aberto, vendas fechadas, receita, conversão, canal, volume diário, funil, tempo de resposta por canal.

### 11.4 Defeitos

| ID | Sev. | Defeito | Evidência |
|----|------|---------|-----------|
| A-01 | ALTO | `days` inválido (`abc`) → `Invalid Date` → 500; negativo/enorme aceito | `analytics/route.ts:11-12` |
| A-02 | ALTO | Volume diário carrega todas as mensagens do período em memória (90 dias = varredura completa) | `route.ts:78-82` |
| A-03 | ALTO | "Tempo médio de resposta" não mede resposta (é duração até a última mensagem), amostra arbitrária de 100 | `route.ts:60-68`, `115-127` |
| A-04 | ALTO | Receita depende de `paid`, que só o webhook (inexistente com mock) ou o PUT manual grava: na prática 0 ou manipulável; filtra por data de criação, não de pagamento | `route.ts:54-57`; O-04; P-01 |
| A-05 | MÉDIO | Deals ganhos por `updated_at` (qualquer edição recontabiliza); conversão divide populações diferentes | `route.ts:49-51`, `110-112` |
| A-06 | MÉDIO | Agrupamento diário em UTC, não em America/Sao_Paulo | `route.ts:102` |
| A-07 | BAIXO | Tela sem erro nem indicação de loja | `analytics/page.tsx:73-84` |

---

## 12. Consumidores e dependências cruzadas

| Dependência | Direção | Detalhe |
|-------------|---------|---------|
| Gateway de mensagens → contatos | escreve | cria/acha contato por loja; `last_contact_at` (`gateway.ts:55-77`, `212-216`) |
| IA (`/api/ai/classify`) → contatos | escreve tags | escopado por loja (`classify/route.ts:25-35`), tags sem controle (`56-67`) |
| Campanhas → contatos | lê | segmento por tags, tamanho, gasto, "dias" e opt-out (`disparo.ts:87-107`, `180-198`) |
| Alertas → contatos, deals, pagamentos | lê | `first_contact`, `returning_customer`, `deal_stale`, `payment_pending` (`engine.ts`); cron `/api/alerts/check` com `CRON_SECRET`. SLA por canal: WhatsApp 5 min, Instagram 15, Facebook 30, TikTok 60 (`rules.ts:7-12`) |
| Catálogo/Bling → pedidos | lê | `reservadoPorSku` em `/api/products/disponibilidade` e `/api/integracoes/bling/catalogo` |
| Inbox → pedidos | escreve | Painel de Venda é o único criador de pedido |
| Lojas → pedidos | lê | `DELETE /api/lojas/[id]` recusa com 409 se houver pedido na loja (`docs/api.md:197`) |
| Mensagens agendadas | nenhuma | não foi encontrado envio de agendadas; se vier a existir (gatilhos `post_sale`, `birthday`, `reactivation`, `promotion`), precisa respeitar opt-out |

---

## 13. Invariantes já travadas por teste (portar como critério de aceite)

De `tests/etapa8-fontes-da-verdade.test.ts`:
- nenhuma rota de pedido chama cliente do Bling; a ponte do Masc não finge integração (`44-65`);
- saldo por depósito, nunca soma da rede; depósito ausente → `null`, não zero (`67-121`);
- disponível desconta prometido; desconhecido continua desconhecido; não desconta produto sem SKU; não fica negativo; pedido lançado/cancelado não reserva; cálculo não escreve (`123-165`);
- número: sigla por loja, acento não vira lixo, prefixo com mês e loja, padding de 4 sem truncar, máximo buscado como número, `substr`, sufixo fora do padrão ignorado, sem aleatório, criação em transação, colisão com nova tentativa (`166-240`);
- Masc: nasce pendente; lançado exige número; dispensar exige justificativa; 409 em outro número; guard independente do status; voltar à fila preserva número; modal de 3 s; fila consultável e indexada; lançamento na timeline (`242-300`);
- pedido individual e rota do Masc filtram por loja (`303-324`);
- tela de venda: rota acessível à vendedora, mostra disponível, modal de 3 s, não chama ERP, disponibilidade não escreve, degrada sem Bling e avisa (`326-370`).

De `tests/escopo-loja.test.ts`: vendedor não troca de loja pela query; gestão vê as duas ou filtra; vendedor sem loja fecha; gestão precisa informar loja para gravar; todo handler que toca dado de loja lê a sessão e usa escopo; gateway exige loja para achar/criar contato.

De `tests/soft-delete.test.ts`: nenhuma rota apaga de verdade, exceto as linhas marcadas LGPD.

---

## 14. Perguntas e decisões para os arquitetos

1. **Unicidade de contato x soft delete** (C-01): índice único parcial com `is_deleted = false` (como previa `docs/integracoes.md:306-316`)? E quando um número excluído volta a escrever: reativar o contato antigo ou criar novo?
2. **Normalização de telefone**: formato canônico (E.164 só dígitos com 55?) para unicidade e busca.
3. **Tags**: continuar livres ou virar catálogo por loja (`contatos_tags`)? A IA pode sugerir e aplicar, ou só sugerir?
4. **Opt-out por loja**: contato é isolado, logo opt-out no Centro não vale no Cerro Azul. É o desejado? Como a cliente faz opt-in de volta? Haverá palavra-chave no chat?
5. **LGPD — apagar ou anonimizar pedidos**: o Masc é o dono fiscal da venda; o pedido daqui é registro operacional. Eliminar tudo (hoje) ou anonimizar pedido/pagamento (manter valores, itens e número; remover PII)? Precisa de ADR.
6. **LGPD x trilha append-only**: a trilha não pode ser apagada (regra da base), mas não pode guardar PII do titular eliminado. Registrar eliminação com id pseudônimo, sem PII? Como tratar `activity_logs.details` antigos?
7. **Quem exporta/elimina**: manter gerente e admin para eliminar; restringir exportação (hoje todos)? Exigir modal de 3 s e motivo/protocolo do pedido do titular?
8. **Pagamentos no escopo da reconstrução**: há provedor real contratado (Mercado Pago, Asaas, PagBank)? Se não, cortar Pix/link do R1 em vez de reconstruir mock. Se sim: assinatura do provedor, idempotência por `(provedor, external_id)`, conferência de valor, expiração, estorno.
9. **Marcar pago manualmente**: permitido (Pix direto na conta da loja, dinheiro)? Com qual papel e com qual evidência?
10. **Status operacional do pedido** (preparando/enviado/entregue): este sistema é dono da logística do pedido do canal, ou isso também vive no Masc? Máquina de estados e quem pode cada transição.
11. **Cancelamento**: o que acontece com pedido `pendente` (sai da fila?), com pedido já `lancado` (alertar para estornar no Masc?), com `total_spent`?
12. **Unicidade do número da venda Masc** (O-02): único por loja? Por rede?
13. **Reserva por tamanho** (O-08): o Bling tem SKU por variação (grade tamanho/cor)? A reserva deve ser por variação.
14. **Preço do item**: servidor usa o preço do catálogo (Bling) e a vendedora só aplica desconto explícito?
15. **Frete, desconto, endereço, forma de pagamento** no Painel de Venda: entram no R1?
16. **Deals**: o funil continua necessário ao lado dos pedidos? Pedido criado a partir de conversa deve fechar automaticamente o deal aberto do contato?
17. **Trocas**: prazo de 7 dias vira regra de validação? Estorno passa pelo provedor? Devolução afeta pedido, Masc e reserva? Quem aprova (vendedor ou só gestão)?
18. **CSAT**: manter (definir escala 1–5, canal de envio, gatilhos e coleta da resposta) ou cortar?
19. **Tela de configurações LGPD**: cortar a tela de fachada ou implementar retenção, exclusão automática e comandos?
20. **Fuso**: número do pedido e analytics em America/Sao_Paulo; decidir `timestamp with time zone` e precisão 3 (armadilha do optimistic locking já conhecida).
21. **Métricas de analytics**: definir oficialmente "tempo de primeira resposta", "conversão" e "receita" (por pagamento ou por lançamento no Masc?).

---

## 15. Divergências entre documentação e código (não confiar nos docs antigos)

| Doc | Diz | Código real |
|-----|-----|-------------|
| `docs/api.md:64` e `:540` | `GET /api/lgpd` e `DELETE /api/lgpd` exigem admin | RBAC padrão: GET todos os papéis; DELETE admin+gerente (`rbac.ts:34-40`) |
| `docs/api.md:368` | `DELETE /api/contacts/[id]` é físico | soft delete (`contacts/[id]/route.ts:105-108`) |
| `docs/api.md:389-390` | perda exige `lossReason`; `DELETE` de deal físico | perda aceita sem motivo; soft delete (`deals/[id]/route.ts:105-108`, `157-160`) |
| `docs/api.md:397`, `:402-403` | número `MS{AAMM}-{4 dígitos}` aleatório | sequencial `MS{AAMM}-{SIGLA}-{seq}` (`numero.ts`) |
| `docs/api.md:421` | `resolvedBy` vem do corpo | vem da sessão (`returns/[id]/route.ts:32-35`) |
| `docs/api.md:103`, `:105`, `:107` | `limit` sem teto; trilha só via front | teto 100 existe; trilha não é chamada no domínio |
| `docs/api.md:529-530` | "Nenhuma rota de escrita grava em ActivityLog" | vale para este domínio; outras rotas já gravam |
| `docs/rbac.md:15` | gerente "exporta LGPD" | exporta, mas vendedor e viewer também |
| `src/app/api/deals/[id]/route.ts:150-151` | comentário "o delete é físico" | soft delete logo abaixo |
| `src/app/api/lgpd/route.ts:113` | eliminação "restrita a admin e gerente" | correto para DELETE; GET (exportação) é aberto |

---

## 16. Resumo dos defeitos por severidade

- **CRÍTICO (12 itens)**: C-01, O-01, O-02, P-01, P-02, P-03, T-01, L-01, L-02, L-03, L-04, L-05. Somam-se, por combinação, O-04 com A-04 (receita manipulável) e a ausência total de auditoria no domínio (seção 3.4).
- **ALTO**: C-02 a C-05, D-01 a D-04, O-03 a O-08, P-04 a P-08, T-02 a T-04, S-01, L-06 a L-09, A-01 a A-04.
- **MÉDIO/BAIXO**: demais itens das tabelas 4.9, 5.8, 6.9, 7.7, 8.6, 9.5, 10.6, 11.4.

Padrões que se repetem e devem virar regra de desenho, não correção pontual:
1. ids secundários do corpo sem conferência de loja;
2. rotas de escrita sem schema (PUT de pedido, troca, tags, POST LGPD);
3. efeitos em múltiplas tabelas fora de transação (evento de deal, pagamento, LGPD, evento de pedido);
4. nenhuma escrita do domínio na trilha de auditoria;
5. status e tipos como texto livre, sem máquina de estados;
6. valores monetários e preços vindos do cliente;
7. telas que prometem o que o backend não faz (configurações LGPD, CSAT, link de pagamento, troca sem criação).
