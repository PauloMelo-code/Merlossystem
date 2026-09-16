# R2-D — Canais extras: Facebook Messenger e TikTok (FINAL)

- **Pacote**: `R2-D` (onda 3 do R2). Especificação, não construção. Fonte da verdade para o agente construtor: ele **não** lê o rascunho.
- **Base conferida**: fundação em `refactor/reconstrucao-estrutura-base` até `9481ef8` (nenhum arquivo de fundação usado aqui mudou depois). Os módulos da onda 2 estão entrando (HEAD `4549881` em 16/09/2026); deles, este documento só cita o que já está commitado: `src/lib/midias/ingestao.ts` (M3), `src/lib/alertas/{regras,_consultas}.ts` (M8), `src/lib/campanhas/regras.ts` (M6). M1 e M5 ainda não commitaram: as interfaces deles vêm de `03-arquitetura.md §10/§11` e `05-plano-construcao.md §5/§6`.
- **Números fixados pela consolidação do R2**: ADRs **0050–0053**; banco de teste `merlostore_test_r2d`, **índice Redis 12**; migrações únicas **`0018_r2`** + **`0019_r2_integridade`** (o R2-D não tem migração própria); embrulho de action sem transação único **`executarAcaoExterna`** (ADR 0049), cuja lista fechada de arquivos o R2-D amplia (§10 X-3); ator de sistema único **`contextoDeSistema(lojaId, origem)`** em `src/lib/auth/sistema.ts`; ADR de SLA configurável = **0056** (R2-E).
- **Pesquisa de API em 16/09/2026.** `partner.tiktokshop.com` e `business-api.tiktok.com` são renderizadas por JavaScript e não puderam ser lidas: o que veio delas por fonte secundária está marcado **CONFERIR** e fica preso nos `config.ts` dos canais (§6.4, ADR 0053).

---

## 0. Decisão central

| Item | Decisão no R2 | Por quê |
|---|---|---|
| **Facebook Messenger** | **Constrói**: receber, responder, mídia, citação | API pública e estável, mesmo app Meta do Instagram (`META_APP_SECRET`), mesmo formato de assinatura. O antigo tinha adaptador (`src/lib/channels/facebook.ts`), com os defeitos D-13, D-14, D-47 e D-48 |
| **TikTok — mensagem direta** (Business Messaging API, TikTok API for Business) | **Constrói, desligado até existir app aprovado** (`TIKTOK_APP_ID`/`TIKTOK_APP_SECRET`/`TIKTOK_API_VERSAO`) | É o único caminho **público** para conversar com a cliente no TikTok. Vale para conta comercial registrada fora de EUA, EEE, Suíça e Reino Unido (Brasil incluso). Limites: a cliente sempre começa, janela de **48 h**, só **texto e imagem JPG/PNG ≤ 3 MB** |
| **TikTok Shop — catálogo e pedidos** | **Não constrói** | (1) o Bling tem integração **nativa** com o TikTok Shop (produtos, pedidos, estoque, NF-e) e o Bling já é a autoridade de estoque (ADR 0004/0015): uma segunda leitura divergiria da primeira; (2) não há tabela para pedido de marketplace e o schema está fechado; jogar o pedido em `pedidos` o poria na fila "falta lançar no Masc", decisão que ninguém tomou; (3) o antigo nunca funcionou ponta a ponta (`04/F03`, `01/D-30`) |
| **TikTok Shop — atendimento** (Customer Service API) | **Não constrói** | Escopo "custom" com portão de 1.000 lojistas autorizados ou 1 milhão de chamadas/dia; app de um lojista só entra por aprovação especial. Construir seria fachada |
| **TikTok — comentário de vídeo** (o que o antigo tentava ler) | **Não constrói** | Não há webhook público de comentário orgânico |

Consequência de schema: `tiktok_shop` continua no CHECK (custo zero, sem adaptador). A conta de mensagem do TikTok ganha o valor próprio **`tiktok`** (contribuição do R2-D à `0018_r2`, §10 X-1). Rotular a conta de DM como `tiktok_shop` repetiria o erro do antigo, agora no banco.

---

## 1. Escopo e o que o sistema antigo tinha

### 1.1 Dentro do R2-D

- **Messenger**: webhook `GET/POST /api/webhooks/facebook`; adaptador `facebook` (texto, imagem, vídeo, áudio, arquivo, figurinha, citação); envio `RESPONSE` até 24 h e `TAGGED_MESSAGE` + `HUMAN_AGENT` entre 24 h e 7 dias **só para mensagem digitada por pessoa**; conexão por **token de página colado**, validado na Meta (`/me`) e com a página assinada no app (`subscribed_apps`) antes de virar `conectado`.
- **TikTok DM**: webhook `POST /api/webhooks/tiktok`; adaptador `tiktok` (texto e uma imagem nos dois sentidos, citação); conexão por **OAuth** (`/api/integracoes/tiktok/callback`) com loja e rótulo escolhidos antes do redirect e guardados no servidor; renovação de token com trava; endereço de entrega do app conferido (e registrado só se vazio) na conexão feita por pessoa.
- **Conferência diária** das contas dos dois canais (token vivo; endereço de entrega do app TikTok), só leitura, pelo job `integracoes/renovar-token` que já existe.
- **Regras de envio puras** (`src/lib/canais/regras-de-envio.ts`, criado pelo delta): janela por provedor, texto e mídia aceitos. Fonte única para o registro do envio, a fila e o composer.
- **Telas**: cartões "Facebook Messenger" e "TikTok" em `/configuracoes/integracoes` (componente-costura). Inbox, conversa, composer, filtros e SLA já são genéricos por `provedor` e só recebem as entradas do delta de M1.

### 1.2 Fora do R2-D (decidido)

Campanha ou mensagem promocional por Messenger/TikTok · eco de página (`message_echoes`) · recibos de entrega/leitura (`message_deliveries`, `message_reads`, `im_mark_read_msg`) · reação, postback, carrossel, "share post", reels · busca do nome do cliente na Graph (User Profile API) · desassinar a página ao desconectar · `HUMAN_AGENT` no Instagram · tudo de TikTok Shop · reescrita automática ou periódica do endereço de entrega do app TikTok.

### 1.3 O que existia no antigo (`5e902d4`) e os defeitos que não podem voltar

| Antigo | Defeito | Como o R2-D fecha |
|---|---|---|
| `webhooks/facebook/route.ts` roteava o lote pela **primeira** `entry` | `01/D-13`: mensagem da página B cai na loja da página A | agrupa por `entry[].id` e grava **um evento por (conta, mensagem)** (§5.2) |
| `facebook.ts:222-235` salvava só o 1º anexo (mesmo `mid`) | `01/D-14` | `midias[]` 1:N — uma mensagem, N linhas em `conversas_mensagens_midias` |
| `facebook.ts:206-243` não filtrava `is_echo` | `01/D-47`: a página vira "cliente" | eco vira evento `descartado` com motivo `eco_de_pagina` |
| anexo desconhecido virava `document` | `01/D-48` | tipo fora da lista vira `descartado` com `tipo_original`; texto que o acompanha é mantido |
| adaptador lia `process.env.META_PAGE_ACCESS_TOKEN` (`Bearer undefined`) | `01/D-04` | credencial **da conta**, do cofre; sem conta válida = falha fechada (ADR 0016) |
| `FACEBOOK_VERIFY_TOKEN`/`TIKTOK_VERIFY_TOKEN` globais; GET do TikTok no estilo Meta | token compartilhado; challenge que o provedor não usa | token do Messenger **próprio**; TikTok só com `POST` (GET = 405) |
| `tiktok.ts` lia comentário de vídeo atrás do HMAC do TikTok Shop; `senderId "unknown"` | `01/D-30`: todo anônimo vira um contato; envio sempre falha | API certa; remetente ausente = `descartado (sem_remetente)`, nunca "unknown" |
| TikTok roteado por `?conta=` na URL | `01/R-01` violada | conta por `user_openid` do corpo **autenticado** → `(provedor, referencia_externa)` |
| OAuth TikTok com `state` de `NEXTAUTH_SECRET`, 60 s, sem uso único; conta nascia **sem loja** | `04/S18`, `04/F03`, `06/INV-93` | `state` da fundação (`INTEGRATIONS_STATE_KEY`, 5 min) + cookie de nonce + contexto de uso único no Redis (`GETDEL`) + loja escolhida antes; `CHECK lojas_integracoes_rede` torna canal sem loja impossível |
| renovação de token sem trava | `04/F04` | trava no Redis antes de chamar o provedor + releitura em `invalid_grant` (§5.4) |
| `app_secret` na query da troca de `code`; corpo de erro do provedor em log | `04/S33` | segredo só em corpo JSON; URL de chamada nunca vai a log (trava §9) |
| conectar por OAuth sem trilha | `04/S12` | `integracao_conectada` na mesma transação da conta |

---

## 2. Regras de negócio

| ID | Regra | Decisão conservadora | ADR |
|---|---|---|---|
| **R2-CE-01** | Conversa de Messenger/TikTok responde **pela conta em que entrou** (`conversas.integracao_id`) | sem fallback de ambiente; conta `erro`, `expirado`, `desconectado` ou excluída = envio `falhou` com motivo | 0016 |
| **R2-CE-02** | Contato isolado **por loja**; identificador em `contatos.facebook_id` (PSID) e `contatos.tiktok_id` (`from_user.id`) | nunca cria contato "unknown": sem remetente = `descartado (sem_remetente)`. O PSID é **por página**: duas páginas na mesma loja geram dois contatos para a mesma pessoa (não existe mesclar) | 0050 |
| **R2-CE-03** | Janela do **Messenger**: até 24 h da última entrada envia `RESPONSE`; de 24 h a 7 dias, **só** mensagem com `origem_envio = 'pessoa'`, marcada `HUMAN_AGENT`; depois de 7 dias, fechada | agendada, campanha e qualquer origem automática **nunca** usam `HUMAN_AGENT`; fora das 24 h elas falham com o texto da janela, sem chamar a Meta | 0050, 0052 |
| **R2-CE-04** | Janela do **TikTok**: 48 h da última entrada; depois, fechada | não se tentam as "mensagens extras" citadas por fontes secundárias (divergentes). O teto de 10 mensagens no primeiro contato **não é contado localmente**: o provedor recusa e a mensagem fica `falhou` com motivo legível (`01/R-09`) | 0051, 0052 |
| **R2-CE-05** | Messenger e TikTok **não** são conta de saída de campanha | já garantido em HEAD por `PROVEDORES_DE_CAMPANHA = ["whatsapp_oficial","uazapi"]` (M6); o R2-D só prova com teste | 0050, 0051 |
| **R2-CE-06** | Eco (mensagem da própria página/conta) **não** entra no histórico | `message_echoes` não é assinado; eco que chegar (Messenger `is_echo`, TikTok `im_send_msg` ou remetente = conta) vira `descartado (eco_de_pagina)`. Resposta dada pelo Meta Business Suite ou pelo app do TikTok **não aparece**: a orientação à equipe (no cartão) é responder só pelo sistema | 0050 |
| **R2-CE-07** | Estado de entrega para em **`enviada`** nesses canais | recibos chegam por marca d'água, sem id por mensagem; a bolha nunca mostra "Entregue"/"Lida" | 0050 |
| **R2-CE-08** | Entrada aceita — Messenger: texto, `image`, `video`, `audio`, `file`, figurinha (`image` com `sticker_id`); TikTok: `text`, `image` | todo o resto (`reel`, `ig_reel`, `post`, `ig_post`, `fallback`, `template`, `location`, `share_post`, postback, reação) vira `descartado` com `tipo_original`; texto que acompanha anexo não suportado **é mantido** e o anexo fica em `metadados.tipo_original` | 0050, 0051 |
| **R2-CE-09** | Saída aceita — Messenger: texto ≤ 2.000 caracteres, anexos ≤ 25 MB (e os tetos da casa: imagem 5 MB, vídeo/áudio 16 MB); TikTok: texto ≤ 1.000 caracteres, **uma** imagem JPG/PNG ≤ 3 MB **sem legenda** por mensagem | vale o **menor** entre o teto do provedor e o da casa. Recusa **antes** de enviar, com o texto de `recusaDeMidia`/`recusaDeTexto` (§10 F9); números marcados CONFERIR | 0052, 0053 |
| **R2-CE-10** | Conectar Messenger vira `conectado` só depois de (a) `GET /me` com o token devolver **o mesmo id** digitado e (b) `POST /{pagina}/subscribed_apps?subscribed_fields=messages` responder sucesso | falhou (a) ou (b) = nada gravado, erro legível. Mesma página na **mesma** loja = reconexão (troca o token, volta a `conectado`); em **outra** loja = recusa | 0050 |
| **R2-CE-11** | Conectar TikTok: loja e rótulo escolhidos **antes** do redirect e guardados no servidor; o retorno só grava se o iniciador ainda é `dono`/`admin` ativo, é a mesma sessão e a loja continua viva | mesma conta na mesma loja = reconexão; em outra loja = `?tiktok=ja_conectada` | 0051 |
| **R2-CE-12** | **Um app Meta e um app TikTok por ambiente** (HML ≠ PRD). O endereço de entrega do app TikTok é conferido na conexão feita por pessoa: vazio → registra `${APP_URL}/api/webhooks/tiktok` com trilha; igual → nada; **outro endereço → recusa a conexão sem alterar nada**; leitura impossível → recusa | nunca há reescrita periódica. A conferência diária só **lê**: endereço diferente põe as contas `tiktok` vivas em `erro` (o gerador de M8 emite `integracao_com_erro`) | 0051 |
| **R2-CE-13** | Sem configuração do app no servidor, o recurso fica **desligado com aviso**; nunca 500 | action devolve `CONFIGURACAO`; webhook recusa (401, INV-43); o cartão diz o que falta em linguagem de gente | 0053 |
| **R2-CE-14** | Detalhe de API não confirmado mora **só** em `canais/{facebook,tiktok}/config.ts` (e as horas/tetos em `regras-de-envio.ts`), marcado `CONFERIR-<CANAL>`; uma trava impede vazamento | a conferência em HML é item do aceite; confirmar é trocar o marcador por `CONFIRMADO:` | 0053 |
| **R2-CE-15** | SLA de primeira resposta: Messenger **30 min**, TikTok **60 min** (`01/R-21`) | os números moram **só** em `PRAZO_SLA_PADRAO_MIN` (`src/lib/sla/prazo.ts`, R2-E); o R2-D não declara prazo | 0056 |
| **R2-CE-16** | Opt-out é de marketing e **não** bloqueia resposta 1:1 nesses canais | igual ao R1 (`01-dados-dominio.md §7.2`) | — |
| **R2-CE-17** | Token do TikTok: renovado **sob demanda** quando faltam < 10 min para o access vencer, e pela conferência diária quando o refresh vence em < 30 dias; nunca duas renovações com o mesmo refresh | `invalid_grant` (depois de reler a linha) = `expirado`. Messenger: `GET /me` diário; erro 190 = `expirado` | 0051 |
| **R2-CE-18** | Nome do cliente: usa o que vier no evento; **não** consulta a Graph para buscar nome | sem nome e sem telefone, a tela mostra "Cliente do Facebook"/"Cliente do TikTok" (rótulo do canal), sem gravar nada | 0050 |
| **R2-CE-19** | Mídia recebida — Messenger: por URL, baixada pelo job `midia/baixar-de-url` (allowlist `meta`); TikTok: por `media_id`, baixada pelo adaptador **antes** de gravar | falha permanente do TikTok = mensagem gravada **sem** a mídia, com `metadados.erro_provedor` e a bolha "mídia indisponível" | 0051 |
| **R2-CE-20** | TikTok Shop não é construído | pergunta ao cliente registrada no ADR 0051 | 0051 |

---

## 3. Modelo de dados usado (nenhuma tabela nova)

Conferido em `git show 9481ef8:src/lib/db/schema/{integracoes,contatos,midias}.ts`, `conversas/{conversas,mensagens,mensagens-midias}.ts` e `_enums/{plataforma,conversas,auditoria}.ts`.

