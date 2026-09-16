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
| `src/lib/integracoes/roteamento.ts` | os três webhooks sobre `rotaDeMaquina` (`webhookWhatsapp`, `webhookInstagram`, `webhookUazapi`) |
| `src/lib/integracoes/diario.ts` | `registrarEventoRecebido` (INSERT idempotente) e `registrarProcessamentoEvento` (via `atualizarEstado`) |
| `src/lib/integracoes/contas.ts` | conectar por token, editar, substituir credencial, desconectar, estado escrito pelo sistema |
| `src/lib/integracoes/oauth.ts` | OAuth do Bling (início, retorno, renovação sob `pg_advisory_xact_lock`) |
| `src/lib/integracoes/sessao.ts`, `uazapi.ts` | sessão do número não oficial: parear (QR) e conferir |
| `src/lib/integracoes/meta/graph.ts`, `meta/modelos.ts` | leitura dos modelos na Graph API e sincronização de status |
| `src/lib/integracoes/_consultas.ts`, `_sistema.ts` | leituras com `vivos()`/`condicaoDeLoja()` e o contexto de sistema |
| `src/lib/actions/lojas.ts` | `listarLojas`, `criarLoja`, `editarLoja`, `desativarLoja` |
| `src/lib/actions/integracoes.ts` | `listarIntegracoes`, `detalharIntegracao`, `conectarContaPorToken`, `editarIntegracao`, `reautenticarIntegracao`, `desconectarIntegracao`, `parearAparelho`, `consultarSessaoDoAparelho`, `iniciarConexaoBling` |
| `src/lib/validadores/lojas.ts`, `integracoes.ts` | Zod compartilhado com a tela |
| `src/app/api/webhooks/whatsapp/route.ts`, `instagram/route.ts`, `uazapi/[integracaoId]/route.ts` | borda de máquina |
| `src/app/api/integracoes/bling/callback/route.ts` | retorno do OAuth |
| `src/app/(app)/configuracoes/page.tsx` | índice em cartões, filtrado por papel no servidor |
| `src/app/(app)/configuracoes/lojas/` | lista, criar/editar com block e diff, desativar |
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

Sem carga (agendador), cada job faz o fan-out: um job por conta, `jobId`
determinístico por janela de 10 minutos. Com `integracaoId`, trabalha a conta.

| Job | O que faz | Erro permanente |
|---|---|---|
| `sincronizar-bling` | chama `sincronizarCatalogoBling` (pacote M4) | sobe (a fila e M4 decidem) |
| `sincronizar-templates` | lê a Graph API e atualiza `status`, `meta_template_id`, `motivo_rejeicao`, `aprovado_em` dos modelos que já existem aqui (casando nome + idioma); rascunho não é tocado | conta vira `erro` com o motivo |
| `renovar-token` | gira o refresh do Bling sob `pg_advisory_xact_lock` | conta vira `expirado` |
| `conferir-sessao-uazapi` | pergunta o estado ao uazapi e grava `conectado`/`desconectado` | token recusado: conta vira `erro` |

Mudança de status publica `integracao-atualizada` no canal da loja. Estado
escrito pelo worker usa o contexto de sistema (`ator_tipo = 'sistema'`,
`modified_by` nulo); `ultimo_erro` e `ultima_sincronizacao` passam por
`atualizarContador` (sem trilha).

## Telas

- `/configuracoes`: cartões Lojas, Integrações e Usuários, cada um só para
  quem alcança.
- `/configuracoes/lojas`: tabela (cartões no celular). Criar e editar passam
  pelo block de 3 s com o diff "de X para Y" (sigla incluída) e o aviso de que
  a sigla entra no número do pedido. Desativar tem block; é recusado enquanto a
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
| `tests/integracao/integracoes-contas.test.ts` | cofre, hash do segredo, único da referência, máscara dos 4 caracteres, ilegível, desconectar, colisão, estado de sistema, lojas |
| `tests/integracao/integracoes-worker.test.ts` | modelos da Meta, fan-out que fecha o evento, sessão do uazapi, falha transitória sobe |
| `tests/componentes/integracoes-telas.test.tsx` | block de desconectar, parear e desativar loja; campos por chave; segredo mostrado uma vez; estados vazios; axe |

Rodar no banco do pacote: `node scripts/db-teste.mjs --sufixo m5` e os testes
com `DATABASE_URL_TESTE=postgres://…/merlostore_test_m5` e
`REDIS_URL=redis://localhost:6382/5`.

## Pendências (dependem da fundação)

- `registrarProcessamentoEvento` e o INSERT do diário deveriam morar em
  `src/lib/db/mutacoes.ts`; hoje estão em `diario.ts` (o INSERT por
  `execute(sql…)`, como `auditoria/gravador.ts`).
- `ATOR_SISTEMA` não existe: o worker grava com autor nulo (mesma solução do
  pacote M1).
- O CHECK `lojas_integracoes_templates_nome` (migração 0011) usa `{1,512}`, que
  o Postgres recusa: todo INSERT/UPDATE de modelo falha até a migração ser
  corrigida — inclusive a sincronização. O caso de teste correspondente fica
  pulado enquanto o CHECK estiver quebrado.
- `ACOES_AUDITADAS` não tem `template_pausado`: modelo pausado na Meta não é
  aplicado (fica em log).
- Agendamentos: `sincronizar-templates` roda de hora em hora (o documento pede
  30 min), `renovar-token` uma vez por dia (o token de acesso do Bling vale
  6 h) e não existe agendador de `sincronizar-bling`.
- A lista de depósitos do Bling na tela de lojas depende do cliente de M4; hoje
  o depósito é digitado.
