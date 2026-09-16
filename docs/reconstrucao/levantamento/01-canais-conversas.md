# Levantamento 01 — Canais e Conversas (sistema antigo)

- **Fonte**: `C:\Users\Paulo\Documents\MerlostoreChat`, branch `refactor/reconstrucao-estrutura-base`, HEAD `5e902d4`. Caminhos abaixo sao relativos a raiz do repo; linhas conferidas nesse commit.
- **Stack antiga**: Next 14.2.35 (App Router, `src/middleware.ts`), Prisma 7.5 + adapter `pg`, NextAuth v4 (JWT), Zod 4, MinIO via `@aws-sdk/client-s3`, `sharp`.
- **Escopo**: inbox, chat, mensagens (texto, midia, nota interna, reply), envio por conta, reenvio de falha, transferencia, rolagem/mesclagem, aviso sonoro; os 6 webhooks (parte de canal); `src/lib/channels/*`, gateway, roteamento por conta, `src/lib/uazapi/*`, `src/lib/chat/*`, `src/lib/transcription/*`, `src/lib/media/*` usado no chat; rotas `conversations`, `messages`, `media/*`, `transcription`, `webhooks/*`, `integracoes/uazapi/[id]/sessao`; telas e componentes `inbox/*` e `chat/*`.
- **Uso**: e REFERENCIA de dominio e regra. Nada aqui e para ser portado como implementacao.
- **Legenda**: `R-xx` = regra de negocio a preservar (sec. 5). `D-xx` = defeito/desvio (catalogo na sec. 17). Severidade: **CRIT** (perda de dado ou brecha exploravel), **ALTA**, **MEDIA**, **BAIXA**.

---

## 1. Resumo executivo

1. **Status de entrega do WhatsApp oficial nunca e processado** quando o POST da Meta so traz `statuses` (o caso normal): a rota resolve a conta por `messages[0]` e retorna antes do laco de status (`src/app/api/webhooks/whatsapp/route.ts:47-56` x `:77-80`). D-01.
2. **Perda silenciosa de mensagem recebida**: webhook processa sincronamente e responde 200 mesmo em erro (`whatsapp/route.ts:84-88`, iguais nos outros); nao ha log bruto do evento; colisao de contato criado pelo CRM com o mesmo telefone (`@@unique([storeId, phone])`) derruba toda mensagem daquele cliente para sempre (`src/lib/channels/gateway.ts:60-70`). D-02, D-03.
3. **Resposta pode sair por outro numero**: sem conta valida (integracao desconectada, credencial ilegivel/incompleta, conversa sem vinculo) o envio cai no adapter de `process.env` (`src/lib/channels/index.ts:45,52,84`; `src/lib/roteamento.ts:70-74,97`), violando "responde pela conta de entrada". D-04.
4. **Midia recebida vira XSS armazenado**: o webhook guarda qualquer MIME do provedor e `/api/media/[id]/raw` serve `inline` na origem do app, sem allowlist nem `nosniff` (`src/lib/media/upload.ts:99-113`, `src/app/api/media/[id]/raw/route.ts:43-53`). D-05.
5. **Transcricao de audio e 100% inoperante**: usa `fileUrl` relativo (`/api/media/{id}/raw`) em `fetch` no servidor, que tambem exigiria sessao; e nenhum cron chama a rota (`src/lib/transcription/whisper.ts:60,13`). D-06.
6. **Envio pela galeria/anexo falha sem rastro**: `/api/media/send` so grava quando o canal aceita e responde 201 `{sent:0}`, o cliente trata como sucesso (`src/app/api/media/send/route.ts:107-122`, `src/lib/chat/midia.ts:45`). Contradiz a regra "falha deixa rastro" que `/api/messages` cumpre. D-07.
7. **uazapi**: mensagens enviadas pelo proprio celular (`fromMe`) sao descartadas, nao ha ack de entrega nem tratamento de queda de sessao (o comentario diz que ha, o codigo nao faz), grupo nao e filtrado, segredo do webhook e global e aceito por query string (`src/lib/channels/uazapi.ts:186-198`, `src/app/api/webhooks/uazapi/route.ts:26-31`). D-08..D-12.
8. **Inbox mostra so as 30 conversas mais recentes** (sem paginacao na tela), sem indicar por qual numero/conta a conversa entrou e sem filtro "minhas" (`src/app/(dashboard)/inbox/page.tsx:34-46`, `src/app/api/conversations/route.ts:21,43-57`). D-15, D-37.
9. **Regras absolutas da base descumpridas no dominio**: `conversations`, `messages`, `message_media` sem colunas de auditoria nem soft delete; LGPD apaga fisicamente e deixa binario no MinIO e `media_files` orfaos; sem optimistic locking; trilha de auditoria so para resolver/transferir; sem modal block 3s. D-20..D-23.
10. **Reply (citar mensagem) nao existe**: coluna `reply_to_id` existe, parser nunca le o contexto e o gateway grava `null` (`gateway.ts:185`). D-39.
11. **TikTok e canal ficticio**: webhook valida HMAC do TikTok **Shop**, mas o parser le "comentario de video" (outra API); envio sempre falha (`src/lib/channels/tiktok.ts:24-53,66-95`). D-30.
12. **RBAC so no middleware**: nenhum handler do dominio confere papel (ex.: POST de QR do uazapi so exige sessao no handler, `src/app/api/integracoes/uazapi/[id]/sessao/route.ts:79-93`). Com Next 16 (proxy nao e fronteira) isso nao pode ser herdado. D-43.

---

## 2. Mapa do dominio (arquivos)

| Camada | Arquivo | Linhas | Responsabilidade |
|---|---|---:|---|
| Tipos | `src/lib/channels/types.ts` | 141 | `ChannelType`, `ContentType`, `IncomingMessage` (normalizado), `ChannelAdapter`, `StatusUpdate`. Tipos de config 120-141 e `OutgoingMessage` 57-67 sem uso |
| Fabrica | `src/lib/channels/index.ts` | 89 | `getAdapter(canal)` (ambiente) e `getAdapterDaConta(canal, credenciais, provedor)` |
| Adapter | `src/lib/channels/whatsapp.ts` | 402 | Meta Cloud API v21.0: envio, download de midia, `parseWhatsAppMessages`, `parseWhatsAppStatuses` |
| Adapter | `src/lib/channels/uazapi.ts` | 233 | uazapi (WhatsApp Web): envio, download por URL, `parseUazapiMessages` |
| Adapter | `src/lib/channels/instagram.ts` | 209 | Graph `/me/messages`: texto e imagem; parser com story reply |
| Adapter | `src/lib/channels/facebook.ts` | 247 | Messenger `/me/messages`: texto e anexos; parser |
| Adapter | `src/lib/channels/tiktok.ts` | 95 | Todos os envios falham; parser de comentario |
| Gateway | `src/lib/channels/gateway.ts` | 303 | `processIncomingMessage`, `processStatusUpdate`, `saveOutgoingMessage` |
| Roteamento | `src/lib/roteamento.ts` | 99 | `contaDoEvento`, `contaDaUrl`, `credenciaisDaConta`, `contaDaConversa` |
| Auth webhook | `src/lib/webhook-auth.ts` | 164 | HMAC Meta, challenge por canal, segredo uazapi, segredo pagamento, `CRON_SECRET` |
| Auth webhook | `src/lib/tiktok/assinatura.ts` | 111 | `verificarAssinaturaWebhook` (HMAC app_key+corpo) |
| Envio | `src/lib/chat/enviar.ts` | 136 | `destinatarioDoCanal`, `entregarNoCanal` (sem gravar) |
| Cliente | `src/lib/chat/mesclar.ts` | 65 | Mescla tela x servidor (otimista, historico paginado) |
| Cliente | `src/lib/chat/midia.ts` | 55 | `subirEEnviar`, `enviarDaBiblioteca` |
| Cliente | `src/lib/chat/aviso-sonoro.ts` | 114 | Bipe Web Audio, Notification API |
| Transcricao | `src/lib/transcription/whisper.ts` | 96 | OpenAI Whisper, fila por `transcription_status` |
| uazapi | `src/lib/uazapi/config.ts` | 87 | Base URL, endpoints, header, tipos (marcado CONFERIR) |
| uazapi | `src/lib/uazapi/instancia.ts` | 91 | Estado da instancia e pareamento (QR) |
| Midia | `src/lib/media/armazenamento.ts` | 128 | S3/MinIO: chave, guardar, ler, apagar, URL assinada |
| Midia | `src/lib/media/upload.ts` | 120 | `subirArquivo` (+thumb sharp), `subirDeUrl`, `getFileTypeFromMime` |
| Midia | `src/lib/media/limites.ts` | 111 | Teto por tipo e MIME aceitos no upload |
| Midia | `src/lib/media/process.ts` | 92 | Limites por canal — **codigo morto** |
| Rota | `src/app/api/webhooks/{whatsapp,uazapi,instagram,facebook,tiktok,payments}/route.ts` | 89/53/48/48/59/104 | Entrada |
| Rota | `src/app/api/conversations/route.ts`, `[id]/route.ts` | 66/149 | Lista, detalhe, PUT |
| Rota | `src/app/api/messages/route.ts`, `[id]/reenviar/route.ts` | 144/84 | Historico, envio, nota, reenvio |
| Rota | `src/app/api/media/{send,upload,gallery,[id],[id]/raw}/route.ts` | 130/94/51/113/63 | Midia no chat |
| Rota | `src/app/api/transcription/route.ts` | 22 | Cron de transcricao |
| Rota | `src/app/api/integracoes/uazapi/[id]/sessao/route.ts` | 93 | Estado/QR do numero uazapi |
| Tela | `src/app/(dashboard)/inbox/page.tsx` | 177 | 3 colunas: lista, chat, contato + painel de venda |
| Comp. | `src/components/inbox/ChatWindow.tsx` | 494 | Orquestra chat |
| Comp. | `src/components/inbox/{ConversationList,BolhaMensagem,CabecalhoConversa,ContactPanel,MenuAtalhos,SeletorProduto,ChannelBadge}.tsx` | 189/199/102/171/159/182/163 | UI |
| Comp. | `src/components/chat/{MediaBar,GalleryModal,MediaPreview,AudioPlayer,AiSuggestion,OrderCard,PaymentCard}.tsx` | 108/184/111/145/123/68/104 | UI de midia; IA oculta; cards sem uso |
| Tela cfg | `src/app/(dashboard)/settings/integracoes/page.tsx` (+ `_components/conectar-conta.tsx`) | — | Conectar conta, QR uazapi, desconectar |
| Catalogo | `src/lib/integracoes-catalogo.ts` | 129 | `PROVEDORES`, `CANAL_DO_PROVEDOR`, `CHAVES_ESPERADAS`, `REFERENCIA_DO_PROVEDOR` |

---

## 3. Glossario: canal, provedor, conta, loja