| Tabela | Colunas usadas | Como |
|---|---|---|
| `lojas_integracoes` | `id, loja_id, provedor, rotulo, status, credenciais_cifradas, credenciais_aad, referencia_externa, expira_em, ultimo_erro, ultima_sincronizacao, revogada_em, created_at, updated_at, deleted_at, is_deleted, modified_by` | **`facebook`**: `referencia_externa` = Page ID; credencial `{"page_access_token": "…"}`; `expira_em` nulo. **`tiktok`**: `referencia_externa` = `open_id` da conta comercial (o `user_openid` do webhook); credencial `{"access_token": "…", "access_expira_em": "<ISO>", "refresh_token": "…"}`; `expira_em` = **vencimento do refresh token** (a data em que alguém precisa reconectar — é o que a tela de M5 mostra como validade). `id` gerado antes do INSERT; `credenciais_aad = id`. `segredo_webhook_hash` **nulo** nos dois (a assinatura é do app). `ultimo_erro` é contador (`atualizarContador` ou junto de `atualizarComTrava`) |
| `lojas_integracoes_eventos` | `provedor, integracao_id, loja_id, tipo, evento_externo_id, assinatura_ok, ip, corpo, cabecalhos, erro, processado_em` | **um evento por (conta, mensagem)**. `evento_externo_id`: Messenger = `message.mid`; TikTok = `content.message_id`; item sem id = `sha256` hex do item serializado (Messenger) ou do corpo cru (TikTok). `corpo` = envelope **de um item só** (§5.2). `cabecalhos` = lista branca de M5 + `tiktok-signature: "presente"` |
| `contatos` | `loja_id, nome, facebook_id, tiktok_id, ultimo_contato_em` | por `upsertContatoPorCanal(tx, lojaId, { canal: "facebook_id" \| "tiktok_id", valor, nome? }, agora)` (existe em `mutacoes.ts`). Sem telefone. Únicos `uq_contatos_facebook`/`uq_contatos_tiktok` já existem |
| `conversas` | `integracao_id, status, ultima_entrada_em, primeira_resposta_em, sla_estourado_em` | `ultima_entrada_em` é a única fonte das janelas |
| `conversas_mensagens` | `direcao, autor_tipo, autor_usuario_id, conteudo, tipo_conteudo, externo_id, status_entrega, falha_motivo, responde_a_id, ocorrida_em, metadados` | `externo_id` = `mid`/`message_id`. `metadados.tipo_original`, `metadados.citacao_externa_id`, **`metadados.conversa_externa_id`** (TikTok, entrada), **`metadados.origem_envio`** (saída), `metadados.erro_provedor` (§10 F8 — mudança de tipo, sem migração) |
| `conversas_mensagens_midias` | `mensagem_id, midia_id, url_externa, externo_id, tipo_arquivo, mime_type, baixada` | Messenger: `url_externa` = `payload.url` (coluna de trabalho, limpa pelo job de M3). TikTok: `externo_id` = `image.media_id`, `midia_id` preenchido **na criação** (bytes já baixados), `baixada = true`, `url_externa` nula — o CHECK `conversas_mensagens_midias_origem` (`midia_id OR url_externa`) é satisfeito por `midia_id` |
| `lojas_midias` | via `guardarMidiaRecebida(tx, { lojaId, origem: "tiktok", bytes, tipoMime }, ctx)` (M3, commitado) | `origem = 'recebida'`, magic bytes conferidos por M3 |
| `auditoria_eventos` | `integracao_conectada`, `integracao_alterada` (já em `ACOES_AUDITADAS`) | nenhuma ação nova |
| `alertas` | `integracao_com_erro`, `sla_estourado` | gerados por M8 (`_consultas.ts` de HEAD já cobre qualquer provedor ≠ `uazapi` com `status in ('erro','expirado')`); o R2-D **não** grava alerta |

**Por que `conversa_externa_id` em `metadados` e não coluna**: o TikTok responde para a **conversa** (`recipient` = `conversation_id`), não para o usuário. O valor chega em **toda** mensagem de entrada, e só se responde dentro de 48 h de uma entrada: sempre existe a linha de onde lê-lo, pelo índice `ix_conversas_mensagens_cursor (conversa_id, ocorrida_em desc, id desc)`. Coluna em `conversas` exigiria migração e duplicaria o dado.

**Por que `origem_envio` em `metadados`**: `HUMAN_AGENT` exige resposta de pessoa. O processador roda no worker e não sabe quem originou a linha; `autor_tipo`/`autor_usuario_id` não distinguem com segurança a agendada criada por uma pessoa. `registrarEnvio` grava `origem_envio = 'pessoa'` **só** quando `ctx.origem === "ui"` — o único ponto confiável.

### 3.1 Estados

**Conta (`lojas_integracoes.status`)**

```
(nenhuma) ──conectar ok (R2-CE-10/11)──────────────────────────► conectado
conectado ──token recusado (Graph 190 / TikTok invalid_grant)──► expirado   (M8 emite integracao_com_erro)
conectado ──permissão perdida / endereço do app TikTok errado──► erro       (idem)
expirado|erro ──reconectar (mesma referência, mesma loja)──────► conectado  (atualizarComTrava, ultimo_erro = null)
erro (endereço do app) ──conferência diária volta a bater───────► conectado (só se ultimo_erro for o do endereço)
qualquer ──desconectar (action de M5, sem mudança)─────────────► is_deleted = true, credenciais_cifradas = NULL, revogada_em = now()
```

Evento para conta desconhecida, revogada ou sem loja = 200 + `recusado`; conta `erro`/`desconectado` = 200 + `descartado`; conta `expirado` **ainda recebe** (`recebido`: o webhook não depende do token); só envio e download falham.

**Evento (`lojas_integracoes_eventos.tipo`)**: `recebido` → `processado` | `falhou` (pelo processador de M1); `recusado` e `descartado` são finais e não são enfileirados.

**Mensagem de saída** (monotônica): `pendente → enviada` ou `pendente → falhou` (`falha_motivo`). Não há `entregue`/`lida` nesses canais. Reenvio só por `reivindicarReenvio()`.

**Janela** (`situacaoDaJanela(provedor, ultimaEntradaEm, origem, agora)`, §10 F9):

| Provedor | `aberta` | `so_agente_humano` | `so_modelo` | `fechada` |
|---|---|---|---|---|
| `whatsapp_oficial` | ≤ 24 h | — | > 24 h ou sem entrada | — |
| `instagram` | ≤ 24 h | — | — | > 24 h ou sem entrada |
| `facebook` | ≤ 24 h | 24 h < t ≤ 168 h e origem `pessoa` | — | t > 168 h; 24 h < t ≤ 168 h com origem `automatica`; sem entrada |
| `tiktok` | ≤ 48 h | — | — | > 48 h ou sem entrada |
| `uazapi` | sempre | — | — | — |
| qualquer outro | — | — | — | sempre (falha fechada) |

A linha do Instagram muda o comportamento de M1 no R1 (antes o composer deixava escrever e a Meta recusava): agora o composer explica e bloqueia. É a mesma regra da Meta, dita antes do envio (ADR 0052).

---

## 4. Permissões

**Nenhuma chave nova** (conferido em `9481ef8:src/lib/auth/permissoes/{plataforma,atendimento}.ts`). O R2-D não toca `FASE_R2` nem a reorganização da matriz.

| Chave | dono | admin | gerente | vendedor | viewer | Uso no R2-D |
|---|:--:|:--:|:--:|:--:|:--:|---|
| `integracoes:ler` | ✅ | ✅ | — | — | — | `lerCanaisExtras`, cartões |
| `integracoes:conectar` | ✅ | ✅ | — | — | — | `conectarPaginaFacebook`, `iniciarConexaoTiktok`, retorno do OAuth |
| `integracoes:desconectar` | ✅ | ✅ | — | — | — | action de M5, sem mudança |
| `configuracao:ler` | ✅ | ✅ | — | — | — | portão de `/configuracoes` (M5) |
| `conversas:ler` | ✅ | ✅ | ✅ | ✅ | ✅ | inbox (M1) |
| `conversas:escrever` | ✅ | ✅ | ✅ | ✅ | — | responder, inclusive com `HUMAN_AGENT` (M1) |

Reconectar usa `integracoes:conectar` (é a mesma action). Gerente não vê conexão de canal (DN-07).

---

## 5. Server Actions, Route Handlers e jobs

### 5.1 Módulo de domínio `src/lib/canais-extras/` (API pública em `index.ts`, `import "server-only"`)

| Função (export de `index.ts`) | Assinatura | O que faz |
|---|---|---|
| `resumoDosCanaisExtras` | `(ctx: Contexto) => Promise<CanaisExtrasDTO>` | `{ facebook: { disponivel, contas }, tiktok: { disponivel, contas } }`; `contas` = `count(*)` de `lojas_integracoes` vivas do provedor, com `condicaoDeLoja(ctx.escopo)`. `disponivel`: facebook = `META_APP_SECRET && META_GRAPH_VERSION && FACEBOOK_VERIFY_TOKEN`; tiktok = `TIKTOK_APP_ID` (o `superRefine` garante o resto) |
| `conectarPaginaDoFacebook` | `(dados: ConectarPaginaFacebook, ctx) => Promise<{ id: string; reconectada: boolean }>` | §5.3 |
| `iniciarOAuthTiktok` | `(dados: IniciarConexaoTiktok, ctx) => Promise<{ url: string; nonce: string }>` | §5.4 |
| `concluirOAuthTiktok` | `(entrada: { code: string \| null; state: string \| null; erro: string \| null; nonceDoCookie: string \| null }, sessao: Sessao) => Promise<RetornoTiktok>` | §5.4. `RetornoTiktok = "ok" \| "estado" \| "recusado" \| "ja_conectada" \| "outro_ambiente" \| "webhook" \| "falha"` |
| `urlDeRetornoTiktok` | `(r: RetornoTiktok) => string` | `new URL("/configuracoes/integracoes?tiktok=" + r, env.APP_URL).toString()` — destino **fixo** |
| `COOKIE_NONCE_OAUTH`, `VALIDADE_NONCE_S` | `"__Host-merlo.oauth_nonce"`, `300` | mesmo cookie do OAuth do Bling (`02 §12`): um OAuth por vez por navegador |
| `webhookFacebook`, `webhookTiktok` | `(req: Request) => Promise<Response>` | construídos com `rotaDeMaquina` (§5.5). Única parte do domínio que recebe `Request`, pela mesma razão da borda de M5: o embrulho da fundação é assim |
| `garantirTokenTiktok` | `(lojaId: string, integracaoId: string) => Promise<void>` | **costura** consumida por M1 (§5.5) |
| `destinoTiktok` | `(lojaId: string, conversaId: string) => Promise<string \| null>` | **costura** consumida por M1 (§5.5) |
| `conferirContasCanaisExtras` | `() => Promise<void>` | **costura** consumida por M5 no job diário (§5.6) |

Privados: `_consultas.ts` (contas por referência/id com `condicaoDeLoja`, conversa externa, contagens), `_gravacao.ts` (criar/reconectar conta, marcar status — só por `inserirAuditado`/`atualizarComTrava`/`atualizarContador` e `cifrar`), `webhook-facebook.ts`, `webhook-tiktok.ts`, `conexao-facebook.ts`, `oauth-tiktok.ts`, `token-tiktok.ts`, `endereco-do-app-tiktok.ts`, `conferencia.ts`.

**Por que escrever a conta aqui e não por uma função de M5**: a interface pública de M5 para criar conta não está publicada; a escrita usa só helpers da fundação (`inserirAuditado`, `atualizarComTrava`, `cifrar`) e segue o contrato de linha de `01-dados.md §6.3`, o mesmo que M5 segue.

### 5.2 Server Actions — `src/lib/actions/canais-extras.ts` (`"use server"`, `export async function`)

Entradas em `src/lib/validadores/canais-extras.ts`:

```ts
const rotulo = z.string().trim().min(3, "Use de 3 a 60 caracteres.").max(60, "Use de 3 a 60 caracteres.");

export const lerCanaisExtrasSchema = z.strictObject({ loja: z.uuid().optional() });

export const conectarPaginaFacebookSchema = z.strictObject({
  loja: z.uuid("Escolha a loja."),
  rotulo,
  paginaId: z.string().trim().regex(/^\d{5,25}$/, "O ID da página tem só números (5 a 25)."),
  token: z.string().trim().min(50, "Cole o token completo.").max(1024, "Cole o token completo."),
});

export const iniciarConexaoTiktokSchema = z.strictObject({ loja: z.uuid("Escolha a loja."), rotulo });

/** Contexto guardado no Redis entre o início e o retorno do OAuth. */
export const contextoOAuthTiktokSchema = z.strictObject({
  lojaId: z.uuid(),
  rotulo,
  usuarioId: z.uuid(),
  verificador: z.string().min(43).max(128).optional(),
});
```

O campo da loja chama-se **`loja`**: é o que `lojaPedida()` de `_base.ts` lê. Um admin em "Todas as lojas", ou com o cookie numa loja e o diálogo em outra, grava na loja **do diálogo**.

| Action | Embrulho | Entrada | Permissão | Loja | Efeito | Trilha |
|---|---|---|---|---|---|---|
| `lerCanaisExtras(dados)` | `executarAcao` | `lerCanaisExtrasSchema` | `integracoes:ler` | `"le"` | `resumoDosCanaisExtras(ctx)` | — |
| `conectarPaginaFacebook(_anterior, form)` | **`executarAcaoExterna`** (rede fora de transação) | `conectarPaginaFacebookSchema` | `integracoes:conectar`, `fresca: true` | `"grava"` | `conectarPaginaDoFacebook(dados, ctx)`; `revalidar: ["/configuracoes/integracoes"]` | `integracao_conectada` (nova) ou `integracao_alterada` (reconexão); o gravador descarta `credencia*`/`token` do diff |
| `iniciarConexaoTiktok(dados)` | **`executarAcaoExterna`** | `iniciarConexaoTiktokSchema` | `integracoes:conectar`, `fresca: true` | `"grava"` | chama `iniciarOAuthTiktok`, grava o cookie `COOKIE_NONCE_OAUTH` (`httpOnly`, `secure`, `sameSite: "lax"`, `path: "/"`, `maxAge: VALIDADE_NONCE_S`) e devolve **só** `{ url }` | nenhuma (nada mudou) |

Erros (contrato fechado de `04 §7.2`): configuração ausente → `CONFIGURACAO`; Meta/TikTok recusou → `INTEGRACAO` com texto traduzido; página em outra loja ou corrida no único → `VALIDACAO` no campo `paginaId`; sessão velha → `SESSAO_NAO_FRESCA` (a tela abre `modal-reautenticacao` e repete); Redis fora no início do OAuth → `INTEGRACAO` transitório. O `token` nunca volta em `valores` (o filtro de `_base.ts` descarta chaves com `token`).

### 5.3 Conectar página do Facebook (`conexao-facebook.ts`)

1. `env.META_APP_SECRET`, `env.META_GRAPH_VERSION` e `env.FACEBOOK_VERIFY_TOKEN` presentes, senão `ErroDeConfiguracao("O Messenger ainda não foi configurado neste servidor.")`; `conferirCofre()`.
2. `lojaId = ctx.escopo.lojaId` (garantido por `loja: "grava"`).
3. Conta viva `(facebook, paginaId)` em **outra** loja → `ErroDeValidacao({ paginaId: ["Esta página já está conectada em outra loja. Desconecte lá primeiro."] })`.
4. `validarTokenDaPagina(paginaId, token)` (`canais/facebook/graph.ts`): `GET /{versão}/me?fields=id,name` com `Authorization: Bearer`. `id ≠ paginaId` ou erro → `ErroDeIntegracao("A Meta recusou o token: ele expirou ou não é desta página. Gere um novo e tente de novo.", true)`. Não usar `GET /{paginaId}`: o dado público da página responde para token de qualquer página.
5. `assinarPaginaNoApp(paginaId, token)`: `POST /{versão}/{paginaId}/subscribed_apps`, corpo `subscribed_fields=messages` (`application/x-www-form-urlencoded`), token no cabeçalho. Falha → `ErroDeIntegracao("A Meta não deixou ligar as mensagens desta página. Confira se o token tem a permissão pages_manage_metadata.", true)`.
6. `emTransacao(ctx, tx => gravarConta(tx, …, ctx))`: sem linha viva → `inserirAuditado` (`id = randomUUID()`, `status = 'conectado'`, `credenciais_cifradas = cifrar(JSON.stringify({ page_access_token }), id)`, `credenciais_aad = id`, `referencia_externa = paginaId`, `rotulo`, `loja_id`), ação `integracao_conectada`; linha viva na mesma loja → `atualizarComTrava` (credencial nova, `status = 'conectado'`, `rotulo`, `ultimo_erro = null`), ação `integracao_alterada`. `23505` em `uq_lojas_integracoes_referencia` → o mesmo `ErroDeValidacao` do passo 3.

### 5.4 OAuth do TikTok (`oauth-tiktok.ts`, `endereco-do-app-tiktok.ts`)

**Início** (`iniciarOAuthTiktok`):
1. `TIKTOK_APP_ID` ausente → `ErroDeConfiguracao("O TikTok ainda não foi liberado neste servidor.")`.
2. `{ state, nonce } = assinarEstado(ctx.sessao.usuarioId)` (fundação).
3. `TT_PKCE === true` → `verificador = randomBytes(32).toString("base64url")`, `desafio` = SHA-256 do verificador em base64url.
4. `redisDoLimitador().set("oauth:tiktok:" + nonce, JSON.stringify({ lojaId, rotulo, usuarioId, verificador? }), "EX", 300, "NX")`; resposta ≠ `"OK"` ou exceção → `ErroDeIntegracao("Não foi possível iniciar a conexão agora. Tente de novo em alguns minutos.", false)`. Aqui **não** há fail-open.
5. `url` = `TT_AUTORIZAR.url` + `client_key`, `response_type=code`, `scope` (`TT_AUTORIZAR.escopos`), `redirect_uri = ${APP_URL}/api/integracoes/tiktok/callback`, `state` (+ `code_challenge`, `code_challenge_method=S256` com PKCE), montados por `URLSearchParams`. Nada vem da entrada.

**Retorno** — `src/app/api/integracoes/tiktok/callback/route.ts` (`GET`, `runtime = "nodejs"`, `dynamic = "force-dynamic"`):
1. `exigirSessao()`; `ErroNaoAutenticado` → `302` para `${APP_URL}/entrar`. `exigirPermissao(sessao, "integracoes:conectar")`; recusa → `302` para `urlDeRetornoTiktok("estado")`.
2. Lê `code`, `state`, `error` da URL e o cookie `COOKIE_NONCE_OAUTH`; chama `concluirOAuthTiktok`; responde `302` para `urlDeRetornoTiktok(r)` apagando o cookie (`Max-Age=0`, mesmos atributos). Exceção inesperada → `"falha"` (log sem URL e sem query).

