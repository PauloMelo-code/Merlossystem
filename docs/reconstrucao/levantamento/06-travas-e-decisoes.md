# 06 — Travas e decisões que a reconstrução precisa carregar

Levantamento READ-ONLY do MerlostoreChat (branch `refactor/reconstrucao-estrutura-base`, código de referência no commit `5e902d4`, 18/08/2026). Lidos: os 24 arquivos de `tests/` (23 testes + `tests/rotas.ts`), `docs/api.md`, `docs/rbac.md`, `docs/oauth.md`, `docs/back.md`, `docs/front.md`, `docs/integracoes.md`, `docs/regras-negocio.md`, `docs/deploy-easypanel.md`, `docs/adr/0001..0007`, `.agents/rules/merlostore-chat.md`, `CLAUDE.md` do repo e o fonte que os testes apontam (para confirmar comportamento real e achar furos).

Legenda de destino: **MANTER** = invariante e mecanismo valem; **MANTER-INV** = invariante vale, mecanismo muda na stack nova; **REVER** = decisão precisa ser refeita com justificativa; **DESCARTAR** = não se aplica mais.

---

## 1. Aviso: a documentação antiga diverge do código (não desenhar a partir dela sem conferir)

Os testes e o fonte são mais novos que boa parte dos docs. Onde divergem, **vale o teste**.

| Doc diz | Realidade (teste/fonte) |
|---|---|
| 50 rotas, 9 públicas (`api.md:3,22`; `rbac.md:23,89` "48 protegidas") | 69 rotas, 12 públicas, 57 protegidas (`tests/api-publica.test.ts:33-47`, `tests/rbac.test.ts:19-22`) |
| Tabela RBAC com papel `agent` (`api.md:57-65`), `GET /api/lgpd` e `/api/activity-logs` só admin | Papéis `admin/gerente/vendedor/viewer`; LGPD e trilha seguem o padrão (GET para todos, inclusive viewer) (`src/lib/rbac.ts:34-89`, `tests/rbac.test.ts:83-98`) |
| uazapi usa `phone_id` + `access_token` (`api.md:587`) | uazapi = `["token"]`; `whatsapp_oficial` = `phone_id`+`access_token` (`tests/uazapi.test.ts:53-58`) |
| Webhook TikTok autentica por `x-webhook-secret` (`api.md:34,612`) | HMAC-SHA256 de `app_key + corpo cru` no header `Authorization` (`src/app/api/webhooks/tiktok/route.ts:32-38`) |
| Upload/remoção no Cloudinary (`api.md:427,431`; `back.md:34`) | MinIO privado (ADR 0006; `tests/midia-minio.test.ts:58-62`) |
| "Delete físico em 10 rotas", "nenhuma mutação grava ActivityLog" (`api.md:106,123-125`) | Só `/api/lgpd` apaga (`tests/soft-delete.test.ts:63-66`); `registrar()` em 6 rotas (`tests/robustez-fase5.test.ts:225-238`) |
| Leitura de `/api/usuarios` e `/api/lojas` só admin (`integracoes.md:603-606`) | GET aberto a todos os papéis, escrita só admin (`tests/rbac.test.ts:156-182`) |
| "Pedido enviado ao Bling carrega o depósito" (`integracoes.md:117-118`), etapa 8 "escrita no Bling" (`integracoes.md:740`) | Superado pela decisão 8: o sistema **não escreve** em ERP (ADR 0004) |
| `ModalConfirmacaoBlock` "ainda não existe" (`front.md:40`) | Existe em 4 telas: equipe, lojas, pedidos, painel de venda |
| `docs/regras-negocio.md` deveria ter as regras do cliente | Só tem RN-001..005 globais da base; **nenhuma regra do projeto foi registrada lá** — as decisões do cliente vivem em `integracoes.md` e ADR 0004 |

---

## 2. (a) Invariantes a manter

Cada linha: o que precisa continuar verdade, de onde vem, e o destino na reconstrução.

### 2.1 Multi-loja e escopo

| # | Invariante | Origem | Destino |
|---|---|---|---|
| INV-01 | `admin` e `gerente` alcançam todas as lojas; `vendedor` e `viewer` não | `tests/escopo-loja.test.ts:18-26`; decisões 1-2 | MANTER |
| INV-02 | Vendedor/viewer leem só a loja do cadastro; loja pedida por query/cookie é **ignorada** para eles | `escopo-loja.test.ts:29-38`; `src/lib/loja.ts:58-68` | MANTER-INV |
| INV-03 | Gestão sem loja escolhida vê todas; com loja escolhida (`?loja=` ou cookie `loja_ativa`) filtra aquela | `escopo-loja.test.ts:40-47`; `api.md:349-358` | MANTER-INV (validar que a loja existe e não está excluída; hoje aceita qualquer string, `loja.ts:67`) |
| INV-04 | Vendedor sem loja (estado impossível) **fecha** o escopo, nunca abre | `escopo-loja.test.ts:49-53`; `loja.ts:62-66` | MANTER |
| INV-05 | Criar registro: vendedor grava na própria loja ignorando parâmetro; gestão **precisa** informar a loja (senão 400, nunca chutar) | `escopo-loja.test.ts:57-64`; `loja.ts:77-83,112-117` | MANTER |
| INV-06 | Todo handler/ação que toca dado de loja resolve o escopo pela **sessão**; checagem é **por handler**, não por arquivo (um POST escopado cobria um GET furado: 36 handlers vazaram) | `escopo-loja.test.ts:91-172`; `rbac.md:74-85` | MANTER-INV (varredura sobre Server Actions/queries Drizzle) |
| INV-07 | Todo handler que toca dado de loja lê a sessão (o GET de LGPD não lia e exportava dossiê de qualquer loja) | `escopo-loja.test.ts:174-180` | MANTER-INV |
| INV-08 | Criar registro de loja define `store_id` (direto ou herdado do pai); tabelas filhas (eventos, pagamentos, destinatários, mídia de mensagem) são escopadas pelo pai | `escopo-loja.test.ts:182-193` | MANTER (decidir se filhas ganham `loja_id` para simplificar filtro) |
| INV-09 | Registro fora do escopo responde **404, não 403** ("existe mas não é seu" já vaza que o cliente é da rede) | `rbac.md:64-65`; `loja.ts:131-136` | MANTER |
| INV-10 | Ids que chegam no corpo (`contactId`, `templateId`, `productId`, `mediaFileIds`, conta de envio) são conferidos contra a loja já resolvida | `rbac.md:67-72`; `loja.ts:119-130`; `campanha-fase6.test.ts:103-108` | MANTER |
| INV-11 | Rotas em que a loja **é** o recurso (`/api/lojas/**`) são a única exceção explícita ao helper de escopo | `escopo-loja.test.ts:135-146` | MANTER |
| INV-12 | Gateway de entrada exige a loja **antes** de achar/criar contato; busca de contato nunca é global | `escopo-loja.test.ts:196-208`; `gateway.ts:33-58` | MANTER |
| INV-13 | Contato é por loja: a mesma pessoa nas duas lojas = dois contatos, sem sugestão de merge; unicidade de identificador de canal é **por loja** | decisão 5 (`integracoes.md:95-103,294-323`); `schema.prisma:191-195` | MANTER-INV (índices únicos **parciais** `WHERE ... IS NOT NULL AND is_deleted = false`; os do Prisma não são parciais) |
| INV-14 | `users_loja_por_papel`: `admin/gerente` ⇒ `store_id IS NULL`; `vendedor/viewer` ⇒ `NOT NULL`, como CHECK no banco, e a regra da aplicação concorda com o CHECK | `prisma/sql/constraints.sql:9-14`; `tests/usuarios-fase4.test.ts:71-102` | MANTER |
| INV-15 | Chave de objeto de mídia começa pela loja | `midia-minio.test.ts:103-107` | MANTER |

### 2.2 Papéis e RBAC (matriz que precisa sobreviver, qualquer que seja o mecanismo)

