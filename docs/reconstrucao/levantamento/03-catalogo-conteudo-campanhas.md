# Levantamento 03 — Catálogo, conteúdo e campanhas (sistema antigo)

> Repositório: `C:\Users\Paulo\Documents\MerlostoreChat`, branch `refactor/reconstrucao-estrutura-base`, commit de referência `5e902d4`.
> Todos os caminhos abaixo são relativos a essa raiz. `arquivo:linha` aponta para o código lido em 15/09/2026.
> O código é **referência de domínio**, não de implementação. Onde a doc (`docs/api.md`) diverge do código, vale o código (ver seção 15).

## Sumário

1. [Contexto transversal que afeta todas as rotas do domínio](#1-contexto-transversal)
2. [Modelo de dados atual do domínio](#2-modelo-de-dados-atual)
3. [Produtos (catálogo local)](#3-produtos-catálogo-local)
4. [Bling somente leitura e disponibilidade](#4-bling-somente-leitura-e-disponibilidade)
5. [Galeria de mídia (MinIO)](#5-galeria-de-mídia-minio)
6. [Lookbooks](#6-lookbooks)
7. [Respostas rápidas (atalhos)](#7-respostas-rápidas-atalhos)
8. [Templates do WhatsApp](#8-templates-do-whatsapp)
9. [Base de conhecimento](#9-base-de-conhecimento)
10. [Campanhas (broadcasts) e disparo em lote](#10-campanhas-broadcasts-e-disparo-em-lote)
11. [Mensagens agendadas](#11-mensagens-agendadas)
12. [Telas](#12-telas)
13. [Testes que travam invariantes (viram requisito)](#13-testes-que-travam-invariantes)
14. [Conformidade com as regras absolutas da base](#14-conformidade-com-as-regras-da-base)
15. [Divergências doc x código](#15-divergências-doc-x-código)
16. [Regras de negócio a preservar](#16-regras-de-negócio-a-preservar)
17. [Defeitos consolidados por severidade](#17-defeitos-consolidados-por-severidade)
18. [Perguntas abertas para arquitetura e cliente](#18-perguntas-abertas)

---

## 1. Contexto transversal

Estas peças valem para **todas** as rotas deste domínio. Quem desenhar o sistema novo precisa saber o que elas faziam (e não faziam).

### 1.1 Sessão e autoria
- `usuarioDaSessao()` lê o JWT do NextAuth e devolve `{ id, role, storeId }` (`src/lib/sessao.ts:22-30`). Não vai ao banco: **papel e loja valem até o token expirar** (conflita com a regra "papel e is_active lidos do banco a cada requisição").
- Autoria (`createdBy`, `uploadedBy`, `modifiedBy`, `senderId`) vem sempre da sessão, nunca do corpo. Regra a preservar.

### 1.2 Escopo de loja
| Função | Onde | Comportamento |
|---|---|---|
| `escopoDaLoja(usuario, lojaPedida)` | `src/lib/loja.ts:58-68` | vendedor/viewer: `{storeId: <loja do cadastro>}` (ou `"__sem_loja__"` se nulo). admin/gerente: `{storeId: lojaPedida}` ou `{}` (as duas lojas) |
| `lojaParaGravar(usuario, lojaPedida)` | `src/lib/loja.ts:77-83` | vendedor: loja do cadastro. Gestão: loja pedida ou `null` → rota responde 400 (`faltaLoja`) |
| `lojaAtiva(req)` | `src/lib/loja.ts:98-109` | `?loja=` na URL, senão cookie `loja_ativa` (seletor do cabeçalho) |
| `foraDaLoja(oQue)` | `src/lib/loja.ts:131-136` | 404 "não encontrado nesta loja" — registro de outra loja responde igual a inexistente |

Regra da casa documentada em `docs/rbac.md:67-72`: **id que vem do corpo** (templateId, productId, mediaFileIds, contactId) precisa ser conferido contra a loja resolvida; o `where` escopado não o alcança. Vários handlers deste domínio ainda não fazem isso (seção 17).

### 1.3 RBAC (só na API, via middleware)
`src/lib/rbac.ts:34-40` + exceções `:47-89`. Páginas **não** têm RBAC (`src/middleware.ts:76-81`).

| Método | admin | gerente | vendedor | viewer |
|---|:-:|:-:|:-:|:-:|
| GET | sim | sim | sim | sim |
| POST / PUT / PATCH | sim | sim | sim | não |
| DELETE | sim | sim | **não** | não |

Exceções relevantes ao domínio:
- `DELETE /api/scheduled/[id]` → admin, gerente, vendedor (é cancelamento lógico) — `src/lib/rbac.ts:49-54`.
- `/api/integracoes/**` (inclui `bling/catalogo` e `bling/depositos`) → só admin em qualquer método — `:58-62`.

Consequências para este domínio:
- **Vendedor pode criar e disparar campanha em massa** (`POST /api/broadcasts`, `PUT` status `sending`, `POST .../disparar`). Não há papel específico para marketing.
- Vendedor pode alterar preço de produto, aprovar template manualmente (`PUT status: approved`) e forjar status de agendamento.
- As telas mostram botões de excluir para vendedor/viewer; a API devolve 403 e várias telas não tratam o erro (seção 12).

### 1.4 Soft delete central (extensão Prisma)
`src/lib/db/soft-delete.ts`:
- Models com filtro automático `isDeleted: false`: `Contact, Deal, MediaFile, Lookbook, KnowledgeArticle, QuickReply, WhatsappTemplate, Broadcast` (`:18-27`).
- Operações filtradas: `findMany, findFirst, findFirstOrThrow, count, aggregate` (`:38`). **`findUnique` e `update` não são filtrados**; um teste proíbe `findUnique` nesses models, mas `src/lib/broadcasts/disparo.ts:54,145,179` usa `findUnique` em `Broadcast`/`Contact` (caminho interno, sem filtro).
- Quem passar `isDeleted` explicitamente no `where` desliga o filtro (`:46`).
- **Fora da lista**: `Product` (não tem coluna), `ScheduledMessage` (não tem coluna), `BroadcastRecipient` (não tem coluna).

### 1.5 Paginação
`src/lib/paginacao.ts`: `limiteDaPagina` grampeia em 1..100 (`LIMITE_MAXIMO = 100`, `:19`), `paginaAtual` ≥ 1. Usada só em `GET /api/products` e `GET /api/media/gallery`. Lookbooks, quick-replies, templates, knowledge, broadcasts **não paginam** (lista inteira). Scheduled usa `take: 50` fixo.

### 1.6 Trilha de auditoria
`src/lib/auditoria.ts`: `registrar()` grava em `activity_logs`, nunca derruba a operação, lista fechada de ações (`:23-35`). **Deste domínio só existe `campanha_disparada`**. Nenhum CRUD de produto, mídia, lookbook, atalho, template, artigo, campanha (criar/pausar/excluir) ou agendamento registra trilha.

### 1.7 Timestamps
Prisma sem `@db.Timestamp(n)` explícito → Postgres `timestamp(3) without time zone`. Nenhuma rota deste domínio faz optimistic locking (nenhum `PUT` compara `updated_at`).

---

## 2. Modelo de dados atual

Fonte: `prisma/schema.prisma`. Nomes em inglês (o sistema novo usa PT hierárquico). A coluna "Sugestão PT" é **proposta a validar pela arquitetura**, não decisão.

### 2.1 `products` — `schema.prisma:368-395` (Sugestão PT: `produtos`)
| Coluna | Tipo | Observação |
|---|---|---|
| id | uuid | |
| store_id | FK stores | obrigatória |
| name | text | obrigatória |
| sku | text? | `@@unique([storeId, sku])` — **não parcial**; casa com `codigo` do Bling |
| description | text? | |
| category | text? | livre; UI usa `vestidos, blusas, calcas, saias, shorts, conjuntos, macacoes, jaquetas, acessorios` |
| size_type | text | `slim / plussize / both`, livre no banco |
| sizes | text[] | grade de tamanhos ("PP".."GG", "46".."58") |
| price | decimal(10,2) | |
| compare_at_price | decimal? | "preço anterior" |
| cost_price | decimal? | custo — **exposto a todos os papéis no GET** |
| stock | jsonb | mapa tamanho → quantidade, ex. `{"P":5,"M":3,"48":2}` — **não é verdade de estoque** (ADR 0004) |
| weight_grams | int? | |
| image_urls | text[] | URLs livres (não FK) |
| active | bool | usado como "excluído" pelo DELETE |
| featured | bool | |
| created_at, updated_at | timestamp(3) | |

Faltam: `deleted_at`, `is_deleted`, `modified_by`. Relação reversa: `media_files.product_id`.

### 2.2 `media_files` — `schema.prisma:286-320` (Sugestão PT: `midias` ou `lojas_midias`)
| Coluna | Tipo | Observação |
|---|---|---|
| store_id | FK | |
| original_name | text? | nulo para mídia recebida por webhook |
| file_key | text | chave no bucket `{storeId}/{pasta}/{uuid}.{ext}` |
| file_url | text | **rota interna** `/api/media/{id}/raw`, nunca URL do bucket |
| thumbnail_key / thumbnail_url | text? | `<chave>.thumb.webp` e `/api/media/{id}/raw?thumb=1` |
| file_type | text | `image / video / audio / document` |
| mime_type | text? | declarado pelo cliente |
| file_size | int? | bytes |
| width, height | int? | só imagem |
| duration | int? | **nunca preenchido** |
| product_id | FK products? | vínculo mídia→produto |
| folder | text | default `general`; valores vistos: `produtos, lookbooks, stories, general, incoming, chat` + qualquer string do cliente |
| tags | text[] | |
| uploaded_by | FK users? | nulo em mídia recebida |
| 5 colunas de auditoria | | presentes |

### 2.3 `message_media` — `schema.prisma:322-341` (vínculo mensagem↔mídia; domínio de chat, citado porque o soft delete de mídia afeta o histórico)

### 2.4 `lookbooks` — `schema.prisma:343-362` (Sugestão PT: `lookbooks` + `lookbooks_midias` + `lookbooks_produtos`)
`name`, `description`, `cover_media_id` (text, **sem FK**), `product_ids text[]` e `media_ids text[]` (**arrays sem FK**), `active`, 5 colunas de auditoria.

### 2.5 `quick_replies` — `schema.prisma:615-635` (Sugestão PT: `respostas_rapidas`)
`title`, `content`, `category` (livre; UI: `frete, medidas, troca, pagamento, rastreio, geral`), `shortcut` (ex. `/frete`, `@@unique([storeId, shortcut])` **não parcial**), `media_ids text[]` (sem FK, **não exposto na API**), `is_active`, 5 colunas de auditoria.

### 2.6 `whatsapp_templates` — `schema.prisma:641-671` (Sugestão PT: `templates_whatsapp` ou `lojas_integracoes_templates`)
`name` (`@@unique([storeId, name])` não parcial), `category` (`marketing / utility / authentication`), `language` (default `pt_BR`), `header_type` (`text/image/video/document`), `header_content`, `body` (com `{{1}}`, `{{2}}`), `footer`, `buttons jsonb`, `meta_template_id`, `status` (`draft / pending / approved / rejected`), `rejection_reason`, `submitted_at`, `approved_at`, 5 colunas de auditoria. **Sem vínculo com a conta (WABA/número)**.

### 2.7 `knowledge_articles` — `schema.prisma:812-834` (Sugestão PT: `artigos_conhecimento` / `base_conhecimento_artigos`)
`title`, `content` (UI diz Markdown), `category` (UI: `medidas, frete, troca, pagamento, tecidos, combinacoes, procedimentos`), `tags text[]`, `is_public` (semântica indefinida, sem consumidor), `created_by` FK users, 5 colunas de auditoria.

### 2.8 `broadcasts` — `schema.prisma:711-755` (Sugestão PT: `campanhas`)
| Coluna | Observação |
|---|---|
| name | |
| template_id | FK obrigatória para whatsapp_templates |
| channel | text default `whatsapp` (livre) |
| store_integracao_id | FK stores_integracoes? — **por qual número sai** (adicionada também por `prisma/sql/constraints.sql`, final do arquivo) |
| segment_filter | jsonb — ver 10.3 |
| content | text? — só usado no uazapi |
| media_ids | text[] — **nunca usado no disparo** |
| total_recipients, sent_count, delivered_count, read_count, replied_count, failed_count | contadores; delivered/read/replied **nunca atualizados** |
| status | `draft / scheduled / sending / paused / completed / cancelled` |
| scheduled_for, started_at, completed_at | `scheduled_for` gravado e **ninguém observa** |
| created_by | FK users |
| 5 colunas de auditoria | presentes |

### 2.9 `broadcast_recipients` — `schema.prisma:757-779` (Sugestão PT: `campanhas_destinatarios`) — **é a fila**
`broadcast_id` FK, `contact_id` FK, `status` (`pending / sending / sent / delivered / read / replied / failed`), `external_id`, `sent_at`, `delivered_at`, `read_at`, `replied_at`, `error_message`, `created_at`.
Faltam: `updated_at`, `deleted_at`, `is_deleted`, `modified_by`; **não há `UNIQUE(broadcast_id, contact_id)`**; **não há índice** em `(broadcast_id, status, created_at)` (a reserva do lote faz varredura).

### 2.10 `scheduled_messages` — `schema.prisma:677-705` (Sugestão PT: `mensagens_agendadas` / `conversas_agendamentos`)
`conversation_id` FK?, `contact_id` FK, `content`, `content_type` (`text / template / product / media`), `template_id` FK?, `template_vars text[]`, `media_ids text[]` (sem FK), `scheduled_for`, `trigger_type` (`manual / follow_up / post_sale / abandoned / reactivation / birthday / promotion`), `status` (`scheduled / sent / cancelled / failed`), `sent_at`, `error_message`, `created_by`, `created_at`.
Faltam: `updated_at`, `deleted_at`, `is_deleted`, `modified_by`.

### 2.11 Referências de outras tabelas usadas pelo domínio
- `stores.bling_deposito_id` (`schema.prisma:25`) — de-para loja ↔ depósito do Bling; **nulo nas duas lojas** hoje (ADR 0004, "Riscos").
- `stores_integracoes` (`schema.prisma:62-104`) — Bling é linha única com `store_id` nulo; WhatsApp tem N linhas por loja com `provedor` `whatsapp_oficial` ou `uazapi`.
- `contacts.opt_out`, `contacts.tags`, `contacts.preferred_size`, `contacts.total_spent`, `contacts.last_contact_at` — base da segmentação.
- `orders.items` (jsonb `[{productId, name, size, quantity, unitPrice}]`) e `orders.masc_status` — base do "reservado".

### 2.12 Onde FK e ON DELETE ficam hoje
Prisma: relação opcional → `ON DELETE SET NULL`; obrigatória → `RESTRICT`. Nenhuma relação deste domínio declara `onDelete`. Todos os arrays de ids (`image_urls`, `product_ids`, `media_ids`, `template_vars`, `cover_media_id`) **não têm integridade referencial nenhuma** — viola "NUNCA criar tabela sem FK".

---

## 3. Produtos (catálogo local)

### 3.1 Rotas
| Rota | Método | Entrada | Validação | Efeito |
|---|---|---|---|---|
| `/api/products` | GET | query `search` (nome/SKU, `contains` insensível), `category`, `sizeType`, `page`, `limit` (padrão 20, máx 100) | paginação grampeada; `category`/`sizeType` usados crus (`src/app/api/products/route.ts:45-46`) | lista escopada por loja, `orderBy createdAt desc`, **inclui inativos** (`:37-56`); devolve `{products,total,page,limit}` |
| `/api/products` | POST | JSON: `name`, `sku?`, `description?`, `category?`, `sizeType` (default both), `sizes[]`, `price ≥ 0`, `compareAtPrice?`, `costPrice?`, `stock` (record string→number), `weightGrams?`, `imageUrls[]`, `active`, `featured` | Zod `:9-24`; loja por `lojaParaGravar` (`:66-67`) | cria produto; SKU duplicado → P2002 → **500 genérico** (`:88`) |
| `/api/products/[id]` | GET | — | escopo loja | 404 se fora da loja (`src/app/api/products/[id]/route.ts:43-59`) |
| `/api/products/[id]` | PUT | JSON parcial (mesmos campos opcionais) | Zod `:16-31`; confere escopo antes (`:67`) | `update` sem `modifiedBy`, sem optimistic locking; `stock` substitui o JSON inteiro (`:71-78`) |
| `/api/products/[id]` | DELETE | — | escopo; RBAC admin/gerente | grava **`active: false`** (`:104`) — não há soft delete de verdade |

### 3.2 Regras de negócio implícitas
- SKU é único por loja (a mesma peça tem o mesmo SKU nas duas lojas — o seed repete de propósito, `prisma/seed.ts:14-24`).
- SKU local = `codigo` no Bling; é o **único** elo entre os dois catálogos.
- Grade: `sizeType` define a grade padrão na UI (`src/app/(dashboard)/products/page.tsx:69-73`): slim `PP,P,M,G,GG`; plussize `46..58`; both = as duas.
- Excluir = inativar, porque `orders.items[].productId` referencia o produto (`src/app/api/products/[id]/route.ts:90-96`).
- `products.stock` continua existindo "como catálogo local" mas **não é verdade de estoque** (ADR 0004, "Alternativas descartadas").
- Produto/preço: dono da verdade declarado é o **Bling** (ADR 0004, tabela). Na prática, o preço é digitado e editado localmente e **não há importação/sincronização** do Bling.

### 3.3 Consumidores de produto fora das rotas
| Consumidor | Onde | O que usa |
|---|---|---|
| Seletor de produto no chat | `src/components/inbox/SeletorProduto.tsx:83-88` | `GET /api/products?limit=20` (inclui inativos); tamanhos "disponíveis" calculados pelo **`stock` local** (`:43-46`); gera texto com nome, preço, tamanhos e `imageUrls[0]` (`:49-60`) — texto vai ao campo, não é enviado direto |
| Painel de venda no chat | `src/app/(dashboard)/inbox/_components/painel-venda.tsx:83` | `GET /api/products/disponibilidade` (Bling) |
| Reserva de estoque | `src/lib/pedidos/reservado.ts:55-58` | `id → sku` (sem filtro de loja) |
| IA (sugestão, oculta na UI) | `src/lib/ai/suggest.ts:40-44` | produtos ativos **sem filtro de loja** |
| Alerta `low_stock` | `src/lib/alerts/rules.ts:42-45` | **só descrito**; o motor (`src/lib/alerts/engine.ts`) não implementa |

### 3.4 Defeitos — produtos
1. **Duas fontes de estoque contraditórias na mesma tela de chat**: SeletorProduto usa `stock` local; PainelVenda usa Bling. Produto criado pela UI sempre tem `stock: {}` → SeletorProduto diz "sem estoque" enquanto o Bling tem peça (`products/page.tsx:109`, `SeletorProduto.tsx:43-46`).
2. **Editar produto pela tela apaga o estoque e a grade**: o formulário manda sempre `stock: {}` e `sizes` = grade padrão do `sizeType` (`products/page.tsx:100-111`); o PUT substitui (`[id]/route.ts:76`). Ex.: Jaqueta com `P,M,G,46,48` vira a grade "both" completa.
3. Filtro "Todas"/"Todos" manda `category=all` / `sizeType=all`, a rota filtra literalmente → lista vazia (`products/page.tsx:323-348` + `route.ts:45-46`).
4. Tela sem paginação: só os 20 primeiros aparecem, sem controles (`products/page.tsx:250-253`).
5. SKU duplicado (inclusive de produto "excluído", já que `active:false` mantém a linha) → 500 genérico, sem mensagem útil (`route.ts:88`).
6. DELETE mistura "inativo" com "excluído"; não há `is_deleted`/`deleted_at`/`modified_by` (`schema.prisma:368-395`).
7. `costPrice` (margem) sai no GET para vendedor e viewer.
8. Zod frouxo: `category`, `sizeType`, `sizes` livres; `stock` aceita negativo e fracionário; `compareAtPrice` sem regra "maior que price"; sem teto de `price`.
9. `imageUrls` são strings livres: SeletorProduto renderiza com `next/image` (`SeletorProduto.tsx:141-147`) e `next.config.mjs` só permite `i.pravatar.cc` → URL externa derruba o seletor. E o link de imagem enviado à cliente (`textoDoProduto`) só funciona se for URL pública — contradiz o bucket privado (a rota `/api/media/[id]/raw` exige sessão).
10. Dois vínculos produto↔imagem concorrentes: `products.image_urls` (usado pela UI) e `media_files.product_id` (usado pela galeria). Nenhum sincroniza com o outro.
11. SeletorProduto oferece produto inativo (GET não filtra `active`).
12. Sem trilha de auditoria para troca de preço; sem optimistic locking.
13. Grade × SKU: o saldo do Bling é **por produto (SKU)**, não por tamanho; o produto local tem um SKU só para todos os tamanhos. O painel deixa escolher "tam M" com o disponível do produto inteiro (`painel-venda.tsx:102-121`). Ver pergunta 18.1.

---

## 4. Bling somente leitura e disponibilidade

### 4.1 Decisão que não pode ser reaberta (ADR 0004 + decisão 6/8 de `docs/integracoes.md`)
- **Masc** é dono da venda. **Bling** é dono do estoque (alimentado pelo vínculo Masc→Bling em tempo real) e de produto/preço. Este sistema **só lê**.
- Conta Bling **única da rede** (`stores_integracoes.store_id` nulo). Separação Centro/Cerro Azul **por depósito** (`stores.bling_deposito_id`).
- Nunca usar `saldoFisicoTotal`/`saldoVirtualTotal` (soma da rede); usar `depositos[].saldoFisico` do depósito da loja.
- Janela de oversell = tempo em que pedido de canal fica `masc_status = pendente`. Por isso: **disponível = saldo do depósito − reservado em pedidos pendentes**.
- Travado em teste: o cliente não pode ter PUT/PATCH/DELETE e exatamente dois POST (OAuth) — `tests/bling.test.ts:104-129`.

### 4.2 Peças
| Arquivo | Responsabilidade |
|---|---|
| `src/lib/bling/config.ts` | endpoints v3 confirmados na OpenAPI oficial (`:38-47`), URL de saldo por depósito com depósito no **path** (`:56-58`), margem de renovação 5 min (`:64`), validade do `state` 60 s (`:67`), credenciais do app em env (`:90-101`), Basic auth (`:104-107`). Limites da API: 3 req/s, 120.000/dia, bloqueio de IP em 600 req/10 s ou 300 erros/10 s, sem `Retry-After` (`:29-30`) |
| `src/lib/bling/estado.ts` | `state` do OAuth = base64url(`{u,t,n}`) + HMAC-SHA256 com `NEXTAUTH_SECRET`, comparação `timingSafeEqual`, expira em 60 s (`:34-76`) |
| `src/lib/bling/cliente.ts` | troca de code e refresh (Basic, form-urlencoded) `:52-104`; `tokenValido` decifra do cofre e renova se faltar < 5 min, regravando no cofre `:132-164`; `buscar` (GET autenticado) marca `status`/`ultimoErro`/`ultimaSincronizacao` na integração `:167-210`; leituras `listarProdutos` `:245`, `listarProdutosPorCodigo` (`codigos[]`) `:259`, `listarDepositos` `:272`, `listarSaldos` (`idsProdutos[]` obrigatório) `:288`, `saldoNoDeposito` (`saldoFisico ?? saldoVirtual`, `null` ≠ 0) `:311-315` |
| `src/lib/pedidos/reservado.ts` | soma por SKU as quantidades de `orders.items` com `masc_status = pendente` e `status NOT IN (cancelled, returned)` da loja (`:32-66`) |

### 4.3 Rotas
| Rota | Quem (RBAC) | Entrada | Efeito / resposta |
|---|---|---|---|
| `GET /api/products/disponibilidade` | todos os papéis | `?busca=` (nome/SKU); loja da sessão ou seletor | exige exatamente 1 loja (senão 400 "Escolha a loja no seletor") `:43-52`; até 50 produtos **ativos** locais por nome asc `:56-72`; se loja tem depósito, há produto com SKU e Bling `conectado`: 2 chamadas (`produtos?codigos[]` → `estoques/saldos/{deposito}?idsProdutos[]`) `:127-137`; devolve `{loja, estoqueAoVivo, produtos:[{id,nome,sku,preco,tamanhos,imagem,saldo,reservado,disponivel}]}`. Bling fora → `estoqueAoVivo:false`, catálogo mesmo assim (`:162-166`) |
| `GET /api/integracoes/bling/catalogo` | só admin | `?pagina=` (inteiro ≥ 1) | exige Bling cadastrado (não exige `conectado`) `:25-31`, 1 loja `:41-50`, depósito configurado (409) `:53-58`; lista página de produtos **do Bling** com saldo do depósito, reservado e disponível; erros: config 503, 401 do Bling → 409, outro → 502 (`:110-121`) |
| `GET /api/integracoes/bling/depositos` | só admin | — | `{conectado, depositos:[{id,descricao}]}` para a tela de lojas escolher o de-para (`:17-48`) |

### 4.4 Regras de cálculo (a preservar)
- `disponivel = max(0, saldo − reservado)`; `saldo = null` ⇒ `disponivel = null` (não saber ≠ zero) — `disponibilidade/route.ts:157`, `catalogo/route.ts:131-139`.
- Produto sem SKU não desconta nada (não chuta produto errado) — `reservado.ts:27-31`.
- Pedido cancelado/devolvido ou já lançado no Masc não reserva — `reservado.ts:36-39`.
- Vender acima do disponível é **permitido com aviso** e passa por modal de bloqueio de 3 s (`painel-venda.tsx:330-376`).

### 4.5 Defeitos — Bling e disponibilidade
1. **Corrida no refresh do token**: duas requisições perto do vencimento renovam ao mesmo tempo; o Bling invalida o refresh anterior a cada uso → a segunda falha e a integração da rede inteira cai para "expirado" (`cliente.ts:153-162`). Sem lock/single-flight.
2. `buscar` grava na tabela `stores_integracoes` **a cada leitura** (`:202-207`) e marca `status: "erro"` em qualquer não-OK, inclusive 429 de rate limit (`:190-198`). Com colunas de auditoria e optimistic locking no sistema novo, isso gera conflito constante.
3. Sem cache nem throttle: cada abertura do painel e cada busca (debounce 300 ms) fazem 2+ chamadas ao Bling; limite é 3 req/s por conta da rede (duas lojas somadas).
4. `listarProdutosPorCodigo` pede `limite: min(n,100)` numa página só (`:265`); a disponibilidade busca até 50 locais, então cabe — mas o catálogo não pagina além disso.
5. Disponível por **produto**, não por tamanho (ver 3.4.13).
6. `saldoNoDeposito` cai de `saldoFisico` para `saldoVirtual` (`:314`), que têm semânticas diferentes no Bling (virtual desconta reservas do próprio Bling).
7. `reservadoPorSku` busca `products` por id **sem filtro de loja** (`reservado.ts:55-58`), e `POST /api/orders` não confere que `items[].productId` é da loja do contato (só valida o contato; `src/app/api/orders/route.ts:86-94`) → item de outra loja pode entrar no reservado com o SKU dela.
8. `state` do OAuth não é de uso único (sem registro de nonce): reaproveitável dentro de 60 s (`estado.ts:48-76`). `NEXTAUTH_SECRET` reutilizado como chave de HMAC do state (troca de auth muda isso).
9. `catalogo` aceita integração não conectada (`:25-28`) e `disponibilidade` exige `conectado` (`:108-111`) — inconsistência.
10. Nenhum catálogo local é importado do Bling: SKU local precisa ser digitado igual ao `codigo` do Bling, sem validação.

---

## 5. Galeria de mídia (MinIO)

### 5.1 Decisões a preservar (ADR 0006)
- SDK S3 (`@aws-sdk/client-s3`), `forcePathStyle: true` (`src/lib/media/armazenamento.ts:53-66`).
- **Bucket privado.** Dois caminhos de leitura: equipe → `GET /api/media/[id]/raw` com sessão **e** escopo de loja; Meta/uazapi → **URL assinada TTL 10 min** gerada no envio e **nunca persistida** (`armazenamento.ts:123-128`).
- `media_files.file_url` guarda a rota interna, não o bucket.
- Chave `{storeId}/{pasta-sanitizada}/{uuid}.{ext}`; nome original nunca vira chave (`:74-78`).
- Miniatura gerada no upload com `sharp`: 200×200 `cover`, webp q80, objeto `<chave>.thumb.webp`; falha não derruba upload; só imagem; vídeo sem miniatura (regressão aceita) (`src/lib/media/upload.ts:20,46-57`).
- Soft delete mantém o objeto no bucket; limpeza definitiva é rotina separada (que **não existe**; `apagar()` em `armazenamento.ts:109-112` não tem chamador).
- `Cache-Control: private` na rota raw.
- Infra: `docker-compose.yml` sobe MinIO (9002 API / 9003 console) e `minio-init` cria `merlostore-midia` com `mc anonymous set none` (linhas 49-82). Env: `S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, S3_REGION` (`.env.example:83-87`). Backup do MinIO **não** está coberto pela política de backup (ADR 0006, Consequências).

### 5.2 Limites de upload (`src/lib/media/limites.ts`)
| Tipo | Teto | MIME aceitos (lista fechada) |
|---|---|---|
| image | 5 MB | `image/jpeg, image/png, image/webp, image/gif` (SVG proibido: executa script) |
| video | 16 MB | `video/mp4, video/quicktime, video/webm, video/3gpp` |
| audio | 16 MB | `audio/mpeg, audio/ogg, audio/wav, audio/webm, audio/aac, audio/mp4` |
| document | 100 MB | `application/pdf`, Word (doc/docx), Excel (xls/xlsx), `text/plain`, `text/csv` |

- Corte grosso por `content-length` antes de ler o corpo (413 acima de 100 MB) — `:77-87`.
- Checagem final com o arquivo: tipo (415), vazio (400), teto do tipo (413) — `:90-111`. Parâmetros do content-type são ignorados (`;charset=`).
- Os tetos são os do WhatsApp (canal mais restritivo).
- `src/lib/media/process.ts` (limites por canal Instagram/Facebook/TikTok, `getAcceptedMimeTypes`) é **código morto**: nenhum import.

### 5.3 Rotas
| Rota | RBAC | Entrada | Validação | Efeito |
|---|---|---|---|---|
| `POST /api/media/upload` | escrita | multipart: `file` (obrig.), `folder` (default `general`), `productId?`, `tags` (CSV). `uploadedBy` do form é ignorado | loja por `lojaParaGravar` `:22-23`; cabeçalho `:29-30`; arquivo `:45-46` | sobe original (+thumb) no MinIO, depois cria `media_files` com id gerado antes (para `file_url` já nascer certo) `:53-84`; 201 com a linha |
| `GET /api/media/gallery` | todos | `folder`, `fileType` (`all` ignorado), `tag` (exata), `productId`, `search` (nome `contains` ou tag exata), `page`, `limit` (30, máx 100) | paginação | lista escopada com `product {id,name}`, `createdAt desc` → `{files,total,page,limit}` (`gallery/route.ts:11-51`) |
| `GET /api/media/[id]` | todos | — | escopo | metadados + produto (`[id]/route.ts:19-39`) |
| `PUT /api/media/[id]` | escrita | JSON `folder`, `tags`, `productId` | escopo; `productId` conferido contra a loja do arquivo `:60-66`; **sem Zod** `:55` | update sem `modifiedBy` `:68-75` |
| `DELETE /api/media/[id]` | admin/gerente | — | escopo | soft delete `isDeleted, deletedAt, modifiedBy`; objeto fica (`:107-110`) |
| `GET /api/media/[id]/raw` | todos | `?thumb=1` | escopo (via `findFirst` + guard) | lê objeto inteiro em memória e devolve com `Content-Type`, `Content-Length`, `Cache-Control: private, max-age=31536000, immutable`, `Content-Disposition: inline` (`raw/route.ts:25-53`); sem miniatura cai no original; S3 fora → 503; objeto ausente → 404 |
| `POST /api/media/send` | escrita | JSON `conversationId`, `mediaFileIds[]` (≥1), `caption?` | Zod `:13-17`; conversa no escopo `:34-41`; cada mídia presa à **loja da conversa** `:72-74` | para cada arquivo: URL assinada, envia pelo adapter da **conta de entrada da conversa** conforme `fileType` (image/video/audio/document) e grava mensagem de saída **só se sucesso** (`:68-120`); devolve `{sent, messages}` 201 |

### 5.4 Mídia recebida por webhook (`src/lib/channels/gateway.ts:124-167`)
- Mensagem com `mediaUrl` e tipo ≠ texto: `subirDeUrl` baixa a URL (Meta/uazapi) e guarda com `pasta = canal` na chave, `folder = "incoming"` no banco, `uploadedBy` nulo, `originalName` nulo.
- Áudio marca `transcriptionStatus: pending` em `message_media`.
- Falha no download é engolida: a mensagem é salva sem mídia (`downloaded: false`, `externalUrl` guardada) e **não há retentativa**.

### 5.5 Envio de mídia pelo chat (`src/lib/chat/midia.ts`, `src/components/inbox/ChatWindow.tsx:295-307`)
- Anexar arquivo = `POST /api/media/upload` com `folder: "chat"` e, em seguida, `POST /api/media/send` com o id. Duas etapas com erros distintos ("arquivo salvo, mas o canal recusou").
- Galeria no chat (`GalleryModal`) lista 30 arquivos (sem paginação), filtros `produtos/lookbooks/general`, multi-seleção, legenda única para todos.
- Mensagem de texto normal usa `src/lib/chat/enviar.ts` (outro domínio), que também assina URL e prende a mídia à loja da conversa (`:87-93`).

### 5.6 Defeitos — mídia
1. **Soft delete quebra o histórico mesmo assim**: a rota raw usa `findFirst`, que recebe `isDeleted:false` do guard → mídia excluída responde 404 e a imagem some das conversas antigas (`raw/route.ts:25-33`). Contradiz o ADR 0006, que manteve o objeto justamente para não quebrar histórico.
2. **Risco de XSS armazenado / MIME sniffing**: o MIME é o declarado pelo navegador (`file.type`), sem checagem de assinatura (magic bytes); `sharp` falhar não recusa; a rota raw serve `inline` **sem `X-Content-Type-Options: nosniff`** (`raw/route.ts:43-53`). `text/plain`/`text/csv` também saem inline.
3. Upload aceita `productId` de outra loja (não confere, ao contrário do PUT) → FK cruzada (`upload/route.ts:35,79`).
4. `folder` é string livre do cliente gravada crua no banco (`upload/route.ts:34,80`); UI da galeria não lista `chat` nem as pastas de canal → uploads do chat só aparecem em "Todas".
5. `req.formData()` carrega o corpo inteiro na memória; requisição sem `content-length` (chunked) passa pelo corte grosso (`limites.ts:78-79`).
6. Objeto é gravado no MinIO **antes** da linha; falha no `create` deixa objeto órfão sem registro (`upload/route.ts:53-84`). Sem limpeza.
7. Rota raw lê o objeto inteiro em memória (`armazenamento.ts:102`), sem streaming e **sem suporte a Range** → documento de 100 MB por requisição na RAM; vídeo sem seek.
8. `media/send`: arquivo não encontrado é pulado em silêncio (`:76`); envio que falha **não grava mensagem `failed`** (só sucesso, `:107-119`), ao contrário de `/api/messages`; exceção do adapter no meio do laço derruba com 500 depois de já ter enviado parte → reenvio duplica. `ChatWindow` não compara `sent` com o pedido.
9. Não verifica se o canal suporta o tipo (Instagram não aceita vídeo/documento via API; WhatsApp imagem só jpeg/png — webp/gif aceitos no upload falham no envio).
10. `subirDeUrl` sem teto de tamanho, sem timeout, sem allowlist de MIME e baixando URL que vem do payload do webhook (`upload.ts:99-113`).
11. `duration` nunca calculado; `sharp` decodifica a imagem duas vezes (thumb + metadata).
12. Sem cota por loja, sem deduplicação por hash, sem rotina de limpeza de objetos de linhas excluídas.
13. `PUT /api/media/[id]` sem Zod: tipos errados em `tags`/`folder` viram 500.
14. `Content-Disposition` usa `filename="<encodeURIComponent>"` em vez de `filename*=UTF-8''`.
15. Nenhuma trilha de auditoria de upload/exclusão; sem `modifiedBy` no PUT.

---

## 6. Lookbooks

### 6.1 Rotas
| Rota | RBAC | Entrada | Validação | Efeito |
|---|---|---|---|---|
| `GET /api/lookbooks` | todos | — | escopo | lista inteira, `createdAt desc`, sem paginação (`lookbooks/route.ts:16-25`) |
| `POST /api/lookbooks` | escrita | `name`, `description?`, `coverMediaId?`, `productIds[]`, `mediaIds[]`, `active` | Zod `:7-14`; loja por `lojaParaGravar` | cria; **ids não conferidos** (`:36-38`) |
| `GET /api/lookbooks/[id]` | todos | — | escopo | 404 fora da loja |
| `PUT /api/lookbooks/[id]` | escrita | `name, description, coverMediaId, productIds, mediaIds, active` | **sem Zod**; escopo | grava os campos do corpo (`[id]/route.ts:54-66`) |
| `DELETE /api/lookbooks/[id]` | admin/gerente | — | escopo | soft delete com `modifiedBy` (`:83-86`) |

### 6.2 Regra de negócio
"Coleção de fotos organizada" (vitrine: quais produtos a loja empurra juntos). Pasta `lookbooks` existe na galeria.

### 6.3 Defeitos — lookbooks
1. **Funcionalidade é casca**: a tela só edita nome e descrição (`gallery/lookbooks/page.tsx:42`); não há como adicionar mídia, produto ou capa, nem enviar lookbook no chat.
2. Tela sem entrada no menu (Sidebar não tem link; só por URL `/gallery/lookbooks`).
3. `product_ids`, `media_ids`, `cover_media_id` sem FK e sem conferência de loja → referência cruzada entre lojas e ids mortos após exclusão.
4. PUT sem Zod; sem `modifiedBy` no update; sem trilha; sem optimistic locking.

---

## 7. Respostas rápidas (atalhos)

### 7.1 Rotas
| Rota | RBAC | Entrada | Validação | Efeito |
|---|---|---|---|---|
| `GET /api/quick-replies` | todos | `search` (título/atalho/conteúdo `contains`), `category`, `apenasAtivas=1` | escopo | lista inteira `createdAt desc` (`quick-replies/route.ts:15-45`) |
| `POST /api/quick-replies` | escrita | `title` (≥1), `content` (≥1), `category?`, `shortcut?`, `isActive` | Zod `:7-13` | cria; atalho repetido → P2002 → 500 (`:65`) |
| `PUT /api/quick-replies/[id]` | escrita | parcial | Zod `:15-21`; escopo | update sem `modifiedBy` (`:45`) |
| `DELETE /api/quick-replies/[id]` | admin/gerente | — | escopo | soft delete (`:68-71`) |

### 7.2 Uso no chat (`src/components/inbox/MenuAtalhos.tsx`, `ChatWindow.tsx:311-324,415-423`)
- Digitar `/` numa linha vazia (regex `^\/(\S*)$`) abre o menu; busca no servidor com debounce 150 ms, `apenasAtivas=1`.
- Setas navegam, Enter escolhe (não envia), Esc fecha e **limpa o campo**.
- Escolher **coloca o conteúdo no campo**; a atendente envia manualmente.
- Não há variáveis (ex. nome da cliente) nem anexos (`media_ids` existe no schema e é ignorado).

### 7.3 Defeitos — respostas rápidas
1. `UNIQUE(store_id, shortcut)` não parcial + soft delete: excluir `/frete` e recriar → 500 (`schema.prisma:632`).
2. Formato do atalho não validado (aceita sem `/`, com espaço etc.).
3. Tela não tem campo "ativo": impossível desativar pela UI, embora a API aceite (`quick-replies/page.tsx:59-64`).
4. `media_ids` morto no schema.
5. Sem paginação; sem trilha; sem optimistic locking; sem `modifiedBy` no update.
6. IA (oculta) lê atalhos de **todas as lojas** (`src/lib/ai/suggest.ts:60-63`).
7. Comentário do handler afirma que vendedor de outra loja reescrevia o atalho — hoje fechado pelo escopo; manter teste equivalente.

---

## 8. Templates do WhatsApp

### 8.1 Regra de negócio fixa
- Template aprovado só existe para número **`whatsapp_oficial`** (Meta Cloud API). No **uazapi** não há template nem janela de 24 h; `sendTemplate` do uazapi **falha de propósito** para não mandar o nome do template como texto (`src/lib/channels/uazapi.ts:100-115`; `docs/integracoes.md:482-485`).
- Envio oficial: `POST /{phoneId}/messages` com `type: template`, `name`, `language.code`, e `components[body].parameters` com as variáveis (`src/lib/channels/whatsapp.ts:181-215`).

### 8.2 Rotas
| Rota | RBAC | Entrada | Validação | Efeito |
|---|---|---|---|---|
| `GET /api/templates` | todos | `status`, `category` (`all` ignorado) | escopo | lista inteira `createdAt desc` (`templates/route.ts:19-37`) |
| `POST /api/templates` | escrita | `name`, `category` (string livre), `language` (default pt_BR), `headerType?`, `headerContent?`, `body` (≥1), `footer?`, `buttons?` (array de objetos livres) | Zod `:8-17` | cria com `status: draft` (default do banco); nome repetido → 500 |
| `GET /api/templates/[id]` | todos | — | escopo | 404 fora da loja |
| `PUT /api/templates/[id]` | escrita | qualquer um de `name, category, headerType, headerContent, body, footer, buttons, status, rejectionReason, metaTemplateId` | **sem Zod**; escopo | `status: pending` carimba `submittedAt`; `approved` carimba `approvedAt`; `rejected` grava `rejectionReason` (`[id]/route.ts:53-69`) |
| `DELETE /api/templates/[id]` | admin/gerente | — | escopo | soft delete (`:85-88`) |

### 8.3 Defeitos — templates
1. **Não há integração com a Meta**: "Enviar para aprovação" só grava `status: pending` e mostra toast de sucesso (`templates/page.tsx:153-161`). Aprovação/rejeição é um `PUT` manual — **qualquer vendedor pode marcar `approved`**. Nenhum webhook `message_template_status_update`.
2. Editar `body` de template aprovado **não volta o status**; o disparo oficial manda só o `name` e a Meta usa o corpo aprovado lá, enquanto a tela mostra o corpo editado.
3. Template é por **loja**, mas na Meta pertence à conta de negócio (WABA) do número. Com N números por loja (possivelmente WABAs diferentes), falta vínculo template ↔ integração. A listagem também não filtra por provedor.
4. Validação fraca: nome sem regra da Meta (minúsculas/underscore), `category`/`language`/`headerType` livres, `buttons` JSON livre, número de variáveis `{{n}}` não é extraído nem guardado.
5. Tela só edita nome, categoria, corpo e rodapé (sem idioma, cabeçalho, botões) (`templates/page.tsx:65-70`).
6. Exclusão não verifica uso por campanha/agendamento (FK RESTRICT não dispara porque é soft delete); o disparo lê o template por `include` sem filtro e continua enviando template excluído.
7. `UNIQUE(store_id, name)` não parcial com soft delete.
8. Sem trilha (a lista de ações de auditoria nem tem `template_*`), sem optimistic locking.

---

## 9. Base de conhecimento

### 9.1 Rotas
| Rota | RBAC | Entrada | Validação | Efeito |
|---|---|---|---|---|
| `GET /api/knowledge` | todos | `search` (título/conteúdo `contains`, tag exata), `category` | escopo | lista inteira com `author {id,name}`, `updatedAt desc` (`knowledge/route.ts:16-41`) |
| `POST /api/knowledge` | escrita | `title` (≥1), `content` (≥1), `category?`, `tags[]`, `isPublic` (default false) | Zod `:7-14`; autor da sessão | cria (`:54-56`) |
| `GET /api/knowledge/[id]` | todos | — | escopo | 404 fora da loja |
| `PUT /api/knowledge/[id]` | escrita | `title, content, category, tags, isPublic` | **sem Zod**; escopo | grava campos do corpo (`[id]/route.ts:54-63`); `null` em campo obrigatório → 500 |
| `DELETE /api/knowledge/[id]` | admin/gerente | — | escopo | soft delete (`:80-83`) |

### 9.2 Defeitos — base de conhecimento
1. **Sem consumidor**: nada no sistema lê os artigos (a IA não usa, embora o comentário diga que usa — `[id]/route.ts:10-13`). É um repositório de texto para a equipe.
2. `is_public` sem semântica (não há portal público) e não aparece na tela.
3. Conteúdo "Markdown" exibido como texto cru com `line-clamp-3` (`knowledge-base/page.tsx:203`); não há tela de leitura do artigo inteiro.
4. PUT sem Zod; sem `modifiedBy` no update; sem paginação; sem trilha; sem optimistic locking.
5. Tela mostra "Artigo excluído" mesmo quando a API recusa (403 para vendedor) — não checa `res.ok` (`knowledge-base/page.tsx:135-140`).
6. Busca por tag é igualdade exata (`has`), não parcial.

---

## 10. Campanhas (broadcasts) e disparo em lote

### 10.1 Decisões a preservar (ADR 0007 + código)
- Fila do disparo **no próprio Postgres** (`broadcast_recipients`), sem BullMQ, porque o deploy não tinha Redis/worker. *Nota*: o docker-compose atual já sobe Redis (6382); a regra da base manda BullMQ. A escolha precisa ser refeita pela arquitetura (pergunta 18.4).
- FIFO por `created_at`; reserva com `FOR UPDATE SKIP LOCKED` antes do envio; cada envio gravado na hora; retomar continua de `pending`; erro por destinatário em `error_message` (sem DLQ separada).
- O laço vive em **quem chama**: a rota processa **um lote** (20) e devolve progresso; a tela repete.
- Campanha sai por uma **conta explícita** (`store_integracao_id`); com uma conta só na loja, usa essa; com duas ou mais, a escolha é obrigatória.
- uazapi manda **texto** (`content` ou `template.body`); oficial manda **template**.
- **Opt-out** fora da lista na montagem **e** conferido de novo na hora do envio.
- Retrato da lista tirado no primeiro lote (quem entrar depois não recebe).

### 10.2 Rotas
| Rota | RBAC | Entrada | Validação | Efeito |
|---|---|---|---|---|
| `GET /api/broadcasts` | todos | `status` (`all` ignorado) | escopo | lista inteira com `template {id,name}` e `creator {id,name}` (`broadcasts/route.ts:22-42`) |
| `POST /api/broadcasts` | escrita | `name`, `templateId`, `channel` (default whatsapp), `segmentFilter` (objeto), `content?`, `mediaIds[]`, `scheduledFor?` (string), `storeIntegracaoId?` | Zod `:9-20`; loja `:52-53`; template **da mesma loja** `:58-62`; conta da loja `:71-78`; se não veio conta e a loja tem **exatamente uma** conta `whatsapp_oficial`/`uazapi`, usa ela `:79-87` | conta destinatários com o mesmo filtro do disparo `:67-68`; cria com `status: scheduled` se houver data, senão `draft` (`:100-101`) |
| `GET /api/broadcasts/[id]` | todos | — | escopo | campanha + template completo + criador + 50 destinatários mais recentes com `contact {id,name,phone}` (`[id]/route.ts:33-46`) |
| `PUT /api/broadcasts/[id]` | escrita | `status`, `name`, `scheduledFor` | **sem Zod, sem máquina de estados**; escopo | `sending` carimba `startedAt`; `completed` carimba `completedAt` (`:69-78`) |
| `DELETE /api/broadcasts/[id]` | admin/gerente | — | escopo | soft delete; destinatários ficam (registro do que já saiu) (`:95-98`) |
| `POST /api/broadcasts/[id]/disparar` | escrita | — | escopo `:28-32`; `status` tem que ser `sending` (senão 409 com progresso) `:34-45`; sem conta → pausa a campanha e 422 `:50-56` | `processarLote` e devolve `{status,total,enviados,falhas,restantes,concluida}`; registra `campanha_disparada` quando `concluida` (`:62-77`) |

### 10.3 Segmentação — `filtroDoSegmento` (`src/lib/broadcasts/disparo.ts:87-108`)
Sempre: `storeId = loja da campanha`, `optOut = false`, `isDeleted = false`.

| Chave em `segment_filter` | Tradução | Observação |
|---|---|---|
| `tags: string[]` | `contacts.tags hasEvery` | **E** lógico (tem todas), não OU |
| `preferred_size` | igualdade em `preferredSize` | UI manda `"all"` quando escolhe "Todos" → zero destinatários |
| `min_spent` | `totalSpent >= min_spent` | sem validação de tipo |
| `max_days_since_purchase` | `lastContactAt >= hoje − N dias` | **usa último contato, não última compra** |

A contagem na criação e a materialização usam a mesma função (regra a preservar: "vai para 300" = "saiu para 300").

### 10.4 Disparo — `processarLote` (`disparo.ts:144-236`)
1. Carrega campanha (`findUnique`, sem filtro de soft delete) com template e integração.
2. Se `status ≠ sending`, só devolve progresso (pausar para de verdade) `:153`.
3. `materializarDestinatarios`: se ainda não há linhas, cria uma por contato do segmento e grava `total_recipients` `:50-78`.
4. `reservarLote`: `UPDATE ... SET status='sending' WHERE id IN (SELECT ... status='pending' ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED) RETURNING id, contact_id` `:120-134`.
5. Lote vazio → `status: completed`, `completedAt` `:158-164`.
6. Resolve credenciais da conta e adapter; `usaTemplate = provedor ≠ uazapi` `:166-176`.
7. Para cada linha: relê contato; opt-out ou sumido → `failed` "opt-out"; sem identificador do canal → `failed`; envia `sendTemplate(destino, template.name, [nome do contato], language)` ou `sendText(destino, content || template.body)`; sucesso → `sent`, `external_id`, `sent_at`, `sent_count++`; recusa/exceção → `failed` + `failed_count++` `:178-233`.
8. Devolve `progresso(id, "sending")`.

`progresso` conta linhas `sent`, `failed`, `pending`; `concluida = status === completed || (restantes === 0 && total > 0)` (`:250-268`).

### 10.5 Máquina de estados real (o que o código permite)
```
draft ──PUT sending──> sending ──PUT paused──> paused ──PUT sending──> sending
scheduled (sem botão na tela, sem agendador)
sending ──lote vazio──> completed
qualquer ──PUT com qualquer string──> qualquer   (sem validação)
disparar sem conta ──> paused (422)
```

### 10.6 Tela (`src/app/(dashboard)/broadcasts/page.tsx`)
- Criar: nome, template **aprovado** (lista `GET /api/templates?status=approved`), tags (CSV), tamanho. **Não escolhe conta de envio, data, conteúdo nem mídia** (`:80-111`).
- Play em `draft`/`paused` → `PUT status: sending` e começa o laço `dispararEmLotes` (`:116-170`), **sem confirmação**. Pause em `sending`. Lixeira com `window.confirm` e sem checar resposta (`:172-177`).
- Métricas exibidas: enviados, entregues, lidos, respondidos (`:269-274`).
- `/broadcasts/new` é página vazia (`broadcasts/new/page.tsx:1-8`).

### 10.7 Defeitos — campanhas
1. **Campanha termina e fica "sending" para sempre**: após o último lote a rota devolve `restantes: 0` e `concluida: true` com status ainda `sending`; a tela para o laço (`page.tsx:158`) e ninguém chama de novo para marcar `completed` (`disparo.ts:235,266`). Se alguém chamar depois, conclui e **registra a trilha de novo**.
2. **Envio em dobro possível**: `materializarDestinatarios` checa `count > 0` sem lock (`:51-52`) e `createMany(skipDuplicates)` não tem índice único para colidir (`schema.prisma:757-779`). Duas chamadas simultâneas no primeiro lote (duas abas, duas pessoas) criam destinatários duplicados → a cliente recebe duas vezes. Contradiz a garantia do ADR 0007.
3. **Linha presa em `sending`**: se o processo morrer entre a reserva e a gravação (deploy, OOM), a linha nunca volta a `pending`; o próximo lote vem vazio e marca a campanha `completed` com gente sem receber. Não há lease/timeout.
4. **Beco sem saída da conta de envio**: loja com 2+ números cria campanha sem conta (a tela não oferece o campo); o disparo pausa com 422 "Edite a campanha e escolha o número", mas o `PUT` não aceita `storeIntegracaoId` (`[id]/route.ts:69-76`) → campanha impossível de enviar.
5. **Início de disparo em massa sem modal de bloqueio de 3 s** (nem `confirm`) — ação crítica por excelência. Exclusão usa `window.confirm`.
6. **Vendedor dispara campanha em massa** (RBAC escrita).
7. `PUT` sem máquina de estados: dá para voltar `completed` para `sending`, pular para `completed` sem enviar, ou gravar status inventado.
8. `POST` não exige template `approved` (a tela filtra, a API não) nem compatibilidade template × provedor da conta.
9. **Variáveis do template**: oficial manda sempre `[nome do contato]` (1 parâmetro), independentemente de quantas `{{n}}` o template tem → a Meta recusa template com 0 ou 2+ variáveis (`disparo.ts:207-213`). uazapi manda `template.body` **com `{{1}}` cru** para a cliente (`:214`).
10. **Métricas mentem**: `delivered_count`, `read_count`, `replied_count` e as colunas de `broadcast_recipients` nunca são atualizadas. O disparo não grava `messages`, então `processStatusUpdate` (que procura `messages.external_id`, `gateway.ts:224-238`) não acha nada. A campanha também **não aparece no histórico da conversa** da cliente.
11. Campanha `scheduled` não tem botão na tela e não há agendador → nunca sai (ADR 0007 admite o agendador; a tela esconde a saída).
12. `preferred_size: "all"` → 0 destinatários (`page.tsx:88,217`). `max_days_since_purchase` usa `last_contact_at`.
13. `media_ids` e `content` (oficial) ignorados no disparo; `channel` livre, mas o disparo força `"whatsapp"` (`:170`).
14. Sem throttle entre mensagens (a tela chama o próximo lote imediatamente) — risco de rate limit da Meta e de **banimento** no uazapi.
15. Consentimento: só `opt_out`; não consulta `consent_logs` de marketing (LGPD — decisão de negócio pendente, pergunta 18.6).
16. Sem trilha de criação, início, pausa e exclusão; sem optimistic locking; `GET` sem paginação; `DELETE` sem checar resposta na tela.
17. `disparo.ts` usa `findUnique` em `Broadcast` e `Contact` (models com soft delete), justamente o que `tests/soft-delete.test.ts:91` proíbe; contato excluído continua recebendo.

---

## 11. Mensagens agendadas

### 11.1 Rotas
| Rota | RBAC | Entrada | Validação | Efeito |
|---|---|---|---|---|
| `GET /api/scheduled` | todos | `status`, `triggerType`, `contactId` (`all` ignorado) | escopo | até 50, `scheduledFor asc`, com `contact {id,name,phone}` e `template {id,name}` (`scheduled/route.ts:20-45`) |
| `POST /api/scheduled` | escrita | `contactId`, `conversationId?`, `content` (≥1), `contentType` (default text), `templateId?`, `templateVars[]`, `mediaIds[]`, `scheduledFor` (string ISO), `triggerType` (string) | Zod `:7-18`; **loja vem do contato** no escopo `:57-61` | cria com `createdBy` da sessão `:63-73`; data inválida → 500 |
| `PUT /api/scheduled/[id]` | escrita | `status`, `scheduledFor`, `content`, `sentAt`, `errorMessage` | **sem Zod**; escopo | update direto (`[id]/route.ts:35-42`) |
| `DELETE /api/scheduled/[id]` | admin, gerente, **vendedor** (exceção RBAC) | — | escopo | `status: cancelled` (`:56-59`) |

### 11.2 O que existe em volta
- **Nenhuma tela** chama `/api/scheduled` (nenhum fetch no front).
- **Nenhum worker envia**. O único consumidor é o motor de alertas: agendamento vencido e ainda `scheduled` gera alerta `follow_up_due` severidade `high` (`src/lib/alerts/engine.ts:318-350`).
- LGPD apaga agendamentos do contato fisicamente (`src/app/api/lgpd/route.ts:120`).

### 11.3 Defeitos — agendadas
1. Funcionalidade inexistente de ponta a ponta: grava intenção, não envia, não tem tela.
2. `conversationId`, `templateId` e `mediaIds` do corpo **não são conferidos** contra a loja do contato (`route.ts:63-69`).
3. `PUT` deixa o cliente forjar `status: sent` e `sentAt` arbitrário.
4. `contentType`/`triggerType` livres; `scheduledFor` passado aceito.
5. Tabela sem `updated_at`, `deleted_at`, `is_deleted`, `modified_by`; cancelamento não registra quem cancelou.
6. Sem trilha, sem optimistic locking.
7. ADR 0007 manda revisitar a fila "quando aparecer o segundo trabalho assíncrono — envio de mensagem agendada"; este é o gatilho.

---

## 12. Telas

Todas são `"use client"` com `fetch` direto para `/api/**`; nenhuma usa o modal de bloqueio de 3 s (só `painel-venda.tsx` usa); nenhuma tem RBAC de página (menu mostra tudo a todos).

| Tela | Arquivo | Mostra | Ações | Defeitos de UI |
|---|---|---|---|---|
| Produtos `/products` | `src/app/(dashboard)/products/page.tsx` (426 l) | tabela nome, SKU, categoria, tipo, preço, status | criar/editar (nome, SKU, descrição, categoria, tipo de tamanho, status, preço, preço anterior), excluir com `confirm` | edição zera estoque e grade (3.4.2); filtro "all" vazio; sem paginação; sem campos de custo, peso, imagens, destaque, grade e estoque; título "Catálogo da Merlos Store" |
| Galeria `/gallery` | `src/app/(dashboard)/gallery/page.tsx` (318 l) | grade de miniaturas, total, busca, filtro pasta/tipo | upload múltiplo (botão e arrastar), preview (img/vídeo/áudio/link), excluir com `confirm` | `accept` omite docx/xlsx aceitos pela API (`:140`); toast "N enviados" sem dizer quais falharam nem o motivo (`:95-110`); pastas não incluem `chat`; não edita tags/pasta/produto; sem paginação (30) |
| Lookbooks `/gallery/lookbooks` | `src/app/(dashboard)/gallery/lookbooks/page.tsx` (162 l) | cards com nome, descrição, nº mídias/produtos, ativo | criar/editar nome e descrição, excluir | casca (6.3); fora do menu |
| Respostas rápidas `/quick-replies` | `src/app/(dashboard)/quick-replies/page.tsx` (272 l) | tabela título, atalho, categoria, conteúdo, status | criar/editar (título, atalho, categoria, conteúdo), excluir | sem toggle de ativo; sem categoria no filtro |
| Templates `/templates` | `src/app/(dashboard)/templates/page.tsx` (239 l) | tabela nome, categoria, status, corpo | criar/editar (nome, categoria, corpo, rodapé) com preview; "enviar para aprovação" (só muda status); excluir | toast de sucesso sem checar resposta (`:146-161`); não mostra motivo de rejeição |
| Base de conhecimento `/knowledge-base` | `src/app/(dashboard)/knowledge-base/page.tsx` (217 l) | cards título, categoria, 3 linhas do conteúdo, tags | criar/editar (título, categoria, tags, conteúdo), excluir | sem leitura completa; Markdown não renderizado; toast sem checar resposta; botões sem `aria-label` |
| Campanhas `/broadcasts` | `src/app/(dashboard)/broadcasts/page.tsx` (317 l) | tabela nome, template, status, destinatários, métricas, criado | criar (nome, template aprovado, tags, tamanho), iniciar/retomar, pausar, excluir; progresso `enviados/total` durante o laço | 10.7 itens 1, 4, 5, 11, 12; sem detalhe da campanha nem lista de falhas; laço morre se a aba fechar |
| Nova campanha `/broadcasts/new` | `src/app/(dashboard)/broadcasts/new/page.tsx` (8 l) | título | nenhuma | stub |

Componentes do chat que consomem o domínio:
| Componente | Consome | Nota |
|---|---|---|
| `src/components/inbox/MenuAtalhos.tsx` | `GET /api/quick-replies?apenasAtivas=1&search=` | seção 7.2 |
| `src/components/inbox/SeletorProduto.tsx` | `GET /api/products` | estoque local, inativos, `next/image` (3.4) |
| `src/components/chat/GalleryModal.tsx` | `GET /api/media/gallery` | 30 itens, sem paginação |
| `src/components/chat/MediaBar.tsx` | upload via `lib/chat/midia.ts` | `accept` image/*, video/*, `.pdf,.doc,.docx` — deixa escolher HEIC etc., recusado depois pelo servidor |
| `src/app/(dashboard)/inbox/_components/painel-venda.tsx` | `GET /api/products/disponibilidade`, `POST /api/orders` | referência boa: modal de bloqueio de 3 s, aviso de estoque não ao vivo, aviso acima do disponível |
| `src/components/gallery/` | — | pasta vazia |

---

## 13. Testes que travam invariantes

Os testes antigos são estáticos (leem fonte) em boa parte; o valor está nas **invariantes**, que devem virar critérios de aceite do sistema novo.

| Teste | Invariantes do domínio |
|---|---|
| `tests/bling.test.ts` | state do OAuth assinado, expira em 1 min, recusa forjado/alterado/outro segredo (`:28-71`); credencial do app em Basic, nunca no corpo (`:73-101`); **cliente Bling e TikTok sem escrita** (`:104-150`); endpoints isolados num arquivo (`:152-186`) |
| `tests/etapa8-fontes-da-verdade.test.ts` | nenhum caminho de pedido chama o Bling (`:26-65`); saldo por depósito, depósito no path, `null` ≠ 0, cai para virtual (`:67-121`); disponível = saldo − pendente, nunca negativo, não desconta sem SKU, pedido lançado/cancelado não reserva, reserva não escreve (`:123-164`); tela de venda usa rota do vendedor, mostra disponível, modal 3 s, degrada sem Bling, avisa estoque não ao vivo (`:326-370`); página inválida não vai crua ao Bling (`:372-379`) |
| `tests/midia-minio.test.ts` | URL gravada é rota autenticada; compose cria bucket privado; sem Cloudinary (`:31-67`); envio assina, TTL curto, rota raw autentica e não assina (`:69-100`); chave começa pela loja, não usa nome original, nome hostil não escapa, sem extensão não quebra (`:102-130`); miniatura webp 200×200 real, falha não derruba, só imagem (`:132-172`); falta de config falha dizendo o que falta; path-style (`:174-195`) |
| `tests/robustez-fase5.test.ts` | paginação grampeada (`:29-80`); upload recusa SVG, aceita tipos da loja, ignora parâmetro do content-type, teto por tipo, vazio, corte por cabeçalho, conferência nos dois momentos (`:82-144`); ações de auditoria em lista fechada, segredo fora do log, falha de auditoria não derruba (`:208-268`) |
| `tests/campanha-fase6.test.ts` | reserva antes do envio, FIFO, falha de rede não prende em `sending`, retomar não reenvia (`:24-53`); lote pequeno, um lote por chamada, tela repete (`:55-77`); pausar para de verdade, rota recusa não-`sending` (`:79-91`); conta certa: sem conta recusa, criação confere loja da conta, conta única dispensa escolha, uazapi manda texto (`:93-124`); opt-out fora da lista e reconferido, filtro igual ao da contagem (`:126-161`); seletor de produto oferece só tamanho com estoque, texto vai ao campo (`:163-206`) |
| `tests/soft-delete.test.ts` | nenhuma rota apaga de verdade (exceto LGPD); guard central; `findUnique` proibido nos models com soft delete (`:45-117`) |
| `tests/escopo-loja.test.ts` (citado em `docs/rbac.md:76-86`) | cada handler que toca dado de loja aplica escopo; piso mínimo de handlers encontrados |

Nota: o teste "oferece só o tamanho que tem em estoque" trava justamente o comportamento que usa o `stock` local (defeito 3.4.1). Precisa ser reescrito contra a fonte de estoque decidida.

---

## 14. Conformidade com as regras da base

Legenda: OK = cumpre; PARCIAL; NAO.

| Entidade | 5 colunas auditoria | Soft delete | FK completas | ON DELETE RESTRICT explícito | Optimistic locking | Trilha de auditoria | Modal 3 s na ação crítica | Nome PT hierárquico |
|---|---|---|---|---|---|---|---|---|
| products | NAO (sem deleted_at, is_deleted, modified_by) | NAO (usa `active`) | PARCIAL (`image_urls` sem FK) | NAO | NAO | NAO | NAO (troca de preço, excluir) | NAO |
| media_files | OK | PARCIAL (quebra histórico) | OK | NAO | NAO | NAO | NAO | NAO |
| lookbooks | OK | OK | NAO (arrays) | NAO | NAO | NAO | NAO | — |
| quick_replies | OK | OK (unique não parcial) | NAO (`media_ids`) | NAO | NAO | NAO | NAO | NAO |
| whatsapp_templates | OK | OK (unique não parcial) | PARCIAL (sem vínculo com conta) | NAO | NAO | NAO | NAO (aprovar/excluir) | NAO |
| knowledge_articles | OK | OK | OK | NAO | NAO | NAO | NAO | NAO |
| broadcasts | OK | OK | PARCIAL (`media_ids`) | NAO | NAO | PARCIAL (só conclusão) | **NAO (disparo em massa)** | NAO |
| broadcast_recipients | NAO (só created_at) | NAO (LGPD apaga) | OK | NAO | n/a | NAO | n/a | NAO |
| scheduled_messages | NAO (sem updated_at, deleted_at, is_deleted, modified_by) | PARCIAL (status cancelled) | NAO (`media_ids`, `template_vars`) | NAO | NAO | NAO | NAO | NAO |

Outras regras:
- **Arquivos < 500 linhas**: todos os arquivos do domínio cumprem (maior: `products/page.tsx`, 426).
- **FIFO / BullMQ / DLQ**: fila no Postgres (ADR 0007) sem DLQ, sem retentativa, sem agendamento; job não idempotente na materialização (10.7.2).
- **Validação com regex**: nenhuma (atalho, nome de template, SKU, variáveis).
- **Server Actions são POST abertos / proxy não é fronteira** (Next 16): o sistema antigo concentrava RBAC no middleware; o novo precisa checar papel e loja dentro de cada action/handler.

---

## 15. Divergências doc x código

`docs/api.md` está desatualizado em pontos que enganariam quem desenha:

| Doc | Diz | Código real |
|---|---|---|
| `docs/api.md:413` | DELETE de produto é delete físico | grava `active: false` |
| `docs/api.md:427-436` | upload manda ao Cloudinary, sem limite de tamanho/MIME, aceita `uploadedBy` | MinIO, limites e allowlist, autor da sessão |
| `docs/api.md:431,446,457,465,469,479` | DELETE físico em mídia, lookbook, campanha, template, atalho, artigo | soft delete em todos |
| `docs/api.md:461` | "único soft delete da API" é o de agendadas | há soft delete em 8 models |
| `docs/api.md:476` | POST de artigo aceita `createdBy` | autor da sessão |
| `docs/api.md:478` | PUT de artigo grava `undefined` nos omitidos | Prisma ignora `undefined`; `null` quebra |
| `src/app/api/knowledge/[id]/route.ts:10-13` | "a IA usa o conteúdo", "delete aqui é físico" | nenhum dos dois |
| `docs/integracoes.md:796` | "10 rotas ainda com delete físico" | só a LGPD |

---

## 16. Regras de negócio a preservar

Numeração provisória para os arquitetos citarem.

**Catálogo e estoque**
- RN-C01 — Este sistema **nunca escreve** no Bling nem no Masc (pedido, estoque, produto).
- RN-C02 — Estoque exibido para vender é **disponível para prometer** = saldo do **depósito da loja** no Bling − quantidade em pedidos da loja com `masc_status = pendente` e status não cancelado/devolvido; nunca negativo.
- RN-C03 — Saldo desconhecido é `null`, nunca zero; a venda segue com aviso "estoque não está ao vivo".
- RN-C04 — Saldo da rede (soma dos depósitos) nunca é mostrado como saldo da loja; gestão sem loja escolhida recebe pedido de escolha.
- RN-C05 — Casamento produto local ↔ Bling é por SKU = `codigo`; produto sem SKU não desconta reserva.
- RN-C06 — SKU único por loja; o mesmo SKU pode existir nas duas lojas.
- RN-C07 — Produto referenciado por pedido não pode sumir: exclusão é lógica.
- RN-C08 — Grade de tamanhos por tipo: slim `PP,P,M,G,GG`; plus size `46,48,50,52,54,56,58`; ambos = as duas.
- RN-C09 — Vender acima do disponível é permitido, com aviso e confirmação bloqueada por 3 s.
- RN-C10 — A tela de venda é acessível ao vendedor; o catálogo cru do Bling e os depósitos são só do admin.

**Mídia**
- RN-M01 — Mídia é da loja; bucket privado; binário só por rota com sessão e escopo de loja.
- RN-M02 — Provedor externo recebe URL assinada de validade curta (10 min), gerada no envio e não persistida.
- RN-M03 — Chave do objeto começa pela loja e nunca usa o nome enviado pelo cliente.
- RN-M04 — Tipos aceitos em lista fechada; SVG e HTML proibidos; tetos por tipo iguais aos do WhatsApp.
- RN-M05 — Miniatura 200×200 webp gerada no upload; falha não impede guardar o original.
- RN-M06 — Excluir mídia é lógico e não pode quebrar mensagens já enviadas/recebidas (o histórico continua exibindo).
- RN-M07 — Mídia enviada numa conversa tem que ser da loja **da conversa** e sai pela **conta de entrada** da conversa.
- RN-M08 — Mídia recebida por webhook é guardada no MinIO da loja da integração que recebeu.

**Conteúdo**
- RN-T01 — Atalho único por loja; menu do chat oferece só atalhos ativos e insere o texto no campo sem enviar.
- RN-T02 — Template aprovado só vale para número `whatsapp_oficial`; uazapi nunca recebe chamada de template (falha explícita em vez de mandar o nome como texto).
- RN-T03 — Nome de template único por loja (a revisar: por conta/WABA, pergunta 18.3).
- RN-T04 — Conteúdo de uma loja (atalho, template, artigo, lookbook) nunca é lido ou alterado por usuário de outra loja; fora da loja responde 404.

**Campanhas**
- RN-B01 — Campanha sai por **uma conta explícita**; se a loja tem uma só, ela é usada; com duas ou mais, a escolha é obrigatória e o disparo recusa sem conta.
- RN-B02 — Template da campanha tem que ser da mesma loja.
- RN-B03 — Contato com opt-out não entra na lista e é reconferido imediatamente antes de cada envio.
- RN-B04 — A lista de destinatários é um retrato tirado no início do disparo.
- RN-B05 — A contagem mostrada na criação usa exatamente o mesmo filtro do envio.
- RN-B06 — Ninguém recebe a mesma campanha duas vezes (reserva antes do envio, retomada não reenvia).
- RN-B07 — Envio em lotes pequenos, FIFO; pausar interrompe no próximo lote.
- RN-B08 — Falha é registrada por destinatário, com motivo legível.
- RN-B09 — Número uazapi recebe o texto (resolvido), número oficial recebe template aprovado.
- RN-B10 — Filtros de segmento existentes: tags (todas), tamanho preferido, gasto mínimo, dias desde a última compra.

**Agendamento**
- RN-A01 — Agendamento pertence à loja do contato.
- RN-A02 — Cancelar agendamento é trabalho de atendimento (vendedor pode) e é lógico.
- RN-A03 — Agendamento vencido e não enviado gera alerta de follow-up atrasado (alta severidade).
- RN-A04 — Gatilhos previstos: manual, follow-up, pós-venda, abandono, reativação, aniversário, promoção.

---

## 17. Defeitos consolidados por severidade

### Crítico (perda de dado, envio indevido a cliente, vazamento)
| # | Defeito | Onde |
|---|---|---|
| C1 | Destinatários duplicados na materialização concorrente → cliente recebe campanha duas vezes | `src/lib/broadcasts/disparo.ts:50-78`; `prisma/schema.prisma:757-779` (sem unique) |
| C2 | Disparo em massa com um clique, sem confirmação, e permitido a vendedor | `broadcasts/page.tsx:116-132,281-300`; `src/lib/rbac.ts:34-40` |
| C3 | uazapi envia `{{1}}` cru; oficial envia sempre 1 variável (Meta recusa template ≠ 1 variável) | `disparo.ts:207-214` |
| C4 | Editar produto pela tela apaga estoque e grade | `products/page.tsx:100-111`; `products/[id]/route.ts:71-78` |
| C5 | MIME confiado ao navegador + raw `inline` sem `nosniff` → XSS armazenado possível | `media/upload/route.ts:45-50`; `media/[id]/raw/route.ts:43-53` |
| C6 | Contato excluído (soft delete) continua recebendo campanha (`findUnique` fura o guard) | `disparo.ts:179-190` |

### Alto (funcionalidade quebrada ou regra da base violada)
| # | Defeito | Onde |
|---|---|---|
| A1 | Campanha concluída fica `sending` para sempre; trilha pode duplicar | `disparo.ts:235,266`; `broadcasts/page.tsx:158`; `disparar/route.ts:62-77` |
| A2 | Linha presa em `sending` após queda do processo; campanha conclui sem enviar | `disparo.ts:120-134,158-164` |
| A3 | Loja com 2+ números não consegue enviar campanha (tela sem campo, PUT sem `storeIntegracaoId`) | `broadcasts/page.tsx:90-98`; `broadcasts/[id]/route.ts:69-76` |
| A4 | Métricas de entregue/lido/respondido nunca atualizadas; campanha fora do histórico da conversa | `disparo.ts:216-224`; `gateway.ts:224-238` |
| A5 | Templates sem integração com a Meta; aprovação manual por qualquer vendedor; editar aprovado não reabre | `templates/[id]/route.ts:53-69`; `templates/page.tsx:153-161` |
| A6 | Duas fontes de estoque contraditórias no chat (local x Bling) | `SeletorProduto.tsx:43-46`; `painel-venda.tsx:83` |
| A7 | Soft delete de mídia quebra histórico (raw filtra excluídos) | `media/[id]/raw/route.ts:25-33` |
| A8 | Corrida no refresh do token do Bling derruba a integração da rede | `bling/cliente.ts:153-162` |
| A9 | Agendamentos não enviam, não têm tela; PUT forja `sent` | `scheduled/**`; `alerts/engine.ts:318-350` |
| A10 | Referências do corpo sem conferência de loja: `productId` no upload, `conversationId/templateId/mediaIds` no agendamento, `productIds/mediaIds/coverMediaId` no lookbook, `items[].productId` no pedido | `media/upload/route.ts:35,79`; `scheduled/route.ts:63-69`; `lookbooks/route.ts:36-38`; `orders/route.ts:86-94` |
| A11 | Nenhuma trilha de auditoria em CRUD do domínio; nenhum optimistic locking | todas as rotas das seções 3–11 |
| A12 | `products`, `scheduled_messages`, `broadcast_recipients` sem colunas de auditoria; arrays de ids sem FK | `schema.prisma:368-395,677-705,757-779,343-362,615-635` |
| A13 | Campanha `scheduled` sem agendador nem botão | `broadcasts/page.tsx:281-305`; ADR 0007 |
| A14 | `media/send` não grava falha, pula arquivo em silêncio, exceção no meio gera reenvio duplicado | `media/send/route.ts:68-122` |

### Médio
| # | Defeito | Onde |
|---|---|---|
| M1 | Unique não parcial + soft delete (SKU, atalho, nome de template) → 500 ao recriar | `schema.prisma:392,632,668` |
| M2 | P2002 vira 500 genérico em vez de 409 com mensagem | `products/route.ts:88`; `quick-replies/route.ts:65`; `templates/route.ts:63` |
| M3 | PUT sem Zod: media, lookbook, template, artigo, campanha, agendamento | `media/[id]:55`, `lookbooks/[id]:54`, `templates/[id]:53`, `knowledge/[id]:54`, `broadcasts/[id]:69`, `scheduled/[id]:35` |
| M4 | Filtro "all" literal em produtos (lista vazia) e em tamanho da campanha (0 destinatários) | `products/page.tsx:323-348`; `broadcasts/page.tsx:88,217` |
| M5 | Rota raw sem streaming nem Range; upload lê corpo inteiro; objeto órfão se o insert falhar | `armazenamento.ts:102`; `upload/route.ts:32,53-84` |
| M6 | Sem cache/throttle nas leituras do Bling (3 req/s da rede); status "erro" em 429; escrita na integração a cada leitura | `bling/cliente.ts:187-207`; `disponibilidade/route.ts` |
| M7 | Disponível por produto, não por tamanho | `disponibilidade/route.ts:147-160`; `painel-venda.tsx:102-121` |
| M8 | Telas mostram sucesso sem checar resposta (templates, artigos, campanhas) e botões de excluir a quem toma 403 | `templates/page.tsx:146-151`; `knowledge-base/page.tsx:135-140`; `broadcasts/page.tsx:172-177` |
| M9 | Lookbooks e base de conhecimento sem uso real (casca / sem consumidor) | seções 6 e 9 |
| M10 | `max_days_since_purchase` usa `last_contact_at`; tags com E lógico | `disparo.ts:97-106` |
| M11 | `subirDeUrl` sem teto, timeout e allowlist | `media/upload.ts:99-113` |
| M12 | Sem throttle entre mensagens da campanha (rate limit Meta, banimento uazapi) | `broadcasts/page.tsx:146-165` |
| M13 | `costPrice` exposto a vendedor/viewer | `products/route.ts:48-58` |
| M14 | Sem paginação em lookbooks, atalhos, templates, artigos, campanhas; telas de produto/galeria sem controles de página | rotas GET citadas |
| M15 | IA (oculta) lê produtos e atalhos sem filtro de loja | `src/lib/ai/suggest.ts:40-44,60-63` |

### Baixo
- `src/lib/media/process.ts` inteiro é código morto; `apagar()` sem chamador.
- `duration` de mídia nunca preenchido; `sharp` decodifica duas vezes.
- `media_ids` de atalho e de campanha sem uso; `is_public` de artigo sem semântica.
- `Content-Disposition` com `encodeURIComponent` em vez de `filename*`.
- `accept` dos inputs diverge da allowlist do servidor (galeria e MediaBar).
- `/broadcasts/new` e `src/components/gallery/` vazios; Lookbooks fora do menu.
- `state` do OAuth reaproveitável por 60 s; chave do HMAC = `NEXTAUTH_SECRET`.
- `saldoFisico ?? saldoVirtual` mistura semânticas.
- Alerta `low_stock` descrito e não implementado (`src/lib/alerts/rules.ts:42-45`).

---

## 18. Perguntas abertas

Para decidir antes do desenho de schema (cliente ou arquitetura, conforme indicado).

1. **Grade × SKU (cliente)**: no Bling da Merlo, cada tamanho é um produto/variação com `codigo` próprio, ou o SKU é único por modelo? Define se o sistema novo guarda `produtos` + `produtos_variacoes` (tamanho com SKU próprio) e se o disponível passa a ser por tamanho.
2. **Catálogo local (arquitetura + cliente)**: ADR 0004 diz que produto/preço é do Bling. O sistema novo importa o catálogo do Bling (somente leitura, cache local com `ultima_sincronizacao`) ou mantém cadastro manual com SKU digitado? E o `stock` jsonb local some?
3. **Template por loja ou por conta (arquitetura)**: templates da Meta pertencem à WABA do número. Vincular `templates` a `lojas_integracoes` (provedor `whatsapp_oficial`)? Sincronizar status pela API/webhook da Meta ou manter aprovação manual (e por qual papel)?
4. **Fila (arquitetura)**: o docker-compose já sobe Redis (6382) e a regra da base manda BullMQ com DLQ. Agora há três trabalhos assíncronos (disparo de campanha, agendadas, refresh/cache do Bling, download de mídia de webhook). ADR 0007 manda revisitar nesse ponto. Manter Postgres `SKIP LOCKED` com worker próprio ou adotar BullMQ?
5. **Quem pode disparar campanha (cliente)**: vendedor dispara em massa hoje. Deve ser só admin/gerente? Precisa de aprovação?
6. **Consentimento de marketing (cliente/LGPD)**: basta `opt_out`, ou campanha só vai para quem tem consentimento `marketing` registrado?
7. **Throttle por provedor (arquitetura)**: qual ritmo por número (oficial x uazapi) para não estourar limite nem arriscar banimento?
8. **Métricas de campanha (arquitetura)**: o disparo passa a gravar a mensagem na conversa (para histórico e para o recibo de entrega atualizar o destinatário)? Resposta da cliente conta como "respondido" em que janela?
9. **Mensagens agendadas (cliente)**: a funcionalidade entra no escopo da reconstrução? Se sim, quais gatilhos automáticos (pós-venda, aniversário, abandono) e fora da janela de 24 h exigem template.
10. **Lookbooks e base de conhecimento (cliente)**: ficam? Lookbook precisa ser enviável no chat? Base de conhecimento é só leitura interna?
11. **Retenção de mídia (arquitetura + operação)**: política de limpeza de objetos com `is_deleted` antigo, cota por loja, backup do MinIO (hoje fora da política).
12. **Mídia excluída no histórico (arquitetura)**: a rota de leitura deve servir mídia soft-deleted quando referenciada por `conversas_mensagens`? (RN-M06 diz que sim.)
13. **Custo do produto (cliente)**: vendedor e viewer podem ver `cost_price`?
14. **Imagem de produto para a cliente (arquitetura)**: o texto do produto enviado no chat hoje leva um link; com bucket privado, enviar a foto como mídia (URL assinada) em vez de link?
