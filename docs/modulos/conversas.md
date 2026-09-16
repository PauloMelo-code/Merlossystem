# Módulo de atendimento e canais (pacote M1)

A tela principal do sistema: entrada de mensagem ponta a ponta, envio, reenvio,
nota interna, transferência, resolver/reabrir/arquivar e tempo real. Fontes:
`01-dados-dominio.md §2`, `03-arquitetura.md §9, §10, §11`, `04-ui.md §5.2,
§6.2, §8.1`, `02-seguranca.md §2.2` (chaves `conversas:*`).

## Tabelas

| Tabela | Uso |
|---|---|
| `conversas` | uma aberta por par (contato, conta de entrada); `integracao_id` decide a conta de SAÍDA |
| `conversas_mensagens` | escrita uma vez; estado de entrega monotônico; `ocorrida_em` é o horário do provedor |
| `conversas_mensagens_midias` | N anexos por mensagem; `url_externa` é coluna de TRABALHO do download |
| `lojas_integracoes_eventos` | diário de ingestão: o processamento marca `processado_em` e troca o corpo pela projeção mascarada |
| `contatos` | casamento na entrada (3 passos, `upsertContatoPorCanal`) |
| `lojas_integracoes`, `lojas_integracoes_templates`, `respostas_rapidas`, `lojas_etiquetas`, `contatos_etiquetas`, `usuarios`, `usuarios_sessoes`, `auditoria_eventos` | só leitura |

## Onde mora

| Caminho | Papel |
|---|---|
| `src/lib/canais/tipos.ts` | contrato `AdaptadorDeCanal` (§10.1). Puro |
| `src/lib/canais/normalizacao.ts` | peças puras: JSON que nunca lança, instante, telefone E.164, prévia, classificação de erro |
| `src/lib/canais/whatsapp-oficial.ts` · `instagram.ts` · `uazapi.ts` | parser do webhook (puro, nunca lança) e envio pela porta HTTP injetada |
| `src/lib/canais/registro.ts` | fábrica única `criarAdaptador(conta)`, credencial do cofre, sem fallback de ambiente |
| `src/lib/conversas/regras.ts` | bloqueio do composer, aviso inline, cursor `(instante, id)`, escala de entrega. Puro |
| `src/lib/conversas/_consultas.ts` | leituras de tela (lista, conversa, mensagens, mídias sem `url_externa`, painel, colegas, modelos, respostas, eventos de sistema) |
| `src/lib/conversas/_consultas-canal.ts` | leituras do caminho de máquina (evento, conta, par, mensagem para envio) |
| `src/lib/conversas/_gravacao.ts` | regra ÚNICA de mesclagem de conversa, inserção de mensagem, cache da conversa, `registrarProcessamentoEvento` |
| `src/lib/conversas/ingestao.ts` | job `processar-evento`: conta → loja → contato → conversa → mensagem, descarte registrado |
| `src/lib/conversas/saida.ts` | COSTURA `registrarEnvio` (consumida por campanhas/agendadas) e `agendarEnvio` |
| `src/lib/conversas/envio.ts` | job `enviar-mensagem`/`reenviar`: conta da conversa, ritmo por conta, erro classificado |
| `src/lib/conversas/gestao.ts` | operações da tela: enviar/nota, reenviar, transferir, resolver, reabrir, arquivar, prioridade, marcar lida |
| `src/lib/conversas/leitura.ts` | montagem dos DTOs (`dto.ts`) |
| `src/lib/conversas/sessao-do-fluxo.ts` | reavaliação da sessão de um stream SSE aberto |
| `src/lib/actions/conversas.ts` · `src/lib/validadores/conversas.ts` | actions e entradas |
| `src/server/processadores/mensagens-{entrada,saida}.ts` | traduzem o job para o domínio e publicam o tempo real depois do commit |
| `src/server/sse.ts` · `src/app/api/eventos/route.ts` | stream SSE |
| `src/app/(app)/conversas/**` | telas (exceto `painel-venda.tsx` e `seletor-produto.tsx`, do pacote de pedidos) |

## Permissões

| Chave | Onde |
|---|---|
| `conversas:ler` | lista, conversa, histórico, resumo (polling), opções dos filtros |
| `conversas:escrever` | enviar, nota interna, reenviar, marcar como lida |
| `conversas:gerir` | transferir, resolver, reabrir, arquivar, prioridade |

A loja de quem grava é a da PRÓPRIA conversa, conferida pelo escopo da pessoa:
gestão em "todas as lojas" não escolhe loja nenhuma, e a trilha sai com a loja
do registro. Conversa de outra loja responde 404.

## Regras que o código garante

- **Conta de saída**: `conversas.integracao_id`. O dado do job não decide, e não
  existe conta de ambiente. Conta desconectada, sem credencial ou de outra loja
  falha fechado com motivo em texto.
- **Entrega monotônica**: `pendente < enviada < entregue < lida`; `falhou` só sai
  por `reivindicarReenvio` (claim atômico; o segundo clique recebe `COLISAO`).
- **Reenvio** vai para o job `reenviar` com id próprio por tentativa (o id do
  envio original faria o BullMQ descartar o job); quem impede reenvio duplo é o claim.
- **Idempotência**: `(loja_id, externo_id)` na entrada; `(conversa_id,
  chave_idempotencia)` no envio (uuid gerado na bolha otimista e pelo lote).
- **`deMim`** (uazapi, enviada pelo aparelho) é gravada como saída, autor
  `usuario` sem id, com `metadados.enviada_pelo_aparelho`. O eco do que o
  próprio sistema enviou pela API (`wasSentByApi`) é descarte registrado.