| # | Invariante | Origem | Destino |
|---|---|---|---|
| INV-16 | Papéis são exatamente `admin`, `gerente`, `vendedor`, `viewer`, lista única usada por RBAC, cadastro e CHECK; `agent` não existe e não passa em nada | `usuarios-fase4.test.ts:39-68`; `src/lib/usuarios.ts:18` | MANTER |
| INV-17 | Todo papel tem rótulo e descrição para a tela | `usuarios-fase4.test.ts:45-50` | MANTER |
| INV-18 | `admin` passa em tudo | `rbac.test.ts:40-44` | MANTER-INV |
| INV-19 | `viewer` nunca escreve | `rbac.test.ts:46-50` | MANTER-INV |
| INV-20 | `vendedor` nunca exclui; única exceção: cancelar mensagem agendada (é cancelamento lógico) | `rbac.test.ts:52-57,141-144`; `rbac.ts:48-54` | MANTER-INV |
| INV-21 | `gerente` = tudo que o admin faz **exceto configuração e usuário** (integrações, lojas, usuários); inclui excluir, LGPD (inclusive apagar) e ler trilha | `rbac.test.ts:65-81,109-115,146-154`; decisão 7 | MANTER-INV |
| INV-22 | Configuração (integrações, inclusive sessão uazapi) é só admin **em qualquer método**, inclusive leitura | `rbac.test.ts:83-98,146-154` | MANTER-INV |
| INV-23 | `/usuarios` e `/lojas`: leitura para todos (seletor de transferência; "em que loja estou"), escrita só admin; a leitura devolve o mínimo e escopado | `rbac.test.ts:156-182`; `usuarios/route.ts:28-61` | MANTER-INV |
| INV-24 | Vendedor opera o dia a dia: enviar mensagem, editar conversa, criar pedido, editar negócio, reconhecer alerta, registrar opt-out | `rbac.test.ts:117-133` | MANTER-INV |
| INV-25 | Vendedor não apaga contato, produto nem mídia; apagar por LGPD é gestão | `rbac.test.ts:110-125` | MANTER-INV |
| INV-26 | Sem papel, papel vazio ou inventado não passa em nada; método desconhecido só admin; HEAD/OPTIONS contam como leitura | `rbac.test.ts:100-106,184-190`; `rbac.ts:92-109` | MANTER-INV |
| INV-27 | Toda ação protegida resolve para ≥1 papel e nenhum papel citado é inexistente (cobertura calculada do inventário real, não de lista escrita à mão) | `rbac.test.ts:18-37`; `tests/rotas.ts:1-8` | MANTER-INV |
| INV-28 | Menu não oferece área que o papel não pode usar (hoje só filtra o índice de settings; páginas não têm RBAC) | `robustez-fase5.test.ts:270-279`; `settings/page.tsx:60` | MANTER-INV + ampliar (RBAC server-side em página/layout) |

### 2.3 Usuários, autenticação e autoria

| # | Invariante | Origem | Destino |
|---|---|---|---|
| INV-29 | Autoria (`createdBy`, `senderId`, `changedBy`, `acknowledgedBy`, `uploadedBy`, `resolvedBy`, `userId` da trilha) **vem da sessão**; nenhum schema Zod aceita campo de autoria; `assignedTo` é atribuição e pode vir do corpo | `tests/autoria.test.ts:13-89`; `api.md:69-87` | MANTER (vira `modificado_por`/`criado_por` da sessão) |
| INV-30 | Trilha grava `userId` e IP do servidor, nunca do corpo | `autoria.test.ts:91-99` | MANTER-INV (IP só de cabeçalho de proxy confiável) |
| INV-31 | Não dá para ficar sem admin ativo: rebaixar ou desativar o último admin → 409; promover nunca bloqueia; alterar só nome/senha do único admin passa | `usuarios-fase4.test.ts:150-221`; `usuarios.ts:94-113` | MANTER |
| INV-32 | Ninguém desativa o próprio acesso | `usuarios-fase4.test.ts:223-225` | MANTER |
| INV-33 | "Excluir usuário" desativa, nunca apaga (usuário é autor de mensagens, pedidos, trilha) | `usuarios-fase4.test.ts:227-232`; ADR 0005 | MANTER |
| INV-34 | Papel e loja são avaliados no **estado final** da edição | `usuarios-fase4.test.ts:234-238` | MANTER |
| INV-35 | Nenhuma resposta traz hash de senha; lista pública não traz e-mail; detalhe (e-mail, ativo, último acesso, desativados) exige admin **na própria ação**, não só no RBAC | `usuarios-fase4.test.ts:130-148`; `chat-fase3.test.ts:255-272` | MANTER |
| INV-36 | Lista de colegas para transferência: só ativos, filtrada pela loja de quem pergunta + gestão (`store_id` nulo) | `chat-fase3.test.ts:269-271`; `usuarios/route.ts:45-57` | MANTER |
| INV-37 | Regra de senha única entre tela e servidor (mínimo 8 hoje) | `campanha-fase6.test.ts:208-217`; `usuarios-fase4.test.ts:117-122` | MANTER-INV (valor e política passam a seguir a régua Better Auth/NIST) |
| INV-38 | Cadastro de equipe não passa por rota pública; o público só criava o 1º admin | `usuarios-fase4.test.ts:241-255` | REVER (ver seção 5, item T-06) |
| INV-39 | Tela de equipe usa dados reais, papéis vêm da constante, desativar passa por modal block 3s | `usuarios-fase4.test.ts:257-273` | MANTER |
| INV-40 | `callbackUrl` é caminho **relativo** (atrás de proxy `href` virava `0.0.0.0:3000` e era open redirect via Host) | `tests/middleware-proxy.test.ts:22-37` | MANTER-INV (em `proxy.ts`/Better Auth: `callbackURL` só mesma origem) |
| INV-41 | A raiz `/` resolve em um salto; `/login` não recebe `callbackUrl=/` (laço e "React error #310" em produção) | `middleware-proxy.test.ts:39-54` | MANTER-INV |

### 2.4 Superfície pública, webhooks e segredos de máquina

| # | Invariante | Origem | Destino |
|---|---|---|---|
| INV-42 | Rota/ação nova nasce **protegida**; a lista pública é exata (hoje 12: auth, bootstrap, 2 crons, 6 webhooks, 2 callbacks OAuth) e prefixo parecido não libera | `tests/api-publica.test.ts:1-67` | MANTER-INV (Next 16: proxy não é fronteira; exigir guarda em cada handler/ação + varredura) |
| INV-43 | Segredo ausente no ambiente ⇒ rota **recusa (403)**, nunca aceita | `tests/webhook-auth.test.ts:57-61,80-84,115-119,141-145`; `uazapi.test.ts:167-171` | MANTER |
| INV-44 | Meta: HMAC `X-Hub-Signature-256` sobre o **corpo cru**, prefixo `sha256=` obrigatório, comparação em tempo constante; errada 401 | `webhook-auth.test.ts:25-62`; `src/lib/webhook-auth.ts:20-55` | MANTER |
| INV-45 | Challenge de verificação com token **por canal** (o do WhatsApp não vale no Instagram), `hub.mode=subscribe` obrigatório | `webhook-auth.test.ts:64-94` | MANTER |
| INV-46 | Webhook de pagamento exige segredo (`x-webhook-secret` ou `asaas-access-token`) — "POST sem segredo quitava pedido de graça" | `webhook-auth.test.ts:96-120` | MANTER-INV (trocar por assinatura do provedor real) |
| INV-47 | Cron autentica com `Authorization: Bearer <CRON_SECRET>` | `webhook-auth.test.ts:122-146` | MANTER-INV (se o cron virar worker de fila, some) |
| INV-48 | Autenticação do webhook ocorre **antes** de ler/parsear o corpo | `uazapi.test.ts:186-189` | MANTER |
| INV-49 | Webhook autenticado responde 200 mesmo com erro de processamento (sem loop de reentrega); falha de autenticação 401/403 | `api.md:554-556`; `webhooks/tiktok/route.ts:55-58` | MANTER-INV (persistir o evento antes do 200, ver T-15) |
| INV-50 | Callback OAuth é público mas autorizado por `state` assinado | `api-publica.ts:21-25`; `bling.test.ts:28-71` | MANTER |

### 2.5 Roteamento por conta e envio