`concluirOAuthTiktok`, nesta ordem (qualquer recusa = **nada gravado**):
1. `erro` presente → `"recusado"`.
2. `conferirEstado(state)` nulo, `!compararEmTempoConstante(estado.nonce, nonceDoCookie)` ou `estado.usuarioId` diferente de `sessao.usuarioId` → `"estado"`.
3. `redisDoLimitador().getdel("oauth:tiktok:" + estado.nonce)` → nulo, exceção, Zod inválido ou `usuarioId` diferente da sessão → `"estado"`. É o uso único: a segunda volta com o mesmo `state` sempre cai aqui.
4. `resolverLojaPedida(sessao, contexto.lojaId)` → `ErroDeEscopo` → `"estado"`; `ctx = contextoDe(sessao, contexto.lojaId)`.
5. `trocarCodigo()` (`canais/tiktok/cliente.ts`): `POST TT_CAMINHOS.token`, JSON `{ client_id, client_secret, grant_type: "authorization_code", auth_code, redirect_uri, code_verifier? }` (nomes CONFERIR). Falha → `"falha"`. Usa `open_id`, `access_token`, `expires_in`, `refresh_token`, `refresh_token_expires_in`.
6. Conta viva `(tiktok, open_id)` em outra loja → `"ja_conectada"`.
7. `garantirEnderecoDoApp()`: lê a configuração de entrega do app para `DIRECT_MESSAGE` (`TT_CAMINHOS.webhookLer`). Leitura falhou → `"webhook"`. Endereço = `${APP_URL}/api/webhooks/tiktok` → segue. Vazio → `POST TT_CAMINHOS.webhookGravar`, JSON `{ app_id, secret, event_type: "DIRECT_MESSAGE", callback_url }`; falha → `"webhook"`; sucesso → `registrou = true`. **Outro endereço → `"outro_ambiente"`**, `logger.warn({ provedor: "tiktok" }, "endereco de entrega do app aponta para outro ambiente")`, sem escrita nenhuma.
8. `GET TT_CAMINHOS.conta` com o token novo (confirma que ele vale para `open_id`). Falha → `"falha"`.
9. `emTransacao(ctx, …)`: cria (`integracao_conectada`) ou reconecta (`integracao_alterada`) com `expira_em = agora + refresh_token_expires_in`, credencial `{ access_token, access_expira_em, refresh_token }`, `rotulo` do contexto, `status = 'conectado'`, `ultimo_erro = null`; `23505` → `"ja_conectada"`. Se `registrou`: `registrarAuditoria(tx, ctx, "integracao_alterada", "lojas_integracoes", contaId, { antes: null, depois: { endereco_do_app: "registrado" } })`.
10. `"ok"`.

### 5.5 Route Handlers de máquina e costuras

Os dois webhooks usam `rotaDeMaquina` (fundação, com o delta F5), **sem `JSON.parse` antes de autenticar**, `runtime = "nodejs"`, `dynamic = "force-dynamic"`.

**`src/app/api/webhooks/facebook/route.ts`** — `export const GET = webhookFacebook; export const POST = webhookFacebook;`

`webhookFacebook = rotaDeMaquina<{ app: "meta" }>({…})`:
- `provedor: "facebook"`, `limiteIntegracao: null` (a chave é do app; ver F5), `chave: () => "app"`.
- `carregar`: `env.META_APP_SECRET ? { app: "meta" } : null`.
- `conferir`: `conferirAssinaturaMeta(corpoCru, req.headers.get("x-hub-signature-256"))`.
- `verificar` (GET): `hub.mode === "subscribe"`, `conferirTokenDeChallenge(hub.verify_token, env.FACEBOOK_VERIFY_TOKEN)` e `hub.challenge` casando `^\d{1,64}$` → `200` com o challenge em `text/plain` e `cache-control: no-store`; senão `403` sem corpo. **Nunca** o token do Instagram.
- `processar`:
  1. `JSON.parse` em `try`; inválido → evento `descartado` (`evento_externo_id = sha256(corpoCru)`, `erro = "corpo ilegivel"`) → 200.
  2. `object !== "page"` → `descartado` (`erro = "objeto nao e pagina"`) → 200.
  3. `rotearMessenger(corpo)` (`canais/facebook/interpretar.ts`, puro): um item por `entry[].messaging[]`, `{ contaExterna: entry.id, eventoExternoId, corpo: { object: "page", entry: [{ id, time, messaging: [item] }] }, descarte?: { motivo, tipoOriginal } }`. Eco, item sem `message` e item sem `sender.id` já vêm com `descarte`.
  4. Conta por `(facebook, contaExterna)` (cache por requisição). Sem conta, revogada ou sem loja → `recusado`; `status in ('erro','desconectado')` → `descartado`; `descarte` → `descartado` com `erro` = motivo e `tipo_original`; senão `recebido`.
  5. `registrarEventoRecebido({ provedor: "facebook", integracaoId, lojaId, tipo, eventoExternoId, assinaturaOk: true, ip, corpo: item.corpo, cabecalhos: cabecalhosDoDiario(req.headers), erro })` — a função **única** de diário e a lista branca de cabeçalhos, pelo caminho que a consolidação fixar (§10 X-5; contrato exigido lá).
  6. `tipo = 'recebido'` e (`novo` ou `pendente`) → `enfileirar("mensagens-entrada", "processar-evento", …)` com **a mesma carga e o mesmo `jobId` que a borda do Instagram de M5 usa** (ler o código final de M5; o teste de integração prova que o processador de M1 consome o evento). Retorno `null` (Redis fora) → lança → **500**, e a Meta reentrega.
  7. 200.
- Reentrega: a linha já existe (`novo = false`); se ainda `recebido` e sem `processado_em` (`pendente`), enfileira de novo com o **mesmo** `jobId`. O BullMQ ignora quando o job já existe, e recupera o evento quando o `enfileirar` anterior falhou. Sem piso de tempo (§12).
- Falha ao **persistir** → 500 (o embrulho faz). Responde em < 5 s: o handler nunca processa a mensagem (a Meta desliga o webhook depois de 1 h de falhas).

**`src/app/api/webhooks/tiktok/route.ts`** — `export const POST = webhookTiktok;` (GET não exportado: 405 do Next; o manifesto declara só `POST`).

`webhookTiktok = rotaDeMaquina<{ segredo: string }>({…})`:
- `provedor: "tiktok"`, `limiteIntegracao: null`, `chave: () => "app"`.
- `carregar`: `env.TIKTOK_APP_SECRET ? { segredo: env.TIKTOK_APP_SECRET } : null`.
- `conferir`: `conferirAssinaturaTiktok(corpoCru, req.headers.get(TT_ASSINATURA.cabecalho), app?.segredo ?? null, Date.now())` (`canais/tiktok/assinatura.ts`): separa `t` e `s`; calcula **sempre** `HMAC-SHA256(segredo, "${t}.${corpoCru}")` em hex (segredo aleatório de processo quando nulo, `t = "0"` quando ilegível); `compararEmTempoConstante(s, esperada)`; exige segredo presente e `|agora/1000 − t| ≤ TT_ASSINATURA.toleranciaS` (300).
- `processar`: parse em `try` (inválido → `descartado`); `rotearTiktok(corpo)` → `{ contaExterna: user_openid, eventoExternoId, corpo, descarte? }`: `im_receive_msg` → candidato a `recebido`; `im_send_msg` ou remetente = `user_openid` → `eco_de_pagina`; `im_mark_read_msg` e outros → `tipo_nao_suportado`; sem `from_user.id` → `sem_remetente`. Daí em diante, igual ao Messenger, com `provedor: "tiktok"`.

**Costuras consumidas por M1** (`token-tiktok.ts`, `_consultas.ts`):
- `garantirTokenTiktok(lojaId, integracaoId)`: lê a conta no escopo da loja e decifra; `access_expira_em − agora > 10 min` → retorna. Senão, **renova com trava**: `SET tiktok:renovando:<id> 1 EX 30 NX` no `redisDoLimitador()` (Redis fora = segue sem trava). Quem **não** pegou a trava relê a linha a cada 500 ms, até 10 vezes: `updated_at` mudou → retorna; não mudou → `ErroDeIntegracao("Renovação do TikTok em andamento.", false)`. Quem pegou: `POST TT_CAMINHOS.renovar`, JSON `{ client_id, client_secret, grant_type: "refresh_token", refresh_token }`; sucesso → `atualizarComTrava` (credencial e `expira_em` novos) com `contextoDeSistema(lojaId, "worker")`, ação `integracao_alterada`; código de token inválido → **relê a linha**: `updated_at` mudou (outro processo renovou) → retorna; não mudou → `status = 'expirado'`, `ultimo_erro = "O TikTok recusou a renovação. Reconecte a conta."`, `ErroDeIntegracao(…, true)`. Rede/5xx → `ErroDeIntegracao(…, false)`. Sempre **fora** de transação.
- `destinoTiktok(lojaId, conversaId)` (usa `ix_conversas_mensagens_cursor`):
  ```sql
  select m.metadados->>'conversa_externa_id' as destino
    from conversas_mensagens m
   where m.conversa_id = $conversaId and m.loja_id = $lojaId
     and m.direcao = 'entrada' and m.is_deleted = false
     and m.metadados ? 'conversa_externa_id'
   order by m.ocorrida_em desc, m.id desc
   limit 1
  ```
  Nulo = sem conversa aberta no TikTok.

### 5.6 Jobs — nenhum nome novo

| Fila / job (existentes) | O que muda | Idempotência | Retentativa |
|---|---|---|---|
| `mensagens-entrada/processar-evento` (M1) | o `provedor` da linha do evento escolhe o adaptador; coluna de contato `facebook → facebook_id`, `tiktok → tiktok_id`; mídia com `idExterno` e sem `url` baixada pelo adaptador antes da transação (§10 M1-3) | únicos `(provedor, evento_externo_id)` e `(loja_id, externo_id)` | padrão (5×, 2 s → 32 s); corpo ilegível = permanente |
| `mensagens-saida/enviar-mensagem`, `reenviar` (M1) | `garantirTokenTiktok` antes de carregar a conta; janela por `situacaoDaJanela` com `metadados.origem_envio`; `agenteHumano` só em `so_agente_humano`; destino por provedor; `recusaDeMidia`; ritmo por conta Messenger 5 msg/s, TikTok 1 msg/s | `jobId` determinístico + `chave_idempotencia` | janela fechada, mídia recusada, destino ausente, token recusado = **permanente**; 5xx/429/613/rede = transitório |
| `midia/baixar-de-url` (M3) | aceita `provedor: "facebook"` → allowlist `meta` (§10 M3-1). TikTok **nunca** passa por aqui | `baixada = true` | host fora da allowlist = permanente, com o host (nunca a URL) no log |
| `integracoes/renovar-token` (M5, diário 03:40) | depois do Bling, `await conferirContasCanaisExtras()` | trava da §5.5 + `atualizarComTrava` | falha de uma conta não interrompe as outras; o job só lança se **todas** as chamadas falharem por rede |

`conferirContasCanaisExtras()` (`conferencia.ts`), sequencial, cada conta com `contextoDeSistema(conta.lojaId, "worker")`:
- **facebook** (vivas, não revogadas): `GET /me?fields=id` com o token. `id` igual → nada. Código Graph 190 ou `id` diferente → `expirado`, `ultimo_erro = "A Meta recusou o token da página. Reconecte a página."`. Códigos 10/200/230 → `erro`, `ultimo_erro = "A página perdeu a permissão de mensagens. Reconecte a página."`. Rede/5xx → só `logger.warn`.
- **tiktok**: (1) **uma** leitura do endereço de entrega do app: diferente de `${APP_URL}/api/webhooks/tiktok` → toda conta `tiktok` viva vai a `erro` com `ultimo_erro = "O app do TikTok entrega as mensagens para outro endereço. Fale com o responsável técnico."`; igual → conta em `erro` **com esse mesmo** `ultimo_erro` volta a `conectado`; leitura falhou → só `logger.warn`. (2) por conta: `expira_em < now() + 30 dias` ou access vencido → renovação (a mesma função da §5.5, forçada); senão `GET TT_CAMINHOS.conta`; código de token inválido → tenta renovar; renovação recusada → `expirado`.
- Nunca **escreve** o endereço de entrega do app.

---

## 6. Integrações externas

### 6.1 Interface — `AdaptadorDeCanal` (contrato de M1, `03 §10.1`, com o ajuste de §10 M1-1)

Os dois adaptadores implementam o contrato de M1. **Não há provedor simulado de canal**: a decisão do orquestrador sobre simulado vale para pagamento, IA e transcrição; canal é testado como os três do R1, com payload fixo (unidade) e transporte falso (`vi.stubGlobal("fetch")` + DNS trocado, como em `tests/seguranca/ssrf.test.ts`). "Desligado" é a ausência de configuração do app (R2-CE-13).

O adaptador lê de `@/lib/env` **só** configuração do app (`META_GRAPH_VERSION`, `TIKTOK_API_VERSAO`); credencial vem **só** de `conta` (A-12). Nenhum `process.env`.

| Método | `facebook` (`canais/facebook/adaptador.ts`) | `tiktok` (`canais/tiktok/adaptador.ts`) |
|---|---|---|
| `provedor` | `"facebook"` | `"tiktok"` |
| `limites` | derivados de `MIDIA_ACEITA`/`TEXTO_MAX` (`regras-de-envio.ts`) e dos tetos da casa | idem; vídeo/áudio/documento = 0 (não suportado) |
| `enviarTexto(destino, texto, opcoes?)` | `POST /{versão}/{referencia}/messages`, JSON `{ recipient: { id }, messaging_type, tag?, message: { text, reply_to? } }`; `opcoes.agenteHumano` → `TAGGED_MESSAGE` + `FB_TAG_AGENTE_HUMANO`; senão `RESPONSE` | `POST TT_CAMINHOS.enviar`, JSON `{ business_id: referencia, recipient_type: "CONVERSATION", recipient: destino, message_type: "TEXT", text: { body }, referenced_message_info? }` (nomes CONFERIR) |
| `enviarMidia?(destino, m, opcoes?)` | multipart (`FormData`: `recipient`, `messaging_type`, `tag?`, `message` com `attachment.type` = `image\|video\|audio\|file`, `filedata`) no mesmo endpoint | `recusaDeMidia` de novo (defesa); upload `POST TT_CAMINHOS.subirMidia` (`FormData`) → `media_id` → envio `message_type: "IMAGE"`, `image: { media_id }` |
| `enviarModelo?` | **ausente** | **ausente** |
| `baixarMidia?(ref)` | **ausente** (a mídia vem por URL, job de M3) | `POST TT_CAMINHOS.baixarMidia` (JSON com `media_id`) → URL temporária → `buscarExterno(url, { provedor: "tiktok", maxBytes: 3 MB })` **sem cabeçalho de credencial** → `{ bytes, mime }` |
| `marcarComoLida?` | ausente | ausente |
| `verificarAssinatura` | delega a `conferirAssinaturaMeta` | devolve **sempre `false`**: o segredo é do app e o adaptador não lê segredo de env (trava §9 c); quem confere é a borda (`webhookTiktok`), antes de gravar. O método existe só para cumprir o contrato; nenhum código chama-o para o TikTok |
| `interpretarWebhook(corpoCru)` | nunca lança; agrupa anexos por `mid`; `deMim` sempre `false` | nunca lança; `content` pode chegar como string JSON (CONFERIR) — o parser aceita os dois; `timestamp` em **ms** |

Resultado com `ok: false`: `permanente = true` para token/permissão recusados (`FB_CODIGOS_PERMANENTES`, `TT_CODIGOS_PERMANENTES`), destino inválido e mídia recusada; `false` para 5xx, 429, código 613 (Meta), timeout e rede. `motivo` sempre em PT-BR para a bolha: token recusado → "O canal recusou a autorização desta conta. Reconecte a conta em Configurações."; limite do primeiro contato do TikTok → "O TikTok não aceita mais mensagens nesta conversa até a cliente responder.".

**Normalização Messenger**: `sender.id` → `remetenteId`; `entry.id` → `contaExterna`; `timestamp` (ms) → `ocorridoEm`; `message.mid` → `externoId`; `message.text` → `texto`; anexos `image` (com `payload.sticker_id` → `sticker`), `video`, `audio`, `file` → `documento`, com `payload.url` → `midias[].url`; `reply_to.mid` → `respondendoA`; `is_echo` → descartado `eco_de_pagina`; anexo de outro tipo → `metadados.tipo_original` (texto mantido; sem texto → descartado `tipo_nao_suportado`).

**Normalização TikTok**: `content.from_user.id` → `remetenteId`; `from_user.nickname`/`display_name`, se vier → `remetenteNome`; `user_openid` → `contaExterna`; `content.conversation_id` → **`conversaExterna`**; `content.message_id` → `externoId`; `type` `text` → texto (`text.body`), `image` → imagem (`image.media_id` → `midias[].idExterno`, sem `url`, `mime` desconhecido até baixar); `referenced_message_info.referenced_message_id` → `respondendoA`. A forma exata do `content` é CONFERIR e vive nos fixtures (§9).

### 6.2 Clientes HTTP