| Conceito | Onde vive | Valores | Papel |
|---|---|---|---|
| **Canal** | `conversations.channel`, `IncomingMessage.channel` | `whatsapp`, `instagram`, `facebook`, `tiktok` | Decide o campo do contato (`whatsapp_id`...) e o destinatario |
| **Provedor** | `stores_integracoes.provedor` | `whatsapp_oficial`, `uazapi`, `instagram`, `facebook`, `tiktok_shop`, `bling` (`src/lib/integracoes-catalogo.ts:21-30`) | Decide o adapter e a autenticacao do webhook. `whatsapp` tem **dois** provedores (`CANAL_DO_PROVEDOR`, `:49-55`) |
| **Conta** | linha de `stores_integracoes` | uma por numero/perfil/pagina/instancia | Chave de roteamento `referencia_externa`; credencial cifrada; `store_id` define a loja |
| **Loja** | `stores` | Centro, Cerro Azul | Carteira isolada. Conta de canal sempre tem loja (`roteamento.ts:40`); `bling` e da rede (`store_id` nulo) |

`referencia_externa` por provedor e de onde o parser a extrai:

| Provedor | `referencia_externa` | Campo do payload | Onde |
|---|---|---|---|
| `whatsapp_oficial` | `phone_number_id` | `entry[].changes[].value.metadata.phone_number_id` | `whatsapp.ts:271` |
| `uazapi` | nome da instancia | `body.instance ?? instanceId ?? owner ?? token` | `uazapi.ts:186` |
| `instagram` | id da conta profissional | `entry[].id` | `instagram.ts:158` |
| `facebook` | id da pagina | `entry[].id` | `facebook.ts:204` |
| `tiktok_shop` | shop id | query `?conta=` da URL | `roteamento.ts:51-53` |

Credenciais esperadas (`integracoes-catalogo.ts:79-85`): `whatsapp_oficial` = `phone_id`, `access_token`; `uazapi` = `token` (+ opcional `base`, lido em `index.ts:50` mas nao declarado); `instagram` = `page_access_token` (+ opcional `instagram_account_id`); `facebook` = `page_access_token`; `tiktok_shop` sem chave de canal.

---

## 4. Modelo de dados atual do dominio (Prisma)

### 4.1 `conversations` (`prisma/schema.prisma:204-243`)

| Coluna | Tipo | Nota |
|---|---|---|
| `id` | uuid texto | |
| `store_id` | NOT NULL, FK stores | escopo |
| `store_integracao_id` | NULL, FK stores_integracoes | conta de entrada. Nulo = conversa "antiga" -> envio pelo ambiente. FK opcional sem `onDelete` = **SetNull** no Prisma (desvio de RESTRICT) |
| `contact_id` | NOT NULL, FK contacts | |
| `channel` | texto livre | whatsapp/instagram/facebook/tiktok |
| `channel_conversation_id` | NULL | **nunca escrito** |
| `status` | texto, default `open` | open/pending/resolved/archived (sem CHECK) |
| `assigned_to` | NULL, FK users | responsavel |
| `last_message_at`, `last_message_preview` | NULL | preview = 100 chars ou `[contentType]` |
| `unread_count` | int default 0 | |
| `priority` | texto default `medium` | low/medium/high/urgent |
| `sla_deadline` | NULL | **nunca escrito** |
| `sla_breached` | bool | escrito pelo motor de alertas |
| `ai_summary` | NULL | escrito por `/api/ai/summarize` (IA fora de escopo) |
| `created_at`, `updated_at` | Prisma `DateTime` = `timestamp(3)` sem fuso | sem `deleted_at`, `is_deleted`, `modified_by` |

Indices: `store_id`, `store_integracao_id`. **Sem unicidade** de conversa aberta por (contato, conta).

### 4.2 `messages` (`schema.prisma:249-280`)

| Coluna | Nota |
|---|---|
| `store_id` NOT NULL | herdado da conversa |
| `conversation_id` NOT NULL | |
| `sender_type` | customer/agent/bot/system. So `customer` (webhook) e `agent` (UI) sao escritos |
| `sender_id` NULL FK users | atendente (da sessao) |
| `content` NULL | texto ou legenda |
| `content_type` default `text` | text/image/video/audio/document/location/sticker/product/payment |
| `external_id` NULL | id do provedor |
| `external_status` NULL | sent/delivered/read/failed |
| `is_internal_note` bool | |
| `reply_to_id` NULL FK self | **sempre nulo** |
| `metadata` jsonb default `{}` | `erroDeEnvio`, `tentadoNovamenteEm`, `storyReply`, `storyUrl`, `type/videoId` (TikTok) |
| `ai_classification` jsonb | IA |
| `read_at` NULL | quando status `read` |
| `created_at` | **= timestamp do provedor** na entrada (`gateway.ts:187`); sem `updated_at` |

Unicidade: indice parcial `messages_store_external_id (store_id, external_id) WHERE external_id IS NOT NULL` (`prisma/sql/constraints.sql:30-32`). Sem soft delete e sem auditoria.

### 4.3 `message_media` (`schema.prisma:322-341`)

`message_id`, `media_file_id` NULL, `external_url` NULL, `external_id` NULL (media id do provedor), `file_type`, `mime_type`, `file_size` (nunca escrito), `caption`, `downloaded`, `transcription`, `transcription_status` (pending/processing/completed/failed), `created_at`. **Nenhuma** coluna de auditoria; sem indice em `message_id`.

### 4.4 `media_files` (`schema.prisma:286-320`) — campos usados pelo chat

`store_id`, `original_name` (nulo na entrada), `file_key` (chave no bucket), `file_url` (= `/api/media/{id}/raw`), `thumbnail_key/url`, `file_type`, `mime_type`, `file_size`, `width/height`, `duration` (**nunca escrito**), `folder` (`incoming` para webhook, `chat` para anexo do chat), `tags`, `uploaded_by`. Tem soft delete e `modified_by`.

### 4.5 `contacts` — campos de canal (`schema.prisma:149-198`)

`phone`, `whatsapp_id`, `instagram_id`, `facebook_id`, `tiktok_id`, `avatar_url`, `last_contact_at`, `opt_out`. Unicidades por loja: `(store_id, whatsapp_id)`, `(store_id, instagram_id)`, `(store_id, facebook_id)`, `(store_id, tiktok_id)`, `(store_id, phone)` — **nao parciais** e sem considerar `is_deleted` (contato apagado logicamente bloqueia recriacao).

### 4.6 `stores_integracoes` (`schema.prisma:62-104`)

`store_id` NULL, `provedor`, `rotulo`, `status` (desconectado/conectado/expirado/erro), `credenciais_cifradas` (AES-256-GCM, `src/lib/cofre.ts`), `referencia_externa`, `expira_em`, `ultimo_erro`, `ultima_sincronizacao`, 5 colunas de auditoria. `@@unique([provedor, referenciaExterna])` **nao parcial** (conta desconectada por soft delete impede reconectar a mesma referencia).

### 4.7 Desvios do modelo frente a base

- Nomes em ingles (`conversations`, `messages`, `message_media`, `media_files`) — alvo exige PT hierarquico (`conversas`, `conversas_mensagens`, `conversas_mensagens_midias`...).
- Sem `deleted_at/is_deleted/modified_by` em conversas, mensagens e midias de mensagem; `messages` sem `updated_at` (e o reenvio edita a linha).
- Enums como texto livre sem CHECK.
- FKs sem `ON DELETE RESTRICT` explicito; FK opcional vira SetNull.
- `timestamp(3)` **sem fuso** (Prisma). Relevante para a armadilha de optimistic locking: precisao 3 ja existe, fuso nao.

---

## 5. Regras de negocio vigentes (preservar)

| ID | Regra | Evidencia | Status no codigo |
|---|---|---|---|
| R-01 | Mensagem de canal sempre pertence a uma loja; a loja sai da **conta** que recebeu, nunca da URL/slug | `roteamento.ts:29-42`; `docs/integracoes.md` dec. 3 | cumprida (exceto TikTok, pela URL) |
| R-02 | Conta desconhecida/desconectada: responder 200 e **descartar** (com log). Nunca criar loja/conversa de webhook nao reconhecido | `whatsapp/route.ts:49-56`; `docs/api.md` Webhooks | cumprida, mas sem registro persistente |
| R-03 | Contato isolado por loja: mesma pessoa nas duas lojas = dois contatos; busca/criacao do contato **dentro** da loja da conta | `gateway.ts:56-70`; dec. 5 | cumprida |
| R-04 | Conversa e por **conta**, nao por canal: mesmo contato falando com Vendas e SAC = duas conversas | `gateway.ts:83-92` | cumprida |
| R-05 | **Responder pela conta de entrada** (numero/perfil em que a mensagem entrou) | `enviar.ts:100-104`; `media/send/route.ts:61-65` | violada no fallback (D-04) |
| R-06 | N numeros de WhatsApp por loja; `whatsapp_oficial` e `uazapi` convivem no mesmo canal; a escolha e da conta, nao do codigo de envio | `index.ts:40-85`; `integracoes-catalogo.ts:49-55` | cumprida |
| R-07 | uazapi nao tem template nem janela de 24h: `sendTemplate` **falha explicitamente** (nunca mandar o nome do template como texto); campanha por uazapi manda o texto | `uazapi.ts:107-114`; `disparo.ts:174-176` | cumprida |
| R-08 | Nota interna e gravada e **nunca** vai ao canal; nao e reenviavel | `messages/route.ts:90-104`; `reenviar/route.ts:50-55` | cumprida |
| R-09 | Falha de envio **deixa rastro**: mensagem gravada `failed` com motivo legivel para a atendente | `messages/route.ts:114-133`; `gateway.ts:262-278` | cumprida em `/api/messages`, violada em `/api/media/send` (D-07) |
| R-10 | Reenvio **edita** a mesma mensagem (uma mensagem, um estado); so `failed` e reenviavel; sucesso limpa o motivo | `reenviar/route.ts:11-17,42-47,67-81` | cumprida (sem atomicidade, D-17) |
| R-11 | Transferencia so para usuario **ativo** que atende a loja da conversa (mesma loja ou gestao sem loja); senao 422 | `conversations/[id]/route.ts:94-116` | cumprida |
| R-12 | Conversa de outra loja responde igual a inexistente (404) | `conversations/[id]/route.ts:51-56`; `media/[id]/raw/route.ts:30-33` | cumprida |
| R-13 | Autoria (`sender_id`, `uploaded_by`) vem da sessao, nunca do corpo | `messages/route.ts:11`; `media/send/route.ts:12` | cumprida |
| R-14 | Arquivo enviado tem que pertencer a loja **da conversa** | `enviar.ts:87-93`; `media/send/route.ts:69-76` | cumprida |
| R-15 | Bucket privado: equipe le por rota com sessao+escopo; provedor externo recebe URL assinada de 10 min, gerada no envio e nao persistida | `armazenamento.ts:114-128`; ADR 0006 | cumprida |
| R-16 | Midia excluida: soft delete e o objeto **fica** (historico de mensagem nao quebra) | `media/[id]/route.ts:95-112` | cumprida |
| R-17 | Status de conversa e prioridade sao listas fechadas | `conversations/[id]/route.ts:14-23` | cumprida (so no PUT) |
| R-18 | Inbox padrao mostra `open` + `pending` | `conversations/route.ts:26-27` | cumprida |
| R-19 | Mensagem nova do cliente reabre/atualiza: nova entrada forca `status=open`, incrementa `unread_count`; conversa `resolved`/`archived` nao e reaberta, **nasce outra** | `gateway.ts:83-118` | comportamento implicito — confirmar com cliente |
| R-20 | Enviar pela UI zera `unread_count` e atualiza preview/`last_message_at` | `gateway.ts:293-300` | cumprida |
| R-21 | SLA de primeira resposta por canal (minutos): whatsapp 5, instagram 15, facebook 30, tiktok 60; alerta `sla_breach` para conversa `open` com nao lidas alem do limite | `src/lib/alerts/rules.ts:7-12`; `src/lib/alerts/engine.ts:25-77` | parcial (usa `last_message_at`, nao "sem resposta do agente") |
| R-22 | Quem respondeu aparece na bolha (varios vendedores no mesmo numero) | `BolhaMensagem.tsx:119-130` | cumprida |
| R-23 | Aviso de mensagem nova: bipe discreto; notificacao do sistema **so com aba escondida**; permissao **so a partir de clique** | `aviso-sonoro.ts:9-14,88-114` | parcial (D-18) |
| R-24 | Rolagem automatica so se a atendente ja estava no fim (folga 120px); "mensagens anteriores" preserva a posicao de leitura | `ChatWindow.tsx:23,73-77,126-131,184-186` | cumprida |
| R-25 | Menu de respostas rapidas abre so quando a linha inteira e `/termo`; lista vem do banco, so ativas, da loja | `ChatWindow.tsx:311-314`; `MenuAtalhos.tsx:48-70` | cumprida |
| R-26 | Produto no chat vai como **texto** (nome, preco, tamanhos com estoque, 1a foto) inserido no campo para a vendedora complementar | `SeletorProduto.tsx:23-27,49-60`; `ChatWindow.tsx:479-491` | cumprida |
| R-27 | Venda sem sair da conversa: pedido nasce pendente de lancamento no Masc (ADR 0004); o sistema nao escreve no ERP | `inbox/page.tsx:164-174` | fronteira com dominio Pedidos |
| R-28 | Opt-out do contato vale no disparo (conferido no momento do envio) | `disparo.ts:192-198` | so em campanha; o chat nao confere opt-out |
| R-29 | Riscos uazapi comunicados em tela/env/config: banimento, queda de sessao, sem template | `src/lib/uazapi/config.ts:1-28`; `.env.example:51-64` | cumprida |
| R-30 | Credencial nunca volta pela API; desconectar apaga a credencial de verdade e soft-deleta a conta | `integracoes/[id]/route.ts:83-127`; `src/lib/integracoes.ts:53-71` | cumprida |