| # | Invariante | Origem | Destino |
|---|---|---|---|
| INV-51 | Mensagem de entrada carrega a conta externa: WhatsApp `metadata.phone_number_id`; Instagram/Facebook `entry.id`; uazapi `instance`; TikTok `?conta=` na URL | `tests/roteamento.test.ts:20-32`; `integracoes-catalogo.ts:95-100`; `webhooks/tiktok/route.ts:40-47` | MANTER |
| INV-52 | Webhook resolve a **conta** (não só a loja) por `(provedor, referencia_externa)` e repassa a conta inteira ao gateway; nenhum webhook resolve loja pela URL | `roteamento.test.ts:34-57`; `src/lib/roteamento.ts:29-42` | MANTER |
| INV-53 | Conta desconhecida, desconectada ou da rede (sem loja) ⇒ 200 e descarta; nunca cria loja/conversa por chute | `roteamento.test.ts:44-49`; `roteamento.ts:25-41` | MANTER (registrar o descarte de forma durável) |
| INV-54 | Conversa guarda `store_integracao_id` (indexado) e é procurada **por conta**: mesma cliente no número de vendas e no de SAC = duas conversas | `roteamento.test.ts:59-76`; `gateway.ts:79-92` | MANTER |
| INV-55 | Resposta sai **pela conta em que a conversa entrou**, com a credencial dessa conta; adapter global proibido no envio | `roteamento.test.ts:79-91`; `tests/envio-por-conta.test.ts:25-58`; decisão 3 | MANTER |
| INV-56 | Duas contas do mesmo canal nunca compartilham instância/credencial (verificado no fio: token/`phone_id` corretos) | `adapters-por-conta.test.ts:62-68`; `envio-por-conta.test.ts:26-57`; `uazapi.test.ts:107-118` | MANTER |
| INV-57 | Adapters recebem credencial por fábrica; não leem `process.env` fora da config de ambiente | `adapters-por-conta.test.ts:25-40` | MANTER (e remover o fallback de ambiente, ver T-14) |
| INV-58 | Chaves esperadas por provedor declaradas num lugar só (`whatsapp_oficial: phone_id, access_token`; `uazapi: token`; `instagram/facebook: page_access_token`; Bling por OAuth); a tela gera os campos dessa constante; conectar com chave faltando ⇒ 400 **antes** de cifrar/gravar | `adapters-por-conta.test.ts:78-109`; `usuarios-fase4.test.ts:275-317`; `integracoes-catalogo.ts:79-85` | MANTER |
| INV-59 | Toda referência externa tem rótulo e ajuda (>20 chars) na tela; trocar de provedor limpa a credencial digitada | `usuarios-fase4.test.ts:293-317` | MANTER |
| INV-60 | Provedores: `bling`, `tiktok_shop`, `instagram`, `facebook`, `whatsapp_oficial`, `uazapi`; de canal: os 5 menos Bling; Bling é o único "da rede" | `roteamento.test.ts:121-128`; `integracoes-catalogo.ts:21-68` | MANTER |
| INV-61 | Mesma conta `(provedor, referencia_externa)` não pode estar ativa em duas lojas ⇒ 409 | `integracoes/route.ts:50-67`; `integracoes.md:255-258` | MANTER-INV (índice único parcial `is_deleted = false`) |
| INV-62 | Destinatário: WhatsApp usa `whatsappId`, cai no telefone; outros canais sem fallback; canal desconhecido não envia | `chat-fase3.test.ts:114-143` | MANTER |
| INV-63 | Mensagem recusada pelo canal é **gravada** como `failed` com o motivo; nada de 500 entre entregar e gravar; reenvio só aceita `failed`, edita a mesma mensagem, é escopado e recusa nota interna | `chat-fase3.test.ts:147-190`; `api.md:379-380` | MANTER |
| INV-64 | Adapter fora do ar vira resultado de erro, não exceção que derruba o lote | `uazapi.test.ts:120-126`; `chat/enviar.ts:125-130` | MANTER |

### 2.6 WhatsApp via uazapi

| # | Invariante | Origem | Destino |
|---|---|---|---|
| INV-65 | `whatsapp_oficial` e `uazapi` convivem no canal `whatsapp`; cada webhook resolve pelo **seu** provedor (a Meta procurava como uazapi e descartava tudo) | `uazapi.test.ts:40-71` | MANTER |
| INV-66 | Adapter uazapi cumpre a mesma interface do da Meta | `uazapi.test.ts:81-88` | MANTER |
| INV-67 | Token da instância no **header**, nunca no corpo | `uazapi.test.ts:90-105` | MANTER |
| INV-68 | `sendTemplate` no uazapi falha explicitamente (não manda o nome do template como texto); campanha via uazapi manda **texto**; template aprovado vale só para `whatsapp_oficial` | `uazapi.test.ts:128-135`; `campanha-fase6.test.ts:115-121` | MANTER |
| INV-69 | Parser: ignora eco `fromMe`; payload desconhecido devolve vazio (não derruba o webhook); timestamp em s/ms/ISO, lixo não vira Invalid Date; URL da mídia serve de `mediaId` | `uazapi.test.ts:196-249` | MANTER |
| INV-70 | Caminhos/cabeçalhos incertos confinados num arquivo de config marcado `NAO CONFIRMADO/CONFERIR`; base por ambiente | `uazapi.test.ts:255-277` | MANTER |
| INV-71 | Aviso de risco de **banimento** visível no config, `.env.example` e tela de integrações; formulário diz que "não é a API oficial" | `uazapi.test.ts:279-287`; `usuarios-fase4.test.ts:309-311` | MANTER |
| INV-72 | Sessão da instância (estado + QR) só admin; o status no banco é realinhado a cada consulta | `api.md:287-296`; `rbac.test.ts:96` | MANTER |

### 2.7 Cofre de credenciais

| # | Invariante | Origem | Destino |
|---|---|---|---|
| INV-73 | AES-256-GCM, formato `v1:<iv>:<tag>:<cifrado>`, IV aleatório (duas cifras do mesmo texto diferem); ida e volta preserva acento/emoji/vazio | `tests/cofre.test.ts:26-62` | MANTER |
| INV-74 | Adulterar texto, tag ou IV ⇒ erro; versão desconhecida ⇒ erro; chave diferente ⇒ erro | `cofre.test.ts:77-108` | MANTER |
| INV-75 | Chave 32 bytes (hex ou base64); ausente ou tamanho errado ⇒ falha alto; **nunca** grava em claro (rota responde 503) | `cofre.test.ts:103-124`; `integracoes/route.ts:121-125` | MANTER |
| INV-76 | Tela só vê chaves + 4 últimos caracteres; credencial ilegível vira `{erro:"ilegivel"}` sem derrubar listagem | `cofre.test.ts:126-155` | MANTER |
| INV-77 | Desconectar apaga o campo cifrado e marca excluído; a linha fica para a trilha | `api.md:148`; `integracoes.md:368-369` | MANTER |
| INV-78 | `INTEGRATIONS_KEY` diferente em HML e PRD; credencial de loja nunca em `.env` | `integracoes.md:370,782-784` | MANTER |

### 2.8 Bling, TikTok Shop e fontes da verdade