- **Messenger** — `canais/facebook/graph.ts`: `validarTokenDaPagina`, `assinarPaginaNoApp`, `enviar(pagina, corpo, token)`, `lerMe(token)`. Só por `buscarExterno(url, { provedor: "meta", metodo, corpo, cabecalhos: { authorization: "Bearer " + token } })`; base `https://graph.facebook.com/${env.META_GRAPH_VERSION}` (versão sem default no código). **Nunca** `?access_token=`.
- **TikTok** — `canais/tiktok/cliente.ts`: `trocarCodigo`, `renovar`, `lerConta`, `enviar`, `subirMidia`, `resolverDownload`, `baixar`, `lerEnderecoDoApp`, `gravarEnderecoDoApp`. Só por `buscarExterno(url, { provedor: "tiktok", metodo, corpo, cabecalhos })`; base `${TT_BASE}/${env.TIKTOK_API_VERSAO}`; cabeçalho `Access-Token` só nas chamadas de conta; `app_id`/`client_secret` só em corpo JSON — exceto se `TT_CAMINHOS.webhookLer` exigir query (CONFERIR), caso em que a URL montada **nunca** vai a log, erro ou trilha (trava §9). Resposta com `code !== 0` → `{ ok: false, motivo, permanente: TT_CODIGOS_PERMANENTES.includes(code) }`. Download do CDN sem nenhum cabeçalho de credencial.

### 6.3 Variáveis de ambiente novas (texto exato em §10 F2)

| Variável | Tipo | Regra |
|---|---|---|
| `FACEBOOK_VERIFY_TOKEN` | `segredo` (≥ 32) opcional | com ela, `META_APP_SECRET` é obrigatória; sem ela o GET de challenge responde 403 e o cartão mostra "indisponível" |
| `TIKTOK_APP_ID` | string opcional | com ela, `TIKTOK_APP_SECRET` e `TIKTOK_API_VERSAO` são obrigatórias |
| `TIKTOK_APP_SECRET` | `segredo` opcional | HMAC do webhook, troca de `code`, renovação e endereço de entrega |
| `TIKTOK_API_VERSAO` | `^v\d+\.\d+$` opcional | **sem default no código** |

`redirect_uri` do TikTok = `${APP_URL}/api/integracoes/tiktok/callback` (derivado). Credencial de conta **nunca** em env. **Um app Meta e um app TikTok por ambiente** (comentário no `.env.example` e no runbook).

### 6.4 `config.ts` com CONFERIR (ADR 0053)

`src/lib/canais/facebook/config.ts` e `src/lib/canais/tiktok/config.ts` são **puros** (sem import). Cada `export const` tem, na linha anterior, `// CONFERIR-MESSENGER: <o que falta> (<fonte>, 16/09/2026)`, `// CONFERIR-TIKTOK: …` ou `// CONFIRMADO: <fonte>, <data>`.

| Constante | Valor inicial | Situação |
|---|---|---|
| `FB_CAMPOS_ASSINADOS` | `["messages"]` | CONFIRMADO (Meta, webhooks) |
| `FB_TAG_AGENTE_HUMANO` | `"HUMAN_AGENT"` | CONFIRMADO (Meta, send-messages); CONFERIR se o app precisa de revisão para `pages_messaging` |
| `FB_TIPO_MENSAGEM` | `{ resposta: "RESPONSE", marcada: "TAGGED_MESSAGE" }` | CONFIRMADO |
| `FB_CAMPO_CITACAO` | `"reply_to"` | CONFERIR (confirmado só na entrada) |
| `FB_CODIGOS_PERMANENTES` | `[190, 10, 200, 230, 551]` | CONFERIR (551 = pessoa indisponível) |
| `TT_BASE` | `"https://business-api.tiktok.com/open_api"` | CONFERIR (Chatwoot) |
| `TT_CAMINHOS` | `token: "/tt_user/oauth2/token/"`, `renovar: "/tt_user/oauth2/refresh_token/"`, `conta: "/business/get/"`, `enviar: "/business/message/send/"`, `subirMidia: "/business/message/media/upload/"`, `baixarMidia: "/business/message/media/download/"`, `webhookLer: "/business/webhook/list/"`, `webhookGravar: "/business/webhook/update/"` | CONFERIR (Chatwoot; `webhookLer` sem fonte legível) |
| `TT_AUTORIZAR` | `{ url: "https://www.tiktok.com/v2/auth/authorize/", escopos: ["user.info.basic", "message.list.read", "message.list.send", "message.list.manage"] }` | CONFERIR (só o mínimo de escopos) |
| `TT_PKCE` | `false` | CONFERIR (se o fluxo aceitar `code_challenge`, virar `true`: o código já trata os dois) |
| `TT_ASSINATURA` | `{ cabecalho: "tiktok-signature", toleranciaS: 300 }`, formato `t=<seg>,s=<hex>`, base `` `${t}.${corpo}` `` | CONFERIR (TikTok for Developers e Chatwoot) |
| `TT_EVENTOS` | `{ recebida: "im_receive_msg", eco: "im_send_msg", leitura: "im_mark_read_msg" }` | CONFERIR |
| `TT_CODIGOS_PERMANENTES` | `[40001, 40100, 40102, 40104, 40105]` | CONFERIR (preencher com o que aparecer em HML) |

As **horas** das janelas e os **tetos** de texto/mídia não estão aqui: moram em `regras-de-envio.ts` (§10 F9), com o mesmo marcador.

### 6.5 Allowlist de host (texto exato em §10 F4)

`meta` ganha `cdn.fbsbx.com` (anexo de arquivo do Messenger); `tiktok` novo: `business-api.tiktok.com` e `.tiktokcdn.com` (CONFERIR no 1º download em HML). Um salto de redirecionamento para outro host nunca leva `authorization`, `access-token` nem `x-api-key`.

### 6.6 Fontes consultadas (16/09/2026)

- Meta (oficial): Send API — `developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages` (`messaging_type`; `HUMAN_AGENT` até 7 dias com `pages_messaging`; tags de atualização recusadas desde 27/04/2026); visão geral (`pages_show_list`, `pages_manage_metadata`, `pages_messaging`; página própria dispensa revisão avançada); webhooks (`POST /{page-id}/subscribed_apps`, `X-Hub-Signature-256`, 200 em até 5 s, desligamento após 1 h de falha); evento `messages` (vários anexos com o mesmo `mid`). Secundária: CM.com (2.000 caracteres, 25 MB).
- TikTok: Business Messaging API — `business-api.tiktok.com/portal/docs/business-messaging/v1.3` (**ilegível**); Chatwoot (`developers.chatwoot.com/self-hosted/configuration/features/integrations/tiktok`; `app/controllers/webhooks/tiktok_controller.rb`, `app/services/tiktok/{client,auth_client,send_on_tiktok_service,message_service}.rb`); Infobip (conversa iniciada pela cliente; indisponível em EUA/EEE/CH/UK); SleekFlow (48 h; 10 mensagens no primeiro contato); Qiscus (só texto e imagem); TikTok for Developers `developers.tiktok.com/doc/webhooks-verification` (`Tiktok-Signature: t=…,s=…`).
- TikTok Shop: `partner.tiktokshop.com/docv2/page/create-conversation-202309`; UnifyPort 18/07/2026 (portão 1.000 lojistas / 1 mi chamadas/dia); Hookdeck (HMAC do webhook do Shop); Bling `bling.com.br/integracao/tiktok-shop` (integração nativa).

---

## 7. Telas

| Rota | Papel mínimo | Server × client | Crítica (block 3 s) |
|---|---|---|---|
| `/configuracoes/integracoes` (página de M5) + **`_components/conectar-canais-extras.tsx`** (costura, dono R2-D) | dono/admin (`configuracao:ler` + `integracoes:ler`) | a costura é **server component** assíncrono: chama `lerCanaisExtras({})` e entrega os dados a dois componentes client (`dialogo-conectar-facebook.tsx`, `dialogo-conectar-tiktok.tsx`) | **nenhuma nova**: conectar não está na lista fechada de `04 §9.1`; "Desconectar" continua o block de M5 |
| `/configuracoes/integracoes/[id]` (M5) | idem | sem arquivo novo: para `facebook`/`tiktok` não oferece o formulário genérico de reautenticação e mostra "Para reconectar, use o cartão do canal em Integrações." (§10 M5-3) | "Desconectar" (M5) |
| `/conversas`, `/conversas/[id]` (M1) | `conversas:ler` | sem arquivo novo; recebe §10 M1-5 | as de M1 |

### 7.1 Cartão "Facebook Messenger"

- **Disponível**: título "Facebook Messenger", contagem ("2 páginas conectadas" / vazio abaixo) e botão secundário **"Conectar página do Facebook"** → `dialog`:
  - Campos: **Loja** (select obrigatório; sem valor inicial, exceto quando só existe uma loja) · **Rótulo** (placeholder "Messenger Centro") · **ID da página** (`inputmode="numeric"`) · **Token de acesso da página** (`type="password"`, `autocomplete="off"`).
  - Ajuda sob o token: "Gere um token de longa duração no Gerenciador de Negócios, com as permissões pages_messaging, pages_manage_metadata e pages_show_list."
  - Aviso fixo (tom `info`): "O Messenger só deixa responder em até 24 horas da última mensagem da cliente. Entre 24 horas e 7 dias, só respostas digitadas por alguém da equipe. Respostas dadas pelo Meta Business Suite não aparecem aqui."
  - Enviar: **"Conectar"**; pendente: "Conferindo o token com a Meta…" (botão desabilitado, `aria-busy`).
  - Sucesso: fecha o diálogo, toast 4 s "Página conectada. As próximas mensagens vão aparecer em Conversas." (reconexão: "Página reconectada.") e `router.refresh()`.
  - Erro: inline no campo (`resumo-de-erros` no topo, foco no primeiro campo com erro); o formulário **não** é limpo, **exceto** o token. Textos: os de §5.3.
- **Indisponível**: `faixa-aviso` neutra "O Messenger ainda não foi configurado neste servidor. Peça ao responsável técnico para configurar o app da Meta." — **sem botão**.

### 7.2 Cartão "TikTok"

- **Disponível**: título "TikTok (mensagens)", contagem e botão **"Conectar conta do TikTok"** → `dialog` com Loja + Rótulo.
  - Aviso (tom `aviso`, antes do botão): "O TikTok só entrega respostas em até 48 horas da última mensagem da cliente, só texto ou uma imagem JPG/PNG de até 3 MB, e não funciona com contas registradas nos EUA, na União Europeia, na Suíça ou no Reino Unido. A cliente sempre precisa escrever primeiro."
  - Botão **"Continuar no TikTok"**; pendente "Abrindo o TikTok…"; sucesso da action → `window.location.assign(url)`.
- **Volta do OAuth** (`?tiktok=`, lida com `useSearchParams` no componente client, mostrada uma vez numa `faixa-aviso` fechável, `role="status"` para `ok` e `role="alert"` para o resto; depois `router.replace` sem o parâmetro; valor desconhecido é ignorado):

  | Valor | Tom | Texto |
  |---|---|---|
  | `ok` | sucesso | "Conta do TikTok conectada. As próximas mensagens vão aparecer em Conversas." |
  | `estado` | perigo | "A autorização expirou ou já foi usada. Comece de novo." |
  | `recusado` | aviso | "A conexão foi cancelada no TikTok." |
  | `ja_conectada` | perigo | "Esta conta do TikTok já está conectada em outra loja. Desconecte lá primeiro." |
  | `outro_ambiente` | perigo | "O app do TikTok deste servidor já entrega mensagens para outro endereço (outro ambiente). Nada foi alterado. Cada ambiente precisa de um app próprio: fale com o responsável técnico." |
  | `webhook` | perigo | "Não foi possível conferir o endereço de entrega do app do TikTok. Nada foi alterado. Tente de novo em alguns minutos." |
  | `falha` | perigo | "O TikTok não respondeu como esperado. Tente de novo em alguns minutos." |

- **Indisponível**: "O TikTok ainda não foi liberado neste servidor: o app precisa ser aprovado pela TikTok e configurado. Fale com o responsável técnico." — sem botão.

### 7.3 Estados obrigatórios

| Estado | Cartões | Conversa (via §10 M1-5) |
|---|---|---|
| carregando | a página de M5 envolve a costura em `<Suspense fallback={<EsqueletoTabela linhas={2} />}>` | os de M1 |
| vazio | "Nenhuma página do Facebook conectada." / "Nenhuma conta do TikTok conectada." (+ " nesta loja" quando o escopo é uma loja) e o botão | "Nenhuma conversa com esses filtros." (M1) |
| erro | `estado-erro` "Não foi possível carregar os canais. Tente de novo." [Tentar de novo] | falha com `falha_motivo` visível + "Tentar de novo" |
| sucesso | toast/faixa; contagem atualizada | bolha "Enviada" |
| sem permissão | a página não renderiza (portão de M5) | composer ausente: "Você tem acesso só de leitura nesta loja." |
| conta caída | selo "Expirado"/"Com erro" na lista de M5 | caso 2 do composer (M1) |

### 7.4 Composer — caso 1 por canal (§10 M1-5), microcopia exata

Continua **um** dos quatro casos de `04 §5.2`; a lista não cresce. Textos = `mensagemDaJanela` (§10 F9). Nota interna nunca é bloqueada.

| Situação | Tom | Texto | Saída oferecida |
|---|---|---|---|
| `whatsapp_oficial` · `so_modelo` | aviso | "Passaram 24h desde a última mensagem da cliente. Só dá para enviar um modelo aprovado." | [Escolher modelo] |
| `facebook` · `so_agente_humano` | info, **não bloqueia** | "Passaram 24 horas desde a última mensagem da cliente. Sua resposta vai marcada como atendimento humano e só vale até 7 dias depois dela." | — |
| `facebook` · `fechada` | aviso, bloqueia | "Passaram 7 dias desde a última mensagem da cliente. O Messenger só deixa responder quando ela escrever de novo." | [Ver outras conversas do contato] quando houver; senão [Escrever nota interna] |
| `tiktok` · `fechada` | aviso, bloqueia | "Passaram 48 horas desde a última mensagem da cliente. O TikTok só deixa responder quando ela escrever de novo." | idem |
| `instagram` · `fechada` | aviso, bloqueia | "Passaram 24 horas desde a última mensagem da cliente. O Instagram só deixa responder quando ela escrever de novo." | idem |
| sem entrada (qualquer canal com janela) | aviso, bloqueia | "A cliente ainda não escreveu por este canal. O <canal> só deixa responder depois que ela escrever." | idem |
| anexo recusado | erro inline no anexo | texto de `recusaDeMidia` (ex.: "O TikTok só aceita uma imagem JPG ou PNG de até 3 MB por mensagem, sem texto junto.") | remover anexo |

Sem timer no cliente: se a janela fechar com a tela aberta, a action recusa com o mesmo texto e o composer o mostra inline.

---

## 8. Segurança

| Ameaça | Resposta do desenho | REQ / INV |
|---|---|---|
| POST forjado nos webhooks | HMAC do corpo cru (Meta) / `t.corpo` (TikTok) com o segredo do app, comparação em tempo constante, antes de qualquer parse ou escrita; segredo ausente = 401 | I2, I8, INV-43/44/48 |
| Reenvio (replay) | único `(provedor, evento_externo_id)` + `jobId` determinístico; TikTok recusa `t` fora de ±300 s | I2, I8 |
| Enumeração pela forma da recusa | `rotaDeMaquina`: 401 corpo nulo, mesmo piso de tempo; nenhum id na URL | I3 |
| **Bloqueio da integração por rajada sem assinatura** | teto por IP antes do banco; o teto por integração conta **só requisição autenticada** (F5); nas duas rotas do R2-D ele é desligado (`limiteIntegracao: null`), porque a chave é do app e um balde só estrangularia todas as contas | **I4** |
| Evento de uma página/conta caindo em outra loja | roteamento por `referencia_externa` de **cada** `entry`/evento; `CHECK lojas_integracoes_rede`; contato buscado na loja da conta | I9, `01/D-13` |
| Token de página/OAuth vazado | cofre AES-256-GCM, AAD = id; tela mostra 4 últimos; nunca em log (`CAMPOS_SENSIVEIS`, F7), `valores`, trilha (gravador descarta), URL ou `argv`; `client_secret` só em corpo JSON | K2, K3, I15 |
| Credencial atravessando redirecionamento para o CDN | `buscarExterno` descarta `authorization`/`access-token`/`x-api-key` quando o host muda e recusa salto em não-GET (F4); download do CDN do TikTok sem credencial | A-17, I15 |
| CSRF / troca de conta no OAuth | `state` HMAC 5 min + nonce igual ao cookie `__Host-` + contexto de uso único (`GETDEL`) + usuário do state = sessão atual + permissão e loja reconferidas no retorno; loja **não** trafega na URL; PKCE quando `TT_PKCE` | I14, `04/S18` |
| Redirect aberto no retorno | destino fixo `urlDeRetornoTiktok` | J |
| Instalação de homologação capturando mensagens reais | um app por ambiente; endereço de entrega nunca sobrescrito; divergência recusa a conexão e põe as contas em `erro` | I9 |
| SSRF no download de mídia | só `buscarExterno`: Messenger no grupo `meta`, TikTok no grupo `tiktok`; DNS sem faixa interna; 1 salto | A-17 |
| Mídia maliciosa (HTML/SVG como arquivo) | ingestão de M3: magic bytes contra a allowlist, `nosniff`, `attachment` para não-imagem | `01/D-05` |
| Violação de política → página/conta banida | `HUMAN_AGENT` só com `origem_envio = 'pessoa'`, gravado só com `ctx.origem === "ui"`; campanha já restrita a WhatsApp; trava de fonte (§9) | I6 |
| Conta comercial fora da região | aviso **antes** de conectar; falha vira `falhou` com motivo | — |
| Challenge refletindo conteúdo | `hub.challenge` só dígitos, `text/plain` | J |
| PII além do necessário | só `sender.id`/`from_user.id` e o nome que vier; `referral`/anúncio não é gravado; nenhuma consulta de perfil; `corpo` do evento mascarado ao processar (ADR 0017); anonimização remove `conversa_externa_id` (M2-1) | LGPD §16 |
| Segredo comparado com `===` | nenhuma linha compara valor de `SECRET`/`TOKEN` com `===`/`!==` (só `!== undefined`) | T17 |
| Detalhe de API errado passando despercebido | `config.ts` + trava CONFERIR + conferência em HML no aceite; assinatura errada falha **fechada** (401) | I6 |