---

## 6. Fluxo de entrada

### 6.1 Visao geral

```
Provedor --POST--> /api/webhooks/<canal>            (publico: src/lib/api-publica.ts:15-26)
   1. autentica (HMAC Meta / HMAC TikTok Shop / segredo uazapi)   -> 401/403
   2. parse<Canal>Messages(body) -> IncomingMessage[]   (contaExterna do payload)
   3. conta = contaDoEvento(provedor, mensagens[0].contaExterna)  -> null => 200 e descarta
   4. [WhatsApp] baixa midia por mediaId com token do AMBIENTE, vira data: URL
   5. para cada msg (sequencial): processIncomingMessage(msg, conta)
   6. [WhatsApp] para cada status: processStatusUpdate(status)
   7. 200 sempre (inclusive em excecao)
```

Tudo sincrono dentro da requisicao do provedor, sem transacao, sem registro bruto do evento.

### 6.2 `GET /api/webhooks/{whatsapp,instagram,facebook,tiktok}` — verificacao

| Item | Detalhe |
|---|---|
| Entrada | query `hub.mode`, `hub.verify_token`, `hub.challenge` |
| Validacao | `verificarChallenge(canal, url)` (`webhook-auth.ts:70-91`): token por canal em env (`WHATSAPP_VERIFY_TOKEN`, `INSTAGRAM_VERIFY_TOKEN`, `FACEBOOK_VERIFY_TOKEN`, `TIKTOK_VERIFY_TOKEN`); sem env -> 403; `mode !== subscribe` -> 403; comparacao em tempo constante |
| Efeito | devolve `challenge` em texto puro, 200 |
| Defeitos | tokens globais por canal (nao por conta); o GET do TikTok usa challenge estilo Meta que o TikTok Shop nao usa |

### 6.3 `POST /api/webhooks/whatsapp` (Meta Cloud API) — `route.ts:30-89`

| Item | Detalhe |
|---|---|
| Entrada | corpo cru (`req.text()`), header `x-hub-signature-256` |
| Auth | `verificarAssinaturaMeta` (`webhook-auth.ts:41-55`): `sha256=HMAC(corpo, META_APP_SECRET)`, sem segredo -> 403, invalida -> 401 |
| Validacao de payload | nenhuma (JSON.parse; parser tolerante) |
| Resolucao | `contaDoEvento("whatsapp_oficial", messages[0]?.contaExterna)` (`:47-48`) |
| Efeitos | por mensagem com `mediaId` sem `mediaUrl`: `whatsappAdapter.downloadMedia` (**adapter do ambiente**, `:63`), converte em `data:<mime>;base64` (`:65-67`); `processIncomingMessage`; depois `processStatusUpdate` para cada status (`:77-80`) |
| Resposta | 200 `{success:true}` sempre apos auth, inclusive no `catch` (`:84-88`) |
| Idempotencia | por `(store_id, external_id)` no gateway |
| Defeitos | D-01 (status sem mensagem descartado), D-02 (erro -> 200 e perda), D-13 (lote com varias contas roteado pela primeira), D-32 (download com token do ambiente), D-33 (data URL persistida), D-40 (tipos ignorados) |

### 6.4 `POST /api/webhooks/uazapi` — `route.ts:16-53`

| Item | Detalhe |
|---|---|
| Entrada | JSON; header `x-uazapi-secret` **ou** query `?segredo=` |
| Auth | `verificarWebhookUazapi` (`webhook-auth.ts:110-120`): segredo **unico global** `UAZAPI_WEBHOOK_SECRET`; verificado antes de ler o corpo |
| Resolucao | `parseUazapiMessages` -> se vazio, 200 (`:28-31`); `contaDoEvento("uazapi", mensagens[0]?.contaExterna)` |
| Efeitos | `processIncomingMessage` por mensagem. Midia chega como URL e e baixada pelo gateway |
| Resposta | 200 sempre apos auth |
| Nao faz | GET de verificacao; status/ack de entrega; eventos de conexao/QR (o comentario `:26-27` diz que "sao registrados no status da conta" — **falso**) |
| Defeitos | D-08 (fromMe descartado), D-09 (sem ack e sem evento de sessao), D-10 (fallback de conta por `token`/`owner`), D-11 (grupos), D-12 (segredo global/query), D-31 (SSRF/download sem teto) |

### 6.5 `POST /api/webhooks/instagram` e `/facebook` — `route.ts:17-48` (identicas)

| Item | Detalhe |
|---|---|
| Auth | HMAC Meta com o mesmo `META_APP_SECRET` |
| Resolucao | `contaDoEvento("instagram"|"facebook", mensagens[0]?.contaExterna)` (`entry.id`) |
| Efeitos | `processIncomingMessage` por mensagem; midia por `att.payload.url` (CDN) |
| Resposta | 200 sempre apos auth |
| Defeitos | D-13 (roteamento pela primeira entry), D-14 (so o 1o anexo de uma mensagem com varios), D-47 (eco `is_echo` nao filtrado), D-48 (tipos de anexo achatados), D-02 |

### 6.6 `POST /api/webhooks/tiktok` — `route.ts:18-59`

| Item | Detalhe |
|---|---|
| Auth | `configDoApp()` (env `TIKTOK_SHOP_APP_KEY/SECRET/REDIRECT_URI`; faltando -> 403); `verificarAssinaturaWebhook(corpo, Authorization, cfg)` = HMAC-SHA256 hex minusculo de `app_key + corpo` com `app_secret` (`src/lib/tiktok/assinatura.ts:94-111`) -> 401 |
| Resolucao | `contaDaUrl("tiktok_shop", url)` = `?conta=<shop id>` (`roteamento.ts:51-53`) |
| Parser | `parseTikTokEvents`: le `body.data[]` com `comment_id` + `text` (comentario de video, **nao** evento do TikTok Shop) |
| Efeitos | `processIncomingMessage` |
| Defeitos | D-30 (parser de outra API; `senderId` "unknown" junta todos os anonimos num contato; envio impossivel) |

### 6.7 `POST /api/webhooks/payments` — parte de canal

Nao ha parte de canal: a rota (`route.ts:12-104`) autentica por segredo compartilhado (`x-webhook-secret`/`asaas-access-token`), acha `payments` por `external_id` **sem escopo de loja**, mapeia evento por substring e marca pedido pago + `order_events`. **Nao** grava mensagem na conversa nem avisa a cliente; `PaymentCard` existe e nao e usado. Reentrega do mesmo evento aprovado cria `order_events` duplicado. (Detalhar no levantamento de Pedidos/Pagamentos.)

### 6.8 Parsers — mapeamento de tipos

| Canal | Tipo de origem | `contentType` | Campos lidos | Descartado |
|---|---|---|---|---|
| WhatsApp (`whatsapp.ts:283-357`) | text | text | `text.body` | reaction, interactive, button, contacts, order, system, unsupported, `context` (reply), `referral` (anuncio) -> `null` sem log |
| | image/video/document | idem | `id`->mediaId, `mime_type`, `caption` | `filename` do documento |
| | audio | audio | `id`, `mime_type` | flag `voice` |
| | location | location | lat/long, `name||address` em text | |
| | sticker | sticker | `id`, `mime_type` | |
| | status (`:360-385`) | sent/delivered/read/failed | `id`, `timestamp` | `errors[]` (motivo da falha), `conversation`/`pricing` |
| uazapi (`uazapi.ts:147-224`) | `text|conversation|extendedTextMessage` | text | `text||content||body||caption` | `fromMe` (`:192`); tipos desconhecidos viram **text** (`:201`) |
| | image/video/audio/ptt/document/sticker/location (+`*Message`) | idem | `file||mediaUrl||url` (vira mediaId e mediaUrl), `mimetype`, `caption`, lat/long | nome do arquivo; quoted/reply |
| | timestamp | — | seg, ms ou ISO; invalido = agora (`:227-233`) | |
| Instagram (`instagram.ts:152-209`) | `message.text` | text | `mid`, `sender.id`, `timestamp` | `is_echo`, `is_deleted`, reactions, `reply_to.mid` |
| | attachments | image se `type=image`, senao **document** (`:178`) | `payload.url`, text repetido | audio/video/share/story_mention viram document |
| | story reply | metadata `storyReply`, `storyUrl` (`:195-204`) | | |
| Facebook (`facebook.ts:198-247`) | text / attachments | image/video/audio, senao document | `payload.url` | `is_echo`, `postback`, `quick_reply`, location, fallback |
| TikTok (`tiktok.ts:66-95`) | comentario | text | `comment_id`, `user_id||from_user_id||"unknown"`, `text`, `video_id` | todo o resto |