| # | Invariante | Origem | Destino |
|---|---|---|---|
| INV-79 | **Nenhuma escrita em ERP**: cliente Bling sem PUT/PATCH/DELETE e exatamente 2 POST (trocar code, renovar token); rotas Bling só GET; nenhuma rota de pedido importa o cliente Bling | `tests/bling.test.ts:104-129`; `tests/etapa8-fontes-da-verdade.test.ts:26-54`; ADR 0004 | MANTER |
| INV-80 | ADR de fontes da verdade existe e é citado onde a leitura acontece | `etapa8.test.ts:27-42` | MANTER (novo ADR herda o 0004) |
| INV-81 | `state` OAuth: assinado HMAC, identifica quem iniciou, nonce (dois seguidos diferem), expira em 60s, recusa forjado/alterado/outro segredo/ausente/malformado | `bling.test.ts:28-71`; `src/lib/bling/estado.ts` | MANTER-INV (segredo próprio; tornar de uso único) |
| INV-82 | Credencial do app Bling em `Basic` base64, **nunca** no corpo; configuração faltando falha alto | `bling.test.ts:73-102` | MANTER |
| INV-83 | URLs do Bling só no arquivo de config, com a procedência (collection OpenAPI oficial) registrada | `bling.test.ts:152-169` | MANTER |
| INV-84 | Saldo exibido é o do **depósito da loja**, nunca `saldoFisicoTotal`; depósito vai no path; `idsProdutos[]` obrigatório e lista vazia não chama | `etapa8.test.ts:67-117`; decisão 6 | MANTER |
| INV-85 | Saldo desconhecido é `null`, **nunca 0** (zero trava venda de peça que existe); cai no saldo virtual se o físico não vier | `etapa8.test.ts:87-97,135-138` | MANTER |
| INV-86 | **Disponível = saldo do Bling − reservado**; reservado = itens de pedidos `masc_status='pendente'` e status fora de `cancelled/returned`, casado **por SKU**; sem SKU não desconta; nunca negativo; cálculo não escreve | `etapa8.test.ts:123-160`; `src/lib/pedidos/reservado.ts` | MANTER |
| INV-87 | Loja sem `bling_deposito_id` ou Bling fora ⇒ catálogo admin 409; tela de venda **degrada** (`estoqueAoVivo:false`) e avisa, sem travar a venda | `etapa8.test.ts:361-369`; `api.md:211-214,244-246` | MANTER |
| INV-88 | Tela de venda usa ação alcançável pelo vendedor (não a de integrações, que é só admin), mostra `disponivel`, não chama nada externo e fecha a venda com modal block | `etapa8.test.ts:326-354` | MANTER |
| INV-89 | Paginação enviada ao Bling é validada como inteiro (`?pagina=abc` marcava a integração como erro) | `etapa8.test.ts:372-378` | MANTER |
| INV-90 | TikTok Shop somente leitura; `app_secret` nunca em parâmetro; URLs confinadas no config com a dúvida declarada | `bling.test.ts:131-149,171-185` | MANTER |
| INV-91 | Assinatura TikTok: params ordenados, `{chave}{valor}` sem separador, envolvidos pelo secret, exclui `sign` e `access_token`, ignora undefined, caminho conforme `ASSINATURA_INCLUI_CAMINHO` (hoje `true`, não confirmado), HMAC-SHA256 hex **maiúsculo**; timestamp em segundos, `sign_method=HmacSHA256`, relógio injetável | `tests/tiktok-assinatura.test.ts:22-125`; `tiktok/config.ts:38` | MANTER |
| INV-92 | Webhook TikTok: HMAC-SHA256(`app_key`+corpo cru), aceita maiúscula/minúscula, recusa adulterado/outro segredo/ausente/sem app_key | `tiktok-assinatura.test.ts:127-159` | MANTER |
| INV-93 | Conta TikTok Shop nasce **sem loja** (não chutar); TikTok ainda sem credencial por conta | `api.md:282`; `adapters-por-conta.test.ts:70-75` | MANTER (falta tela de atribuir loja) |

### 2.9 Pedidos e ponte com o Masc

| # | Invariante | Origem | Destino |
|---|---|---|---|
| INV-94 | Pedido nasce `masc_status='pendente'`; fila "falta lançar" consultável e indexada `(loja, masc_status)` | `etapa8.test.ts:245-248,289-292` | MANTER |
| INV-95 | `lancado` exige número da venda no Masc; `dispensado` exige justificativa escrita | `etapa8.test.ts:250-258`; `orders/[id]/masc/route.ts:20-34` | MANTER |
| INV-96 | Relançar com número diferente ⇒ 409; a trava olha "já houve número", **não** `masc_status` (dava para contornar em 2 passos); voltar à fila **preserva** o número | `etapa8.test.ts:260-277`; `masc/route.ts:51-83` | MANTER |
| INV-97 | Lançamento entra na linha do tempo do pedido e passa por modal block 3s (não `window.prompt`) | `etapa8.test.ts:279-296` | MANTER |
| INV-98 | Nenhuma chamada HTTP para o Masc (não há API conhecida) | `etapa8.test.ts:56-60` | MANTER |
| INV-99 | Número do pedido **sequencial por loja e mês**, formato `MS{AAMM}-{SIGLA}-{NNNN}` (padding 4, cresce sem truncar); sigla de 3 letras sem acento/pontuação (`LOJ` se vazia, completa com `X`); maior buscado como **número**; sufixo fora do padrão descartado; sem aleatório; colisão retentada | `etapa8.test.ts:166-235`; `src/lib/pedidos/numero.ts` | MANTER-INV (contador atômico; sigla cadastrada e única, ver T-25) |
| INV-100 | Criação do pedido (pedido, evento, totais do contato, negócio ganho) numa **transação só** | `etapa8.test.ts:223-230`; `api.md:397` | MANTER |
| INV-101 | GET/PUT de pedido e a ação do Masc filtram por loja, não só por id | `etapa8.test.ts:303-316` | MANTER |

### 2.10 Campanhas (disparo)

| # | Invariante | Origem | Destino |
|---|---|---|---|
| INV-102 | Ninguém recebe duas vezes: destinatário **reservado antes** do envio (`FOR UPDATE SKIP LOCKED`), só `pending` é reservado, `sent` fica gravado ⇒ retomar não reenvia | `tests/campanha-fase6.test.ts:24-51`; ADR 0007 | MANTER-INV (mesma garantia com BullMQ, se adotado) |
| INV-103 | FIFO por `created_at` | `campanha-fase6.test.ts:33-35` | MANTER |
| INV-104 | Falha de rede marca `failed` com motivo, nunca deixa linha presa em `sending` | `campanha-fase6.test.ts:37-44` | MANTER |
| INV-105 | Lote pequeno (≤50; hoje 20); uma requisição processa um lote, sem laço infinito | `campanha-fase6.test.ts:55-66`; `disparo.ts:31` | MANTER-INV |
| INV-106 | Pausar para de verdade: o lote confere o status **antes** de reservar; disparar campanha que não está `sending` ⇒ 409 | `campanha-fase6.test.ts:79-91` | MANTER |
| INV-107 | Campanha sai por **conta explícita**; sem conta ⇒ 422 e pausa; conta é conferida contra a loja; loja com uma conta só dispensa escolha | `campanha-fase6.test.ts:93-113`; `constraints.sql:43-52` | MANTER |
| INV-108 | Opt-out e contato excluído ficam fora do segmento **e** são reconferidos na hora do envio | `campanha-fase6.test.ts:126-140`; `disparo.ts:192-198` | MANTER (hoje o reconfere ignora `is_deleted`, ver D-06) |
| INV-109 | O mesmo filtro de segmento conta e envia; critérios: tags (todas), tamanho preferido, gasto mínimo, dias desde a compra; lista materializada uma vez no início | `campanha-fase6.test.ts:142-158`; `disparo.ts:43-108` | MANTER |
| INV-110 | "Iniciar envio" precisa enviar de fato (antes só marcava `sending`) | `campanha-fase6.test.ts:1-7,68-74` | MANTER |

### 2.11 Chat e atendimento (UX com regra)

| # | Invariante | Origem | Destino |
|---|---|---|---|
| INV-111 | Mesclagem de mensagens: não duplica por id; versão do servidor vence; otimista some quando o servidor confirma (mesmo texto **e** mesmo remetente) e fica enquanto não confirma; preserva histórico paginado; ordena por data | `chat-fase3.test.ts:40-110` | MANTER |
| INV-112 | PUT de conversa valida `status ∈ {open,pending,resolved,archived}` e `priority ∈ {low,medium,high,urgent}` e usa o corpo validado ("banana" sumia a conversa) | `chat-fase3.test.ts:231-243` | MANTER |
| INV-113 | Transferir só para usuário ativo da loja da conversa (ou gestão), senão 422 | `chat-fase3.test.ts:245-252`; `api.md:377` | MANTER |
| INV-114 | Transferir e resolver funcionam e são auditados (`conversa_resolvida`/`conversa_transferida`) | `chat-fase3.test.ts:216-229`; `conversations/[id]/route.ts:137` | MANTER |
| INV-115 | Respostas rápidas vêm do banco, só ativas; menu abre só com `/^\/(\S*)$/` ("parcelo em 10/12" não abre) | `chat-fase3.test.ts:274-298` | MANTER |
| INV-116 | Rolagem automática só se a atendente já estava no fim; ref no elemento que rola | `chat-fase3.test.ts:192-214` | MANTER-INV |
| INV-117 | Aviso sonoro armado em gesto do usuário; notificação só com aba escondida; nunca pedir permissão sem ação do usuário | `chat-fase3.test.ts:300-320` | MANTER |
| INV-118 | Busca de conversas com debounce, não por tecla | `chat-fase3.test.ts:322-330` | MANTER |
| INV-119 | Seletor de produto: oferece só tamanhos com estoque, diz "sem estoque", preço em R$ pt-BR, não quebra sem foto/tamanho, e o texto vai **para o campo** (não direto à cliente) | `campanha-fase6.test.ts:163-205` | MANTER |
| INV-120 | Nota interna é gravada e não vai ao canal | `api.md:379` | MANTER |