---


## 9. PACOTE DE CONSTRUÇÃO — R2-D Canais extras

- **Objetivo**: Messenger e TikTok DM funcionando ponta a ponta sobre a ingestão e o envio genéricos do R1 — sem tela de fachada e sem TikTok Shop.
- **Pré-condição**: DELTA da §10 aplicado e verde (`npm run verificar`), M1, M3 e M5 fechados. Um agente, sequencial. ~20 arquivos de código (~2.400 linhas) + ~9 de teste. Se o app do TikTok não estiver aprovado, o pacote fecha com o TikTok **desligado e testado** e a conferência em HML fica pendente datada.
- **Entradas**: este documento; `03-arquitetura.md §4.1, §8, §10, §11, §12.3, §12.4, §13`; `02-seguranca.md §12, §13`; `04-ui.md §5.2, §5.6, §7.2, §10`; `01-dados.md §6.3, §6.4, §10`; `01-dados-dominio.md §2`.
- **Ambiente de teste**: `node scripts/db-teste.mjs --sufixo r2d` → `merlostore_test_r2d`; `REDIS_URL=redis://localhost:6382/12`. Variáveis de app (`META_APP_SECRET`, `META_GRAPH_VERSION`, `FACEBOOK_VERIFY_TOKEN`, `TIKTOK_*`) são postas **no teste** com `vi.stubEnv` + `vi.resetModules()` + `import()` dinâmico; o ambiente de teste padrão continua **sem** elas (a prova de INV-43 da fundação depende disso).

**CRIA E É DONO**

```
src/lib/canais/facebook/config.ts                 puro, CONFERIR-MESSENGER (§6.4)
src/lib/canais/facebook/graph.ts                  validarTokenDaPagina, assinarPaginaNoApp, enviar, lerMe
src/lib/canais/facebook/interpretar.ts            rotearMessenger, interpretarMessenger (puros, nunca lançam)
src/lib/canais/facebook/adaptador.ts              criarAdaptadorFacebook (costura F10 → corpo real)
src/lib/canais/tiktok/config.ts                   puro, CONFERIR-TIKTOK (§6.4)
src/lib/canais/tiktok/assinatura.ts               conferirAssinaturaTiktok
src/lib/canais/tiktok/cliente.ts                  chamadas via buscarExterno (§6.2)
src/lib/canais/tiktok/interpretar.ts              rotearTiktok, interpretarTiktok (puros, nunca lançam)
src/lib/canais/tiktok/adaptador.ts                criarAdaptadorTiktok (costura F10 → corpo real)
src/lib/canais-extras/index.ts                    API pública (costura F10 → corpo real)
src/lib/canais-extras/_consultas.ts
src/lib/canais-extras/_gravacao.ts
src/lib/canais-extras/webhook-facebook.ts
src/lib/canais-extras/webhook-tiktok.ts
src/lib/canais-extras/conexao-facebook.ts
src/lib/canais-extras/oauth-tiktok.ts
src/lib/canais-extras/token-tiktok.ts
src/lib/canais-extras/endereco-do-app-tiktok.ts
src/lib/canais-extras/conferencia.ts
src/lib/actions/canais-extras.ts
src/lib/validadores/canais-extras.ts
src/app/api/webhooks/facebook/route.ts
src/app/api/webhooks/tiktok/route.ts
src/app/api/integracoes/tiktok/callback/route.ts
src/app/(app)/configuracoes/integracoes/_components/conectar-canais-extras.tsx    (costura F10 → corpo real)
src/app/(app)/configuracoes/integracoes/_components/dialogo-conectar-facebook.tsx
src/app/(app)/configuracoes/integracoes/_components/dialogo-conectar-tiktok.tsx
tests/unidade/canais-extras-facebook.test.ts
tests/unidade/canais-extras-tiktok.test.ts
tests/integracao/canais-extras-webhooks.test.ts
tests/integracao/canais-extras-conexao.test.ts
tests/integracao/canais-extras-token.test.ts
tests/integracao/canais-extras-envio.test.ts
tests/componentes/canais-extras-cartoes.test.tsx
tests/travas/canais-extras.test.ts
tests/fixtures/canais-extras/*.json               payloads fixos, sem dado real
docs/modulos/canais-extras.md
```

**SÓ LÊ**: `src/lib/canais/{tipos,registro,regras-de-envio}.ts` (depois de §10 F9 e M1-1/M1-2), `src/lib/conversas/**`, a API pública de `@/lib/integracoes` e a função única de diário (§10 X-5), `src/lib/midias/ingestao.ts`, `src/lib/db/**` (`emTransacao`, `inserirAuditado`, `atualizarComTrava`, `atualizarContador`, `registrarAuditoria`, `condicaoDeLoja`, `vivos`), `src/lib/seguranca/{maquina,assinaturas,cofre,limite,corpo}.ts`, `src/lib/rede/buscarExterno.ts`, `src/lib/fila/{filas,idempotencia}.ts`, `src/lib/auth/**` (`guard`, `loja`, `sistema`), `src/lib/campanhas/regras.ts`, `src/components/comum/**`, `src/lib/ui/tons.ts`, `src/lib/env.ts`, `src/lib/logger.ts`.

**Não negociável**

- Nenhum `JSON.parse` antes de autenticar; ordem de `rotaDeMaquina` intacta; `limiteIntegracao: null` nas duas rotas; persistir falhou = 500; `enfileirar` devolveu `null` = 500; processar falhou (já enfileirado) = 200.
- Um evento por (conta, mensagem); várias mídias = uma mensagem; eco e tipo não suportado descartados com registro; `interpretar*`/`rotear*` nunca lançam.
- Sem fallback de ambiente; credencial só do cofre; token nunca em log, trilha, DTO, `valores`, URL ou mensagem de erro; `Access-Token`/`Authorization` nunca no download do CDN.
- `HUMAN_AGENT` **só** quando `situacaoDaJanela` devolve `so_agente_humano`, o que só acontece com `origem_envio = 'pessoa'`.
- `conectado` só depois de validar token (`/me`) **e** assinar a página (Messenger) / trocar o `code`, conferir o endereço de entrega e confirmar a conta (TikTok). Loja escolhida antes, lida do campo `loja`, nunca chutada.
- O endereço de entrega do app TikTok só é **escrito** quando está vazio, dentro de uma conexão feita por pessoa, com trilha. Nunca sobrescrito, nunca periódico.
- Detalhe não confirmado só em `config.ts`/`regras-de-envio.ts` com marcador; `META_GRAPH_VERSION` e `TIKTOK_API_VERSAO` sem default no código.
- Recurso sem configuração = cartão "indisponível" + `CONFIGURACAO`; nunca 500, nunca botão que não funciona.
- Nenhuma chamada a TikTok Shop; nenhuma escrita em ERP; nenhum alerta gravado pelo R2-D (M8 gera pelo status).
- Nenhuma comparação de `SECRET`/`TOKEN` com `===`/`!==` (T17); nenhum `fetch(` fora de `buscarExterno`; nenhum `process.env`.
- Arquivo < 500 linhas; PT-BR; `export async function` em `"use server"`; nenhum arquivo fora da lista acima é gravado — faltou algo em arquivo alheio, **para e reporta**.

**Aceite verificável**

1. `npm run lint && npm run typecheck && npm run compliance && npm run test:travas` verdes.
2. `node scripts/db-teste.mjs --sufixo r2d && npm run db:migrate && npm run test:integracao` verde (inclui `enums-check` com `tiktok` no CHECK).
3. POST forjado em `/api/webhooks/facebook` e `/api/webhooks/tiktok` → 401, corpo nulo, **zero** linhas novas; sem `META_APP_SECRET`/`TIKTOK_APP_SECRET` → 401; TikTok com `t` a 301 s → 401; `?token=x` na URL → 401.
4. **REQ-I4**: 301 POSTs sem assinatura do mesmo IP (em lotes de 50) e depois um POST assinado, nas duas rotas → o assinado responde 200 e grava o evento.
5. `GET /api/webhooks/facebook` com o token do Instagram → 403; com `FACEBOOK_VERIFY_TOKEN` e challenge numérico → 200 com o challenge; challenge `<script>` → 403. `GET /api/webhooks/tiktok` → 405.
6. Payload fixo do Messenger com 2 entries (2 páginas, 2 lojas) → cada mensagem na loja da sua página; mensagem com 2 anexos → 1 linha em `conversas_mensagens` e 2 em `conversas_mensagens_midias`; `is_echo` → evento `descartado`, nenhum contato; `reel` → `descartado` com `tipo_original = "reel"`; texto + anexo `location` → mensagem de texto com `metadados.tipo_original`; mesmo `mid` 2× → 1 mensagem; página desconhecida → `recusado`.
7. Payload fixo do TikTok → contato com `tiktok_id`, mensagem com `metadados.conversa_externa_id`; imagem → `lojas_midias` gravada e anexo com `midia_id` e `baixada = true`; download recusado (404 do CDN) → mensagem sem anexo, `metadados.erro_provedor.codigo = "midia_indisponivel"`; `im_send_msg` → `descartado`.
8. `enfileirar` devolvendo `null` (fila simulada fora) → 500 e a linha fica `recebido`; reentrega do mesmo corpo com a fila de volta → 200 e job criado com o mesmo `jobId`.
9. Envio (transporte falso): Messenger com `ultima_entrada_em` há 2 h → `messaging_type = RESPONSE`; há 30 h, mensagem do composer (`origem_envio = 'pessoa'`) → `TAGGED_MESSAGE` + `HUMAN_AGENT`; há 30 h, mesma conversa por `registrarEnvio` com contexto de worker → `falhou` com o texto da janela e **nenhuma** chamada ao provedor; há 8 dias → a action recusa com `VALIDACAO`. TikTok há 49 h → recusado; PNG 2 MB → upload + `IMAGE`, `recipient` = `conversa_externa_id` da última entrada; MP4 ou PNG com legenda → `VALIDACAO` com o texto de `recusaDeMidia`; sem entrada com `conversa_externa_id` → `falhou` "Não há conversa aberta no TikTok com esta cliente.".
10. `conectarPaginaFacebook`: `/me` com outro id → `INTEGRACAO`, nenhuma linha; `subscribed_apps` falhando → nenhuma linha; sucesso → linha `conectado` + `integracao_conectada` sem token no diff; mesma página, mesma loja → reconexão (`integracao_alterada`); outra loja → `VALIDACAO` em `paginaId`; campo `loja` ≠ cookie → grava na loja do campo; admin em "Todas as lojas" com `loja` preenchida → grava.
11. Retorno do OAuth: `state` reutilizado, expirado, adulterado, de outra sessão, sem cookie, com cookie de outro nonce ou sem contexto no Redis → `?tiktok=estado` e nenhuma linha; iniciador rebaixado a gerente entre o início e a volta → recusado, nenhuma linha; `open_id` vivo em outra loja → `ja_conectada`; endereço de entrega vazio → registrado + trilha `endereco_do_app`; igual → nenhuma escrita no provedor; **diferente → `outro_ambiente` e nenhuma chamada de escrita**; leitura do endereço falhando → `webhook`, nada gravado.
12. Duas chamadas simultâneas a `garantirTokenTiktok` com token vencendo → **uma** chamada de renovação ao provedor; `invalid_grant` depois de outro processo renovar → sem `expirado`.
13. `conferirContasCanaisExtras`: Graph 190 → `expirado`; endereço do app diferente → contas `tiktok` em `erro` e **nenhuma** escrita no provedor; endereço voltou → `conectado`; rede fora → nenhum status muda.
14. Sem `TIKTOK_APP_ID` → cartão "indisponível" (componente) e `iniciarConexaoTiktok` → `{ ok: false, codigo: "CONFIGURACAO" }`; idem Messenger sem `FACEBOOK_VERIFY_TOKEN`.
15. **HML (manual, com data em `docs/modulos/canais-extras.md`)**: página real recebe e responde; imagem recebida baixa (host confere com a allowlist); resposta entre 24 h e 7 dias sai marcada; cada `CONFERIR-MESSENGER` resolvido vira `CONFIRMADO:`. TikTok: idem **se** o app estiver aprovado; senão, "pendente: aprovação do app TikTok (dono: Paulo)".

**Testes obrigatórios** (título com o ID da regra `R2-CE-xx` ou do REQ)

- `tests/unidade/canais-extras-facebook.test.ts`: `rotearMessenger`/`interpretarMessenger` com os fixtures (2 entries, 2 anexos, eco, reel, postback, sem remetente, figurinha, citação, corpo ilegível sem lançar); `ehProvedorDeCampanha("facebook") === false` (R2-CE-05).
- `tests/unidade/canais-extras-tiktok.test.ts`: `conferirAssinaturaTiktok` (válida, adulterada, `t` a ±301 s, cabeçalho malformado, segredo nulo → false); `rotearTiktok`/`interpretarTiktok` (`content` como objeto e como string JSON, eco por evento e por remetente, leitura, sem remetente); `ehProvedorDeCampanha("tiktok") === false`.
- `tests/integracao/canais-extras-webhooks.test.ts`: aceite 3–8.
- `tests/integracao/canais-extras-conexao.test.ts`: aceite 10, 11, 14 (lado da action).
- `tests/integracao/canais-extras-token.test.ts`: aceite 12, 13.
- `tests/integracao/canais-extras-envio.test.ts`: aceite 9, pelo processador de M1 com transporte falso.
- `tests/componentes/canais-extras-cartoes.test.tsx`: os dois cartões em disponível/indisponível/vazio/erro; faixa de retorno `?tiktok=` para os 7 valores e valor desconhecido ignorado; token nunca repopulado depois de erro; `axe` sem violação.
- `tests/travas/canais-extras.test.ts`:
  - (a) as strings `open_api`, `business-api.tiktok.com`, `tiktok-signature`, `im_receive_msg`, `im_send_msg`, `HUMAN_AGENT`, `TAGGED_MESSAGE`, `subscribed_apps`, `webhook/update` só aparecem em `src/lib/canais/{facebook,tiktok}/config.ts` (exceção única: `business-api.tiktok.com` em `src/lib/rede/buscarExterno.ts`);
  - (b) todo `export const` desses dois arquivos tem `CONFERIR-` ou `CONFIRMADO:` na linha anterior; piso ≥ 12 constantes;
  - (c) em `src/lib/canais/{facebook,tiktok}/**`, `env.` só aparece como `env.META_GRAPH_VERSION` ou `env.TIKTOK_API_VERSAO`, e `process.env` não aparece;
  - (d) `agenteHumano` só é **lido** em `src/lib/canais/facebook/adaptador.ts`, e o literal `agenteHumano: true` não existe em `src/`;
  - (e) `origem_envio: "pessoa"` só é escrito junto de `ctx.origem === "ui"` (arquivo do registro de envio de M1);
  - (f) em `src/lib/canais-extras/**` e `src/lib/canais/tiktok/**`, nenhuma chamada de `logger.` recebe `url`, `query`, `token` ou `segredo`;
  - (g) `webhookGravar` só é referenciado em `src/lib/canais-extras/endereco-do-app-tiktok.ts`, e esse arquivo não é importado por `conferencia.ts`.

**Riscos**

| Risco | Plano B |
|---|---|
| App do TikTok não aprovado para um lojista só | TikTok fica desligado e testado; ADR 0051 já prevê; nenhuma tela promete o canal |
| Formato real da assinatura do TikTok diferente do CONFERIR | o webhook recusa (401) — falha segura; ajustar `TT_ASSINATURA` e o fixture com o payload real de HML |
| TikTok sem endpoint de **leitura** do endereço de entrega | toda conexão cai em `?tiktok=webhook`: nada é gravado. Saída documentada: o responsável técnico configura o endereço no portal do TikTok e troca `garantirEnderecoDoApp` por "só confere pelo primeiro evento recebido" com ADR novo — nunca por escrita às cegas |
| Meta exigir revisão para `HUMAN_AGENT` | `horasAgenteHumano` sai da regra do `facebook` em `regras-de-envio.ts` (uma linha); o composer passa a bloquear depois de 24 h |
| CDN do TikTok fora da allowlist | download falha permanente com o host no log; acrescentar o host em `buscarExterno` (uma linha, delta de fundação) |
| Forma final de M1/M5 diferente do assumido no delta | o pacote **para** e reporta; não edita arquivo de M1/M5 |
| Carga/`jobId` do `processar-evento` diferente entre Instagram e o que o processador espera | o teste de integração de aceite 6/7 falha; alinhar ao código de M5, nunca criar forma nova |

**Commits** (Conventional Commits, sem coautoria)

```
feat(canais): adaptador do Facebook Messenger com agente humano só por pessoa
feat(webhooks): borda do Messenger com assinatura da Meta e challenge próprio
feat(integracoes): conectar página do Facebook validando token e assinatura do app
feat(canais): adaptador de mensagens diretas do TikTok com detalhes a conferir
feat(integracoes): conexão do TikTok por OAuth com contexto de uso único e endereço conferido
feat(integracoes): renovação travada do TikTok e conferência diária das contas
feat(webhooks): borda do TikTok com assinatura do app e anti-repetição
feat(configuracoes): cartões de conexão do Messenger e do TikTok com estado indisponível
test(canais-extras): parsers, assinaturas, janelas, envio, OAuth e trava do CONFERIR
docs(canais-extras): documentar o módulo canais-extras
```