### 6.9 `processIncomingMessage(msg, conta)` — `gateway.ts:33-219`

Entrada: `IncomingMessage` + `{id, storeId}` da conta. Sem transacao. Passos:

1. **Dedupe previo** (`:47-53`): `messages.findFirst({store_id, external_id})` -> se existe, retorna `null` (nada mais e feito).
2. **Contato** (`:56-77`): busca `{store_id, <campo do canal>: senderId}`. Nao achou -> cria com `name`, `avatar_url`, campo do canal e, no WhatsApp, `phone = senderId` (`:68`). Achou e sem nome -> preenche nome. Nunca atualiza avatar. Sem normalizacao de telefone.
3. **Conversa** (`:83-118`): busca `{store_id, contact_id, channel, store_integracao_id: conta.id, status in [open,pending]}` ordenada por `last_message_at desc`. Nao achou -> cria `open`, `medium`, `unread_count=1`, preview. Achou -> atualiza `last_message_at = msg.timestamp`, preview, `unread_count += 1`, `status = open`.
4. **Midia** (`:124-167`): se `mediaUrl` e tipo != text: `subirDeUrl(mediaUrl, {storeId, pasta: canal, mimeType})` (baixa tudo em memoria, sem teto, sem allowlist de MIME), gera id, cria `media_files` (`folder=incoming`, `file_url` interno, thumb se imagem). Se `fileType=audio`, `transcription_status=pending`. Erro -> `console.error` e segue sem midia.
5. **Mensagem** (`:176-193`): `sender_type=customer`, `content`, `content_type`, `external_id`, `reply_to_id=null`, `metadata`, `created_at = msg.timestamp`. `P2002` (corrida) -> retorna `null`.
6. **message_media** (`:196-210`): se ha arquivo **ou** `mediaUrl` — grava `external_url = mediaUrl` (no WhatsApp com upload falho, e a data URL inteira), `external_id = mediaId`, `downloaded`, `transcription_status`.
7. **Contato** (`:213-216`): `last_contact_at = msg.timestamp`.

Retorno: `{contact, conversation, message}` ou `null`. Nenhum evento para a UI (a UI descobre por polling). Nenhuma auditoria.

Idempotencia: boa para reentrega sequencial; na corrida, os passos 2-4 ja rodaram (contador duplicado, midia duplicada no bucket) antes do `P2002` no passo 5. Defeitos: D-02, D-03, D-16, D-24, D-25, D-33, D-38.

### 6.10 `processStatusUpdate(update)` — `gateway.ts:224-238`

Busca `messages.findFirst({external_id})` **sem loja**; grava `external_status` e, se `read`, `read_at`. Sem ordem monotonica (delivered depois de read rebaixa), sem motivo de falha, sem historico. Hoje so e chamado pelo webhook da Meta (e na pratica nunca, D-01). Defeito D-26.

### 6.11 Autenticacao dos webhooks (resumo)

| Rota | Mecanismo | Segredo | Falha |
|---|---|---|---|
| whatsapp/instagram/facebook POST | HMAC `X-Hub-Signature-256` sobre corpo cru, `timingSafeEqual` | `META_APP_SECRET` (um por app) | sem env 403; invalido 401 |
| tiktok POST | HMAC(app_key+corpo) em `Authorization` | `TIKTOK_SHOP_APP_SECRET` | sem cfg 403; invalido 401 |
| uazapi POST | segredo compartilhado em header ou query | `UAZAPI_WEBHOOK_SECRET` (global) | sem env 403; ausente/invalido 401 |
| payments POST | segredo compartilhado em header | `PAYMENT_WEBHOOK_SECRET` | idem |
| transcription POST | `Authorization: Bearer` | `CRON_SECRET` | idem |

Sem protecao contra replay (timestamp/nonce) em nenhum; sem rate limit.

---

## 7. Fluxo de saida

### 7.1 Escolha do adapter — `getAdapterDaConta(canal, credenciais, provedor)` (`index.ts:40-85`)

| Condicao | Adapter |
|---|---|
| `credenciais == null` (conversa sem conta, conta soft-deletada, sem credencial, decifra falhou) | **ambiente** `getAdapter(canal)` |
| `provedor=uazapi` e `token` presente | `criarUazapiAdapter({token, base})` |
| `provedor=uazapi` sem `token` | **ambiente** (WhatsApp Meta do env) |
| `whatsapp` com `phone_id`+`access_token` | `criarWhatsappAdapter` |
| `instagram`/`facebook` com `page_access_token` | fabrica da conta |
| qualquer outro caso (incompleto, tiktok) | **ambiente** |

Os adapters de ambiente leem `process.env.X!` a cada chamada (`whatsapp.ts:23-29`, `instagram.ts:20-25`, `facebook.ts:18-22`): com env vazio mandam `Bearer undefined`.

### 7.2 Matriz de capacidade dos adapters

| Operacao | WhatsApp oficial | uazapi | Instagram | Facebook | TikTok |
|---|---|---|---|---|---|
| Endpoint | `POST graph.facebook.com/v21.0/{phoneId}/messages` Bearer | `POST {base}/send/text`, `/send/media`, header `token` | `POST /me/messages` Bearer page token | idem | — |
| texto | sim | sim | sim | sim | falha |
| imagem (url + legenda) | sim | sim | sim, **legenda ignorada** | sim, legenda ignorada | falha |
| video | sim | sim | falha | sim | falha |
| audio | sim | sim (`type: audio`, nao `ptt`) | falha | sim | falha |
| documento (url + nome) | sim | sim (`docName`) | falha | sim (`file`, nome ignorado) | falha |
| template | sim (`body` params, `pt_BR`) | **falha explicita** | falha | falha | falha |
| downloadMedia | 2 passos Graph (url + bearer) | `fetch(url)` sem auth | `fetch(url)` | `fetch(url)` | lanca |
| `limits` declarado (MB) img/vid/aud/doc | 5/16/16/100 | 5/16/16/100 | 8/0/0/0 | 25/25/25/25 | 0 |
| Id retornado | `messages[0].id` | `id ?? messageid ?? key.id` | `message_id` | `message_id` | — |
| Erro | `error.message`; `res.json()` pode lancar | rede -> `{success:false}`; HTTP -> `error ?? message` | `error.message` | idem | fixo |

`limits` nao e lido por ninguem (D-41). Localizacao, sticker, reacao, reply/quote, marcar como lida no provedor, digitando: **nao existem** no envio.

### 7.3 `entregarNoCanal({conversa, contentType, content, mediaFileId, mediaCaption})` — `enviar.ts:65-136`

1. `destinatarioDoCanal` (`:43-59`): whatsapp = `whatsapp_id || phone`; instagram/facebook/tiktok = id do canal; canal desconhecido = `null` -> `{ok:false}`.
2. Se `mediaFileId`: `media_files.findFirst({id, store_id: conversa.store_id})` -> senao `{ok:false, "Arquivo de midia nao encontrado nesta loja"}`; `urlAssinada(file_key)` (600 s).
3. `contentType != text` sem midia -> `{ok:false}`.
4. `contaDaConversa` -> `credenciaisDaConta` -> `getAdapterDaConta`.
5. `switch contentType`: image/video/audio/document (nome fixo `"document"`, `:120`); **qualquer outro valor cai em `sendText`** (`:122-123`).
6. Excecao do adapter -> `{ok:false, erro}` (`:125-130`). Nao grava nada.

Nao confere: janela de 24h, opt-out, limite do canal, tamanho do texto, conta com `status` erro/expirado.

### 7.4 `saveOutgoingMessage(opts)` — `gateway.ts:249-303`

Cria `messages` (`sender_type=agent`, `sender_id`, `external_status = failed | sent (se tem externalId) | null`, `metadata = {erroDeEnvio}` na falha); se `mediaFileId`, cria `message_media` (`downloaded=true`, sem `file_type`/`mime_type` — a bolha cai em "document", D-34); atualiza conversa (`last_message_at=now`, preview, `unread_count=0`). Sem transacao; nao muda `status` nem `assigned_to`.

### 7.5 `POST /api/messages` — `messages/route.ts:67-144`

| Item | Detalhe |
|---|---|
| Entrada | JSON `{conversationId: string, content?: string, contentType?: string="text", mediaFileId?: string, mediaCaption?: string, isInternalNote?: boolean=false}` (`:12-19`) |
| Auth | middleware (sessao + RBAC POST: admin/gerente/vendedor); handler so confere sessao |
| Validacao | Zod; `contentType` **string livre**; `content` opcional sem minimo/maximo; ids nao validados como uuid |
| Escopo | `conversations.findFirst({id, ...escopoDaLoja(usuario, lojaAtiva(req))})` -> 404 |
| Nota interna | cria `messages` com `is_internal_note=true`, `content_type=text`, **sem** atualizar conversa -> 201 |
| Envio | `entregarNoCanal` -> `saveOutgoingMessage` nos dois resultados -> **201 mesmo com recusa**; o cliente distingue por `external_status` |
| Resposta | `Message` criada; Zod -> 400 `{error: issues}`; outro erro -> 500 |
| Idempotencia | nenhuma (duplo POST = duas mensagens para a cliente) |
| Regras | R-05, R-08, R-09, R-13, R-14, R-20 |
| Defeitos | D-04, D-19 (sem auditoria), D-35 (validacao frouxa), D-36 (sem idempotencia) |

### 7.6 `POST /api/messages/[id]/reenviar` — `reenviar/route.ts:19-84`

| Item | Detalhe |
|---|---|
| Entrada | `id` da URL; sem corpo |
| Escopo | `messages.findFirst({id, ...escopo})` com `media` e `conversation.contact` -> 404 |
| Validacao | `external_status != failed` -> 409; `is_internal_note` -> 409. Nao confere `sender_type` |
| Efeito | `entregarNoCanal` com o conteudo/1a midia gravados; `update` da mesma linha: sucesso -> `sent`, `external_id`, `metadata={}`; falha -> `failed`, `metadata={erroDeEnvio, tentadoNovamenteEm}` |
| Resposta | 200 com a mensagem atualizada |
| Idempotencia | so sequencial. Dois POST concorrentes leem `failed` e **os dois entregam** (D-17) |
| Defeitos | D-17, D-19, D-04 (reenvio apos desconectar a conta sai pelo ambiente) |

### 7.7 `POST /api/media/send` — `media/send/route.ts:22-130`