### 2.12 Mídia

| # | Invariante | Origem | Destino |
|---|---|---|---|
| INV-121 | Bucket **privado** (`mc anonymous set none`); URL persistida é a rota interna autenticada `/api/media/{id}/raw` (`?thumb=1`), nunca a do bucket | `tests/midia-minio.test.ts:31-56`; ADR 0006 | MANTER |
| INV-122 | Rota raw exige sessão **e** escopo de loja, não assina, `Cache-Control: private` | `midia-minio.test.ts:91-95`; ADR 0006:79-80 | MANTER |
| INV-123 | Quem baixa de fora (Meta/uazapi) recebe URL assinada gerada **no envio**, TTL curto (hoje 600s; teto testado 3600), nunca persistida | `midia-minio.test.ts:69-89`; `armazenamento.ts:123` | MANTER |
| INV-124 | Chave `{loja}/{pasta}/{uuid}.{ext}`: extensão minúscula, nome original nunca vira chave, `..` não escapa, sem extensão ⇒ `.bin` | `midia-minio.test.ts:102-126` | MANTER |
| INV-125 | Miniatura webp 200x200 q80 só para imagem; falhar nela não derruba o upload; vídeo sem miniatura (regressão aceita) | `midia-minio.test.ts:132-160`; ADR 0006:45-63 | MANTER |
| INV-126 | S3 SDK com `forcePathStyle: true`; config faltando falha dizendo a variável; `S3_ENDPOINT` público (URL assinada precisa resolver fora) | `midia-minio.test.ts:174-194`; `deploy-easypanel.md:84-89` | MANTER |
| INV-127 | Mídia excluída: linha marcada, binário fica; limpeza definitiva é rotina separada | ADR 0005:67-76; ADR 0006:77-80 | MANTER |

### 2.13 Soft delete, LGPD e auditoria

| # | Invariante | Origem | Destino |
|---|---|---|---|
| INV-128 | Nenhuma exclusão física, **exceto** a eliminação LGPD, marcada linha a linha e existente num lugar só | `tests/soft-delete.test.ts:45-66`; ADR 0002:58-63; ADR 0005:78-87 | MANTER |
| INV-129 | Excluir grava **quem e quando** (`deleted_at`, `modificado_por`), não só o booleano; `is_deleted` nasce false | `soft-delete.test.ts:28-43,68-78` | MANTER |
| INV-130 | Leitura padrão nunca vê excluído; quem pede excluído explicitamente (tela de auditoria) é atendido sem um "segundo cliente sem guarda" | `soft-delete.test.ts:81-117`; ADR 0005:18-32 | MANTER-INV (helper Drizzle, ex. `vivos()` da base) |
| INV-131 | Filhos-rastro (eventos do funil, destinatários de campanha) não são apagados nem marcados quando o pai é excluído | ADR 0005:60-65 | MANTER |
| INV-132 | Exclusão de contato comum ≠ eliminação LGPD (a interface diferencia); eliminação LGPD vale **para a loja atual** e não procura a pessoa na outra loja | ADR 0005:85-87; `integracoes.md:345-352` | MANTER |
| INV-133 | Opt-out registrado (atendimento pode) retira o contato de toda campanha | `rbac.test.ts:117-119`; `api.md:538` | MANTER |
| INV-134 | Trilha: ações em lista fechada; diff só do que mudou (`{de, para}`); segredo (`senha/password/token/secret/credencia/authorization/apikey`) nunca entra; `store_id` nulo para ação de rede | `robustez-fase5.test.ts:206-266`; `src/lib/auditoria.ts:23-47,98-108` | MANTER (política de falha muda, ver T-24) |
| INV-135 | Mutações sensíveis registram: usuário criado/alterado/desativado/reativado, integração conectada/desconectada, conversa resolvida/transferida, campanha disparada | `robustez-fase5.test.ts:225-238` | MANTER + ampliar a toda mutação (base) |

### 2.14 Robustez de entrada

| # | Invariante | Origem | Destino |
|---|---|---|---|
| INV-136 | Paginação: teto 100; texto/vazio ⇒ padrão da rota; 0/negativo ⇒ 1; fracionário trunca; página ≥1; nenhuma listagem usa `parseInt` cru | `robustez-fase5.test.ts:29-77`; `src/lib/paginacao.ts` | MANTER |
| INV-137 | Upload: allowlist fechada de MIME (sem SVG, HTML, executável), ignora parâmetro e caixa do content-type; teto por tipo (imagem 5 MB, vídeo/áudio 16 MB, documento 100 MB; exato no teto passa); vazio 400; acima 413; tipo recusado 415 | `robustez-fase5.test.ts:82-127`; `src/lib/media/limites.ts` | MANTER |
| INV-138 | Corte pelo `content-length` **antes** de ler o corpo; cabeçalho ausente/mentiroso não bloqueia sozinho; tamanho real reconferido depois | `robustez-fase5.test.ts:116-141` | MANTER |
| INV-139 | Webhook reentregue não duplica: checagem por `(loja, external_id)` antes de criar contato/baixar mídia **e** índice único parcial `WHERE external_id IS NOT NULL` para a corrida | `robustez-fase5.test.ts:146-177`; `constraints.sql:30-32` | MANTER |
| INV-140 | Constraints que o ORM não expressa chegam ao banco publicado, inclusive em banco já existente | `robustez-fase5.test.ts:180-204` | MANTER-INV (migração versionada; ver T-28) |

### 2.15 Build e estrutura

| # | Invariante | Origem | Destino |
|---|---|---|---|
| INV-141 | Componente cliente não alcança `node:crypto`/`fs`/`child_process` (build quebrava com `UnhandledSchemeError`); catálogo de provedores é puro, sem import | `tests/cliente-sem-servidor.test.ts` | MANTER-INV (`server-only` + varredura) |
| INV-142 | Nenhum arquivo com `\u00XX` literal, mojibake (`Ã§`, `â€`) ou BOM | `tests/tokens-tailwind.test.ts:72-107` | MANTER |
| INV-143 | Popup em portal (dialog/sheet) define cor de texto junto com o fundo | `tokens-tailwind.test.ts:59-70` | MANTER-INV (Tailwind v4) |
| INV-144 | Auditor de conformidade pega SQLite, delete físico Drizzle (erro), segredo e tabela sem auditoria; setup de teste de componente de pé | `tests/estrutura.test.tsx` | MANTER (vem da base) |

---

## 3. Defeitos do código antigo que a reconstrução NÃO pode reproduzir

Achados nesta leitura; nenhum está coberto por teste hoje.