---

## 10. DELTA DA FUNDAÇÃO (aplicar antes da onda 3)

Três grupos: **F** = arquivo da fundação, texto exato; **M/E** = arquivo de módulo (aplicar **depois** que o módulo fechar, dentro do delta único daquele módulo), contrato exato + teste; **X** = itens transversais já consolidados com os outros clusters, com a parte do R2-D.

Ordem: X-1 → F1 → F2 → F3 → F4 → F5 → F6 → F7 → F8 → F9 → F10 → F11 → F12 → M/E → F13 → F14.

### F1 — `src/lib/db/schema/_enums/plataforma.ts` (parte do R2-D em X-1)

Substituir o comentário e a lista de `PROVEDORES` por (a constante `PROVEDORES_DE_PAGAMENTO` é do R2-PG e vem declarada **antes**):

```ts
/**
 * `tiktok` = mensagem direta pela Business Messaging API (R2, ADR 0051).
 * `tiktok_shop` fica no CHECK porque custa zero e NÃO tem adaptador: catálogo,
 * pedidos e atendimento do TikTok Shop estão fora (ADR 0051). `bling` é a
 * conta da rede: `loja_id` nulo. Os de pagamento são do R2-PG.
 */
export const PROVEDORES = [
  "whatsapp_oficial",
  "uazapi",
  "instagram",
  "facebook",
  "tiktok",
  "tiktok_shop",
  "bling",
  ...PROVEDORES_DE_PAGAMENTO,
] as const;
```

SQL esperado na `0018_r2` para as duas listas (conferir literal):

```sql
ALTER TABLE "lojas_integracoes" DROP CONSTRAINT "lojas_integracoes_provedor_lista";--> statement-breakpoint
ALTER TABLE "lojas_integracoes" ADD CONSTRAINT "lojas_integracoes_provedor_lista" CHECK ("lojas_integracoes"."provedor" in ('whatsapp_oficial', 'uazapi', 'instagram', 'facebook', 'tiktok', 'tiktok_shop', 'bling', 'mercadopago', 'pagamento_simulado'));--> statement-breakpoint
ALTER TABLE "lojas_integracoes_eventos" DROP CONSTRAINT "lojas_integracoes_eventos_provedor_lista";--> statement-breakpoint
ALTER TABLE "lojas_integracoes_eventos" ADD CONSTRAINT "lojas_integracoes_eventos_provedor_lista" CHECK ("lojas_integracoes_eventos"."provedor" in ('whatsapp_oficial', 'uazapi', 'instagram', 'facebook', 'tiktok', 'tiktok_shop', 'bling', 'mercadopago', 'pagamento_simulado'));
```

`CHECK lojas_integracoes_rede` não muda. **Efeito de tipo**: todo `Record<Provedor, …>` e `Record<Exclude<Provedor, "bling">, …>` quebra o `typecheck`. Em HEAD o único é `SLA_MINUTOS` em `src/lib/alertas/regras.ts` (M8, `e88d181`), tratado por E-1. O `catalogo-provedores.ts` de M5 é tratado por M5-1. Rodar `npm run typecheck` e corrigir **no mesmo commit** qualquer outro que aparecer.

### F2 — `src/lib/env.ts` e `.env.example`

`env.ts`, no bloco `// -- Canais`, depois de `INSTAGRAM_VERIFY_TOKEN: segredo.optional(),`:

```ts
    /** Challenge do webhook do Messenger. PROPRIO: nunca o do Instagram (ADR 0050). */
    FACEBOOK_VERIFY_TOKEN: segredo.optional(),
    /** App da TikTok API for Business (mensagem direta, ADR 0051). Um app por ambiente. */
    TIKTOK_APP_ID: z.string().min(1).optional(),
    /** HMAC do webhook, troca de code, renovacao e endereco de entrega do app. */
    TIKTOK_APP_SECRET: segredo.optional(),
    /** Sem default literal no codigo, como META_GRAPH_VERSION. */
    TIKTOK_API_VERSAO: z.string().regex(/^v\d+\.\d+$/, 'formato "v1.3"').optional(),
```

No `superRefine`, depois do bloco do Bling:

```ts
    if (v.FACEBOOK_VERIFY_TOKEN !== undefined) {
      exigir("META_APP_SECRET", "quando FACEBOOK_VERIFY_TOKEN existe");
    }
    if (v.TIKTOK_APP_ID !== undefined) {
      exigir("TIKTOK_APP_SECRET", "quando TIKTOK_APP_ID existe");
      exigir("TIKTOK_API_VERSAO", "quando TIKTOK_APP_ID existe");
    }
```

`.env.example`, bloco `# -- Canais`: trocar a primeira linha de comentário por `# HMAC dos webhooks WhatsApp/Instagram/Messenger. Com ele, META_GRAPH_VERSION e obrigatoria.` e acrescentar a linha `# UM APP META POR AMBIENTE: o endereco do webhook e do app, nao da instalacao.` logo abaixo; depois de `INSTAGRAM_VERIFY_TOKEN=`:

```
# Challenge do webhook do Messenger. PROPRIO: nunca o do Instagram (ADR 0050).
FACEBOOK_VERIFY_TOKEN=
# App da TikTok API for Business (mensagem direta, ADR 0051). UM APP POR AMBIENTE:
# HML e PRD com o mesmo app disputam o endereco de entrega das mensagens.
# Com TIKTOK_APP_ID, TIKTOK_APP_SECRET e TIKTOK_API_VERSAO sao obrigatorias.
TIKTOK_APP_ID=
TIKTOK_APP_SECRET=
# Formato v1.3. Sem default no codigo.
TIKTOK_API_VERSAO=
```

(T17 exige as mesmas chaves nos dois arquivos; `!== undefined` é permitido por ela.)

### F3 — `src/lib/seguranca/rotas-publicas.ts` e `docs/seguranca/caminhos-de-acesso.md`

`rotas-publicas.ts` — tipo único consolidado:

```ts
  /** Pacote que entrega o arquivo. "fundacao" ja existe. */
  dono: "fundacao" | "M5" | "R2-PG" | "R2-D";
```

Ao fim de `ROTAS_PUBLICAS` (depois da linha do R2-PG):

```ts
  {
    caminho: "/api/webhooks/facebook",
    metodos: ["GET", "POST"],
    portao: "maquina",
    motivo: "Meta entrega evento do Messenger: HMAC do corpo cru, token de challenge proprio",
    dono: "R2-D",
  },
  {
    caminho: "/api/webhooks/tiktok",
    metodos: ["POST"],
    portao: "maquina",
    motivo: "TikTok entrega mensagem direta: HMAC com o segredo do app e carimbo de tempo",
    dono: "R2-D",
  },
  {
    caminho: "/api/integracoes/tiktok/callback",
    metodos: ["GET"],
    portao: "proprio",
    motivo: "redirect do provedor: state assinado, 5 min, contexto de uso unico e sessao reconferida",
    dono: "R2-D",
  },
```

`caminhos-de-acesso.md`: em "Como ler a coluna `estado`", acrescentar `- \`pacote R2-x\` — rota do R2; mesma regra de \`pacote Mx\`.`. Na tabela da §1, depois da linha do Bling:

```
| `/api/webhooks/facebook` | GET, POST | maquina | Meta entrega evento do Messenger; HMAC do corpo cru, challenge proprio | pacote R2-D |
| `/api/webhooks/tiktok` | POST | maquina | TikTok entrega mensagem direta; HMAC do app + carimbo de tempo | pacote R2-D |
| `/api/integracoes/tiktok/callback` | GET | proprio (OAuth) | redirect do provedor; `state` assinado, contexto de uso unico, 5 min | pacote R2-D |
```

Na §7, a frase final da lista passa de "e qualquer rota de TikTok ou Facebook." para "e qualquer rota de TikTok Shop." (os outros itens da lista são tratados pelos clusters donos).

### F4 — `src/lib/rede/buscarExterno.ts` (texto único consolidado) e `tests/seguranca/ssrf.test.ts`

```ts
export type Provedor =
  | "meta"
  | "uazapi"
  | "bling"
  | "discord"
  | "mercadopago"
  | "openai"
  | "tiktok";

const HOSTS: Record<Provedor, readonly string[]> = {
  meta: [
    "graph.facebook.com",
    "lookaside.fbsbx.com",
    // Anexo de arquivo do Messenger (ADR 0050). CONFERIR-MESSENGER no 1o download em HML.
    "cdn.fbsbx.com",
    "mmg.whatsapp.net",
    ".fbcdn.net",
  ],
  uazapi: [],
  bling: ["api.bling.com.br", "www.bling.com.br", "bling.com.br"],
  discord: ["discord.com", "discordapp.com"],
  /** Pagamentos (R2-PG). */
  mercadopago: ["api.mercadopago.com"],
  /** Transcricao (R2-C). O audio sai do MinIO, nunca de URL de terceiro. */
  openai: ["api.openai.com"],
  // API e CDN de midia do TikTok (ADR 0051). CONFERIR-TIKTOK: host do CDN no 1o download em HML.
  tiktok: ["business-api.tiktok.com", ".tiktokcdn.com"],
};
```

Depois de `export const TIMEOUT_MS = 8_000;`:

```ts
/** Teto absoluto: so upload de audio (R2-C) passa de 8 s, e nunca de 60 s. */
export const TIMEOUT_MAXIMO_MS = 60_000;

/** Cabecalhos com credencial: nunca atravessam para outro host num salto. */
const CABECALHOS_DE_CREDENCIAL = new Set(["authorization", "access-token", "x-api-key"]);

function semCredencial(cabecalhos: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(cabecalhos ?? {}).filter(([nome]) => !CABECALHOS_DE_CREDENCIAL.has(nome.toLowerCase())),
  );
}
```

`OpcoesBusca`:

```ts
export type OpcoesBusca = {
  provedor: Provedor;
  metodo?: "GET" | "POST" | "PUT";
  /** String (JSON ou form) ou multipart; o content-type com boundary e do runtime. */
  corpo?: string | FormData;
  cabecalhos?: Record<string, string>;
  /** Teto de bytes do corpo lido. O padrao cobre video e audio (16 MB). */
  maxBytes?: number;
  /** Padrao TIMEOUT_MS; cortado em TIMEOUT_MAXIMO_MS. */
  timeoutMs?: number;
};
```

Em `uma()`: `signal: AbortSignal.timeout(Math.min(opcoes.timeoutMs ?? TIMEOUT_MS, TIMEOUT_MAXIMO_MS)),`.

Em `buscarExterno`, o bloco de redirecionamento passa a ser:

```ts
  if (resposta.status >= 300 && resposta.status < 400) {
    const destino = resposta.headers.get("location");
    if (!destino) recusar("redirecionamento sem destino");
    await resposta.body?.cancel();
    // O corpo nao e reenviado num salto, e o salto poderia leva-lo a outro host.
    if ((opcoes.metodo ?? "GET") !== "GET") recusar("so GET segue redirecionamento");
    const proximo = await conferirDestino(new URL(destino, url).toString(), opcoes.provedor);
    // Credencial nunca atravessa para outro host, nem dentro da allowlist.
    const cabecalhos =
      proximo.hostname === url.hostname ? (opcoes.cabecalhos ?? {}) : semCredencial(opcoes.cabecalhos);
    url = proximo;
    resposta = await uma(url, { ...opcoes, cabecalhos });
    if (resposta.status >= 300 && resposta.status < 400) {
      await resposta.body?.cancel();
      recusar("mais de um redirecionamento");
    }
  }
```

`ssrf.test.ts` — no mapa de DNS acrescentar `["api.mercadopago.com", "18.231.0.10"]`, `["api.openai.com", "162.159.140.245"]`, `["business-api.tiktok.com", "23.50.0.10"]`, `["p16-sign.tiktokcdn.com", "23.50.0.11"]`, `["cdn.fbsbx.com", "157.240.1.3"]`; casos novos:
- host de um provedor não vale para outro: `business-api.tiktok.com` com `meta`, `api.openai.com` com `tiktok`, `api.mercadopago.com` com `openai` → recusados;
- `https://evil.tiktokcdn.com.attacker.io` com `tiktok` → recusado;
- 302 de `business-api.tiktok.com` para `https://p16-sign.tiktokcdn.com/x` com `Access-Token` e `Authorization` → a 2ª chamada de `fetch` não leva nenhum dos dois; 302 para o **mesmo** host → leva;
- `metodo: "POST"` e `"PUT"` recebendo 302 → recusados, com **uma** chamada de `fetch` só;
- `timeoutMs: 120_000` → `AbortSignal.timeout` chamado com `60_000` (espião); sem `timeoutMs` → `8_000`;
- `corpo: new FormData()` chega ao `fetch` como `body`.

### F5 — `src/lib/seguranca/maquina.ts` (REQ-I4) e `tests/seguranca/maquina-balde.test.ts` (novo)

Em `ConfigMaquina<I>`, trocar `limiteIntegracao?: Regra;` por:

```ts
  /**
   * Teto por integracao, contado SO depois de autenticar (REQ-I4): antes da
   * assinatura, um balde por chave e arma de bloqueio contra a integracao —
   * qualquer um esgota o balde com POST sem assinatura. `null` desliga o balde:
   * rota assinada pelo APP (Messenger, TikTok), em que a chave e constante e um
   * balde so estrangularia todas as contas juntas.
   */
  limiteIntegracao?: Regra | null;
```

No comentário de `rotaDeMaquina`, a ordem passa a: "teto por IP -> content-length -> leitura com teto -> carregar integracao -> validade -> assinatura sobre o corpo cru -> teto por integracao (so autenticado) -> (do chamador) anti-repeticao -> persistir -> enfileirar -> 200."

Em `tratar`, **remover** o bloco `// 2. Teto por integracao…` (de `if (chave !== null) {` até o `}` que fecha) e, logo depois do bloco `if (integracao === null || !autentica) { … return recusa(); }`, inserir:

```ts
    // 8. Teto por integracao, SO para quem autenticou (REQ-I4): anti-laco do
    // provedor. Contar antes da assinatura deixaria qualquer um travar a conta.
    if (cfg.limiteIntegracao !== null && chave !== null) {
      const porIntegracao = await limitarPorIp(
        `maquina:${cfg.provedor}:conta`,
        chave,
        cfg.limiteIntegracao ?? LIMITE_INTEGRACAO_PADRAO,
      );
      if (!porIntegracao.permitido) return excesso(porIntegracao.retryAfter);
    }
```

O GET de challenge deixa de consumir o balde por integração (só o por IP). Nenhum outro comportamento muda; as rotas de M5 continuam com o padrão (300/min, agora só para requisição autenticada) — M5 decide se as suas rotas assinadas pelo app passam `null`.

`tests/seguranca/maquina-balde.test.ts` (mesmo esqueleto de `webhooks.test.ts`: `flushdb` no `beforeEach`, integração em memória com segredo por cabeçalho):
- `REQ-I4: 301 POSTs sem assinatura (lotes de 50) não bloqueiam a integração` → o POST assinado seguinte responde 200 e `processou === 1`;
- `requisição autenticada ainda conta no balde` → `limiteIntegracao: { janela: 60, max: 3 }`, 4 POSTs assinados → o 4º responde 429;
- `limiteIntegracao: null desliga o balde` → mesmos 4 POSTs → todos 200;
- `GET de challenge não consome o balde por integração` → `max: 1`, três GETs chegam ao `verificar`, depois um POST assinado → 200.

`docs/seguranca/matriz-req-teste.md`, linha `I1-I15`: acrescentar `tests/seguranca/maquina-balde.test.ts` à coluna de prova (estado `entregue` para esse arquivo). `02-seguranca.md §12`: a ordem do primeiro parágrafo passa a "teto por IP → `content-length` → … → assinatura → teto por integração (só autenticado) → anti-repetição → …", e a frase "O teto por IP e por `integracaoId` é aplicado antes de tocar o banco…" vira "O teto por IP é aplicado antes de tocar o banco. O teto por integração conta só requisição autenticada (REQ-I4): antes da assinatura, ele seria arma de bloqueio contra a integração." Idem `03-arquitetura.md §11`.

### F6 — `src/components/comum/icone-canal.tsx`

```ts
export type Canal = "whatsapp_oficial" | "uazapi" | "instagram" | "facebook" | "tiktok" | "tiktok_shop";
```

`ROTULOS`: `tiktok: "TikTok",` (antes de `tiktok_shop`) e `tiktok_shop: "TikTok Shop",`. `CORES`: `tiktok: "text-canal-tiktok",`. `GLIFOS`: `tiktok:` com o mesmo `path` que hoje está em `tiktok_shop`.

### F7 — `src/lib/logger.ts` (lista única consolidada)

`CAMPOS_SENSIVEIS` ganha, além dos do R2-PG e do R2-C, `"access_token"`, `"refresh_token"`, `"page_access_token"`, `"client_secret"` e `"auth_code"`.

### F8 — `src/lib/db/schema/conversas/mensagens.ts` (tipo único consolidado, sem migração)

```ts
export type MetadadosMensagem = {
  tipo_original?: string;
  story_url?: string;
  encaminhada?: boolean;
  citacao_externa_id?: string;
  /** TikTok: `conversation_id` do provedor, exigido para responder (ADR 0052). */
  conversa_externa_id?: string;
  /** Quem originou a saida. So `pessoa` pode usar HUMAN_AGENT no Messenger (ADR 0052). */
  origem_envio?: "pessoa" | "automatica";
  erro_provedor?: { codigo: string; mensagem: string };
  card?: { tipo: "produto" | "pedido" | "pagamento" | "lookbook"; id: string };
};
```