| Item | Detalhe |
|---|---|
| Entrada | `{conversationId, mediaFileIds: string[] (min 1), caption?}` |
| Escopo | conversa por escopo (404); cada arquivo por `store_id` da conversa, **inexistente e pulado em silencio** (`:76`) |
| Efeito | resolve destinatario **duplicando** `destinatarioDoCanal` (`:43-52`) e o adapter (`:63-65`); para cada arquivo: URL assinada, `switch fileType` (default `sendImage`), **sem try/catch por arquivo**; so grava `saveOutgoingMessage` se `success` |
| Resposta | 201 `{sent, messages}` inclusive com `sent=0` |
| Defeitos | D-07 (falha invisivel e sem rastro), D-42 (logica duplicada divergente: nome do documento aqui = `original_name`, em `enviar.ts` = `"document"`), excecao no meio = 500 com envios parciais ja feitos e sem gravacao dos ja entregues |

### 7.8 Cliente — `src/lib/chat/midia.ts`

- `subirEEnviar(conversationId, file)`: `POST /api/media/upload` (`folder=chat`) -> `enviarDaBiblioteca([id])`. Anexo do chat entra na **galeria** da loja (D-51).
- `enviarDaBiblioteca(ids, legenda)`: `POST /api/media/send`; `res.ok` = sucesso (D-07).

---

## 8. Leitura e gestao de conversas

### 8.1 `GET /api/conversations` — `route.ts:10-66`

- Query: `channel`, `status` (ausente/`all` = `open`+`pending`), `assignedTo`, `priority`, `search` (contato: nome ILIKE, telefone LIKE, email ILIKE), `page`, `limit` (padrao 30, teto 100 — `src/lib/paginacao.ts:25-37`).
- Escopo: `escopoDaLoja` (vendedor/viewer = loja do JWT; gestao = `?loja=` ou cookie `loja_ativa`, senao todas) (`src/lib/loja.ts:58-68,98-109`).
- Retorno: `{conversations: [conversa + contact{id,name,phone,avatarUrl,preferredSize,tags} + agent{id,name,avatarUrl}], total, page, limit}` ordenado por `last_message_at desc nulls last`.
- Nao inclui a conta (`rotulo` do numero), nao filtra por conta, nao filtra contato soft-deletado (filtro de relacao nao passa pela extensao de soft delete), sem cursor estavel (offset).

### 8.2 `GET /api/conversations/[id]` — `route.ts:34-58`

Conversa no escopo + `contact` completo + `agent`. 404 fora do escopo. Nao usado pela inbox (ela usa a lista).

### 8.3 `PUT /api/conversations/[id]` — `route.ts:60-149`

| Item | Detalhe |
|---|---|
| Entrada | `{status?: open|pending|resolved|archived, priority?: low|medium|high|urgent, assignedTo?: string|null, markRead?: boolean}` |
| Escopo | conversa no escopo, senao 404 (`foraDaLoja`) |
| Validacao | Zod enum; corpo vazio de efeito -> 400 "Nada a atualizar" |
| Transferencia | `assignedTo` vazio/null = devolve a fila; senao usuario `is_active` com `store_id = loja da conversa` **ou** `store_id null` -> senao 422 |
| markRead | `unread_count = 0` |
| Efeito | `update` direto por `id` (sem `updated_at` no where — **sem optimistic locking**) |
| Auditoria | so `conversa_resolvida` (status=resolved) ou `conversa_transferida` (qualquer `assignedTo`) (`:133-146`). Mudanca para open/pending/archived e prioridade **nao** sao registradas |
| RBAC | PUT = admin/gerente/vendedor. Viewer abrindo conversa recebe 403 silencioso no `markRead` |
| Defeitos | D-21 (sem locking: duas transferencias simultaneas, ultima vence sem aviso), D-19, D-22 (sem modal block), viewer pode ser destinatario de transferencia (nao responde) |

### 8.4 `GET /api/messages` — `route.ts:24-62`

- Query: `conversationId` obrigatorio (400), `limit` (padrao 50, teto 100), `before` (ISO; `created_at < before`).
- Escopo: `messages.store_id` pelo escopo (nao confere se a conversa existe).
- Retorno: array cronologico (busca desc e inverte) com `media[] + mediaFile (linha inteira, inclui file_key)` e `sender{id,name,avatarUrl}`.
- Defeitos: D-27 (cursor so por `created_at`; empate de segundo — timestamps do WhatsApp sao em segundos — pula mensagens), `before` invalido -> `Invalid Date` -> 500.

### 8.5 Maquinas de estado (como codificadas)

**Conversa (`status`)**
```
(nova mensagem, sem conversa open/pending da mesma conta) -> open
open|pending --nova mensagem do cliente--> open (unread+1)
qualquer --PUT status--> open|pending|resolved|archived   (sem regra de transicao)
resolved|archived --nova mensagem--> (fica como esta) e NASCE outra conversa open
```
Nao ha `resolved_at`, motivo, quem resolveu (so na trilha), reabertura explicita, nem atribuicao automatica.

**Mensagem de saida (`external_status`)**
```
nota interna / sem externalId -> null
POST envio ok -> sent --webhook--> delivered -> read   (webhook pode rebaixar)
POST envio recusado -> failed --reenviar ok--> sent | --reenviar falha--> failed
webhook failed -> failed (sem motivo)
```
Mensagem de entrada: `external_status` null.

**Transcricao (`message_media.transcription_status`)**: `null` (nao audio / saida) | `pending` (audio recebido) -> `processing` -> `completed` | `failed`. `processing` fica preso se o processo morrer.

**Conta (`stores_integracoes.status`)**: `desconectado` (sem credencial) | `conectado` (com credencial ou GET sessao conectado) | `erro` (falha de config uazapi) | `expirado` (so por PUT manual). A sessao uazapi mapeia `conectando`/`desconhecido` para `desconectado`.

---

## 9. Midia usada no chat

| Peca | Comportamento | Defeitos |
|---|---|---|
| `POST /api/media/upload` (`upload/route.ts:17-94`) | multipart `file`, `folder` (livre), `productId`, `tags`; loja = `lojaParaGravar` (gestao sem loja -> 400); corte por `content-length` antes de ler (413); `recusaDoArquivo`: MIME em allowlist (415), vazio (400), teto por tipo (413); `subirArquivo` + `media_files` com `uploaded_by` | `productId` nao conferido contra a loja; `folder` livre; `formData()` le tudo em memoria quando `content-length` ausente/mentiroso; sem auditoria |
| Limites (`limites.ts:15-52`) | image 5 MB (jpeg/png/webp/gif), video 16 MB (mp4/quicktime/webm/3gpp), audio 16 MB (mpeg/ogg/wav/webm/aac/mp4), document 100 MB (pdf, doc(x), xls(x), txt, csv). Teto = WhatsApp | aceita formatos que o WhatsApp recusa no envio (wav/webm audio, webm/quicktime video); nao considera canal (Instagram so imagem) — D-41 |
| `subirArquivo` (`upload.ts:70-93`) | chave `storeId/pasta/uuid.ext` (`armazenamento.ts:74-78`); thumb webp 200x200 para imagem; dimensoes | video sem thumb (regressao aceita, ADR 0006) |
| `subirDeUrl` (`upload.ts:99-113`) | `fetch(url)` qualquer esquema/host (inclui `data:`), buffer inteiro, MIME do provedor ou do header | **sem teto de tamanho, sem allowlist, sem bloqueio de rede interna** — D-05, D-31 |
| `GET /api/media/[id]/raw` (`raw/route.ts:20-63`) | sessao + escopo; `?thumb=1`; le objeto inteiro em memoria; `Content-Type` = gravado; `Content-Disposition: inline`; `Cache-Control: private, max-age=31536000, immutable` | D-05 (inline + sem `nosniff`); arquivo soft-deletado continua em cache do navegador por 1 ano; sem suporte a `Range` (audio/video longos baixam inteiros) |
| `GET /api/media/gallery` (`gallery/route.ts:11-51`) | filtros `folder`, `fileType`, `tag`, `productId`, `search`; escopo; soft delete automatico | inclui `folder=incoming` (fotos de clientes) e `chat` na mesma galeria |
| `GET/PUT/DELETE /api/media/[id]` | escopo; PUT sem Zod (`folder`, `tags`, `productId` com checagem de loja); DELETE soft, objeto fica | PUT sem validacao; sem auditoria; DELETE nao checa uso em mensagens |
| URL assinada (`armazenamento.ts:123-128`) | 600 s, gerada no envio | provedor que baixa atrasado (fila da Meta) recebe 403 |
| `process.ts` | `CHANNEL_LIMITS`, `isMediaSupported`, `getAcceptedMimeTypes` | **nao importado por ninguem** |

---

## 10. Transcricao

| Item | Detalhe |
|---|---|
| Rota | `POST /api/transcription` (`transcription/route.ts:9-22`), publica (`api-publica.ts:20`), `Bearer CRON_SECRET`; processa ate 5 por chamada; responde `{processed}` |
| Selecao | `message_media` `transcription_status=pending` e `file_type=audio`, `created_at asc` (`whisper.ts:47-57`), **sem escopo de loja, sem lock** (duas chamadas pegam os mesmos) |
| Execucao | marca `processing`; `transcribeAudio(mediaFile.fileUrl || externalUrl)`: `fetch` do audio, envia a OpenAI `whisper-1`, `language=pt`, nome fixo `audio.ogg`; grava texto e `completed`; erro -> `failed` |
| Exibicao | `AudioPlayer` mostra "Aguardando/Transcrevendo/Falha/texto" num expansivel |
| Defeitos | D-06: `fileUrl` e relativo (`/api/media/{id}/raw`) -> `fetch` no Node lanca; e a rota exige sessao. Nenhum agendador chama a rota (nada em `docker-compose.yml`, `Dockerfile`, `package.json`). Sem retentativa; `processing` orfao; audio da cliente enviado a terceiro (OpenAI) sem registro de base legal/consentimento; `OPENAI_API_KEY` global |

---

## 11. uazapi — ciclo de vida do numero

| Peca | Detalhe |
|---|---|
| Config (`uazapi/config.ts`) | `UAZAPI_BASE_URL` obrigatorio (host da instalacao); endpoints `/send/text`, `/send/media`, `/instance/status`, `/instance/connect`, `/instance/disconnect`; header `token`; tipos image/video/audio/document. **Tudo marcado CONFERIR** (Swagger nao lido) |
| `estadoDaInstancia(token)` / `iniciarPareamento(token)` (`instancia.ts:80-91`) | GET status / POST connect; normaliza `connected|open` -> conectado, `connecting|qrcode|pairing` -> conectando, `disconnected|close|closed` -> desconectado; le `qrcode`, `owner/number`. Usa sempre `baseDaApi()` global, ignorando `credenciais.base` que o adapter aceita (`index.ts:50`) |
| `GET /api/integracoes/uazapi/[id]/sessao` (`route.ts:53-77`) | conta `provedor=uazapi` viva; token decifrado (409 se ausente); consulta estado e **grava** `status` (conectado ou desconectado), `ultimo_erro=null`, `modified_by` a cada chamada; erro de config -> grava `status=erro`, 503 |
| `POST .../sessao` (`route.ts:79-93`) | inicia pareamento e devolve QR; **sem auditoria** (parear um aparelho novo ao numero da loja e a acao mais sensivel do canal) |
| RBAC | so admin via middleware (`rbac.ts:58-62`); handler so confere sessao |
| Tela (`settings/integracoes/page.tsx:94-109`) | botoes "consultar" (GET) e "gerar QR" (POST); nao ha polling automatico nem desconectar sessao (endpoint `desconectar` sem uso); desconectar a conta usa `window.confirm` (`:114-118`), nao modal block |
| Deteccao de queda | **inexistente** fora do clique manual (D-09) |