| # | Defeito | Evidência | Consequência |
|---|---|---|---|
| D-01 | Sessão JWT com `role`/`storeId` no token e RBAC lendo do token; desativar ou rebaixar não tem efeito até o JWT expirar | `src/lib/auth.ts:57-64`; `src/lib/sessao.ts:20-29`; `src/middleware.ts:30,64` | Viola "papel e is_active lidos do banco"; usuário desligado continua operando |
| D-02 | Bootstrap do 1º admin por rota pública com `count()==0` seguido de `create`, sem trava | `src/app/api/register/route.ts:31-67` | Duas requisições simultâneas criam dois admins; janela pública após todo deploy com banco vazio |
| D-03 | Eliminação LGPD: ~20 exclusões **fora de transação**, sem registro na trilha (`contato_apagado_lgpd` existe e ninguém chama), sem confirmação no servidor | `src/app/api/lgpd/route.ts:117-151`; `auditoria.ts:33` | Contato parcialmente apagado sem rollback; ato irreversível sem rastro |
| D-04 | POST de consentimento sem Zod e com `ipAddress` do corpo | `lgpd/route.ts:53-71` | Contraria INV-30; prova de consentimento forjável |
| D-05 | Atualização de status de entrega busca a mensagem por `external_id` **sem loja/conta** | `src/lib/channels/gateway.ts:224-238` | Status de uma loja pode alterar mensagem de outra |
| D-06 | Disparo reconfere contato/campanha com `findUnique`, que a guarda de soft delete não alcança | `src/lib/broadcasts/disparo.ts:54,145,179` | Contato excluído recebe campanha; campanha excluída continua disparando |
| D-07 | Criação de contato e de conversa no gateway sem tratar corrida (só a mensagem trata P2002) | `gateway.ts:56-70,83-107` | Duas mensagens simultâneas do mesmo número: exceção engolida pelo 200 do webhook, mensagem perdida, ou duas conversas abertas |
| D-08 | Unicidades não parciais em tabelas com soft delete: contato por canal e `(provedor, referencia_externa)` | `prisma/schema.prisma:99,191-195`; `integracoes/route.ts:50-57` | Recriar contato excluído ou reconectar conta desconectada estoura P2002/500 |
| D-09 | Lista pública libera **qualquer** `/api/webhooks/*` por prefixo | `src/lib/api-publica.ts:17` | Webhook novo nasce público sem gate, contrariando INV-42 |
| D-10 | Segredo do webhook uazapi aceito por query `?segredo=` | `src/lib/webhook-auth.ts:115-116` | Viola regra da casa (segredo de máquina nunca por query); vaza em log de proxy |
| D-11 | `state` OAuth reutilizável dentro dos 60s (nonce não é consumido) e assinado com `NEXTAUTH_SECRET` | `src/lib/bling/estado.ts:12,48-76` | Replay; segredo some com a troca para Better Auth |
| D-12 | Envio sem credencial da conta cai no adapter do **ambiente** | `src/lib/channels/index.ts:45,81-84`; `roteamento.ts:83-85` | Resposta pode sair por conta errada; contradiz "credencial de loja não vai no .env" |
| D-13 | Auditoria best-effort (`catch` + `console.error`) inclusive em mudança de papel/credencial | `auditoria.ts:14-17,85-88` | Viola "gravar a trilha ANTES do efeito quando o efeito destrói o estado anterior" |
| D-14 | Admin define a senha de outra pessoa (criação e edição), sem convite nem troca obrigatória | `usuarios/route.ts:72-74,112`; `usuarios/[id]/route.ts:104` | Viola regra da casa |
| D-15 | Ação do Masc sem optimistic locking e sem trilha (`pedido_lancado_masc` nunca é gravado); update por `id` após leitura escopada | `orders/[id]/masc/route.ts:45-108` | Duas pessoas lançando ao mesmo tempo; lançamento sem auditoria |
| D-16 | Nenhuma rota usa optimistic locking | `api.md:124`; `back.md:89` | Regra absoluta da base não cumprida |
| D-17 | `viewer` exporta dossiê LGPD completo e lê a trilha (GET padrão) | `rbac.ts:34-40`; `lgpd/route.ts:12-47` | Dado pessoal completo para papel de só leitura; ver pergunta P-10 |
| D-18 | Escopo aceita qualquer `lojaPedida` da gestão sem conferir existência | `src/lib/loja.ts:67` | Filtro por loja inexistente/excluída silencioso |
| D-19 | Sigla da loja derivada do nome: terceira loja "Cerro Grande" colidiria com "Cerro Azul" (`CER`); leitura do maior número tem corrida resolvida por retry | `pedidos/numero.ts:32-40,62-64` | Numeração ambígua entre lojas no mesmo mês |
| D-20 | Páginas sem RBAC (só o índice de settings filtra) | `middleware.ts:62-63`; `rbac.md:101-105` | Menu e telas abertas a quem não pode usar |

---

## 4. (b) Decisões de negócio do cliente

Todas as decisões do projeto foram registradas por **Paulo** (dev, repassando o cliente Merlo Store) em **17/08/2026**, salvo indicação. Nenhuma está em `docs/regras-negocio.md`: recomenda-se registrá-las como RN-100+ na reconstrução.

| ID | Decisão | Data / autor | Fonte | Situação |
|---|---|---|---|---|
| DN-00 | Duas lojas físicas: **Centro** (`centro`) e **Cerro Azul** (`cerro-azul`); desenho suporta a 3ª sem mudar schema | 17/08/2026, "definidas pelo cliente" | `integracoes.md:33-43` | vale |
| DN-01 | Um vendedor atende **uma loja só** (loja no próprio cadastro, sem tabela de vínculo) | 17/08/2026, Paulo | `integracoes.md:49-58` | vale |
| DN-02 | **Admin e gerente veem as duas lojas**; papel `gerente` novo; `agent` vira `vendedor`; `viewer` leitura da própria loja | 17/08/2026, Paulo | `integracoes.md:60-74,573-574` | vale |
| DN-03 | Cada loja tem **N números de WhatsApp**; conversa sabe por qual entrou; resposta sai pelo mesmo número | 17/08/2026, Paulo | `integracoes.md:76-87` | vale |
| DN-04 | Dados atuais são **mock**: sem migração, banco novo, seed com duas lojas e **dois números na mesma loja** | 17/08/2026, Paulo | `integracoes.md:89-93,286-288` | vale |
| DN-05 | **Contato isolado por loja**; mesma pessoa nas duas = dois contatos, sem merge; LGPD por loja | 17/08/2026, Paulo | `integracoes.md:95-103,345-352` | vale |
| DN-06 | **Bling conta única da rede**, separação por depósito (`stores.bling_deposito_id`) | 17/08/2026, Paulo | `integracoes.md:105-118` | vale (a parte de "enviar pedido ao Bling" foi superada por DN-08) |
| DN-07 | **Gerente pode tudo menos configuração e usuário**; LGPD (inclusive apagar) e ler trilha são operação/gestão | 17/08/2026, Paulo | `integracoes.md:120-140` | vale |
| DN-08 | **Masc é o dono da venda**, Bling é autoridade de estoque (vínculo Masc→Bling); o sistema **não escreve em ERP** e só registra/acompanha o lançamento manual | 17/08/2026, Paulo ("O Masc e o dono da venda, nao escreve estoque, ele e vinculado com Bling para estoque") | `integracoes.md:144-161`; ADR 0004 | vale |
| DN-08b | Vínculo Masc→Bling é **em tempo real** (saldo do Bling confiável no atendimento; janela de oversell = tempo em `pendente`) | 17/08/2026, Paulo | ADR 0004:56-61,72-98 | vale (mecanismo não verificado, P-02) |
| DN-09 | **uazapi convive** com a API oficial; cada número escolhe o provedor | 17/08/2026 (etapa 7, "a recomendação foi seguida") | `integracoes.md:463-475` | vale; quais números vão para o uazapi é pergunta aberta (P-04) |
| DN-10 | Pedido de canal nasce **pendente de lançamento no Masc**; lançar exige número da venda; dispensar exige justificativa | 17/08/2026 (derivada de DN-08) | ADR 0004:62-70; `api.md:253-267` | vale |
| DN-11 | Conta TikTok Shop é por loja, nasce sem loja até alguém atribuir | 17/08/2026 (etapa 6) | `integracoes.md:263-264,719-720` | vale; sem tela |
| DN-12 | Leitura da lista de colegas aberta ao vendedor (quem transfere conversa) | 18/08/2026, Paulo (commit `72704d1`) | `rbac.ts:72-84` | vale |
| DN-13 | Campanha sai por conta de envio escolhida (marketing não pode sair pelo número do SAC) | 18/08/2026, Paulo (commit `5e902d4`) | `campanha-fase6.test.ts:93-101` | vale |

Regras globais da base que o projeto herda (não são do cliente): RN-001 exclusão lógica, RN-002 rastreabilidade, RN-003 modal block 3s, RN-004 versionamento de documento, RN-005 validação de categoria por regex — **Lucas Dettenborn, 15/05/2026** (`regras-negocio.md:27-65`); stack base — **Lucas + equipe Bah! Tech, 30/05/2026** (ADR 0001). RN-004 e RN-005 não têm aplicação conhecida neste domínio.

---

## 5. (c) Decisões técnicas antigas: manter, rever ou descartar

