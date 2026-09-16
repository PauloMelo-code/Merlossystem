# Módulo de plataforma e integrações (pacote M5)

Lojas, contas conectadas por canal, borda de webhook, OAuth do Bling e modelos
da Meta. Fontes: `01-dados.md §6`, `03-arquitetura.md §11, §12.2`,
`02-seguranca.md §12, §13`, `04-ui.md §5.6`.

## Onde mora

| Caminho | Papel |
|---|---|
| `src/lib/lojas/index.ts` | listar, criar, editar (trava de colisão) e desativar loja (exclusão lógica) |
| `src/lib/integracoes/catalogo-provedores.ts` | provedores conectáveis no R1, chaves de credencial e o que é a `referencia_externa`. Puro, sem import: a tela gera o formulário daqui |
| `src/lib/integracoes/payload.ts` | roteamento do corpo **depois** de autenticar: conta e id de cada item (Meta e uazapi). Puro |
| `src/lib/integracoes/roteamento.ts` | os três webhooks sobre `rotaDeMaquina` (`webhookWhatsapp`, `webhookInstagram`, `webhookUazapi`) e a lista branca de cabeçalhos do diário. O INSERT do diário é `registrarEventoDeIngestao`, de `@/lib/db/mutacoes` |
| `src/lib/integracoes/contas.ts` | conectar por token, editar, substituir credencial, desconectar, estado escrito pelo sistema |
| `src/lib/integracoes/oauth.ts` | OAuth do Bling (início, retorno, renovação sob `pg_advisory_xact_lock`) |
| `src/lib/integracoes/sessao.ts`, `uazapi.ts` | sessão do número não oficial: parear (QR) e conferir |
| `src/lib/integracoes/meta/graph.ts`, `meta/modelos.ts` | leitura e envio de modelos na Graph API; sincronização de status |
| `src/lib/integracoes/meta/aprovacao.ts` | costura `enviarModeloParaAprovacao(ctx, templateId)`, consumida pelo M6 |
| `src/lib/integracoes/_consultas.ts` | leituras com `vivos()`/`condicaoDeLoja()` |
| `src/lib/actions/lojas.ts` | `listarLojas`, `criarLoja`, `editarLoja`, `desativarLoja` |
| `src/lib/actions/integracoes.ts` | `listarIntegracoes`, `detalharIntegracao`, `conectarContaPorToken`, `editarIntegracao`, `reautenticarIntegracao`, `desconectarIntegracao`, `parearAparelho`, `consultarSessaoDoAparelho`, `iniciarConexaoBling` |
| `src/lib/validadores/lojas.ts`, `integracoes.ts` | Zod compartilhado com a tela |
| `src/app/api/webhooks/whatsapp/route.ts`, `instagram/route.ts`, `uazapi/[integracaoId]/route.ts` | borda de máquina |
| `src/app/api/integracoes/bling/callback/route.ts` | retorno do OAuth |
| `src/app/(app)/configuracoes/page.tsx` | índice em cartões, filtrado por papel no servidor |
| `src/app/(app)/configuracoes/lojas/` | lista, criar/editar com block e diff, depósito escolhido na lista do Bling, desativar |
| `src/app/(app)/configuracoes/integracoes/` | lista, conectar por token, conectar Bling, detalhe `[id]` |
| `src/server/processadores/integracoes.ts` | jobs `sincronizar-bling`, `sincronizar-templates`, `renovar-token`, `conferir-sessao-uazapi` |

## Permissões

Tudo de `integracoes:*` e `configuracao:*` é **dono e admin** (o gerente não
alcança nem a leitura: ela expõe estado de credencial, INV-22). `lojas:ler` é de
todos; criar, editar e desativar loja são de dono e admin. As páginas chamam
`pode()` para decidir o que mostrar, e as actions reconferem com
`exigirPermissao()`.

## Webhooks

Ordem fixa de `rotaDeMaquina`: teto por IP → teto por conta → content-length →
corpo cru com teto de 256 KB → carregar → assinatura sobre o corpo cru →
**só então** `JSON.parse` → anti-repetição → persistir → enfileirar → 200.