- **Descarte** (grupo, eco, tipo não suportado, sem remetente) não vira contato
  nem conversa: fica na projeção do evento, e evento só com descarte vira
  `tipo = 'descartado'`.
- **Várias mídias = uma mensagem com N linhas**. Card é `metadados.card`.
- **Mídia**: a tela só vê `/api/midias/<midia_id>`. Binário da Meta é baixado com
  a credencial e guardado pela costura do pacote de mídia; URL (uazapi,
  Instagram) nasce em `url_externa` e o job `midia/baixar-de-url` é agendado
  depois do commit. Download que falhou aparece como "Mídia indisponível".
- **Conversa resolvida reabre** na entrada e no envio (trilha
  `conversa_reaberta`); **arquivada não**: nasce outra.
- **Composer bloqueado em quatro casos**: janela de 24 h (só WhatsApp oficial,
  por `ultima_entrada_em`), número desconectado, papel sem escrita e sem
  conexão. O servidor refaz o veredito no envio. Opt-out não bloqueia.
- **Contadores** (`nao_lidas`, `ultima_*`, `primeira_resposta_em`) passam por
  `atualizarContador`: nunca envelhecem o `updated_at` que a tela levou.
- **Eventos de sistema** da linha do tempo saem da trilha de negócio.
- **Ritmo por conta**: 1 msg/s no uazapi, 10 msg/s no oficial e no Instagram.

## Tempo real

- Um assinante Redis por processo (`psubscribe loja:* usuario:*`) e fan-out em
  memória. Gestão em "todas as lojas" recebe todas.
- Teto por pessoa (3; 2 para dono e admin) ANTES do teto da instância
  (`EVENTOS_MAX_CONEXOES`, 503). O corte sai no log como `sse_limite_atingido`.
- Heartbeat de 25 s com reavaliação da sessão sem renovar atividade: conta
  desativada, papel ou loja trocados, sessão encerrada, inatividade de 60 min ou
  12 h de stream fecham com `sessao-invalidada`. `usuario:<id>:revogar` fecha na hora.
- O evento não carrega conteúdo. A tela reconcilia com leitura completa a cada
  evento e ao reconectar; duas falhas seguidas passam a polling de 15 s.

## Telas

`/conversas` e `/conversas/[id]`: lista (filtros na URL, "Carregar mais",
pílula de atualizações), conversa (cabeçalho, linha do tempo, composer com nota
interna, respostas rápidas por `/`, modelo aprovado quando a janela fecha) e
painel do contato (pedidos pelo componente do pacote de pedidos, etiquetas,
outras conversas, opt-out). Resolver, reabrir, arquivar, transferir e mudar
prioridade executam já, com "Desfazer" por 5 s usando o `updated_at` devolvido.

## Testes

| Arquivo | Prova |
|---|---|
| `tests/unidade/conversas-parsers.test.ts` | parser dos 3 provedores com payload fixo, envio pela porta HTTP, erro classificado |
| `tests/unidade/conversas-regras.test.ts` | bloqueios, avisos, uma prova por transição de entrega, cursor, normalização |
| `tests/unidade/dto-midia.test.ts` | nenhum `url_externa` no caminho de leitura |
| `tests/integracao/conversas-ingestao.test.ts` | entrada ponta a ponta, idempotência, reabertura, recibos, descarte, `deMim` |
| `tests/integracao/contato-upsert.test.ts` | `upsertContatoPorCanal` com contato de CRM sem `whatsapp_id` |
| `tests/integracao/conversas-envio.test.ts` | envio, reenvio, transitório × permanente, conta da conversa, janela, costura |
| `tests/integracao/conversas-gestao.test.ts` | Desfazer, colisão, transferência, 404, cursor sem pular, DTO |
| `tests/integracao/conversas-sse.test.ts` | fechamento por sessão e por revogação, teto por pessoa antes do global, fan-out |
| `tests/componentes/conversas-composer.test.tsx` | quatro bloqueios, nota interna, falha com motivo visível |

Rodar no banco do pacote: `node scripts/db-teste.mjs --sufixo m1` e os testes com
`DATABASE_URL_TESTE=postgres://dev:dev@localhost:5437/merlostore_test_m1` e
`REDIS_URL=redis://localhost:6382/1`.

## Pendências (dependem de arquivo de outro dono)

- `upsertContatoPorCanal` (`src/lib/db/mutacoes.ts`) não reconhece a colisão de
  telefone porque o Drizzle 0.45 embrulha o erro do pg em `cause`. A ingestão
  roda o passo 2 antes, pelo helper com trava, até a correção.
- `ACOES_AUDITADAS` não tem `mensagem_recebida`, `conversa_criada` nem
  `conversa_arquivada`: gravam com a ação mais próxima (`_sistema.ts`), e o
  `depois` da trilha carrega a verdade.
- `ATOR_SISTEMA` não existe: worker e webhook gravam com autor nulo.
- `externo_id` não está em `ESTADOS_DE_SISTEMA.conversas_mensagens`: o id do
  provedor é gravado por `atualizarComTrava`.
- `MetadadosMensagem` não declara `modelo` nem `enviada_pelo_aparelho`.
- Envio de mídia pela tela: falta costura de leitura do binário (pacote de
  mídia) e `buscarExterno` só aceita corpo texto (upload multipart da Graph).
  Sem isso não há botão "Anexar" (nada de tela de fachada).
- O contador "N sem resposta" do topo da lista só se atualiza na navegação
  (vem do servidor com a página).
- `executarAcao` não aceita `renovaAtividade: false`: o polling de degradação
  renova a atividade da sessão.