| ID | Decisão antiga | Origem | Veredito | Motivo |
|---|---|---|---|---|
| T-01 | Prisma 7 com transição gradual para Drizzle; multi-loja feita em Prisma | ADR 0002 (Paulo, 17/08), ADR 0003 (Paulo, 17/08) | **DESCARTAR** | Reconstrução nasce 100% Drizzle; os dois ADRs ficam como "substituídos". Lição que fica: nada de dois ORMs nem `db push` sobre o mesmo banco; migração versionada desde o dia 1 |
| T-02 | `prisma db push` + `db-bootstrap.mjs` + `constraints.sql` reaplicado a cada start; container sobe mesmo se a constraint falhar | `deploy-easypanel.md:146-273`; `robustez-fase5.test.ts:180-204` | **REVER** | `drizzle-kit generate` + migração aplicada em passo de release; CHECK/índices parciais dentro da migração. "Subir com AVISO" conflita com garantir constraint: decidir explicitamente |
| T-03 | Tudo em Route Handlers consumidos por `fetch` (69 rotas) | `back.md:11`; `front.md:53-56` | **REVER** | Server Actions para telas; Route Handlers só para webhooks, callbacks OAuth, mídia raw, handler de auth e (se houver) cron. Cada Server Action é POST aberto e precisa da própria guarda |
| T-04 | Middleware como porta única de autenticação e RBAC ("rota nova nasce protegida") | `middleware.ts`; `rbac.md:3-5` | **MANTER-INV / REVER mecanismo** | Next 16: `proxy.ts` não é fronteira. Guarda obrigatória em cada ação/handler (wrapper) + teste de varredura; proxy só para redirecionamento de UX |
| T-05 | RBAC por **caminho + método HTTP** com padrão e exceções | `src/lib/rbac.ts` | **REVER** | Com Server Actions, caminho/método perde sentido. Permissão por `recurso:acao` preservando a matriz da seção 2.2 e os testes de invariante sobre a tabela inteira |
| T-06 | NextAuth v4 Credentials + JWT; bootstrap do 1º admin por rota pública; bcrypt 12; senha ≥8 definida pelo admin; sem convite | `oauth.md:8-21`; `auth.ts`; `register/route.ts`; `usuarios/route.ts:72-74` | **DESCARTAR** | Better Auth endurecido (padrão da casa): sessão em banco revogável, papel/ativo/loja lidos do banco a cada requisição, 2FA obrigatório com passkey, bloqueio por conta, mensagem de recusa única, provisionamento do 1º admin por script (sem senha literal, fora do entrypoint), convite/troca obrigatória em vez de senha escolhida pelo admin (D-01, D-02, D-14) |
| T-07 | Better Auth apaga fisicamente sessões/verificações | armadilha conhecida (contexto) | **NOVO — ADR obrigatório** | Colide com soft delete; decidir exceção explícita para tabelas de sessão/verificação + trilha de login append-only separada |
| T-08 | `escopoDaLoja`/`lojaParaGravar` + cookie `loja_ativa` + `?loja=` + 404 fora do escopo | `src/lib/loja.ts`; `api.md:349-358` | **MANTER-INV** | Semântica intacta; helper Drizzle equivalente; validar loja pedida (D-18). RLS no Postgres é opção a avaliar, não requisito |
| T-09 | Soft delete como extensão do cliente Prisma só em 8 models; `findUnique` proibido | ADR 0005 (17/08) | **REVER** | Drizzle não tem extensão: helper de leitura (`vivos()` da base) + varredura. Base exige 5 colunas em **toda** tabela, não em 8. Índices únicos parciais `is_deleted = false` (D-08) |
| T-10 | Exceção LGPD com delete físico marcado `compliance:delete-fisico-lgpd` | ADR 0002:58-63; ADR 0005:78-87 | **MANTER + REVER execução** | Transação única, trilha append-only sem PII ("contato X eliminado por Y em Z"), modal block, escopo por loja (D-03). Confirmar retenção fiscal de pedidos antes de apagar (P-11) |
| T-11 | Cofre AES-256-GCM versionado | `src/lib/cofre.ts`; `api.md:330-341` | **MANTER** | Correto e testado; acrescentar plano de rotação (`v2`) |
| T-12 | Desconectar integração apaga o campo cifrado e marca excluída | `api.md:148` | **MANTER** | — |
| T-13 | Roteamento por `(provedor, referencia_externa)`; TikTok por `?conta=` | `src/lib/roteamento.ts`; `integracoes.md:519-539` | **MANTER** | Acrescentar registro durável do evento descartado (a tabela `integracoes_eventos` foi especificada e nunca criada, `integracoes.md:182`) |
| T-14 | Fallback para adapter/credencial de ambiente quando a conta não tem credencial | `channels/index.ts:40-85` | **DESCARTAR** | Banco novo não tem "conversa antiga"; falhar fechado (mensagem `failed`, "conta sem credencial") (D-12) |
| T-15 | Webhook processa inline e responde 200 mesmo com erro | `api.md:554-556` | **REVER** | Persistir o evento cru (idempotente) e processar em fila; o 200 deixa de engolir perda (D-07) |
| T-16 | Segredo compartilhado do uazapi por header **ou query** | `webhook-auth.ts:97-120` | **REVER** | Só header, ou URL por instância com segredo por conta (`integracoes.md:525-528`) (D-10) |
| T-17 | Lista pública por regex, com prefixo `/api/webhooks/` | `api-publica.ts:15-26` | **REVER** | Lista exata de rotas públicas, cada uma com gate (D-09) |
| T-18 | `state` OAuth assinado com `NEXTAUTH_SECRET`, 60s | `bling/estado.ts` | **MANTER-INV** | Segredo próprio, uso único (nonce consumido em tabela/Redis), conferir no callback que o iniciador ainda é admin ativo (D-11) |
| T-19 | Bling e TikTok Shop somente leitura | ADR 0004 | **MANTER** | Decisão de negócio DN-08 |
| T-20 | Endpoints incertos confinados (Bling confirmado; TikTok `ASSINATURA_INCLUI_CAMINHO=true` e uazapi `CONFERIR`) | `bling.test.ts:152-185`; `uazapi.test.ts:255-272` | **MANTER** | Confirmar em sandbox antes de HML |
| T-21 | Mídia no MinIO privado, URL assinada 600s, thumb com sharp, sem ffmpeg | ADR 0006 (17/08) | **MANTER** | Ciclo contra MinIO real nunca rodou (ADR 0006:84-97): validar cedo. Backup do MinIO e rotina de limpeza não existem |
| T-22 | Tetos de upload do WhatsApp + allowlist | `media/limites.ts` | **MANTER** | Opcional: conferir assinatura de bytes além do MIME declarado |
| T-23 | Paginação grampeada em 100 | `paginacao.ts` | **MANTER** | Pode virar schema Zod reutilizado |
| T-24 | Auditoria best-effort, lista fechada, diff, filtro de segredo, IP de `x-forwarded-for` | `src/lib/auditoria.ts` | **REVER** | Manter lista, diff e filtro. Mudar: mesma transação da mutação (ou antes do efeito destrutivo), append-only (sem UPDATE/DELETE para o usuário da app), cobrir toda mutação + login/falha/bloqueio/logout/403; IP só do proxy confiável (D-13) |
| T-25 | Número do pedido por `max(substr)` + retry de colisão; sigla derivada do nome | `pedidos/numero.ts` | **MANTER formato / REVER mecanismo** | Contador atômico por (loja, mês) via `UPDATE ... RETURNING` ou sequence; sigla como coluna única da loja (D-19). Formato precisa de ok do cliente (P-12) |
| T-26 | Fila de disparo no próprio Postgres, laço dirigido pela aba aberta | ADR 0007 (18/08) | **REVER** | O gatilho de revisão do próprio ADR já ocorreu (mensagens agendadas, campanha agendada não dispara, transcrição, alertas, refresh de token Bling, ingestão de webhook). Redis 6382 está no compose e o HUG usa BullMQ: adotar fila com worker mantendo INV-102..110 |
| T-27 | Crons externos batendo em rota com `CRON_SECRET` | `deploy-easypanel.md:206-215` | **REVER** | Com worker de fila, jobs repetíveis substituem as rotas públicas de cron (some a superfície) |
| T-28 | Deploy EasyPanel: container único porta 3000, standalone, sem Redis; health `/login` | `deploy-easypanel.md` | **REVER** | Conflita com padrão da base (2 VPS, Redis na VPS de backend). Decidir alvo (P-15); manter as lições: segredo nunca como build-arg, `S3_ENDPOINT` público, cookie `__Secure-` exige HTTPS |
| T-29 | Chat por polling de 5s com mesclagem no cliente | `chat-fase3.test.ts:89-98` | **REVER mecanismo** | Decidir tempo real (SSE/websocket) ou polling; INV-111 vale em qualquer caso |
| T-30 | `products` local com `stock` que "não é verdade de estoque"; pedido referencia `products.id` local; reserva casada por SKU | ADR 0004:109-112; `api.md:236-242` | **REVER** | Decidir se o catálogo local continua (e como é alimentado a partir do Bling, só leitura) ou se o pedido referencia produto do Bling; manter `sku` único por loja |
| T-31 | IA (Anthropic) classifica e grava tags no contato sem revisão humana | `api.md:487,491-494` | **REVER** | Tag alimenta segmento de campanha; decidir revisão humana (P-08) |
| T-32 | Pagamentos com provedor mock gravando `Payment` real; webhook por segredo compartilhado | `api.md:496-510,621-623` | **REVER** | Fora de produção hoje; escopo e provedor dependem do cliente (P-07) |
| T-33 | Transcrição de áudio com OpenAI Whisper | `api.md:524` | **REVER** | Áudio de cliente sai do perímetro; escopo e consentimento (P-09) |
| T-34 | Tailwind v3 com teste de tokens no `tailwind.config.ts` e proibição de `@theme inline` | `tokens-tailwind.test.ts:33-57` | **DESCARTAR** | Stack alvo é Tailwind v4, em que `@theme inline` é o correto; manter só INV-142/143 |
| T-35 | Canal Facebook Messenger incluído por já existir no código | `integracoes-catalogo.ts:13-20`; `integracoes.md:681-683` | **REVER** | Não estava na lista do cliente (P-06) |
| T-36 | Canal de **mensagens** TikTok (adapter sem credencial) separado do TikTok Shop | `integracoes.md:22,442-443`; `adapters-por-conta.test.ts:70-75` | **REVER** | Confirmar se existe uso real (P-06) |
| T-37 | Timestamps sem decisão de precisão/fuso | armadilha conhecida (contexto) | **NOVO — decidir** | `timestamp(precision 3)` para o optimistic locking bater com `Date` do JS; decidir `withTimezone` uma vez para todas as tabelas |