| Rota | Conta | Autenticação |
|---|---|---|
| `POST /api/webhooks/whatsapp` | `metadata.phone_number_id` = `referencia_externa` | HMAC-SHA256 do corpo cru com `META_APP_SECRET` (`X-Hub-Signature-256`) |
| `POST /api/webhooks/instagram` | `entry.id` = `referencia_externa` | o mesmo HMAC |
| `GET` das duas acima | — | challenge com token **do canal** (`WHATSAPP_VERIFY_TOKEN`, `INSTAGRAM_VERIFY_TOKEN`) |
| `POST /api/webhooks/uazapi/[integracaoId]` | o id da URL | segredo **da integração** em `x-uazapi-secret`, comparado por hash. `?segredo=` é recusado |

- **Recusa isonômica**: integração inexistente, revogada, de outro provedor ou
  assinatura inválida → `401` com corpo nulo e o mesmo piso de tempo. Nada é
  gravado no diário (a recusa vai para `auth_eventos` como `webhook_recusado`).
- **Lote agrupado por conta**: cada mensagem (ou recibo de status) vira uma
  linha do diário com a conta dela. Vários anexos com o mesmo id externo viram
  **um** item. O pedaço gravado mantém a forma do payload original, para o
  adaptador de canal (pacote M1) ler sem saber do corte.
- **Idempotência**: `evento_externo_id` = `msg-<id>`, `st-<id>-<status>`,
  `lido-<id>` ou hash do conteúdo, com `ON CONFLICT DO NOTHING` sobre
  `(provedor, evento_externo_id)`. Reentrega com a linha ainda `recebido`
  reenfileira com o mesmo `jobId` (`evento-<id>`); reentrega depois de
  processada não faz nada.
- **Conta desconhecida, revogada ou sem loja** → `200` e linha `recusado`.
  **Conta com status `erro`** → `200` e linha `descartado` (menos evento de
  sessão, que é justamente o que pode recuperar a conta). Nenhum vira contato.
- **Falha ao persistir ou ao enfileirar** → `500`, para o provedor reentregar.
- **Modelo da Meta** (`message_template_status_update`) chega pela WABA, que
  mora cifrada na credencial: a linha nasce sem conta e dispara
  `sincronizar-templates` para as contas oficiais.
- **Evento de sessão do uazapi** dispara `conferir-sessao-uazapi` da conta.
- O diário guarda só os cabeçalhos `content-type`, `user-agent`,
  `x-request-id` e a **presença** da assinatura. O token da instância que o
  uazapi repete no corpo é retirado antes de gravar.

## Credenciais (cofre)

- Só no cofre (`seguranca/cofre.ts`): AES-256-GCM, AAD = id da linha. O id
  nasce antes do INSERT porque o envelope precisa dele. Sem `INTEGRATIONS_KEY`
  a action responde `CONFIGURACAO` (503) **antes** de gravar.
- A tela vê só as chaves e os 4 últimos caracteres. Credencial ilegível aparece
  como "não foi possível ler esta credencial" e não derruba a lista.
- Chaves por provedor: WhatsApp oficial `access_token` + `waba_id`; uazapi
  `token`; Instagram `page_access_token`; Bling `access_token` +
  `refresh_token` (preenchidas pelo OAuth).
- **uazapi**: o segredo do webhook é gerado no servidor e mostrado **uma vez**,
  junto do endereço. O banco guarda só o SHA-256.
- **Desconectar**: apaga `credenciais_cifradas`, `credenciais_aad` e
  `segredo_webhook_hash`, carimba `revogada_em` e marca a linha excluída (duas
  linhas de trilha: `integracao_alterada` e `integracao_desconectada`). A
  referência fica livre para conectar de novo.

## OAuth do Bling