---

## 12. Frontend

### 12.1 `/inbox` — `src/app/(dashboard)/inbox/page.tsx` (client component)

- Estado: `conversations`, `selectedId`, `search` (debounce 350 ms, `:28-32`), `channelFilter`, `statusFilter`, `vendendo`.
- Carrega `GET /api/conversations` com filtros (`:34-46`) e **polling a cada 5 s** (`:52-55`) — so a 1a pagina (30).
- Layout: coluna 1 lista (mobile: tela cheia), coluna 2 `ChatWindow`, coluna 3 `ContactPanel` + botao "Nova venda" (desktop); mobile tem Sheet de contato e botao "Vender". `PainelVenda` (dominio Pedidos) recebe `contactId`, `conversationId`.
- A conversa selecionada vem da lista: se sair da 1a pagina ou do filtro, o chat fecha.

### 12.2 `ConversationList`

Badge "N sem resposta" = conversas com `unread_count>0` na pagina; busca; filtro canal (todos/whatsapp/instagram/facebook/tiktok); filtro status ("Abertos"=open+pending, open, pending, resolved — sem archived); item com avatar + icone do canal, nome/telefone, tempo relativo, badge do canal, URGENTE/ALTA, preview, contador de nao lidas. **Nao mostra** conta/numero, responsavel, SLA estourado.

### 12.3 `ChatWindow` (orquestrador, 494 linhas)

| Aspecto | Comportamento | Onde |
|---|---|---|
| Pagina | 40 mensagens | `:20` |
| Troca de conversa | limpa lista, carrega, rola ao fim | `:139-144` |
| Carregar | `GET /api/messages?limit=40` + `mesclarMensagens(atuais, recentes)`; `temMais = recebidas >= 40` | `:87-97` |
| Anteriores | cursor `before=createdAt` da mais antiga nao pendente; mescla invertida (tela vence); preserva scroll | `:100-135` |
| Marcar lida | PUT `markRead` ao abrir e a cada nova mensagem do cliente; chama `onConversaAtualizada` (recarrega lista) | `:151-162,181` |
| Polling | a cada 5 s: carrega; se ultima mensagem mudou e e `customer` (e nao e a 1a leitura) -> bipe + notificacao se aba escondida + markRead; rola se estava no fim | `:164-189` |
| Envio texto | Enter (sem Shift) ou botao; bolha otimista `local:N` `pendente`; limpa campo; POST; `!ok` -> remove otimista, devolve texto, toast; ok -> substitui pela salva; se `failed` -> toast com motivo | `:193-253` |
| Nota interna | mesmo fluxo com `isInternalNote=true` (botao post-it) | `:445-454` |
| Reenviar | POST reenviar; atualiza a bolha; toast | `:255-273` |
| Transferir/Resolver | PUT via `CabecalhoConversa`; toast; recarrega lista | `:277-291,339-351` |
| Midia | foto/video/arquivo -> `subirEEnviar`; galeria -> `enviarDaBiblioteca`; depois recarrega | `:295-307` |
| Respostas rapidas | regex `^\/(\S*)$` abre `MenuAtalhos`; escolher substitui o texto; Esc limpa | `:313-314,415-423` |
| Produto | `SeletorProduto` acrescenta texto ao campo | `:482-491` |
| IA | `AiSuggestion` comentado (fora de escopo desde 18/08/2026) | `:389-400` |
| Defeitos | D-18, D-28 (fetch que lanca deixa bolha presa e texto perdido: `try/finally` sem `catch`, `:218-252`), D-29 (mescla ignora nota), polling duplo (lista+chat) + PUT a cada mensagem |

### 12.4 `BolhaMensagem`

Alinha agente/bot a direita; nota interna amarela com rotulo; falha com borda vermelha, "Nao entregue" + tooltip `metadata.erroDeEnvio` + botao "Tentar de novo"; nome do atendente (exceto nota); midias via `MediaPreview` (`mediaFile.fileUrl || externalUrl`); texto com `whitespace-pre-wrap` (React escapa); tempo relativo; icones de estado: pendente (relogio), sent (check), delivered (check duplo cinza), read (check duplo azul). Nao ha: citacao/reply, reacao, mensagem apagada, localizacao renderizada (vira texto), sticker (vira documento).

### 12.5 `CabecalhoConversa`

Nome + badge do canal; `<select>` "Transferir para..." carregado de `GET /api/usuarios` (ativos da loja + gestao; inclui o proprio usuario e viewers) — dispara ao escolher, **sem confirmacao**; botao "Resolver" sem confirmacao. Nao mostra responsavel atual, conta/numero, status, prioridade.

### 12.6 `ContactPanel`

`GET /api/contacts/{id}`: avatar/iniciais, tamanho preferido, telefone, email, WA id, IG id, pedidos, total gasto, tags, notas. Somente leitura.

### 12.7 `MenuAtalhos` e `SeletorProduto`

- `MenuAtalhos`: `GET /api/quick-replies?apenasAtivas=1&search=` com debounce 150 ms; teclado em captura (setas, Enter escolhe sem enviar, Esc fecha); `onMouseDown` para nao perder foco. Nao substitui variaveis (`{nome}`).
- `SeletorProduto`: `GET /api/products?limit=20&search=` debounce 250 ms; mostra preco, SKU, tamanhos com `stock>0`; `textoDoProduto` (`:49-60`). Estoque vem de `products.stock` local, que o ADR 0004 diz **nao** ser verdade de estoque (Bling e).

### 12.8 `src/components/chat/*`

| Componente | Uso | Notas |
|---|---|---|
| `MediaBar` | usado | inputs `image/*`, `video/*`, `.pdf,.doc,.docx`; botoes produto, galeria, resposta rapida. Sem gravacao de audio, sem colar imagem, sem arrastar |
| `GalleryModal` | usado | pastas fixas (todos/produtos/lookbooks/general); multi-selecao + legenda unica para todos. D-49: cada tecla na busca reexecuta o efeito que **zera a selecao e a legenda**; sem debounce; sem checar `res.ok` |
| `MediaPreview` | usado | audio -> `AudioPlayer`; imagem thumb + dialog; video `<video controls>`; documento com link `target=_blank` para `/raw` (vetor do D-05) |
| `AudioPlayer` | usado | play/pause, barra, duracao (`media_files.duration` nunca preenchido), transcricao expansivel |
| `AiSuggestion` | oculto | chama `/api/ai/suggest` |
| `OrderCard`, `PaymentCard` | **sem uso** | cards de pedido/Pix nunca renderizados |

### 12.9 `lib/chat/mesclar.ts` e `aviso-sonoro.ts`

- `mesclarMensagens(atuais, recentes)` (`mesclar.ts:28-43`): mapa por id, servidor vence, remove otimista quando existe mensagem confirmada com mesmo `senderType` + `content`, ordena por `createdAt`. Duas mensagens iguais seguidas: a 1a confirmacao remove as duas otimistas. Nao compara `isInternalNote` apesar do comentario (`:52-53`).
- `armarAviso` cria `AudioContext` no 1o `pointerdown/keydown`; `tocarBipe` duas notas 880/1174 Hz, ganho 0,08; `notificarSeEscondido(titulo, corpo)` so com aba oculta e permissao concedida, `tag` pelo titulo (nome do contato); `pedirPermissaoDeAviso` **nunca e chamado** -> notificacao nunca aparece.

---

## 13. Outros consumidores do dominio

| Consumidor | Uso | Nota |
|---|---|---|
| Disparo de campanha (`src/lib/broadcasts/disparo.ts:166-236`) | `getAdapterDaConta` pela `broadcasts.store_integracao_id`; `destinatarioDoCanal`; template (oficial) ou texto (uazapi); confere opt-out | **nao grava** a mensagem na conversa do contato: atendente nao ve que a cliente recebeu campanha. Fila no Postgres (ADR 0007) |
| Motor de alertas (`src/lib/alerts/engine.ts:25-77,82+`) | `sla_breach` por canal; `review_risk` (IG/FB 2h) | sem escopo por loja na busca (grava loja no alerta); criterio usa `last_message_at` e `unread_count`, nao tempo sem resposta de agente |
| Analytics (`src/app/api/analytics/route.ts:31-60`) | contagens de conversa por status/periodo/canal | — |
| LGPD (`src/app/api/lgpd/route.ts:140-151`) | exporta conversas+mensagens; DELETE apaga **fisicamente** `message_media`, `messages`, `conversations`, contato | nao apaga objetos no MinIO nem `media_files` recebidos (PII residual) — D-20 |
| IA (`/api/ai/classify|suggest|summarize`) | le mensagens/conversa; grava `ai_classification`, `ai_summary` | fora de escopo (decisao 18/08/2026) |
| Painel de venda (`inbox/_components/painel-venda.tsx:142-147`) | `POST /api/orders` com `conversationId` | pedido nao gera mensagem/card na conversa |

---

## 14. RBAC e autenticacao efetivos (rotas do dominio)

Regra padrao (`src/lib/rbac.ts:34-40`): GET todos; POST/PUT/PATCH admin+gerente+vendedor; DELETE admin+gerente. Excecao `/api/integracoes/**` so admin. Aplicado **so** no `src/middleware.ts:64-69` com `role` do JWT (pode estar desatualizado). Handlers conferem apenas sessao (`src/lib/sessao.ts:22-30`) e escopo de loja.

| Rota | GET | POST/PUT | Escopo no handler |
|---|---|---|---|
| `/api/conversations`, `[id]` | todos | PUT: admin/gerente/vendedor | sim |
| `/api/messages` | todos | POST: admin/gerente/vendedor | sim |
| `/api/messages/[id]/reenviar` | — | POST: idem | sim |
| `/api/media/send`, `upload` | — | POST: idem | sim |
| `/api/media/gallery`, `[id]`, `[id]/raw` | todos | PUT idem; DELETE admin/gerente | sim |
| `/api/integracoes/uazapi/[id]/sessao` | admin | POST admin | **nao** (qualquer loja; so sessao) |
| `/api/webhooks/*`, `/api/transcription` | publico + segredo | publico + segredo | n/a |

Nao ha regra de "so o responsavel responde": qualquer vendedor da loja envia em qualquer conversa, inclusive atribuida a outro.

---

## 15. Trilha de auditoria

Lista fechada `ACOES` (`src/lib/auditoria.ts:23-35`). No dominio, **registrado**: `conversa_resolvida`, `conversa_transferida`, `integracao_conectada`, `integracao_desconectada`. `registrar` nunca derruba a operacao (grava apos o efeito).