---

## 6. Testes antigos e seu destino

| Arquivo | Invariantes | Destino |
|---|---|---|
| `escopo-loja.test.ts` | INV-01..12 | Reescrever sobre helper Drizzle + varredura por ação |
| `rbac.test.ts` | INV-18..27 | Reescrever sobre a tabela `recurso:acao` |
| `usuarios-fase4.test.ts` | INV-14,16,17,31..39,58,59,71 | Manter lógica pura; parte de `/register` descartada |
| `autoria.test.ts` | INV-29,30 | Reescrever sobre Server Actions |
| `api-publica.test.ts` | INV-42 | Reescrever: lista exata + guarda obrigatória |
| `webhook-auth.test.ts` | INV-43..47 | Manter (portar); remover query do uazapi |
| `middleware-proxy.test.ts` | INV-40,41 | Portar para `proxy.ts`/config do Better Auth |
| `roteamento.test.ts`, `adapters-por-conta.test.ts`, `envio-por-conta.test.ts` | INV-51..62 | Manter; trocar "cai no ambiente" por "falha fechado" |
| `uazapi.test.ts` | INV-65..72 | Manter |
| `cofre.test.ts` | INV-73..76 | Manter integral |
| `bling.test.ts`, `tiktok-assinatura.test.ts`, `etapa8-fontes-da-verdade.test.ts` | INV-79..101 | Manter; checagens sobre `schema.prisma` viram sobre schema Drizzle |
| `campanha-fase6.test.ts` | INV-102..110, 119, 37 | Manter invariantes; adaptar à fila |
| `chat-fase3.test.ts` | INV-62,63,111..118 | Manter lógica pura (mesclagem, destinatário); varreduras de UI refeitas |
| `midia-minio.test.ts` | INV-121..126 | Manter |
| `soft-delete.test.ts` | INV-128..131 | Reescrever para Drizzle (`vivos()`) e toda tabela |
| `robustez-fase5.test.ts` | INV-134..140, 28 | Manter paginação/upload/idempotência; auditoria com nova política |
| `cliente-sem-servidor.test.ts` | INV-141 | Manter |
| `tokens-tailwind.test.ts` | INV-142,143 | Manter só encoding e portal; descartar tokens v3 |
| `estrutura.test.tsx` | INV-144 | Vem da base |

---

## 7. (d) Perguntas ainda abertas do cliente

| # | Pergunta | Por que importa | Fonte |
|---|---|---|---|
| P-01 | O módulo de e-commerce/sincronização com marketplaces do Masc está **ligado** na Merlo? | Se estiver, há um segundo sistema mexendo em estoque/pedido; verificar antes de qualquer automação | `integracoes.md:163-168,428-431`; ADR 0004:120-124 |
| P-02 | **Como** é o vínculo Masc→Bling (automático, arquivo, digitação)? O "tempo real" foi afirmado mas o mecanismo não foi verificado | Define se o saldo exibido é confiável durante o dia | `integracoes.md:169-171,432-436`; ADR 0004:125-127 |
| P-03 | O Masc tem API? O fornecedor é mesmo a **Informezz** (confiança média)? | Se tiver API, o lançamento deixa de ser manual | `integracoes.md:420-423,437-438`; ADR 0004:114-116 |
| P-04 | Quais números vão para o **uazapi** (risco de banimento) e quais ficam na API oficial? | Decisão de negócio não mitigável por código | `integracoes.md:737-739` |
| P-05 | Qual o `bling_deposito_id` de cada loja? | Sem o de-para, saldo responde 409/sem estoque ao vivo | ADR 0004:128-130; `deploy-easypanel.md:189-191` |
| P-06 | Os canais **Facebook Messenger** e **TikTok (mensagens)** são usados de fato? Instagram conecta colando token ou precisa de login OAuth? | Entraram por existir no código, não por pedido do cliente | `integracoes.md:681-687,698-707`; `api.md:599-601` |
| P-07 | Pagamento (link/Pix) está no escopo? Mercado Pago ou Asaas? | Hoje é mock que grava `Payment` real | `api.md:501-505` |
| P-08 | A IA pode gravar tags no contato sem revisão humana? | Tag vira segmento de campanha | `api.md:491-494` |
| P-09 | Transcrição de áudio (OpenAI) está no escopo, com qual base legal/consentimento? | Áudio de cliente sai do perímetro | `api.md:524`; `.env.example:69-70` |
| P-10 | `viewer` pode exportar o dossiê LGPD completo e ler a trilha? (Hoje pode, por seguir o padrão de leitura) | Decisão 7 fala de gerente; viewer nunca foi discutido | `rbac.test.ts:83-98`; D-17 |
| P-11 | Na eliminação LGPD, pedidos com efeito fiscal devem ser apagados ou anonimizados? Titular cliente das duas lojas: duas operações é aceitável? | Conflito entre eliminação e retenção; UX por loja | `integracoes.md:345-352`; `api.md:539-543` |
| P-12 | O formato `MS{AAMM}-{SIGLA}-{NNNN}` serve à conferência no Masc? Qual a sigla oficial de cada loja? | Número é a chave de conferência da fila | `etapa8.test.ts:166-191` |
| P-13 | Campanha agendada e mensagem agendada precisam disparar sozinhas? Campanha pode continuar com a aba fechada? | Hoje `scheduled_for` é gravado e ninguém observa | ADR 0007:57-64 |
| P-14 | Por quanto tempo mídia excluída fica guardada antes da limpeza definitiva? Backup do MinIO com qual política? | Volume só cresce; backup só cobre Postgres | ADR 0005:74-76; ADR 0006:74-77; `deploy-easypanel.md:223-225` |
| P-15 | Ambiente de produção: EasyPanel (container único) ou padrão da base (2 VPS Hostinger)? | Define se há Redis/worker e como migração roda | `deploy-easypanel.md`; `CLAUDE.md:340-384` |
| P-16 | Criação de acesso: há provedor de e-mail para convite? As vendedoras têm celular próprio para 2FA/passkey? | Regra da casa exige 2FA obrigatório e proíbe admin escolher senha definitiva | `usuarios/route.ts:72-74`; D-14 |
| P-17 | Quem atribui a loja da conta TikTok Shop, e é uma conta por loja? | Conta nasce sem loja e não há tela | `integracoes.md:263-264,719-720` |
| P-18 | Regras de SLA, automações e alertas: quais o cliente quer? (hoje são telas sem backend) | Aparecem no menu de configuração | `integracoes.md:596`; `front.md:30` |