E a linha de `conversas_mensagens.metadados` em `01-dados.md §10`, mais o schema Zod de metadados onde M1 o declarou (M1-3).

### F9 — `src/lib/canais/regras-de-envio.ts` (novo, completo; dono FUNDAÇÃO) e `tests/unidade/regras-de-envio.test.ts`

Criado **completo** porque M1 (delta M1-4/M1-5) e o R2-D o consomem; o R2-D só lê.

```ts
import type { Provedor } from "@/lib/db/schema/_enums/plataforma";

/**
 * Regras de envio por provedor (ADR 0052). PURO: sem I/O e sem `server-only`.
 * Fonte UNICA da janela de resposta e dos tetos de texto e midia dos canais do
 * R2: o registro do envio, o processador de saida e o DTO da conversa leem
 * daqui. Nenhum outro arquivo compara `ultima_entrada_em` com o relogio para
 * decidir se pode enviar.
 */

export type SituacaoDaJanela = "aberta" | "so_agente_humano" | "so_modelo" | "fechada";

/** `pessoa` = digitada por alguem da equipe (acao com sessao); o resto e `automatica`. */
export type OrigemDoEnvio = "pessoa" | "automatica";

type Regra = {
  /** Horas desde a ultima entrada da cliente; `null` = sem janela. */
  horas: number | null;
  /** Depois de `horas` e ate este limite, so resposta de pessoa (Messenger). */
  horasAgenteHumano?: number;
  /** O que vale depois da janela e quando a cliente nunca escreveu. */
  depois: "so_modelo" | "fechada";
  /** Nome do canal na frase ("O Messenger so deixa..."). */
  nome: string;
};

export const JANELAS: Readonly<Partial<Record<Provedor, Regra>>> = {
  whatsapp_oficial: { horas: 24, depois: "so_modelo", nome: "O WhatsApp" },
  uazapi: { horas: null, depois: "fechada", nome: "O WhatsApp" },
  instagram: { horas: 24, depois: "fechada", nome: "O Instagram" },
  // CONFIRMADO: 24 h + HUMAN_AGENT ate 7 dias (Meta, send-messages, 16/09/2026).
  facebook: { horas: 24, horasAgenteHumano: 168, depois: "fechada", nome: "O Messenger" },
  // CONFERIR-TIKTOK: 48 h (SleekFlow, Qiscus, Chatwoot; doc oficial ilegivel em 16/09/2026).
  tiktok: { horas: 48, depois: "fechada", nome: "O TikTok" },
};

const HORA_MS = 3_600_000;

function horasDesde(ultimaEntradaEm: Date, agora: Date): number {
  return (agora.getTime() - ultimaEntradaEm.getTime()) / HORA_MS;
}

/** Provedor fora de `JANELAS` FECHA: canal sem regra nao envia. */
export function situacaoDaJanela(
  provedor: string,
  ultimaEntradaEm: Date | null,
  origem: OrigemDoEnvio,
  agora: Date,
): SituacaoDaJanela {
  const regra = JANELAS[provedor as Provedor];
  if (!regra) return "fechada";
  if (regra.horas === null) return "aberta";
  if (!ultimaEntradaEm) return regra.depois;
  const horas = horasDesde(ultimaEntradaEm, agora);
  if (horas <= regra.horas) return "aberta";
  if (regra.horasAgenteHumano !== undefined && horas <= regra.horasAgenteHumano) {
    return origem === "pessoa" ? "so_agente_humano" : "fechada";
  }
  return regra.depois;
}

/** Texto para o composer e para `falha_motivo`. `null` quando a janela esta aberta. */
export function mensagemDaJanela(
  provedor: string,
  ultimaEntradaEm: Date | null,
  origem: OrigemDoEnvio,
  agora: Date,
): string | null {
  const situacao = situacaoDaJanela(provedor, ultimaEntradaEm, origem, agora);
  const regra = JANELAS[provedor as Provedor];
  if (situacao === "aberta") return null;
  if (!regra) return "Este canal não permite enviar mensagem.";
  if (situacao === "so_modelo") {
    return "Passaram 24h desde a última mensagem da cliente. Só dá para enviar um modelo aprovado.";
  }
  if (situacao === "so_agente_humano") {
    return "Passaram 24 horas desde a última mensagem da cliente. Sua resposta vai marcada como atendimento humano e só vale até 7 dias depois dela.";
  }
  if (!ultimaEntradaEm) {
    return `A cliente ainda não escreveu por este canal. ${regra.nome} só deixa responder depois que ela escrever.`;
  }
  const horas = horasDesde(ultimaEntradaEm, agora);
  if (regra.horasAgenteHumano !== undefined && horas <= regra.horasAgenteHumano) {
    return `Passaram ${regra.horas} horas desde a última mensagem da cliente. Agora ${regra.nome.replace(/^O /, "o ")} só aceita resposta digitada por alguém da equipe.`;
  }
  const prazo = regra.horasAgenteHumano !== undefined ? "7 dias" : `${regra.horas} horas`;
  return `Passaram ${prazo} desde a última mensagem da cliente. ${regra.nome} só deixa responder quando ela escrever de novo.`;
}

type MidiaAceita = {
  /** `null` = qualquer MIME que a casa aceita. */
  mimes: readonly string[] | null;
  maxBytes: number;
  maxArquivos: number;
  semLegenda: boolean;
  recusa: string;
};

const MB = 1024 * 1024;

export const MIDIA_ACEITA: Readonly<Partial<Record<Provedor, MidiaAceita>>> = {
  // CONFERIR-MESSENGER: 25 MB por anexo (CM.com, 16/09/2026); os tetos da casa cortam antes.
  facebook: {
    mimes: null,
    maxBytes: 25 * MB,
    maxArquivos: 10,
    semLegenda: false,
    recusa: "O Messenger aceita anexos de até 25 MB.",
  },
  // CONFERIR-TIKTOK: uma imagem JPG/PNG de ate 3 MB, sem legenda (Chatwoot, 16/09/2026).
  tiktok: {
    mimes: ["image/jpeg", "image/png"],
    maxBytes: 3 * MB,
    maxArquivos: 1,
    semLegenda: true,
    recusa: "O TikTok só aceita uma imagem JPG ou PNG de até 3 MB por mensagem, sem texto junto.",
  },
};

/** Texto da recusa, ou `null`. Provedor fora da tabela: vale so o teto da casa. */
export function recusaDeMidia(
  provedor: string,
  anexos: readonly { mime: string; bytes: number }[],
  temLegenda: boolean,
): string | null {
  const regra = MIDIA_ACEITA[provedor as Provedor];
  if (!regra || anexos.length === 0) return null;
  if (anexos.length > regra.maxArquivos || (regra.semLegenda && temLegenda)) return regra.recusa;
  const invalido = anexos.some(
    (a) => a.bytes > regra.maxBytes || (regra.mimes !== null && !regra.mimes.includes(a.mime.toLowerCase())),
  );
  return invalido ? regra.recusa : null;
}

// CONFERIR-MESSENGER: 2.000 (CM.com). CONFERIR-TIKTOK: sem fonte; 1.000 e baixo de proposito.
export const TEXTO_MAX: Readonly<Partial<Record<Provedor, number>>> = { facebook: 2000, tiktok: 1000 };

/** Recusa de texto longo, ou `null`. Provedor fora da tabela: vale o limite de M1. */
export function recusaDeTexto(provedor: string, texto: string): string | null {
  const max = TEXTO_MAX[provedor as Provedor];
  if (max === undefined || texto.length <= max) return null;
  const regra = JANELAS[provedor as Provedor];
  return `${regra?.nome ?? "Este canal"} aceita até ${max.toLocaleString("pt-BR")} caracteres por mensagem.`;
}
```

`tests/unidade/regras-de-envio.test.ts` (fundação): tabela de `situacaoDaJanela` com `whatsapp_oficial`, `uazapi`, `instagram`, `facebook` (2 h/30 h/8 dias × `pessoa`/`automatica`), `tiktok` (47 h/49 h), sem entrada e provedor desconhecido (`bling`, `tiktok_shop`, `"x"` → `fechada`); os textos exatos de `mensagemDaJanela` para cada linha da §7.4; `recusaDeMidia` (PNG 2 MB ok; MP4, PNG 4 MB, duas imagens e imagem com legenda recusados no TikTok; 26 MB recusado no Messenger; provedor fora da tabela → `null`); `recusaDeTexto` (2.001 no Messenger, 1.001 no TikTok, qualquer tamanho no uazapi → `null`). A trava `canais-extras` do R2-D confere os marcadores `CONFERIR-`/`CONFIRMADO:` também neste arquivo.

### F10 — Costuras (dono R2-D; a fundação cria com a assinatura final)

`src/lib/canais/facebook/adaptador.ts`:

```ts
import { naoImplementado } from "@/lib/erros";
import type { AdaptadorDeCanal, ContaDeCanal } from "../tipos";

/** COSTURA — dono: R2-D. Fabrica do adaptador do Messenger (ADR 0050). */
export function criarAdaptadorFacebook(_conta: ContaDeCanal): AdaptadorDeCanal {
  throw naoImplementado("adaptador do Messenger (pacote R2-D)");
}
```

`src/lib/canais/tiktok/adaptador.ts`: idem, `criarAdaptadorTiktok`, mensagem `"adaptador do TikTok (pacote R2-D)"`, ADR 0051.

`src/lib/canais-extras/index.ts`:

```ts
import "server-only";
import { naoImplementado } from "@/lib/erros";

/**
 * COSTURA — dono: R2-D (canais extras). API publica consumida por M1 (envio e
 * ingestao do TikTok) e por M5 (job diario `renovar-token`).
 */

export async function garantirTokenTiktok(lojaId: string, integracaoId: string): Promise<void> {
  throw naoImplementado(`garantirTokenTiktok [loja ${lojaId}, conta ${integracaoId}] (pacote R2-D)`);
}

export async function destinoTiktok(lojaId: string, conversaId: string): Promise<string | null> {
  throw naoImplementado(`destinoTiktok [loja ${lojaId}, conversa ${conversaId}] (pacote R2-D)`);
}

/**
 * Sem o pacote R2-D nao existe como conectar conta `facebook` ou `tiktok`:
 * nada a conferir. No-op de proposito, para o job diario nao falhar antes dele.
 */
export async function conferirContasCanaisExtras(): Promise<void> {
  return;
}
```

`src/app/(app)/configuracoes/integracoes/_components/conectar-canais-extras.tsx`:

```tsx
/**
 * COSTURA — dono: R2-D (spec r2/final-r2d-canais-extras.md §7).
 * Cartoes de conexao do Messenger e do TikTok. Pagina de M5, arquivo do R2-D.
 * Server component: busca a disponibilidade pela action `lerCanaisExtras`.
 */
export async function ConectarCanaisExtras(_props: {
  lojas: readonly { id: string; nome: string }[];
}) {
  return null;
}
```

Acrescentar à tabela de costuras (`05-plano §5`):

| Arquivo-costura | Assinatura | Dono depois |
|---|---|---|
| `src/lib/canais/facebook/adaptador.ts` | `criarAdaptadorFacebook(conta: ContaDeCanal): AdaptadorDeCanal` | R2-D — consumido por M1 (`registro.ts`) |
| `src/lib/canais/tiktok/adaptador.ts` | `criarAdaptadorTiktok(conta: ContaDeCanal): AdaptadorDeCanal` | R2-D — idem |
| `src/lib/canais-extras/index.ts` | `garantirTokenTiktok`, `destinoTiktok`, `conferirContasCanaisExtras` | R2-D — consumido por M1 e M5 |
| `src/app/(app)/configuracoes/integracoes/_components/conectar-canais-extras.tsx` | `<ConectarCanaisExtras lojas />` | R2-D — renderizado pela página de M5 |
| `src/lib/canais/regras-de-envio.ts` | `situacaoDaJanela`, `mensagemDaJanela`, `recusaDeMidia`, `recusaDeTexto` | fundação (completo) — consumido por M1 e R2-D |

### F11 — `tests/seguranca/escopo-loja.test.ts`

Em `PASTAS_DE_DOMINIO`, acrescentar `"src/lib/canais-extras/",` depois de `"src/lib/integracoes/",`.

### F12 — Mapa de donos (`05-plano §8`) e índice Redis (`05-plano §3.3`)

| Caminho | Dono |
|---|---|
| `src/lib/canais/facebook/**`, `src/lib/canais/tiktok/**`, `src/lib/canais-extras/**`, `src/lib/actions/canais-extras.ts`, `src/lib/validadores/canais-extras.ts`, `src/app/api/webhooks/facebook/**`, `src/app/api/webhooks/tiktok/**`, `src/app/api/integracoes/tiktok/**`, `src/app/(app)/configuracoes/integracoes/_components/{conectar-canais-extras,dialogo-conectar-facebook,dialogo-conectar-tiktok}.tsx`, `tests/*/canais-extras-*`, `tests/travas/canais-extras.test.ts`, `tests/fixtures/canais-extras/**`, `docs/modulos/canais-extras.md` | R2-D |
| `src/lib/canais/regras-de-envio.ts`, `tests/unidade/regras-de-envio.test.ts`, `tests/seguranca/maquina-balde.test.ts` | FUNDAÇÃO (delta R2) |

Nota de rodapé: "exceções nominais dentro de `src/lib/canais/**` (M1), `src/app/api/webhooks/**`, `src/app/api/integracoes/**` e `src/app/(app)/configuracoes/integracoes/**` (M5)". Tabela §3.3: linha `R2-D | merlostore_test_r2d | 12`.

### M/E — contribuição do R2-D aos deltas únicos de módulo (aplicar depois que o módulo fechar)

**M1-1 — `src/lib/canais/tipos.ts`**
- `Provedor` inclui `"tiktok"` (se M1 repetiu a união; se importou de `_enums/plataforma`, nada a fazer).
- `Canal` inclui `"facebook" | "tiktok"`.
- Novo: `export type OpcoesEnvio = { /** Messenger entre 24 h e 7 dias, só pessoa (ADR 0052). */ agenteHumano?: boolean; /** Id externo da mensagem citada. */ respondendoA?: string };`
- `enviarTexto(destino: string, texto: string, opcoes?: OpcoesEnvio)` e `enviarMidia?(destino: string, m: MidiaParaEnvio, opcoes?: OpcoesEnvio)` — terceiro parâmetro opcional; as três implementações do R1 continuam compilando.
- `MensagemNormalizada` ganha `conversaExterna?: string; // TikTok: conversation_id, exigido para responder`.
- **Remove** `exigeJanela24h` do contrato e das três implementações; todo leitor passa a `situacaoDaJanela` (F9).
- Exporta `ContaDeCanal` = o tipo do parâmetro de `criarAdaptador` (se ainda não exporta).
- Comentário de `Provedor`: "`tiktok_shop`, `bling` e os de pagamento NÃO têm adaptador de canal".
- Teste: nenhum arquivo de `src/` contém `exigeJanela24h` (vai na trava `canais-extras`).

**M1-2 — `src/lib/canais/registro.ts`**: no `switch (conta.provedor)`, `case "facebook": return criarAdaptadorFacebook(conta);` e `case "tiktok": return criarAdaptadorTiktok(conta);`, com os imports de `./facebook/adaptador` e `./tiktok/adaptador`; `tiktok_shop`, `bling` e os de pagamento continuam lançando `ErroDeConfiguracao("provedor não habilitado")`.

**M1-3 — ingestão (`processar-evento` e o módulo de ingestão de M1)**
- Mapa provedor → coluna de contato: `facebook → "facebook_id"`, `tiktok → "tiktok_id"` (sem telefone).
- `mensagem.conversaExterna` presente → `metadados.conversa_externa_id` (e o schema Zod de metadados de M1 aceita a chave).
- Mídia com `idExterno` e **sem** `url`, quando o adaptador tem `baixarMidia`: **antes** de abrir a transação, `if (provedor === "tiktok") await garantirTokenTiktok(lojaId, integracaoId)`, depois `adaptador.baixarMidia(idExterno)`; dentro da transação, `guardarMidiaRecebida(tx, { lojaId, origem: provedor, bytes, tipoMime: mime }, ctx)` e o anexo nasce com `midia_id`, `externo_id = idExterno`, `mime_type` detectado e `baixada = true`. `ErroDeIntegracao` transitório → lança (o job retenta); permanente → a mensagem é gravada **sem** a linha de anexo, com `metadados.erro_provedor = { codigo: "midia_indisponivel", mensagem: "A mídia não pôde ser baixada do canal." }`. O caminho é genérico (presença de `baixarMidia` e ausência de `url`), não um `if` por provedor além do token.
- Mídia com `url` (Messenger): igual ao Instagram — anexo com `url_externa` e `agendarDownload({ lojaId, anexoId, provedor: "facebook" })`.
- Contato sem nome e sem telefone: a tela mostra `Cliente do ${rotuloDoCanal(provedor)}`; nada é gravado em `contatos.nome`.
- Teste de M1: evento `facebook` e `tiktok` com fixture do R2-D processados ponta a ponta.