**Nao registrado** (regra da base exige): envio de mensagem, nota interna, reenvio, envio de midia, upload/edicao/exclusao de midia, marcar como lida, mudar status para open/pending/archived, mudar prioridade, parear QR uazapi, consulta de sessao que muda `status`, mensagem recebida/descartada por conta desconhecida, falha de webhook, transcricao enviada a terceiro.

---

## 16. Idempotencia e concorrencia — quadro

| Operacao | Protecao atual | Buraco |
|---|---|---|
| Webhook reentregue | dedupe `(store_id, external_id)` + indice unico parcial | na corrida, contato/conversa/contador/midia ja foram escritos antes do `P2002` |
| 1a mensagem de contato novo concorrente | `@@unique(store_id, <canal>_id)` | `P2002` no `contact.create` nao tratado -> excecao -> 200 -> mensagem perdida |
| Conversa aberta duplicada | nenhuma | duas conversas `open` para o mesmo contato+conta |
| Status de entrega | nenhuma | fora de ordem rebaixa; sem loja |
| POST mensagem | botao desabilitado enquanto envia | sem chave de idempotencia; retry de rede = duplicado na cliente |
| Reenvio | checagem `failed` antes de entregar | sem claim atomico -> duplo envio concorrente |
| PUT conversa | nenhuma | ultima escrita vence (transferencia, status) |
| Transcricao | nenhuma | duas execucoes pegam os mesmos pendentes |
| Upload/galeria envio | nenhuma | — |

---

## 17. Catalogo de defeitos e desvios

| ID | Sev | Onde | Defeito | Cenario / impacto |
|---|---|---|---|---|
| D-01 | ALTA | `webhooks/whatsapp/route.ts:47-56,77-80` | Conta resolvida por `messages[0]`; payload so com `statuses` retorna antes de processar status | Meta envia recibos em POST separados: `delivered/read/failed` nunca chegam; falha assincrona (ex. numero sem WhatsApp) fica como `sent` |
| D-02 | ALTA | todos os webhooks (`whatsapp/route.ts:84-88` etc.) | Processamento sincrono, sem registro bruto, 200 em qualquer erro | Postgres/MinIO fora por segundos = mensagem de cliente perdida sem reentrega; midia grande estoura o prazo do provedor |
| D-03 | CRIT | `gateway.ts:60-70`; `schema.prisma:195` | Criacao de contato WhatsApp grava `phone=senderId`; se ja existe contato do CRM com o mesmo telefone e sem `whatsapp_id`, `P2002` nao tratado | **Toda** mensagem daquele cliente e perdida, para sempre, com 200 ao provedor. Tambem: telefone sem normalizacao gera duplicata quando formato difere |
| D-04 | ALTA | `index.ts:45,52,84`; `roteamento.ts:70-74,97`; `enviar.ts:102-104` | Fallback silencioso para adapter do ambiente | Conta desconectada, credencial ilegivel/incompleta ou conversa sem vinculo (todo o seed) -> resposta sai pelo numero do `.env` ou falha com `Bearer undefined`; viola R-05 |
| D-05 | ALTA | `upload.ts:99-113`; `gateway.ts:130-134`; `raw/route.ts:43-53`; `MediaPreview.tsx:106` | Midia recebida sem allowlist de MIME servida `inline` na origem, sem `X-Content-Type-Options: nosniff` | Cliente envia documento HTML/SVG (uazapi/Messenger aceitam) -> atendente abre -> script com a sessao dela chama a API |
| D-06 | ALTA | `whisper.ts:13,60`; ausencia de cron | URL relativa + rota autenticada; nada agenda | Transcricao nunca funciona; audios ficam `pending`/`failed` |
| D-07 | ALTA | `media/send/route.ts:107-122`; `chat/midia.ts:45` | Falha de envio de midia nao grava mensagem e responde 201 | Atendente acha que mandou a foto; sem bolha vermelha nem reenvio |
| D-08 | ALTA | `uazapi.ts:192` | Descarta `fromMe` | Vendedora responde pelo celular do numero (uso comum em uazapi) e o historico fica sem a resposta; colegas nao sabem o que foi prometido |
| D-09 | ALTA | `webhooks/uazapi/route.ts:26-31`; `instancia.ts` | Sem ack de entrega e sem tratamento de evento de conexao (comentario afirma o contrario) | Numero cai e ninguem sabe ate abrir a tela; mensagens uazapi ficam `sent` para sempre |
| D-10 | MEDIA | `uazapi.ts:186` | `contaExterna = instance ?? instanceId ?? owner ?? token` | Payload sem `instance` casa por telefone/token; se alguem cadastrar o token como referencia, o segredo fica em claro em `referencia_externa`, na API e na trilha |
| D-11 | MEDIA | `uazapi.ts:195-198` | `chatid` de grupo (`@g.us`) vira "telefone" | Mensagens de grupo criam contato/conversa falsos; resposta vai ao grupo |
| D-12 | MEDIA | `webhook-auth.ts:110-120` | Segredo unico para todas as instancias e aceito em query | Vaza em log de proxy; quem tem o segredo injeta mensagem em qualquer numero de qualquer loja |
| D-13 | MEDIA | `whatsapp/route.ts:48`; `instagram/route.ts:29`; `facebook/route.ts:29`; `uazapi/route.ts:33` | Lote com eventos de varias contas e roteado pela primeira | Mensagem do numero B cai na loja/conversa do numero A |
| D-14 | MEDIA | `instagram.ts:176-185`; `facebook.ts:222-235` | Varios anexos de uma mensagem compartilham o mesmo `mid` | So o 1o anexo e salvo; demais caem no dedupe |
| D-15 | ALTA | `inbox/page.tsx:34-46`; `conversations/route.ts:21` | Tela usa so a 1a pagina (30) | Conversas alem da 30a so aparecem por busca |
| D-16 | MEDIA | `gateway.ts:83-107` | Sem unicidade de conversa aberta por (contato, conta) | Corrida cria duas conversas `open` |
| D-17 | MEDIA | `reenviar/route.ts:42-81` | Checagem e envio sem claim atomico | Duas abas/atendentes reenviam -> cliente recebe duas vezes |
| D-18 | MEDIA | `aviso-sonoro.ts:109`; `ChatWindow.tsx:164-189` | Permissao de notificacao nunca pedida; bipe so para a conversa aberta; `tag` pelo nome | Mensagem de conversa nova/nao aberta nao avisa ninguem; homonimos colapsam |
| D-19 | ALTA | sec. 15 | Trilha so cobre resolver/transferir | Regra absoluta da base; "quem mandou isso para a cliente?" sem resposta auditavel (so `sender_id`) |
| D-20 | ALTA | `schema.prisma:204-341`; `lgpd/route.ts:140-151` | Tabelas do chat sem auditoria/soft delete; LGPD apaga fisico e deixa binarios e `media_files` | Viola regra da base; esquecimento LGPD incompleto (foto/audio da titular permanece) |
| D-21 | MEDIA | `conversations/[id]/route.ts:122-129` | Sem optimistic locking | Dois gerentes transferem ao mesmo tempo; ultima vence sem aviso |
| D-22 | MEDIA | `CabecalhoConversa.tsx:52-98`; `settings/integracoes/page.tsx:114-118` | Resolver/transferir sem confirmacao; desconectar com `window.confirm` | Regra do modal block 3 s |
| D-23 | MEDIA | `schema.prisma:212,238` | FK opcional sem `onDelete` (SetNull) e nomes em ingles | Desvio de RESTRICT/nomenclatura |
| D-24 | BAIXA | `gateway.ts:108-118,176-193` | Conversa atualizada antes do insert da mensagem | Na corrida, `unread_count` e preview contam duas vezes |
| D-25 | MEDIA | `gateway.ts:124-167` | Midia baixada antes do dedupe final e sem teto | Corrida duplica objeto no bucket; arquivo enorme derruba o processo |
| D-26 | MEDIA | `gateway.ts:224-238` | Status sem loja, sem ordem, sem motivo | Rebaixa `read` para `delivered`; `failed` sem explicacao |
| D-27 | MEDIA | `messages/route.ts:46`; `ChatWindow.tsx:111-112` | Cursor so por `created_at` (segundos do provedor) | Mensagens no mesmo segundo da borda nunca aparecem em "anteriores" |
| D-28 | MEDIA | `ChatWindow.tsx:218-252` | `try/finally` sem `catch` | Queda de rede: bolha "enviando" eterna e texto apagado |
| D-29 | BAIXA | `mesclar.ts:55-65` | Confirmacao por texto+remetente ignora nota e duplicatas | Nota e mensagem de mesmo texto se confundem; duas mensagens iguais somem juntas da fila otimista |
| D-30 | MEDIA | `tiktok.ts:24-95`; `webhooks/tiktok/route.ts` | Parser de comentario atras de HMAC do TikTok Shop; envio sempre falha; `senderId "unknown"` | Canal nao entrega nada util; todos os anonimos viram um contato |
| D-31 | MEDIA | `upload.ts:103`; `uazapi.ts:127` | `fetch` de URL vinda do payload sem restricao | SSRF para rede interna (MinIO, metadados) com conteudo exibido na UI |
| D-32 | ALTA | `whatsapp/route.ts:63` | Download de midia com adapter do ambiente, nao da conta | Numero de outra WABA/token: midia perdida; como `mediaUrl` fica vazio, nem `message_media` e gravado (id perdido) |
| D-33 | MEDIA | `whatsapp/route.ts:65-66`; `gateway.ts:201` | Upload falho grava a data URL base64 inteira em `message_media.external_url` | Linhas de MB no banco; bolha renderiza base64 |
| D-34 | BAIXA | `gateway.ts:281-290` | Midia de saida sem `file_type/mime_type` em `message_media` | Bolha usa `fileType || "document"`: foto enviada aparece como documento |
| D-35 | MEDIA | `messages/route.ts:12-19` | `contentType` livre, `content` sem limite/minimo, `mediaFileId` aceito com `text` | `product/payment/location` viram falha; texto vazio vai ao provedor; >4096 chars recusado so no canal |
| D-36 | MEDIA | `messages/route.ts:67-133` | Sem chave de idempotencia | Retry de rede duplica mensagem na cliente |
| D-37 | MEDIA | `conversations/route.ts:43-57`; `ConversationList.tsx` | Lista sem conta/rotulo, responsavel, SLA; sem filtro por conta nem "minhas" | Com N numeros por loja a atendente nao sabe se esta no Vendas ou no SAC |
| D-38 | MEDIA | `gateway.ts:83-107` | Resolvida/arquivada nunca reabre; nasce outra conversa; UI mostra so a conversa atual | Historico fragmentado sem linha do tempo do contato (confirmar regra) |
| D-39 | MEDIA | `gateway.ts:185`; parsers | Reply/citacao inexistente | Escopo pede reply; `context.id` (WA) e `reply_to.mid` (IG) ignorados; UI e envio nao citam |
| D-40 | MEDIA | `whatsapp.ts:355-356` | Tipos nao mapeados descartados sem log | Reacao, botao, lista, contato, pedido do catalogo, anuncio clicado somem |
| D-41 | BAIXA | `limites.ts`; `process.ts`; `types.ts:70-75` | Limite por canal inexistente no envio (codigo morto) | Video para Instagram, audio webm para WhatsApp so falham no provedor |
| D-42 | MEDIA | `media/send/route.ts:43-105` x `enviar.ts:43-136` | Logica de envio duplicada e divergente | Nome do documento, default de tipo e tratamento de erro diferentes; viola "uma regra, um lugar" |
| D-43 | ALTA | `middleware.ts:64-69`; handlers | Papel checado so no middleware, a partir do JWT | Next 16: proxy nao e fronteira; papel rebaixado continua valendo ate o token expirar; POST de QR uazapi (sequestro do numero) protegido so por middleware |
| D-44 | BAIXA | `conversations/[id]/route.ts:98-107` | Viewer pode receber transferencia; viewer nao consegue `markRead` (403) | Conversa atribuida a quem nao responde; contador nao zera para viewer |
| D-45 | BAIXA | `sessao/route.ts:65-72` | GET grava a cada consulta e mapeia `conectando` para `desconectado`; POST sem auditoria | Write storm se houver polling; estado enganoso durante pareamento |
| D-46 | BAIXA | `webhooks/payments/route.ts` | Sem parte de canal; reentrega duplica `order_events`; busca sem loja | Cliente nao e avisada; `PaymentCard` morto |
| D-47 | MEDIA | `instagram.ts:160-192`; `facebook.ts:206-243` | Eco (`is_echo`) nao filtrado | Com `message_echoes` assinado, mensagem da pagina vira "cliente" com contato = pagina |
| D-48 | BAIXA | `instagram.ts:178`; `facebook.ts:224-227` | Anexos achatados para document | Audio/video do Instagram, localizacao/compartilhamento viram documento |
| D-49 | BAIXA | `GalleryModal.tsx:43-60` | Efeito reexecuta a cada tecla e zera selecao | Buscar depois de selecionar perde a selecao |
| D-50 | BAIXA | `docs/api.md:34,427,587-592,606,612` | Documentacao divergente | Diz TikTok por `x-webhook-secret`, chaves uazapi `phone_id/access_token`, upload no Cloudinary |
| D-51 | BAIXA | `chat/midia.ts:20`; `gallery/route.ts` | Anexo do chat e foto recebida entram na galeria da loja | Galeria de produtos misturada com dado pessoal de cliente |
| D-52 | BAIXA | `raw/route.ts:50` | `immutable` 1 ano | Arquivo excluido/escopo alterado continua visivel no cache do navegador |
| D-53 | BAIXA | `prisma/seed.ts:129,149` | Conversas do seed sem `store_integracao_id` | Todo teste manual de envio exercita o fallback do ambiente (esconde D-04) |
| D-54 | MEDIA | `enviar.ts`; `messages/route.ts` | Chat nao confere `opt_out` nem janela de 24h (oficial) nem status da conta | Falha so aparece como erro do provedor; opt-out LGPD vale so em campanha |