1. `iniciarConexaoBling` grava `__Host-merlo.oauth_nonce` (HttpOnly,
   SameSite=Lax, 5 min) e devolve a URL de autorização com `state` assinado
   (`assinarEstado`) e `redirect_uri` de `BLING_REDIRECT_URI`.
2. `GET /api/integracoes/bling/callback`: sessão viva com
   `integracoes:conectar` → `state` válido, do mesmo usuário, igual ao cookie e
   de **uso único** (`SET NX`) → troca do `code` com `client_id:client_secret`
   em Basic → credencial no cofre. Qualquer falha é a mesma recusa e volta para
   a tela com `?bling=expirado|negado|invalido|falhou|sem-permissao`.
3. A conta da rede é **única** (loja nula): reconectar atualiza a linha viva.
   Ao conectar, sai um `sincronizar-bling`.
4. PKCE não entra: o Bling v3 não documenta suporte.

Os dois POST do OAuth (`www.bling.com.br/Api/v3/oauth/token`) moram aqui, não
em `integracoes/bling/` (pacote M4): a conexão é deste pacote.

## Jobs da fila `integracoes`

Agendadores (`fila/agendamentos.ts`): `sincronizar-templates` a cada 30 min
(minutos 23 e 53), `renovar-token` de hora em hora (minuto 40; o token de
acesso do Bling vale 6 h), `sincronizar-bling` de hora em hora (minuto 17) e
`conferir-sessao-uazapi` a cada 10 min.

Sem carga (agendador), cada job faz o fan-out: um job por conta, `jobId`
determinístico por janela de 10 minutos. Com `integracaoId`, trabalha a conta.

| Job | O que faz | Erro permanente |
|---|---|---|
| `sincronizar-bling` | chama `sincronizarCatalogoBling` (pacote M4) | sobe (a fila e M4 decidem) |
| `sincronizar-templates` | lê a Graph API e atualiza `status`, `meta_template_id`, `motivo_rejeicao`, `aprovado_em` dos modelos que já existem aqui (casando nome + idioma); rascunho não é tocado. Ações: `template_enviado`, `template_aprovado`, `template_rejeitado`, `template_pausado` | conta vira `erro` com o motivo |
| `renovar-token` | gira o refresh do Bling sob `pg_advisory_xact_lock` | conta vira `expirado` |
| `conferir-sessao-uazapi` | pergunta o estado ao uazapi e grava `conectado`/`desconectado` | token recusado: conta vira `erro` |

Mudança de status publica `integracao-atualizada` no canal da loja. Estado
escrito pelo worker usa `contextoDeSistema({ origem: "worker", lojaId })`, de
`@/lib/db/mutacoes`: `ator_tipo = 'sistema'` e `ator_id`/`modified_by` =
`ATOR_SISTEMA`. `ultimo_erro` e `ultima_sincronizacao` passam por
`atualizarContador` (sem trilha). O job fecha a linha do diário com
`registrarProcessamentoEvento(tx, id, { tipo, projecao })`.

## Envio de modelo para aprovação (costura do M6)

`enviarModeloParaAprovacao(ctx: ContextoDeGravacao, templateId)` devolve
`{ templateId, externoId, status }`. A permissão (`modelos:enviar_aprovacao`,
gerente para cima) é conferida pela action do M6.

- Só `rascunho` e `rejeitado` saem; outro status é `VALIDACAO`. Modelo de outra
  loja ou excluído é `NAO_ENCONTRADO`.
- A conta do modelo precisa ser WhatsApp oficial com `waba_id` e
  `access_token`; senão, `INTEGRACAO` permanente.
- Sem `meta_template_id`, cria em `POST /{waba}/message_templates`; rejeitado
  com id da Meta é editado em `POST /{meta_template_id}` (criar de novo com o
  mesmo nome é recusado lá).
- Componentes: cabeçalho de texto, corpo, rodapé e botões (URL, telefone,
  resposta rápida). A Meta exige um exemplo por variável; vai `exemplo N`.
  Cabeçalho de mídia e categoria `authentication` são recusados (exigem upload
  por handle e botão de código).