**M1-4 — saída (registro do envio e processador `enviar-mensagem`/`reenviar`)**
- No ponto único que grava a mensagem de saída (`registrarEnvio` e o caminho do composer, se forem diferentes): `metadados.origem_envio = ctx.origem === "ui" ? "pessoa" : "automatica"`.
- Só para `origem_envio = "pessoa"` e mensagem que não é nota interna, antes de gravar: `situacaoDaJanela(...)` = `fechada`, ou `so_modelo` sem modelo → `ErroDeValidacao({ conteudo: [mensagemDaJanela(...)] })`; `recusaDeMidia(...)` → `ErroDeValidacao({ midias: [texto] })`; `recusaDeTexto(...)` → `ErroDeValidacao({ conteudo: [texto] })`.
- No processador, **antes** de abrir transação e de carregar a conta: `if (provedor === "tiktok") await garantirTokenTiktok(lojaId, integracaoId)`. Depois: `situacao = situacaoDaJanela(provedor, conversa.ultima_entrada_em, metadados.origem_envio ?? "automatica", agora)`; `fechada` (ou `so_modelo` sem modelo) → `falhou` **permanente** com `mensagemDaJanela(...)`, sem chamar o provedor; `recusaDeMidia`/`recusaDeTexto` → `falhou` permanente com o texto; `opcoes = { agenteHumano: situacao === "so_agente_humano", respondendoA }`.
- Destino: `facebook → contato.facebook_id`; `tiktok → await destinoTiktok(lojaId, conversaId)`, nulo → `falhou` permanente "Não há conversa aberta no TikTok com esta cliente.".
- Ritmo por conta (§8.4): `facebook: 5`, `tiktok: 1` msg/s.

**M1-5 — DTO da conversa e composer**: o DTO ganha `janela: { situacao: SituacaoDaJanela; mensagem: string | null }`, calculado no servidor com `origem = "pessoa"`. O composer lê daí: `fechada`/`so_modelo` = caso 1 de `04 §5.2` (bloqueia; `so_modelo` → [Escolher modelo]; `fechada` → [Ver outras conversas do contato] quando houver, senão [Escrever nota interna]); `so_agente_humano` → faixa `info` não bloqueante com a mensagem. Textos da §7.4. Esta é a parte do R2-D no slot único do composer (as costuras de IA e lookbook são dos outros clusters).

**M2-1 — `anonimizarContato`**: no `UPDATE` de `conversas_mensagens` do titular, `metadados = metadados - 'conversa_externa_id'`; conferir que `facebook_id` e `tiktok_id` já são limpos. `tests/integracao/lgpd-anonimizacao.test.ts` passa a criar uma mensagem com `conversa_externa_id` e prova que a chave some. `01-dados-dominio.md §8` atualizado.

**M3-1 — `src/lib/midias/ingestao.ts`** (commitado em HEAD): a linha de `provedorDeBusca` passa a

```ts
  if (origem === "whatsapp_oficial" || origem === "instagram" || origem === "facebook") return "meta";
```

e o comentário de `MidiaRecebida.origem` cita `facebook` e `tiktok`. `tiktok` continua caindo no erro permanente (TikTok nunca usa URL). Teste de M3: `provedorDeBusca("facebook") === "meta"`; `provedorDeBusca("tiktok")` lança.

**M5-1 — `src/lib/integracoes/catalogo-provedores.ts`**: `facebook` e `tiktok` marcados como conexão própria (fora do formulário genérico de token — senão o Messenger conectaria sem assinar a página), rótulos "Facebook Messenger" e "TikTok (mensagens)"; `tiktok_shop` fora de qualquer lista de conectáveis. Teste de M5: o formulário genérico não oferece `facebook`, `tiktok` nem `tiktok_shop`.

**M5-2 — `src/app/(app)/configuracoes/integracoes/page.tsx`**: abaixo da lista de contas, `<Suspense fallback={<EsqueletoTabela linhas={2} />}><ConectarCanaisExtras lojas={lojas} /></Suspense>` (as lojas que a página já carrega, `{ id, nome }`).

**M5-3 — `src/app/(app)/configuracoes/integracoes/[id]/page.tsx`**: para `provedor in ("facebook","tiktok")`, sem o formulário genérico de reautenticação; texto "Para reconectar, use o cartão do canal em Integrações." com link para `/configuracoes/integracoes`.

**M5-4 — `src/server/processadores/integracoes.ts`**, `renovarToken`: depois do Bling, `await conferirContasCanaisExtras();` (import de `@/lib/canais-extras`).

**M5-5 — lista branca do diário**: a função de cabeçalhos do diário acrescenta `tiktok-signature` **só como presença** (`"presente"`), igual a `x-hub-signature-256`; `01-dados.md §10` atualizado.

**E-1 — SLA (delta do R2-E)**: `PROVEDORES_DE_CONVERSA` inclui `"tiktok"` (e não inclui `tiktok_shop`, `bling` nem os de pagamento) e `PRAZO_SLA_PADRAO_MIN` tem `facebook: 30` e `tiktok: 60` — **só** em `src/lib/sla/prazo.ts`. Até essa costura substituir `SLA_MINUTOS`, o `CASO_SLA` de `src/lib/alertas/_consultas.ts` (M8) não tem `else`: conversa `tiktok` teria prazo nulo e **nunca** geraria `sla_estourado`. O teste de aceite do R2-E prova `tiktok → 60`.

**M6 e M8**: nenhuma mudança. M6 já restringe campanha a WhatsApp (`PROVEDORES_DE_CAMPANHA`, HEAD `6c135de`); o R2-D prova com teste próprio. O `integracao_com_erro` de M8 (HEAD `e88d181`) já cobre qualquer provedor ≠ `uazapi` com `status in ('erro','expirado')`.

### X — Itens transversais (parte do R2-D)

- **X-1 — Migração única `0018_r2`**: o R2-D contribui só com `tiktok` nas duas listas de F1 (e, via E-1, em `lojas_sla_provedor_lista`). Nenhuma tabela, coluna, índice ou SQL custom; `TOTAL_TABELAS` e as outras contagens não mudam por causa do R2-D.
- **X-2 — Pasta de mutações**: o R2-D **não** acrescenta helper; usa `inserirAuditado`, `atualizarComTrava`, `atualizarContador` e `registrarAuditoria`.
- **X-3 — Embrulho sem transação (`executarAcaoExterna`, ADR 0049)**: a lista fechada de arquivos que podem usá-lo passa a `src/lib/actions/pagamentos.ts`, `src/lib/actions/inteligencia.ts` **e `src/lib/actions/canais-extras.ts`** (em `tests/seguranca/guarda.test.ts`). Motivo: `conectarPaginaFacebook` chama a Meta duas vezes (até 16 s) e não pode segurar conexão do pool.
- **X-4 — Contexto de sistema**: o R2-D usa o único `contextoDeSistema(lojaId, "worker")` de `src/lib/auth/sistema.ts`; não cria outro.
- **X-5 — Diário de ingestão**: o R2-D consome **a** função única de diário e **a** lista branca de cabeçalhos, no caminho que a consolidação fixar (API pública de `@/lib/integracoes`, que reexporta se a função morar na pasta de mutações). Contrato exigido: grava sem transação de domínio com `ON CONFLICT DO NOTHING` em `(provedor, evento_externo_id)`; aceita `integracaoId`/`lojaId` nulos e `tipo` em `recebido | recusado | descartado`; devolve `{ id, novo, pendente }`, com `pendente = (tipo = 'recebido' e processado_em is null)` **sem piso de tempo** (§12).
- **X-6 — Rótulos da trilha, block de 3 s, navegação, permissões**: nenhuma contribuição (nenhuma ação auditada nova, nenhuma ação crítica nova, nenhum item de menu, nenhuma chave).
- **X-7 — Índice Redis 12, ADRs 0050–0053.**

### F13 — Documentos da especificação e do repositório

- `00-visao.md`, `01-dados.md §11 item 7 e §13.4`, `02-seguranca.md S-16 e §19`, `03-arquitetura.md §4.2 (módulo \`canais-extras\`), §10.2 e §22`: "TikTok · Facebook" sai de "Fora do R1" para "R2: Messenger e TikTok DM (ADR 0050/0051)"; "TikTok Shop" continua fora, com o motivo.
- `01-dados.md §6.3` (valores e credenciais de `facebook`/`tiktok`, `expira_em` do TikTok = refresh), `§10` (metadados e cabeçalhos), `§16.3` (`PROVEDORES`).
- `02-seguranca.md §12`: a linha "Facebook, TikTok Shop" vira três — Messenger (HMAC Meta + `FACEBOOK_VERIFY_TOKEN`), TikTok DM (HMAC do app + `t` ±300 s; OAuth igual ao Bling), TikTok Shop (não existe); e o texto de F5. `§18`: as quatro variáveis novas.
- `03-arquitetura.md §5` (três rotas novas; "Não existem …" mantém só `/api/webhooks/tiktok-shop`), `§10.1` (M1-1), `§11` (F5 e as duas linhas de roteamento), `§12.4` (F4), `§15` (tirar `FACEBOOK_VERIFY_TOKEN`/`TIKTOK_*` de "sumiram de propósito", com "voltaram no R2, ADR 0050/0051").
- `04-ui.md §5.2` (caso 1 por canal, §7.4 deste documento) e `§5.6` (cartões).
- `docs/seguranca/runbook.md` (linha 133): "`FACEBOOK_VERIFY_TOKEN` e `TIKTOK_SHOP_APP_SECRET` não existem" vira "`TIKTOK_SHOP_APP_SECRET` não existe; `FACEBOOK_VERIFY_TOKEN` e `TIKTOK_*` são do R2-D" + a regra "um app Meta e um app TikTok por ambiente; o endereço de entrega do app TikTok nunca é sobrescrito pelo sistema".
- `docs/regras-negocio.md` (linha 200): tirar "TikTok, Facebook" da lista de fora; acrescentar a seção "Canais extras" com R2-CE-01..20.
- `docs/integracoes.md`: nota no topo — "TikTok Shop não é construído (ADR 0051); TikTok no R2 é mensagem direta".

### F14 — ADRs

A fundação cria `docs/adr/0050-*.md` a `0053-*.md` (§11) e as linhas no índice `docs/adr/README.md` (a onda não edita `docs/adr/`).

---

## 11. ADRs a criar

| ADR | Título | Decisão (3 linhas) |
|---|---|---|
| **0050** | Facebook Messenger como canal de mensagem | Entra no R2 pela Send API: token de página colado, validado por `/me` e página assinada no app antes de `conectado`; webhook próprio com `FACEBOOK_VERIFY_TOKEN` e o HMAC do app; **um app Meta por ambiente**. Conservador: sem eco (respostas pelo Meta Business Suite não aparecem), estado para em `enviada`, sem busca de nome na Graph, tipos fora da lista descartados com registro, PSID por página (duas páginas = dois contatos). Perguntas ao cliente: usam Messenger hoje? quantas páginas e em quais lojas? respondem pelo Business Suite? |
| **0051** | TikTok no R2 é só mensagem direta; TikTok Shop fica fora | Provedor novo `tiktok` (Business Messaging API, OAuth por conta com contexto de uso único, 48 h, texto e uma imagem JPG/PNG ≤ 3 MB), desligado com aviso enquanto o app não for aprovado; **um app por ambiente**, endereço de entrega registrado só se vazio, na conexão feita por pessoa, nunca sobrescrito (divergência = conexão recusada e contas em `erro`). TikTok Shop não é construído: catálogo/pedidos já chegam ao Bling pela integração nativa, não há tabela para pedido de marketplace e o atendimento do Shop exige 1.000 lojistas. Perguntas ao cliente: vendem no TikTok Shop (então ligar a extensão do Bling)? a conta comercial é registrada no Brasil? |
| **0052** | Regras de envio por provedor em módulo puro; `conversa_externa_id` e `origem_envio` em metadados | `src/lib/canais/regras-de-envio.ts` é a fonte única de janela, tetos de texto e mídia (registro, fila e composer); `exigeJanela24h` sai do contrato; Instagram passa a bloquear no composer depois de 24 h. `HUMAN_AGENT` só para `origem_envio = 'pessoa'`, gravado só com sessão (`ctx.origem === "ui"`); agendada e campanha nunca. O `conversation_id` do TikTok fica em `metadados.conversa_externa_id`, lido da última entrada; anonimização remove a chave; reverter = coluna própria com migração |
| **0053** | Detalhe de API não confirmado preso em `config.ts` com CONFERIR | Endpoints, cabeçalhos, formato de assinatura, eventos, códigos e limites que não puderam ser lidos na documentação oficial vivem só em `canais/{facebook,tiktok}/config.ts` (e horas/tetos em `regras-de-envio.ts`), cada constante com `CONFERIR-<CANAL>` ou `CONFIRMADO:` e a fonte datada. Uma trava reprova essas strings fora dos arquivos (exceção: a linha de hosts em `buscarExterno.ts`) e exige o marcador. A conferência em HML é item do aceite; confirmar é trocar o marcador; assinatura errada falha fechada |

A correção do teto por integração (F5) **não** vira ADR: é conformidade com o REQ-I4 do catálogo, que já pedia "balde por IP e só depois da autenticação balde por integração"; o registro é o commit `fix(seguranca)` e a atualização de `02 §12`.

---

## 12. Conformidade com a consolidação do R2

| Item da crítica | Posição final do R2-D |
|---|---|
| Migração 0018 por cluster (bloqueante) | sem migração própria; contribui com `tiktok` nas listas da `0018_r2` (F1, X-1) |
| Contagens de schema (alta) | o R2-D não cria tabela, coluna, FK nem gatilho: nenhuma contagem muda por causa dele |
| `mutacoes.ts` acima de 500 linhas (alta) | nenhum helper novo (X-2) |
| Dois embrulhos sem transação (alta) | usa o único `executarAcaoExterna` (ADR 0049) e amplia a lista fechada com `actions/canais-extras.ts` (X-3) |
| Deltas em arquivos de M1 (alta) | contribuição única e sequencial M1-1..M1-5; `EnvioParaRegistrar` **não** ganha campo por causa do R2-D (a origem vem de `ctx.origem`) |
| Deltas em arquivos de M2/M4/M8 (alta) | M2-1 só; M4 e M8 intocados (o alerta de conta já é genérico; o SLA vai por E-1) |
| Índice Redis (alta) | 12 |
| ADRs sobrepostos (média) | 0050–0053, sem sobreposição |
| Block de 3 s, navegação, permissões, rótulos da trilha (média) | nenhuma contribuição (X-6) |
| `buscarExterno` alterado de três formas (média) | texto único em F4, com PUT, `FormData`, `timeoutMs`, recusa de salto em não-GET e credencial descartada em troca de host |
| `rotas-publicas.ts` com `dono` divergente (média) | `"fundacao" \| "M5" \| "R2-PG" \| "R2-D"` (F3) |
| Credencial atravessando redirect (baixa) | F4 + teste de SSRF |
| Mapa de donos (média) | F12, com as exceções nominais |
| Teste com nome errado (baixa) | `tests/seguranca/ssrf.test.ts` (F4) |
| HEAD desatualizado (baixa) | base `9481ef8` para a fundação; módulos citados pelo commit em que entraram |
| Piso de 2 min para reenfileirar (divergência com o rascunho do R2-PG) | **sem piso** (X-5). Com o piso, a Meta que reentrega em segundos depois de um 500 encontra o evento "novo demais", recebe 200 e para de reentregar — a mensagem da cliente se perde. O `jobId` determinístico já impede job duplicado |

---

## 13. Problemas rejeitados ou resolvidos de outro jeito

| Crítica | O que foi pedido | O que foi feito e por quê |
|---|---|---|
| r2d · alta · webhooks travados por rajada sem assinatura | "`chave(req)` devolve `null` nas rotas assinadas pelo app" | **Resolvido de outro jeito.** No `rotaDeMaquina` de HEAD, `chave` nula faz `carregar` não rodar e a rota recusa **toda** requisição (401), inclusive a assinada: a correção proposta derrubaria os dois canais. Adotado: o balde por integração passa a contar só depois de autenticar (F5, vale para todas as rotas de máquina, conforme REQ-I4) e aceita `limiteIntegracao: null`, que as duas rotas do R2-D usam. O teste pedido (301 sem assinatura + 1 assinado → 200) está no aceite 4 e em `maquina-balde.test.ts` |
| r2d · média · reescrita do callback do TikTok | "+ alerta `integracao_com_erro`" no momento da recusa | **Em parte.** Na recusa da conexão não existe conta (nada foi gravado), e o `alertas` é escrito só pelo gerador de M8 a partir do estado das contas; o canal de alerta da fundação (`alertar`) é de segurança, com texto fixo que aponta para `/auditoria/seguranca`. Adotado: erro legível para quem está conectando (dono/admin, o público certo), `logger.warn`, e a conferência diária (só leitura) põe as contas existentes em `erro` quando o endereço diverge — aí o gerador de M8 emite `integracao_com_erro`. O resto da correção foi adotado integralmente: um app por ambiente, leitura antes de escrever, recusa sem alterar nada, nenhuma reescrita periódica, escrita só na conexão feita por pessoa, com trilha, e o teste "endereço diferente → nada é reescrito" (aceite 11 e 13) |
| geral · alta · deltas de M1 | "um slot no composer para as três costuras (…, bloqueio por `situacaoDaJanela`)" | **Em parte.** O bloqueio por janela não é componente: é lógica do composer que já existe (caso 1 de `04 §5.2`). O R2-D entrega o dado pronto no DTO (`janela`, M1-5) e o composer o lê; não há componente-costura do R2-D no composer. As costuras de componente (IA, lookbook) seguem com os clusters donos |

Todos os demais pontos da crítica foram adotados como pedido (ver §12).