---

## 18. Funcionalidades ausentes ou parciais

- **Reply/citacao** (entrada, saida, UI) — D-39.
- **Reacoes, edicao e exclusao** de mensagem pelo cliente; "digitando"; marcar como lida no provedor (tick azul para a cliente).
- **Mensagens enviadas fora do sistema** (celular no uazapi, app do Instagram) — D-08, D-47.
- **Tempo real**: tudo por polling de 5 s (lista + chat).
- **Aviso global** de mensagem nova e notificacao do sistema — D-18.
- **Filtros de inbox**: por conta/numero, "minhas", nao atribuidas, SLA estourado, arquivadas; paginacao — D-15, D-37.
- **Atribuicao automatica** (1a resposta, distribuicao) e regra de posse da conversa.
- **Template do WhatsApp oficial no chat** para abrir janela de 24h (existe so em campanha).
- **Gravacao/envio de audio** (nota de voz), colar/arrastar imagem, envio de localizacao.
- **Linha do tempo do contato** juntando conversas resolvidas — D-38.
- **Card de pedido/pagamento** na conversa (componentes existem, sem uso).
- **Status de sessao uazapi** automatico e desconectar sessao — D-09.
- **Transcricao** funcional — D-06.
- **Registro bruto de webhooks** (`integracoes_eventos` especificado em `docs/integracoes.md` e nao implementado) — D-02.
- **Credencial por conta no TikTok** e canal TikTok real — D-30.

---

## 19. Codigo morto ou oculto

`src/lib/media/process.ts` inteiro; tipos de config e `OutgoingMessage` em `src/lib/channels/types.ts:57-67,120-141`; `ChannelAdapter.limits`; `lojaDoWebhook` (`src/lib/loja.ts:151-159`); `UAZAPI_ENDPOINTS.desconectar`; `pedirPermissaoDeAviso`; `OrderCard`, `PaymentCard`; `AiSuggestion` (comentado); colunas `conversations.channel_conversation_id`, `sla_deadline`, `messages.reply_to_id`, `media_files.duration`, `message_media.file_size`.

---

## 20. Testes existentes que codificam regras (portar como casos)

| Arquivo | O que trava |
|---|---|
| `tests/chat-fase3.test.ts` | mescla (sem duplicar, servidor vence, remove otimista confirmada, preserva historico, ordena por data); `destinatarioDoCanal` (WA cai no telefone, prefere whatsappId, outros sem fallback, canal desconhecido = null); falha grava rastro e 201; reenvio so `failed`; bolha mostra motivo; rolagem so no fim; transferir/resolver ligados; PUT com enum fechado e loja do destinatario; lista de usuarios sem dado sensivel e so ativos; atalhos do banco, so ativos, regex; aviso armado em gesto, notifica so escondido, nao pede permissao sozinho; busca com debounce |
| `tests/roteamento.test.ts` | conta vem do payload; nenhum webhook resolve loja pela URL; conversa guarda conta e e procurada por conta; envio pela conta de entrada; `getAdapterDaConta` (credencial, fallback, incompleta) |
| `tests/uazapi.test.ts` | dois provedores convivem; webhook Meta resolve por `whatsapp_oficial`, uazapi por `uazapi`; token no header; instancias nao compartilham token; uazapi fora do ar vira erro; `sendTemplate` falha explicito; auth do webhook (sem segredo recusa, header, query); parser (instancia, ignora eco, payload desconhecido = [], timestamps, URL como mediaId); incerteza concentrada no `config.ts`; aviso de banimento |
| `tests/adapters-por-conta.test.ts`, `tests/envio-por-conta.test.ts` | fabricas por conta; token/phone_id por conta; chaves esperadas; rota de conectar recusa credencial incompleta |
| `tests/webhook-auth.test.ts` | HMAC Meta (correto, outro segredo, corpo adulterado, ausente, sem prefixo, sem env = 403); challenge por canal (token do WA nao vale no IG); pagamento; cron |
| `tests/robustez-fase5.test.ts` | teto de paginacao; limites de upload (svg recusado, teto, vazio, cabecalho); reentrega de webhook nao duplica (dedupe + indice unico) |
| `tests/midia-minio.test.ts` | URL nao publica, assinatura so no envio, escopo na rota raw |
| `tests/tiktok-assinatura.test.ts` | HMAC do webhook TikTok Shop |

Muitos desses testes sao por **inspecao de codigo-fonte** (regex no arquivo), nao comportamento — o novo sistema deve reescreve-los como testes de comportamento.

---

## 21. Variaveis de ambiente do dominio (`.env.example`)

`META_APP_SECRET` (HMAC dos 3 webhooks Meta), `WHATSAPP_VERIFY_TOKEN`, `INSTAGRAM_VERIFY_TOKEN`, `FACEBOOK_VERIFY_TOKEN`, `TIKTOK_VERIFY_TOKEN`; legado de conta unica por ambiente: `WHATSAPP_PHONE_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `META_APP_ID`, `META_PAGE_ACCESS_TOKEN`, `META_INSTAGRAM_ACCOUNT_ID`, `TIKTOK_CLIENT_KEY/SECRET`; `TIKTOK_SHOP_APP_KEY/APP_SECRET/REDIRECT_URI`; `UAZAPI_BASE_URL`, `UAZAPI_WEBHOOK_SECRET`; `INTEGRATIONS_KEY` (cofre); `S3_ENDPOINT/BUCKET/ACCESS_KEY/SECRET_KEY/REGION` (MinIO 9002); `OPENAI_API_KEY` (Whisper); `CRON_SECRET`; `REDIS_URL` (6382, **nao usado** pelo dominio).

---

## 22. Pontos de decisao para os arquitetos (entradas, nao desenho)

1. **Entrada duravel**: gravar o evento bruto autenticado (append-only, com hash/dedupe por provedor+id) e responder 2xx; processar fora da requisicao (fila). Decidir fila (BullMQ/Redis 6382 disponivel x Postgres ADR 0007) e retentativa/DLQ.
2. **Roteamento por evento, nao por lote**: resolver conta por `entry`/`change` individual; status sem mensagem precisa rotear.
3. **Sem fallback de ambiente**: conta de entrada inexistente/invalida = mensagem `failed` com motivo, nunca outro numero. Definir o que acontece com conversas de conta desconectada (bloquear resposta? escolher outra conta da loja com auditoria?).
4. **Contato**: normalizacao E.164, unicidade parcial com `is_deleted=false`, upsert atomico; decidir casamento de contato do CRM por telefone com o 1o WhatsApp.
5. **Conversa**: unicidade parcial de conversa aberta por (contato, conta); regra de reabertura x nova conversa (D-38) — confirmar com o cliente; atribuicao/posse.
6. **Mensagem**: status monotonico com historico de eventos; cursor composto `(criado_em, id)`; separar horario do provedor do horario de gravacao; chave de idempotencia no envio; claim atomico no reenvio; reply com FK para a mensagem citada.
7. **Midia**: allowlist de MIME tambem na entrada, `nosniff` + `attachment` para nao-imagem, teto de download, bloqueio de SSRF, midia de cliente fora da galeria de produtos, exclusao LGPD alcancando o bucket.
8. **uazapi**: webhook por conta (URL com id + segredo por conta, sem query string), tratar `fromMe`, ack, eventos de conexao e grupos; confirmar payload no Swagger da instalacao antes de desenhar tabelas.
9. **Soft delete x LGPD**: mensagens com soft delete na operacao normal e anonimizacao/expurgo como fluxo LGPD separado (ADR), coerente com a armadilha do Better Auth.
10. **Timestamps**: `timestamp(3)`; decidir `withTimezone` (hoje sem fuso).
11. **Autorizacao no servidor**: papel lido do banco em toda Server Action/route handler (armadilha Next 16); rota de QR/pareamento como acao critica com auditoria antes do efeito e modal block.
12. **Tempo real**: substituir polling duplo por SSE/WebSocket ou polling unico de "novidades" por loja; aviso sonoro global.
13. **TikTok**: decidir se o canal existe no escopo; se nao, retirar do enum.
14. **Transcricao**: decidir se continua (dado pessoal a terceiro) e, se sim, via fila com leitura direta do bucket.