- A chamada à Graph fica fora de transação. Depois, `atualizarComTrava` grava
  `status`, `meta_template_id`, `enviado_em` e limpa `motivo_rejeicao`, com a
  ação `template_enviado`. Se alguém editou o modelo durante o envio, a trava
  recusa com `COLISAO`.
- A Meta recusando o modelo (4xx fora 429) é `INTEGRACAO` permanente com o
  motivo dela; 429 e 5xx são transitórios.

## Telas

- `/configuracoes`: cartões Lojas, Integrações e Usuários, cada um só para
  quem alcança.
- `/configuracoes/lojas`: tabela (cartões no celular). Criar e editar passam
  pelo block de 3 s com o diff "de X para Y" (sigla incluída) e o aviso de que
  a sigla entra no número do pedido. O depósito do Bling é escolhido na lista
  da conta da rede (`listarDepositosBling`, costura do M4; inativos ficam de
  fora e o atual que sumiu do Bling continua, marcado). Se o Bling não
  responde, a página segue aberta e o número é digitado. Desativar tem block; é recusado enquanto a
  loja tiver pessoa ativa ou conta conectada.
- `/configuracoes/integracoes`: status, validade, último erro e o final da
  credencial. "Conectar número ou conta" (canal e loja em rádio, um campo por
  chave, senha oculta) e "Conectar Bling" (só quando o ambiente tem
  `BLING_CLIENT_*`).
- `/configuracoes/integracoes/[id]`: dados, renomear e trocar loja,
  reautenticar, últimos 20 eventos do diário (sem corpo), desconectar (block) e,
  no uazapi, parear novo aparelho (block → QR gerado no servidor com contagem
  de 45 s e consulta do estado a cada 5 s). Conta de outra loja é 404.

## Testes

| Arquivo | Prova |
|---|---|
| `tests/unidade/integracoes-payload.test.ts` | roteamento por conta, N anexos = 1 item, ids estáveis, ilegível não lança, token fora do diário, validadores |
| `tests/seguranca/webhooks.test.ts` (T15) | uazapi real: POST forjado não grava, repetido = 1 linha e 1 job, conta com erro descartada, sessão dispara conferência |
| `tests/integracao/integracoes-meta.test.ts` | lote com duas contas em duas lojas, assinatura forjada, conta desconhecida `recusado`, modelo dispara sincronização, challenge por canal |
| `tests/integracao/integracoes-oauth.test.ts` | cookie ausente/errado, state de outra sessão, expirado, adulterado e reusado recusados sem tocar a rede; Basic sem segredo no corpo; conta de rede única; refresh e expiração |
| `tests/integracao/integracoes-contas.test.ts` | cofre, hash do segredo, único da referência, máscara dos 4 caracteres, ilegível, desconectar, colisão, estado de sistema com `ATOR_SISTEMA`, lojas |
| `tests/integracao/integracoes-worker.test.ts` | modelos da Meta (aprovado, rejeitado, pausado), fan-out que fecha o evento, sessão do uazapi, falha transitória sobe, envio para aprovação (criar, editar rejeitado, escopo, recusa da Meta, componentes) |
| `tests/componentes/integracoes-telas.test.tsx` | block de desconectar, parear e desativar loja; campos por chave; segredo mostrado uma vez; depósito em lista ou digitado; estados vazios; axe |

Rodar no banco do pacote: `node scripts/db-teste.mjs --sufixo m5` e os testes
com `DATABASE_URL_TESTE=postgres://…/merlostore_test_m5` e
`REDIS_URL=redis://localhost:6382/5`.

## Pendências

- Os caminhos e o cabeçalho da API do uazapi (`/instance/status`,
  `/instance/connect`, cabeçalho `token`) vêm do padrão público e não foram
  conferidos no Swagger da instalação; estão em três constantes de
  `src/lib/integracoes/uazapi.ts`.
- Exemplos dos modelos enviados à Meta são genéricos (`exemplo N`): o modelo não
  guarda exemplo por variável.
