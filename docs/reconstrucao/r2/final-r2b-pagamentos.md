# R2-PG — Pagamentos (Pix e link) · ESPECIFICAÇÃO FINAL

- **Pacote**: `R2-PG` (onda 3 do R2). **Base**: `refactor/reconstrucao-estrutura-base` @ `9481ef8` (fundação commitada). Módulos M1..M8 são citados pela especificação (`spec/final/*`), nunca pelo código em construção.
- **Substitui** `rascunho-r2b-pagamentos.md`. O construtor lê **só este documento** e as entradas listadas no §9.
- **Fontes**: `levantamento/02-crm-vendas.md` §2.4, §6, §7, §14 · `levantamento/06-travas-e-decisoes.md` (INV-46, T-32) · `final/01-dados-dominio.md` §6.3–§6.6 · `final/01-dados.md` §4, §6.3, §6.4, §7.4 · `final/02-seguranca.md` §2.2, §12, §13, §17, §20 · `final/03-arquitetura.md` §4, §6.4, §8, §11, §12 · `final/04-ui.md` §2.4, §5.3, §7, §9, §10 · `final/05-plano-construcao.md` §2, §5, §6, §8 · código em `HEAD`: `schema/pedidos/{pagamentos,pedidos}.ts`, `schema/integracoes.ts`, `schema/_enums/*`, `db/mutacoes.ts`, `db/listas-fechadas.ts`, `actions/_base.ts`, `auditoria/gravador.ts`, `seguranca/{maquina,assinaturas,cofre,limite}.ts`, `rede/buscarExterno.ts`, `fila/*`, `server/worker.ts`, `ui/tons.ts`, `qr.ts`, `formato.ts`, `erros.ts`.
- **CONFERIR** = contrato do Mercado Pago não verificado contra conta real. Vive **só** em `src/lib/pagamentos/provedores/mercadopago/config.ts`; a trava T-PG-12 impede que vaze.
- **Numeração fixada pelo orquestrador**: ADRs deste cluster **0036–0041**; compartilhados **0033** (estorno, fusão R2-A + R2-PG) e **0049** (action sem transação, fusão R2-PG + R2-C). Migrações do R2: **`0018_r2`** (gerada, única para todos os clusters) + **`0019_r2_integridade`** (custom). Banco de teste `merlostore_test_r2pg`, **Redis índice 10**.

---

## 1. Escopo e o que o sistema antigo tinha

### 1.1 Escopo

**Entra**
1. **Conta de pagamento por loja** (Mercado Pago; provedor simulado só fora de produção), credencial no cofre, identidade da conta fixa, teste, troca de credencial da mesma conta e desconexão.
2. **Cobrança de um pedido** por **Pix** (copia-e-cola + QR na tela) ou **link de pagamento** (Checkout do Mercado Pago), valor calculado no servidor.
3. **Envio da cobrança à cliente** pela conversa de origem do pedido, por ação humana.
4. **Confirmação só pelo provedor**: webhook assinado por conta → diário → fila → **consulta de volta** → conferência (loja, referência, id, valor, moeda, conta) → transição monotônica → `pedidos.pagamento_status` calculado num lugar só.
5. **Cancelamento** (pessoa ou cancelamento do pedido), **expiração confirmada no provedor**, **conciliação** noturna, **estorno/chargeback** registrados quando o provedor informa.
6. **Alertas** pelo gerador de M8 (Pix pendente há 20 min; "pagamento para conferir").
7. **Teto de estorno e estado de pagamento do pedido** num módulo puro compartilhado com o R2-A (`src/lib/pagamentos/situacao.ts`).

**Não entra (decisão conservadora, com ADR)**
- Baixa manual ("marcar pago") — não existe (ADR 0038). Dinheiro, maquininha e Pix direto na conta da loja vivem no Masc.
- Estorno iniciado pelo sistema — não existe (ADR 0033). Estorno é feito no painel do Mercado Pago e chega por webhook ou conciliação.
- Asaas e PagBank — ficam no `CHECK`, sem adaptador (ADR 0037).
- Cobrança parcial, parcelamento configurável, boleto, split, recorrência.
- Mensagem automática à cliente ("recebemos seu pagamento") e QR enviado como imagem (ADR 0041). `pagamentos.qrcode_midia_id` fica sempre nulo.
- Escrita em ERP (Masc/Bling) por causa de pagamento (ADR 0004).
- Mudança na "Receita" dos relatórios (continua "pedidos com `masc_status = 'lancado'`", `04-ui.md §5.5`).
- Evento de tempo real próprio: a tela usa atualização periódica enquanto há cobrança pendente visível (§7.1).

### 1.2 O que o sistema antigo tinha (commit `5e902d4`, só domínio)

| Peça | Comportamento antigo |
|---|---|
| `src/lib/payments/{types,index,mock-provider}.ts` | interface `generatePix/generatePaymentLink/getPaymentStatus/refund`; `getPaymentProvider()` **sempre** devolvia o mock; Pix falso (`pix_<ts>_<rand>`, 30 min), link `https://pay.mock.dev/...` (24 h); `getPaymentStatus` sempre `pending` e nunca chamado |
| `POST /api/payments/pix` e `/link` | cobrança sobre `orders.total`, grava `payments` `pending` com QR em data-URI na linha, marca `orders.payment_method` **fora de transação**; link sem tela |
| `POST /api/webhooks/payments` | segredo compartilhado (`x-webhook-secret`/`asaas-access-token`); `external_id` **global**; status por **substring**; `approved` marca pedido `paid`; **200 em qualquer erro** |
| `checkPendingPayments` | alerta `payment_pending` para Pix pendente há 20+ min |
| `/orders` | "Gerar Pix" sem modal; QR **nunca exibido**; `PUT /api/orders/[id]` deixava vendedor marcar `paid` sem pagamento |

Regras antigas preservadas: RN-PG1 (cobrança sobre o total; Pix 30 min, link 24 h), RN-PG2 (gerar grava pendente e a forma no pedido), RN-PG3 (só o gateway confirma; sem segredo = recusa), RN-PG4 (aprovado marca o pedido pago e entra na linha do tempo), RN-PG5 (alerta de Pix pendente há 20 min).

### 1.3 Defeitos que NÃO podem voltar (cada um tem teste no §9)

| ID | Defeito antigo | Resposta |
|---|---|---|
| P-01 | mock gravando pagamento "real" | simulado bloqueado em produção em 3 camadas (registro, rota, conexão) e simulação recusa pagamento real; "TESTE — não pague" em tudo |
| P-02 | webhook sem conferir valor, provedor, loja; `external_id` global | conta pela URL; consulta de volta com a credencial da loja; referência = `pagamentos.id` da mesma loja; valor em centavos, BRL, conta recebedora; único `(provedor, externo_id)` |
| P-03 | 200 em qualquer erro | falha ao persistir = 500; fila fora = 500; falha ao processar = fila com retentativa/DLQ |
| P-04 | sem idempotência; status regride | diário único `(provedor, evento_externo_id)`; claim `WHERE status IN (…)`; aprovado nunca regride |
| P-05 | status por substring | mapa fechado em `config.ts`; valor fora do mapa = evento `falhou` |
| P-06 | estorno não chega ao pedido; expiração nunca marcada | estado do pedido recalculado por `situacao.ts`; expiração só com o provedor confirmando |
| P-07 | cobrança para pedido cancelado/pago, várias pendentes | R2-PG-01..03; índice único parcial; trava do pedido `FOR UPDATE` |
| P-08 | segredo compartilhado | HMAC da aplicação do Mercado Pago, por loja |
| P-09 | sem loja, autor, `updated_at`, trilha | colunas existentes; trilha `pagamento_*` na mesma transação |
| P-10/P-11 | QR nunca mostrado; QR em data-URI no banco | QR gerado sob demanda a partir do copia-e-cola, não persistido |
| O-04 / A-04 | vendedor marca `paid`; receita manipulável | sem baixa manual; `'manual'` sai do `CHECK`; `pagamentos:marcar_pago` removida |
| O-13 | "Gerar Pix" sem modal | gerar e cancelar cobrança com block de 3 s |
| O-14 | evento de pagamento misturado com status do pedido | ações próprias na trilha (`pagamento_gerado/confirmado/estornado/cancelado/status_alterado`) |

---

## 2. Regras de negócio

### 2.1 Cobrança

| ID | Regra | ADR |
|---|---|---|
| **R2-PG-01** | Só recebe cobrança o pedido **vivo** da loja resolvida com `status ∉ {cancelado, devolvido}` e `pagamento_status ∉ {pago, estornado}`. Pedido com `masc_status = 'lancado'` pode receber, e o resumo do block avisa: "Este pedido já foi lançado no Masc. Confira se o pagamento não foi registrado lá." | 0039 |
| **R2-PG-02** | Valor = `pedidos.total` lido **sob trava**, em centavos (`paraCentavos`). Nenhum campo de valor na entrada. `total = 0` → recusa. `pedidoAtualizadoEm` diferente do `updated_at` travado → `ErroDeColisao`. | 0039 |
| **R2-PG-03** | **Uma** cobrança `pendente` por pedido (índice `uq_pagamentos_um_pendente`). Pendente ainda válida → recusa com "Este pedido já tem uma cobrança aguardando pagamento." Pendente vencida ainda não conferida → recusa com "A cobrança anterior venceu e está sendo conferida no Mercado Pago. Tente de novo em alguns minutos." Trocar de método exige cancelar a pendente. | 0039 |
| **R2-PG-04** | Métodos: `pix` (validade 30 min padrão; opções fechadas 30, 120, 1440 min) e `link` (validade fixa 1440 min; cartão ou Pix na página do provedor; **boleto e lotérica excluídos**). | 0039 |
| **R2-PG-05** | Gerar cobrança é ação crítica (block 3 s). Ordem: pré-checagem → chamada ao provedor **fora de transação** com idempotência = `pagamentos.id` (uuid gerado antes) → transação curta que trava o pedido, reconfere R2-PG-01..03 e `updated_at`, insere `pagamentos` e grava `pedidos.forma_pagamento` (só se mudou). Se a transação falhar, o sistema tenta **cancelar no provedor** a cobrança recém-criada (melhor esforço, fora de transação, erro só em log) e devolve o erro da transação. | 0049 |
| **R2-PG-06** | Mercado Pago só é oferecido com `PAGAMENTOS_MERCADOPAGO ≠ desligado`. Em `teste`, só token com prefixo de teste; em `producao`, só token de produção (prefixos em `config.ts`). Desligar **não** interrompe a confirmação de cobranças já criadas. | 0037 |

### 2.2 Confirmação

| ID | Regra | ADR |
|---|---|---|
| **R2-PG-07** | **Só o provedor confirma.** Nenhuma tela, action, script ou job de pessoa leva pagamento a `aprovado`. `para: "aprovado"` existe só em `confirmacao.ts`. | 0038 |
| **R2-PG-08** | Mudança para `aprovado`/`estornado` exige **todas**: (a) assinatura válida da conta que a URL aponta (webhook) ou job do sistema; (b) estado lido **de volta** do provedor com a credencial da conta atual da loja; (c) `referencia` = `pagamentos.id` de pagamento **da loja da conta** e do **mesmo provedor**; (d) no Pix, id externo = `pagamentos.externo_id`; (e) valor em centavos = `pagamentos.valor`; (f) moeda `BRL`; (g) cobrança criada **enquanto a conta atual estava conectada** (`pagamentos.created_at ≥ lojas_integracoes.created_at`); (h) conta recebedora informada pelo provedor = conta guardada no cofre (quando o provedor informa). Falhou (c) → evento `descartado`. Falhou (d)(e)(f)(h) → nada muda, evento `falhou`, `erro = 'pagamento_conferir:valor_divergente' \| 'pagamento_conferir:id_divergente' \| 'pagamento_conferir:conta_divergente'`. Falhou (g) → nada muda, `erro = 'pagamento_conferir:conta_trocada'`. | 0038 |
| **R2-PG-09** | **Campo não assinado não decide.** No Mercado Pago só `data.id`, `x-request-id` e `ts` são assinados; `type` da query é gravado para diagnóstico e **nunca** decide descarte. Toda notificação autenticada com `data.id` vai para a consulta de volta. Notificação autenticada sem `data.id` é gravada como `descartado` com `evento_externo_id` **nulo** (não consome a chave de deduplicação). | 0038 |
| **R2-PG-10** | **Resposta vazia nunca é "não pago".** 404, busca sem a cobrança ou provedor fora do ar: nada muda; a cobrança continua `pendente`. Só a pessoa (R2-PG-15) pode cancelar uma cobrança que o provedor não encontra. | 0038 |
| **R2-PG-11** | Transições de `pagamentos.status` são monotônicas e por claim (§3.3). `aprovado` nunca volta a `pendente`, `recusado`, `cancelado` ou `expirado`. `estornado` é terminal. | 0038 |
| **R2-PG-12** | Aprovação que chega para cobrança `cancelado`, `expirado` ou `recusado`, ou para pedido `cancelado`/`devolvido`, **é registrada** (dinheiro recebido é fato), com `motivo` "pagamento recebido depois de <status>", e vira alerta (§5.6). Nunca estorna sozinho. | 0040 |
| **R2-PG-13** | Mapa do Mercado Pago (em `config.ts`): `pending`, `in_process`, `authorized` → pendente · `approved` → aprovado · `rejected` → recusado (**só Pix**; no link é ignorado, a cliente pode tentar outro cartão) · `cancelled` → `expirado` se `expira_em ≤ agora`, senão `cancelado` · `refunded` → estornado · `charged_back` → estornado + `erro 'pagamento_conferir:chargeback'` · `in_mediation` → sem mudança + `erro 'pagamento_conferir:disputa'` · fora do mapa → evento `falhou` com `erro = 'status_desconhecido:<valor>'`. Estorno parcial (`approved` com valor estornado > 0) → sem mudança + `erro 'pagamento_conferir:estorno_parcial'`. Link com 2+ pagamentos aprovados → aprova uma vez + `erro 'pagamento_conferir:duplicidade'`. Cobrança local `pendente`/`cancelado`/`expirado`/`recusado` que o provedor já mostra `estornado` passa por `aprovado` e depois `estornado` (duas linhas de trilha). | 0038 |
| **R2-PG-14** | **Ordem de trava fixa: `pedidos` antes de `pagamentos`.** Toda transação que muda pagamento trava primeiro o pedido (`SELECT … FOR UPDATE`), depois o pagamento (claim). | 0039 |

### 2.3 Cancelamento, expiração e conciliação

| ID | Regra | ADR |
|---|---|---|
| **R2-PG-15** | Cancelar cobrança: papel de operação, **motivo 8–255**, block 3 s. Antes, o provedor é consultado: já paga → registra o pagamento e devolve `jaPago`; pagamento de link em análise → recusa ("A cliente está com um pagamento em análise no Mercado Pago. Aguarde a conclusão para cancelar."); não paga → cancela no provedor e depois `pendente → cancelado`; **provedor não encontra** a cobrança → cancela aqui com o motivo e devolve `naoEncontrada` (a tela manda conferir no painel); **provedor fora do ar** → recusa, a cobrança continua valendo. | 0039 |
| **R2-PG-16** | Cancelar o pedido (M4) cancela, **na mesma transação**, as pendentes dele (`motivo = "pedido cancelado"`) e enfileira `cancelar-no-provedor`. Aprovação posterior cai na R2-PG-12. | 0040 |
| **R2-PG-17** | Cobrança vencida só vira `expirado` quando o provedor **encontra** a cobrança, mostra que **nada** foi pago nem está em análise, e o cancelamento lá dá certo (ou ela já estava encerrada). Qualquer outra resposta: continua `pendente`; depois de 30 min vencida, alerta (§5.6). | 0039 |
| **R2-PG-18** | Conciliação noturna relê do provedor as cobranças da conta atual (R2-PG-08 g): não aprovadas criadas nos últimos **7 dias** e aprovadas com `pago_em` nos últimos **90 dias**. Toda mudança passa por `aplicarEstadoExterno` com `motivo = 'conciliação'`. Cobranças de conta anterior não são relidas (limitação do ADR 0036). | 0039 |
| **R2-PG-19** | Notificação que não resolve para pagamento desta loja e deste provedor é `descartado`, sem alerta (a mesma conta recebe vendas da maquininha). | 0038 |

### 2.4 Envio, QR e dados do pagador

| ID | Regra | ADR |
|---|---|---|
| **R2-PG-20** | A cliente recebe a cobrança **só por ação humana**, pela conversa do pedido, via `registrarEnvio` (costura M1). A conversa tem de ser `pedidos.conversa_id`, **da mesma loja do pagamento, do mesmo `contato_id` do pedido e viva**; senão "Este pedido não veio de uma conversa." Pix = **duas** mensagens (resumo; código sozinho). Link = uma. Chaves de idempotência fixas (§7.1): no máximo uma vez por cobrança. Só cobrança `pendente` com `expira_em > agora + 1 min`. | 0041 |
| **R2-PG-21** | O QR é gerado **no servidor** a partir do copia-e-cola (`qrDeDataUrl`, `src/lib/qr.ts`), nunca por serviço externo, e **não é persistido**. | 0041 |
| **R2-PG-22** | E-mail do pagador (e CPF quando `config.ts` exigir) são digitados na hora, **enviados só ao provedor**; nunca em banco, log, trilha, job, Redis ou `valores` de erro. E-mail vem pré-preenchido de `contatos.email` quando existe. | 0041 |
| **R2-PG-23** | A descrição enviada ao provedor é `Pedido <numero> — <lojas.nome>`: sem nome da cliente, sem itens. | 0041 |

### 2.5 Conta de pagamento

| ID | Regra | ADR |
|---|---|---|
| **R2-PG-24** | Conta é **da loja** (no máximo uma viva por loja, índice `uq_lojas_integracoes_pagamento`), credencial no cofre, gerida por dono/admin; conectar, trocar credencial e desconectar exigem **sessão fresca**. Loja sem conta → cobrança desligada com aviso honesto. | 0036 |
| **R2-PG-25** | **Identidade fixa**: ao conectar, o id da conta no provedor (`contaExternaId`) vai para o JSON cifrado e para o `rotulo` (`Mercado Pago · conta <id>`), que aparece na tela e no diff da trilha. **Trocar credencial só aceita token da mesma conta**; outra conta → `ErroDeValidacao` "Este token é de outra conta do Mercado Pago (conta <id>). Para trocar de conta, desconecte esta e conecte a nova." | 0036 |
| **R2-PG-26** | Desconectar com cobrança `pendente` do provedor da conta na loja é recusado. Desconectar apaga a credencial, marca `revogada_em` e exclui logicamente a linha. Depois disso, estornos de cobranças antigas não chegam mais (o modal avisa). | 0036 |
| **R2-PG-27** | `pagamento_simulado` existe só com `NODE_ENV ≠ production`: registro lança, rota responde 404, conexão recusa, simulação recusa. A simulação só age sobre pagamento `provedor = 'pagamento_simulado'` em loja cuja conta viva é simulada. Tudo simulado mostra "TESTE — não pague". | 0037 |
| **R2-PG-28** | Resposta 401/403 do provedor em qualquer chamada → conta `status = 'erro'` + `ultimo_erro`; novas cobranças pausadas; o webhook continua aceitando (o segredo pode seguir válido) e o evento fica `falhou`. | 0036 |

### 2.6 Estado do pedido, estorno e ERP

| ID | Regra | ADR |
|---|---|---|
| **R2-PG-29** | `pedidos.pagamento_status` e o teto de estorno vêm de **um módulo só**, `src/lib/pagamentos/situacao.ts` (`statusPagamentoDoPedido`, `tetoDeEstorno`, `origemDoPagamento`), chamado por R2-PG (confirmação e estorno no provedor) e pelo R2-A (conclusão de devolução; `src/lib/devolucoes/_teto.ts` delega a ele), sempre com o pedido travado e na mesma transação do fato. Regra de estado: pedido **sem** pagamento no provedor (`recebido = aprovado + estornado no provedor = 0`) nunca tem `pagamento_status` mudado por pagamento nem por devolução (o sistema não registrou esse pagamento); `estornado` não muda mais; de `pago` vai a `estornado` quando não resta aprovado **ou** o estorno registrado cobre `min(total, recebido)`; de `pendente`/`cancelado` vai a `pago` quando há aprovado. | 0033 |
| **R2-PG-30** | **Teto de estorno** (R2-TR-10 do R2-A): `recebido > 0` → base = `min(total, recebido)` (origem `provedor`; o estornado no provedor **continua contando**, porque o estorno do painel pode chegar antes do registro); senão, `masc_status = 'lancado'` → base = `total` (origem `masc`: a venda de balcão é do Masc, ADR 0004, e não existe baixa manual); senão, base = 0 (origem `nenhuma`). Teto = `max(0, base − estorno já registrado)`. | 0033 |
| **R2-PG-31** | Pagamento **não** muda `pedidos.status`, `masc_*` nem a "Receita", **não** tira o pedido da fila "falta lançar" e **não escreve em ERP**. A seção mostra "Pago — falta lançar no Masc." quando cabe. | 0038 |

---

## 3. Modelo de dados usado

**Schema fechado para colunas e tabelas.** Nenhuma coluna nova. Mudanças de `CHECK` e índices estão no §10 (D-01, D-02, D-03).

### 3.1 Tabelas e colunas (conferidas em `HEAD`)

| Tabela | Colunas usadas | Uso |
|---|---|---|
| `pagamentos` | `id`, `loja_id`, `pedido_id` (FK composta `fkc_pagamentos_pedido` → `pedidos(id, loja_id)`, migração 0016), `provedor`, `metodo`, `status`, `valor` (`numeric(12,2)`, CHECK `> 0`), `externo_id`, `pix_copia_cola`, `link_pagamento`, `expira_em`, `pago_em`, `estornado_em`, `criado_por`, `created_at`, `updated_at`, `deleted_at`, `is_deleted`, `modified_by` | cobrança. `externo_id` = id do pagamento (Pix) ou da preferência (link). **`qrcode_midia_id` sempre nulo.** Índices existentes: `uq_pagamentos_externo`, `ix_pagamentos_pedido`, `ix_pagamentos_status`, `ix_pagamentos_expiracao`, `ix_pagamentos_loja` |
| `pedidos` | `id`, `loja_id`, `contato_id`, `conversa_id` (FK **simples** → conferir loja e contato no código), `numero`, `status`, `pagamento_status`, `total`, `forma_pagamento`, `masc_status`, `updated_at`, `is_deleted` | leitura sob trava; escrita só de `pagamento_status` e `forma_pagamento`, por `atualizarComTrava` |
| `pedidos_devolucoes` | `pedido_id`, `status`, `valor_estorno`, `is_deleted` | só leitura, em `situacao.ts` (estorno registrado = soma das `concluida` vivas) |
| `lojas_integracoes` | `id`, `loja_id`, `provedor`, `rotulo`, `status`, `credenciais_cifradas`, `credenciais_aad`, `ultimo_erro`, `ultima_sincronizacao`, `revogada_em`, `created_at`, `updated_at`, `is_deleted` | conta de pagamento. `referencia_externa`, `segredo_webhook_hash` e `expira_em` ficam **nulos** (roteamento pelo id na URL; o segredo do HMAC precisa estar em claro para calcular, então vai **cifrado**; a mesma conta do Mercado Pago pode servir duas lojas, então não há único por conta) |
| `lojas_integracoes_eventos` | todas | diário de ingestão (ADR 0017), escrito só por `registrarEventoRecebido` e `registrarProcessamentoEvento` (D-04) |
| `auditoria_eventos` | via `registrarAuditoria`; leitura de `acao`, `entidade`, `entidade_id`, `antes`, `motivo`, `ator_id`, `criado_em` | trilha; histórico de cancelamento e regra de alerta "aprovado depois de encerrado" |
| `alertas` | — | só pelo gerador de M8, a partir de `candidatosDeAlertaDePagamento` (§5.6) |
| `contatos` | `nome`, `email` | só leitura (resumo e pré-preenchimento) |
| `conversas` | `id`, `loja_id`, `contato_id`, `integracao_id`, `is_deleted` | conferência do envio (R2-PG-20) |
| `conversas_mensagens` | `conversa_id`, `chave_idempotencia`, `status_entrega`, `falha_motivo`, `created_at` | só leitura: situação do envio da cobrança |
| `lojas` | `nome`, `sigla` | resumo e descrição |
| `usuarios` | `nome` | "gerado por" |

Credencial no cofre (JSON cifrado com `cifrar(json, id)`, AAD = `lojas_integracoes.id`, id gerado antes do insert):

```ts
type CredencialMercadoPago = { accessToken: string; segredoWebhook: string; contaExternaId: string };
type CredencialSimulada = { segredoWebhook: string; contaExternaId: "simulada" }; // segredo gerado pelo sistema, nunca exibido
```

### 3.2 Listas fechadas (valores exatos após o §10)

- `PROVEDORES_PAGAMENTO` (`pagamentos.provedor`) = `mercadopago, asaas, pagbank, pagamento_simulado` (sai `manual`).
- `PROVEDORES_DE_PAGAMENTO` (contas que recebem dinheiro) = `mercadopago, pagamento_simulado`.
- `PROVEDORES` (integrações) = `whatsapp_oficial, uazapi, instagram, facebook, tiktok, tiktok_shop, bling, mercadopago, pagamento_simulado`.
- `FORMAS_PAGAMENTO` (vale para `pagamentos.metodo`) = `pix, cartao, boleto, link, dinheiro` — o R2 grava só `pix` e `link`.
- `STATUS_PAGAMENTO` = `pendente, aprovado, recusado, estornado, expirado, cancelado`.
- `STATUS_PAGAMENTO_PEDIDO` = `pendente, pago, estornado, cancelado` — `situacao.ts` produz `pago` e `estornado`; `cancelado` e `pendente` só são mantidos.
- `ACOES_AUDITADAS` ganha (deste cluster) `pagamento_cancelado`, `pagamento_status_alterado`.
- `TIPOS_ALERTA` ganha `pagamento_conferir`.
- `TIPOS_EVENTO_INTEGRACAO` (inalterada) = `recebido, recusado, descartado, processado, falhou`.

### 3.3 Estados e transições

**`pagamentos.status`** — única porta: `transicionarPagamento()` (D-04), claim atômico, depois do pedido travado.

| De \ Para | aprovado | recusado | expirado | cancelado | estornado |
|---|:--:|:--:|:--:|:--:|:--:|
| `pendente` | provedor | provedor (só Pix) | provedor confirma (R2-PG-17) ou `cancelled` vencido | pessoa (R2-PG-15), pedido cancelado (R2-PG-16) ou `cancelled` não vencido | — (passa por `aprovado`) |
| `recusado` | provedor + alerta | — | — | — | — |
| `expirado` | provedor + alerta | — | — | — | — |
| `cancelado` | provedor + alerta | — | — | — | — |
| `aprovado` | — | — | — | — | provedor |
| `estornado` | — (terminal) | — | — | — | — |

Ação da trilha (entidade `pagamentos`): `→ aprovado` = `pagamento_confirmado` · `→ estornado` = `pagamento_estornado` · `→ cancelado` = `pagamento_cancelado` (com `motivo`) · `→ recusado`/`→ expirado` = `pagamento_status_alterado` (com `motivo`). Inserção = `pagamento_gerado`.

**`pedidos.pagamento_status`** (entidade `pedidos`, `atualizarComTrava` com o `updated_at` lido sob `FOR UPDATE`; valor sempre de `statusPagamentoDoPedido`):

| Fato | Novo valor | Quem grava · ação da trilha |
|---|---|---|
| cobrança gerada | inalterado; `forma_pagamento` = método (só se mudou) | R2-PG · `pagamento_gerado` |
| pagamento aprovado, pedido `pendente`/`cancelado` | `pago` | R2-PG · `pagamento_confirmado` |
| pagamento aprovado, pedido já `pago` (duplicidade) ou `estornado` | inalterado | — (alerta §5.6) |
| estorno no provedor, pedido `pago`, não resta aprovado | `estornado` | R2-PG · `pagamento_estornado` |
| estorno no provedor com outro aprovado restante | inalterado (`pago`) | — (o alerta de duplicidade some quando só resta um) |
| devolução concluída cobrindo `min(total, recebido)`, pedido `pago` | `estornado` | R2-A · `pedido_status_alterado` |
| devolução de venda sem pagamento no provedor (origem `masc`) | inalterado | — |
| qualquer fato com pedido `estornado` | inalterado (idempotente) | — |

**`lojas_integracoes.status`** (conta de pagamento): nasce `conectado` · `erro` quando o provedor responde 401/403 · `conectado` de novo ao testar ou trocar credencial com sucesso · desconectar: `desconectado` + `revogada_em` + exclusão lógica.

**`lojas_integracoes_eventos.tipo`** (pagamento): `recebido` → `processado` | `descartado` | `falhou` (por `registrarProcessamentoEvento`, que troca `corpo` pela projeção `{ mascarado: true, pagamentoId, pedidoId, pagamentoExternoId, resultado }` no mesmo `UPDATE` e zera `cabecalhos`). `descartado` direto na ingestão só sem `data.id` (R2-PG-09). `erro` dos casos para conferir começa com `pagamento_conferir:` (`valor_divergente`, `id_divergente`, `conta_divergente`, `conta_trocada`, `duplicidade`, `estorno_parcial`, `disputa`, `chargeback`); outros: `credencial_recusada`, `conta_desconectada`, `status_desconhecido:<v>`.

---

## 4. Permissões

Arquivo novo `src/lib/auth/permissoes/pagamentos.ts` (D-06), dentro de `MATRIZ_ENTREGUE`.

| Chave | dono | admin | gerente | vendedor | viewer | Situação |
|---|:--:|:--:|:--:|:--:|:--:|---|
| `pagamentos:ler` | ✅ | ✅ | ✅ | ✅ | — | existia em `FASE_R2`; muda de arquivo |
| `pagamentos:gerar_cobranca` | ✅ | ✅ | ✅ | ✅ | — | idem; vale para gerar, enviar e simular |
| `pagamentos:cancelar_cobranca` | ✅ | ✅ | ✅ | ✅ | — | **nova**. Exceção escrita de INV-20: cancelar cobrança pendente não move dinheiro e é o caminho para trocar de método |
| `pagamentos:marcar_pago` | — | — | — | — | — | **removida** |
| `conversas:escrever` | ✅ | ✅ | ✅ | ✅ | — | existe; conferida **também** em envio pela conversa |
| `integracoes:ler` | ✅ | ✅ | — | — | — | existe — `/configuracoes/pagamentos` |
| `integracoes:conectar` | ✅ | ✅ | — | — | — | existe — conectar (sessão fresca) |
| `integracoes:editar` | ✅ | ✅ | — | — | — | existe — testar (sem frescor) e trocar credencial (sessão fresca) |
| `integracoes:desconectar` | ✅ | ✅ | — | — | — | existe — desconectar (sessão fresca, block 3 s) |

- Viewer vê o **selo** `pagamento_status` do pedido (vem com `pedidos:ler`), nunca a seção de cobrança.
- Loja: escrita com `loja: "grava"`, leitura `"le"`. Id de pedido, pagamento ou conta de outra loja = **404** (`ErroDeEscopo`).
- Webhook e jobs não usam permissão: `contextoDeSistema` tem papel `viewer` em memória, então qualquer `pode()` com ele falha fechado.

---

## 5. Server Actions, handler de máquina, jobs e costuras

### 5.1 Módulo de domínio `src/lib/pagamentos/`

| Arquivo | Conteúdo |
|---|---|
| `index.ts` | API pública (reexporta o que actions, rota e processadores usam) |
| `situacao.ts` | **criado completo pelo delta D-08** (dono R2-PG, consumido por R2-A; muda só com ADR 0033) |
| `costuras.ts` | **criado pelo delta D-09** com a assinatura final; R2-PG troca o corpo por chamadas a `cancelamento.ts` e `alertas.ts` |
| `_consultas.ts` | leituras (pedido sob trava, conta viva da loja, pagamento por id e loja, pendentes, histórico com motivo e autor, situação do envio, contas para conciliar) |
| `_regras.ts` | funções puras: `bloqueioDeCobranca(pedido, pendente, agora)`, `transicaoPermitida(de, para)`, `expiraEm(metodo, validade, agora)`, `descricaoDaCobranca(numero, loja)` |
| `conta.ts` | `carregarContaDaLoja`, `conectarConta`, `trocarCredencial`, `testarConta`, `desconectarConta`, `marcarContaComErro` |
| `cobranca.ts` | `gerarCobranca`, `lerSecaoDePagamento` |
| `envio.ts` | `enviarCobrancaNaConversa` |
| `cancelamento.ts` | `cancelarCobranca` (pessoa), `cancelarNoProvedor` (job), `cancelarCobrancasDoPedido` (corpo da costura) |
| `confirmacao.ts` | `aplicarEstadoExterno` — **único** arquivo com `para: "aprovado"` |
| `webhook.ts` | `tratarWebhookDePagamento` |
| `notificacao.ts` | `processarNotificacao` |
| `expiracao.ts` | `expirarCobrancas` |
| `conciliacao.ts` | `conciliarCobrancas` |
| `alertas.ts` | `candidatosDeAlertaDePagamento` (corpo da costura) |
| `mensagens.ts` | textos puros enviados à cliente |
| `simulacao.ts` | `simularEvento` (só fora de produção) |
| `provedores/{tipos,registro,simulado}.ts`, `provedores/mercadopago/{config,cliente,adaptador,assinatura}.ts` | §6 |

`aplicarEstadoExterno`:

```ts
export type AlvoTravado = {
  pagamento: {
    id: string; lojaId: string; pedidoId: string; provedor: string; metodo: "pix" | "link";
    status: StatusPagamento; valorCentavos: number; externoId: string | null;
    expiraEm: Date | null; criadoEm: Date;
  };
  /** Já travado com FOR UPDATE pelo chamador (R2-PG-14). */
  pedido: { id: string; pagamentoStatus: StatusPagamentoPedido; updatedAt: Date };
};
export type OpcoesAplicacao = { motivo: string; conta: { contaExternaId: string; criadaEm: Date } };
export type Desfecho = { resultado: "processado" | "descartado" | "falhou"; erro: string | null; mudou: boolean };

export async function aplicarEstadoExterno(
  tx: Transacao,
  alvo: AlvoTravado,
  estados: EstadoExterno[],
  ctx: Contexto,
  opcoes: OpcoesAplicacao,
): Promise<Desfecho>;
```

Passos: (1) filtra `estados` com `referencia === pagamento.id`; lista vazia → `descartado`; (2) confere R2-PG-08 (d)(e)(f)(g)(h) nessa ordem, primeira falha → `falhou` com o `erro` correspondente, nada muda; (3) decide o alvo pela R2-PG-13; (4) aplica `transicionarPagamento` (claim; `false` = outra transição venceu → devolve `processado` sem mudança); (5) se virou `aprovado` ou `estornado`: `lerFatosDePagamento(tx, pedidoId, lojaId)` → `statusPagamentoDoPedido` → se mudou, `atualizarComTrava(pedidos, { pagamento_status }, …)` com `alvo.pedido.updatedAt` e ação `pagamento_confirmado` ou `pagamento_estornado`; (6) devolve o `erro` informativo (`duplicidade`, `estorno_parcial`, `disputa`, `chargeback`) mesmo quando aplicou. Nenhuma chamada de rede aqui.

### 5.2 Server Actions — `src/lib/actions/pagamentos.ts` (`"use server"`, `export async function`)

Validadores em `src/lib/validadores/pagamentos.ts` (com `cpfValido`, dígitos verificadores). `executarAcaoExterna` é a action sem transação (D-05, ADR 0049): o domínio abre `emTransacao` curtas e **nenhuma rede acontece dentro delas**. Nenhuma action usa `revalidar`; a tela chama `router.refresh()` no sucesso.

| Action | Embrulho | Permissão · loja · fresca | Entrada | Efeito | Trilha |
|---|---|---|---|---|---|
| `lerPagamentoDoPedido(pedidoId)` | `executarAcao` | `pagamentos:ler` · `le` | `z.uuid()` | `SecaoPagamentoDTO` (§7.1) | — |
| `gerarCobranca(bruto)` | `executarAcaoExterna` | `pagamentos:gerar_cobranca` · `grava` | `gerarCobrancaSchema` | passo a passo abaixo | `pagamento_gerado` em `pagamentos` + `pagamento_gerado` em `pedidos` (se `forma_pagamento` mudou); `mensagem_enviada` é de M1 |
| `cancelarCobranca(bruto)` | `executarAcaoExterna` | `pagamentos:cancelar_cobranca` · `grava` | `cancelarCobrancaSchema` | R2-PG-15; devolve `{ desfecho: "cancelada" \| "jaPago" \| "naoEncontrada" }` | `pagamento_cancelado` com motivo, ou as da confirmação |
| `enviarCobrancaNaConversa(bruto)` | `executarAcao` | `pagamentos:gerar_cobranca` + `exigirPermissao(sessao, "conversas:escrever")` · `grava` | `{ pagamentoId: z.uuid() }` | R2-PG-20 | `mensagem_enviada` (M1) |
| `lerContaDePagamento()` | `executarAcao` | `integracoes:ler` · `le` | `z.object({})` | `ContaPagamentoDTO` (§7.3); escopo "todas" → `{ escolherLoja: true }` | — |
| `conectarContaPagamento(bruto)` | `executarAcaoExterna` | `integracoes:conectar` · `grava` · **fresca** | `conectarContaSchema` | R2-PG-06/24/25/27: testa no provedor → `id = randomUUID()` → cifra com AAD = `id` → `inserirAuditado` (`rotulo`, `status: "conectado"`, `ultima_sincronizacao`); único violado → "Esta loja já tem uma conta de pagamento." | `integracao_conectada` (diff com `provedor`, `rotulo`, `status`) |
| `trocarCredencialPagamento(bruto)` | `executarAcaoExterna` | `integracoes:editar` · `grava` · **fresca** | `trocarCredencialSchema` | testa → compara `contaExternaId` (R2-PG-25) → recifra → `atualizarComTrava({ credenciais_cifradas, status: "conectado" })` + `atualizarContador({ ultimo_erro: null, ultima_sincronizacao: agora })` | `integracao_alterada` (credencial fora do diff pelo filtro `SEGREDO` do gravador) |
| `testarContaPagamento(bruto)` | `executarAcaoExterna` | `integracoes:editar` · `grava` | `{ integracaoId: z.uuid() }` | `testar`; conta diferente da guardada → `status = 'erro'`, `ultimo_erro` "O token passou a responder por outra conta."; 401/403 → `erro`; sucesso → `conectado` | `integracao_alterada` só quando o status muda |
| `desconectarContaPagamento(bruto)` | `executarAcao` | `integracoes:desconectar` · `grava` · **fresca** | `{ integracaoId: z.uuid(), atualizadoEm: z.coerce.date() }` | R2-PG-26: pendentes → "Há N cobranças aguardando pagamento nesta conta. Cancele-as ou espere vencerem para desconectar."; senão `atualizarComTrava({ credenciais_cifradas: null, credenciais_aad: null, status: "desconectado", revogada_em: agora })` e `excluirLogico` com o `updated_at` devolvido | `integracao_alterada` + `integracao_desconectada`, mesma transação |
| `simularEventoDePagamento(bruto)` | `executarAcao` | `pagamentos:gerar_cobranca` · `grava` | `simularEventoSchema` | R2-PG-27: produção → `ErroDeConfiguracao`; pagamento não simulado ou conta viva da loja não simulada → `ErroDeValidacao` "Só cobrança de conta simulada pode ser simulada."; grava o estado no Redis e passa uma `Request` assinada por `tratarWebhookDePagamento` no mesmo processo | as da confirmação (ator sistema) |

```ts
export const VALIDADES_PIX_MIN = [30, 120, 1440] as const;

export const gerarCobrancaSchema = z
  .object({
    pedidoId: z.uuid(),
    /** updated_at que o resumo mostrou: total mudou = ErroDeColisao. */
    pedidoAtualizadoEm: z.coerce.date(),
    metodo: z.enum(["pix", "link"]),
    validadeMinutos: z.coerce
      .number()
      .int()
      .refine((v) => (VALIDADES_PIX_MIN as readonly number[]).includes(v), "Escolha uma validade da lista.")
      .default(30),
    pagadorEmail: z.union([z.literal(""), z.email("E-mail inválido.").max(254)]).optional(),
    pagadorCpf: z
      .union([
        z.literal(""),
        z.string().regex(/^\d{11}$/, "CPF com 11 dígitos, só números.").refine(cpfValido, "CPF inválido."),
      ])
      .optional(),
    enviarNaConversa: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  })
  .transform((d) => ({
    ...d,
    validadeMinutos: d.metodo === "link" ? 1440 : d.validadeMinutos,
    pagadorEmail: d.pagadorEmail || undefined,
    pagadorCpf: d.pagadorCpf || undefined,
  }));

export const cancelarCobrancaSchema = z.object({
  pagamentoId: z.uuid(),
  motivo: z.string().trim().min(8, "Escreva o motivo (8 a 255 caracteres).").max(255),
});

/** `MP` vem de `provedores/mercadopago/config.ts` (o formato do token é contrato do provedor). */
export const conectarContaSchema = z.discriminatedUnion("provedor", [
  z.object({
    provedor: z.literal("mercadopago"),
    accessToken: z.string().trim().regex(MP.formatoToken, "Token em formato inesperado."),
    segredoWebhook: z.string().trim().min(16, "Assinatura secreta curta demais.").max(256),
  }),
  z.object({ provedor: z.literal("pagamento_simulado") }),
]);

export const trocarCredencialSchema = z.object({
  integracaoId: z.uuid(),
  atualizadoEm: z.coerce.date(),
  accessToken: z.string().trim().regex(MP.formatoToken, "Token em formato inesperado."),
  segredoWebhook: z.string().trim().min(16, "Assinatura secreta curta demais.").max(256),
});

export const simularEventoSchema = z.object({
  pagamentoId: z.uuid(),
  status: z.enum(["aprovado", "recusado", "cancelado", "estornado"]),
  /** Só para simular valor divergente. */
  valor: z.string().regex(REGEX_DINHEIRO).optional(),
});
```

A exigência de e-mail/CPF é conferida no domínio contra `provedor.exigencias.pix` e volta como `ErroDeValidacao` no campo ("Informe o e-mail do pagador. O Mercado Pago exige."). `accessToken`, `segredoWebhook` e `pagadorCpf` não voltam em `valores` de erro (regex de `_base.ts`, D-05).

**`gerarCobranca` (domínio), passo a passo**
1. `emTransacao` curta de leitura: pedido (escopo), conta viva da loja, pendente atual, `contatos.email`, `lojas.nome`. Recusas: sem conta → `ErroDeConfiguracao("Esta loja não tem conta de pagamento conectada.")`; conta `erro` → `ErroDeValidacao` "A conta de pagamento desta loja está com erro. Peça ao administrador para conferir."; Mercado Pago com instalação desligada → `ErroDeConfiguracao("Cobrança pelo Mercado Pago está desligada nesta instalação.")`; R2-PG-01..03; `updated_at ≠ pedidoAtualizadoEm` → `ErroDeColisao`; com envio: `exigirPermissao(sessao, "conversas:escrever")` e conversa válida (R2-PG-20), senão `ErroDeValidacao` no campo `enviarNaConversa`.
2. `id = randomUUID()`, `expiraEm`, limitador de saída (§6.3), `criarPix`/`criarLink` com `idempotencia = referencia = id`. Link: `url` validada contra `MP.hostsDoLink` (fora → `ErroDeIntegracao("O Mercado Pago devolveu um link inesperado. Nada foi enviado.", true)` + cancelamento em melhor esforço).
3. `emTransacao`: `SELECT pedidos … FOR UPDATE`; reconfere `updated_at`, R2-PG-01..03 e `paraCentavos(total) === valorEnviado`; `inserirAuditado(pagamentos, { id, loja_id, pedido_id, provedor, metodo, status: "pendente", valor, externo_id, pix_copia_cola | link_pagamento, expira_em, criado_por: ctx.autorId }, ctx, "pagamento_gerado")`; se `forma_pagamento ≠ metodo`, `atualizarComTrava(pedidos, { forma_pagamento: metodo }, …, "pagamento_gerado")`. Violação de `uq_pagamentos_um_pendente` → mensagem da R2-PG-03.
4. Falha no passo 3 → `provedor.cancelar(...)` em melhor esforço (catch + `logger.warn` sem corpo nem cabeçalho) e relança o erro original.
5. Com envio: nova `emTransacao` → `enviarCobrancaNaConversa(tx, id, ctx)`; `ErroDeValidacao` aqui vira `envio: { ok: false, mensagem }` no retorno (a cobrança fica).
6. Retorno: `{ pagamentoId: string; envio: null | { ok: true } | { ok: false; mensagem: string } }`.

**`enviarCobrancaNaConversa(tx, pagamentoId, ctx)`**: pagamento (escopo, vivo) `pendente` com `expira_em > agora + 1 min`, senão "Esta cobrança não está mais valendo."; pedido da mesma loja com `conversa_id`; conversa lida com `condicaoDeLoja(ctx.escopo)`, `loja_id = pagamento.loja_id`, `contato_id = pedido.contato_id` e `vivos()`, senão "Este pedido não veio de uma conversa."; então `registrarEnvio(tx, { lojaId, contatoId: pedido.contato_id, integracaoId: conversa.integracao_id, conversaId: conversa.id, conteudo, chaveIdempotencia }, ctx)` para cada mensagem de `mensagens.ts`. Bloqueios do composer são aplicados por `registrarEnvio` (delta M1, D-16) e sobem como `ErroDeValidacao`.

### 5.3 Handler de máquina

`src/app/api/webhooks/pagamentos/[provedor]/[integracaoId]/route.ts` (só `POST`; sem `GET` exportado, o Next responde 405):

```ts
import { tratarWebhookDePagamento } from "@/lib/pagamentos";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ provedor: string; integracaoId: string }> },
) {
  return tratarWebhookDePagamento(req, (await params).provedor);
}
```

`tratarWebhookDePagamento(req, provedor)`:
1. `provedor ∉ PROVEDORES_DE_PAGAMENTO` → 404 vazio. `pagamento_simulado` com `NODE_ENV = production` → 404 vazio. `PAGAMENTOS_MERCADOPAGO = desligado` **não** bloqueia (R2-PG-06).
2. Delega a `rotaDeMaquina<ContaCarregada>` (uma instância por provedor, criada no carregamento do módulo), na ordem da fundação **com o delta D-13** (balde por conta só depois de autenticar):
   - `chave(req)`: último segmento do caminho se casar com UUID; senão `null`.
   - `carregar(id)`: `lojas_integracoes` com `id`, `provedor` = o da URL, `loja_id IS NOT NULL`, `revogada_em IS NULL`, `is_deleted = false` → `decifrar` + `provedor.lerCredencial` → `{ id, lojaId, provedor, criadaEm, cred }`. Conta `erro` **é carregada**. `ErroDoCofre` sobe (500; o provedor reentrega).
   - `conferir(corpoCru, req, conta)`: `provedor.conferirNotificacao(req, corpoCru, conta?.cred.segredoWebhook ?? SEGREDO_DE_ISONOMIA)`; `SEGREDO_DE_ISONOMIA` = 32 bytes aleatórios gerados no carregamento do módulo.
   - `processar({ req, corpoCru, integracao, ip })`, com `ctx = contextoDeSistema(integracao.lojaId, "webhook")`:
     1. `n = provedor.lerNotificacao(req, corpoCru)` (qualquer `JSON.parse` acontece aqui, depois da assinatura);
     2. `n === null` → `registrarEventoRecebido({ provedor, integracaoId, lojaId, tipo: "descartado", eventoExternoId: null, assinaturaOk: true, ip, corpo: { mascarado: true, motivo: "sem_id" }, cabecalhos: cabecalhosDoDiario(req.headers), erro: "sem_id" })` → **200**;
     3. `r = await registrarEventoRecebido({ provedor, integracaoId, lojaId, tipo: "recebido", eventoExternoId: n.eventoExternoId, assinaturaOk: true, ip, corpo: { pagamentoExternoId: n.pagamentoExternoId, tipoInformado: n.tipoInformado, recebido: <corpo parseado ou { invalido: true }> }, cabecalhos: cabecalhosDoDiario(req.headers), erro: null })` (função única do diário, D-04);
     4. `r.novo === false` e `r.pendente === false` → **200** sem enfileirar (já processado);
     5. `enfileirar("pagamentos", "processar-notificacao", { eventoId: r.id }, { jobId: jobId("notificacao", r.id) })` para evento novo **ou** repetido ainda pendente (a reentrega recupera enfileiramento que falhou; o BullMQ ignora `jobId` já presente); retorno `null` → **500**;
     6. **200** corpo vazio.

No Mercado Pago o corpo **não** é assinado: `eventoExternoId = x-request-id` (assinado) ou, sem ele, `"<data.id>-<ts>"`; `pagamentoExternoId = data.id` (query, assinado); `tipoInformado = type` (query, **não assinado**, só diagnóstico — R2-PG-09). No simulado o corpo inteiro é assinado e, mesmo assim, o job consulta de volta.

### 5.4 Jobs — fila `pagamentos` (concorrência 2, D-10)

Todos usam `contextoDeSistema(lojaId, "worker")`. Rede **antes** de abrir a transação; a transação trava `pedidos` e depois `pagamentos` (R2-PG-14). Depois do commit, nada é publicado em tempo real (a tela atualiza sozinha, §7.1).

| Job | Carga | `jobId` / agendador | Algoritmo | Idempotência | Retentativa |
|---|---|---|---|---|---|
| `processar-notificacao` | `{ eventoId }` | `notificacao-<eventoId>` | lê o evento; `tipo ≠ 'recebido'` → sai. Conta viva do evento, senão `descartado` com `erro 'conta_desconectada'`. `consultarPagamento(pagamentoExternoId)`: `null` → `descartado`. Referência que não é UUID, ou pagamento inexistente na loja com o provedor da conta → `descartado`. Método `link` → `consultarCobranca` para a lista completa (duplicidade). Transação: trava pedido, relê pagamento, `aplicarEstadoExterno(motivo "notificação")`, `registrarProcessamentoEvento` com o desfecho e a projeção | único do diário + claim | padrão da fila (5, exponencial 2 s). **Permanente** (não relança; evento `falhou`): 401/403 (conta `erro`, `erro 'credencial_recusada'`), `ErroDeConfiguracao`, conferência falhou. **Transitório** (relança): timeout, 429, 5xx, limitador de saída cheio |
| `cancelar-no-provedor` | `{ pagamentoId, lojaId }` | `cancelar-<pagamentoId>`, enfileirado dentro da transação de `cancelarCobrancasDoPedido`, `delay: 3000` | local `pendente` → a transação ainda não confirmou ou foi desfeita: relança transitório; na última tentativa encerra sem erro (`logger.info`). Local `cancelado` → `cancelar` no provedor: `ja_pago` → `consultarCobranca` + transação + `aplicarEstadoExterno` (R2-PG-12); `cancelado`/`ja_encerrado`/`desconhecida` → fim. Outro status → fim | só age sobre `cancelado`; cancelar o já cancelado é sucesso | 5 |
| `expirar-cobrancas` | `{}` | agendador `expirar-cobrancas-5min`, `*/5 * * * *` | lote de 100 por `ix_pagamentos_expiracao` (`status = 'pendente' AND expira_em < now() - interval '2 minutes'`), só cobranças da conta atual de cada loja (R2-PG-08 g). Por linha: `consultarCobranca` → `desconhecida` → pula; algo `aprovado`/`estornado`/`em_disputa` → `aplicarEstadoExterno`; pagamento de link `pendente` (em análise) → pula; nada pago → `cancelar`: `cancelado`/`ja_encerrado` → `pendente → expirado` (`pagamento_status_alterado`, motivo "vencida; o Mercado Pago confirmou que não foi paga"); `ja_pago` → reconsulta e aplica; `desconhecida` → pula; transitório → pula; 401/403 → conta `erro` e pula a loja | claim | 1 (o próximo ciclo é a retentativa) |
| `conciliar-cobrancas` | `{ lojaId? }` | agendador `conciliar-cobrancas-diario`, `50 2 * * *` | R2-PG-18, uma loja por vez, limitador de saída; `desconhecida` → nada | claim | 1 |

### 5.5 Costuras

| Consumidor | Arquivo-costura (criado pelo delta) | Assinatura | Contrato |
|---|---|---|---|
| R2-A (`concluirDevolucao`, `_teto.ts`) e R2-PG | `src/lib/pagamentos/situacao.ts` (**completo**, D-08) | `lerFatosDePagamento(tx, pedidoId, lojaId)`, `origemDoPagamento(f)`, `baseDeEstorno(f)`, `tetoDeEstorno(f)`, `statusPagamentoDoPedido(atual, f)` | §2.6; o chamador já travou o pedido |
| M4 (`cancelarPedido`) | `src/lib/pagamentos/costuras.ts` (D-09) | `cancelarCobrancasDoPedido(tx, pedidoId, ctx): Promise<void>` | na transação do cancelamento, depois de travar o pedido e antes de gravar `cancelado`: cada pendente → `cancelado` (motivo "pedido cancelado", `pagamento_cancelado`) + enfileira `cancelar-no-provedor`. Nunca faz rede |
| M8 (via `src/lib/alertas/fontes-r2.ts`, D-15) | `src/lib/pagamentos/costuras.ts` | `candidatosDeAlertaDePagamento(tx, lojaId, agora): Promise<CandidatoDeAlertaDePagamento[]>` | §5.6; toda chave começa com `pagamento-`; tipos `pagamento_pendente`/`pagamento_conferir` |
| M4 (`/pedidos/[id]/page.tsx`) | `src/components/comum/pagamentos/secao-pagamento.tsx` (D-09) | `<SecaoPagamento pedidoId={string} />` (server, async) | ilha de servidor: o pedido é de M4, a cobrança é de R2-PG; uma consulta, pelo portão da action; resultado `ok: false` com `SEM_PERMISSAO` → não renderiza |
| M4 (`painel-venda.tsx`) | `src/components/comum/pagamentos/botao-cobrar.tsx` (D-09) | `<BotaoCobrar pedidoId={string} />` (client) | estado de sucesso do "Fechar venda" |

### 5.6 Regras de alerta (`candidatosDeAlertaDePagamento`)

O gerador abre o candidato novo e **resolve** o aberto de tipo `pagamento_pendente`/`pagamento_conferir` e prefixo `pagamento-` cuja chave não voltou (D-15). Leitura com o `tx` que o gerador passa. Valores com `moeda()`; `<X>` = número do pedido.

| Condição | Tipo · severidade | Chave | Mensagem | Resolve quando |
|---|---|---|---|---|
| Pix `pendente`, `created_at ≤ agora − 20 min`, `expira_em > agora` | `pagamento_pendente` · `media` | `pagamento-pix-pendente-<pagamentoId>` | "Pix de R$ 189,90 do pedido <X> aguarda pagamento há mais de 20 minutos." | deixa de ser pendente ou vence |
| `pendente` com `expira_em ≤ agora − 30 min` | `pagamento_conferir` · `alta` | `pagamento-vencida-<pagamentoId>` | "A cobrança do pedido <X> venceu e o Mercado Pago não confirmou a situação. Confira no painel do Mercado Pago e cancele a cobrança aqui." | sai de `pendente` |
| `aprovado` e (pedido `cancelado` **ou** trilha `pagamento_confirmado` desse pagamento com `antes->>'status' <> 'pendente'` **ou** pedido `devolvido` com Σ `valor_estorno` das devoluções `concluida` vivas **menor** que Σ dos pagamentos `aprovado` do pedido — se o registrado cobre o aprovado, o estorno já foi feito fora e o alerta mandaria estornar duas vezes) | `pagamento_conferir` · `alta` | `pagamento-tardio-<pagamentoId>` | "Pagamento de R$ 189,90 recebido depois que a cobrança ou o pedido <X> foi encerrado. Estorne pelo painel do Mercado Pago ou refaça a venda." | vira `estornado` |
| pedido com 2+ pagamentos `aprovado` vivos | `pagamento_conferir` · `alta` | `pagamento-duplicidade-<pedidoId>` | "O pedido <X> foi pago mais de uma vez. Estorne o pagamento repetido pelo painel do Mercado Pago." | resta no máximo 1 aprovado |
| `estornado`, pedido `masc_status = 'lancado'` e `status ∉ {cancelado, devolvido}` | `pagamento_conferir` · `alta` | `pagamento-estorno-masc-<pagamentoId>` | "O pagamento do pedido <X> foi estornado no Mercado Pago, mas a venda segue lançada no Masc. Registre a devolução ou o cancelamento do pedido e ajuste o Masc." | pedido vira `cancelado`/`devolvido` (a conclusão de devolução do R2-A exige a confirmação do ajuste no Masc) |
| evento do diário desta loja, provedor em `PROVEDORES_DE_PAGAMENTO`, `erro LIKE 'pagamento_conferir:%'`, `created_at > agora − 30 dias` | `pagamento_conferir` · `alta` | `pagamento-evento-<eventoId>` | por sufixo — `valor_divergente`: "O Mercado Pago informou um pagamento com valor diferente da cobrança do pedido <X>. Nada foi alterado; confira no painel." · `id_divergente`, `conta_divergente`, `conta_trocada`: "Chegou um pagamento para o pedido <X> que não bate com a cobrança gerada (outra conta ou outro código). Nada foi alterado; confira no painel." · `duplicidade`: "O link do pedido <X> recebeu mais de um pagamento." · `estorno_parcial`: "O pagamento do pedido <X> teve estorno parcial no Mercado Pago." · `disputa`: "A cliente abriu disputa do pagamento do pedido <X> no Mercado Pago." · `chargeback`: "O pagamento do pedido <X> foi contestado (chargeback) e estornado." | 30 dias depois do evento (a retenção do diário apaga a evidência); reconhecer registra quem viu |

`pedidoId` do último caso vem da projeção do evento (`corpo->>'pedidoId'`); sem ele, o candidato sai sem pedido e com "<X>" trocado por "desta loja".

---

## 6. Integrações externas

### 6.1 Interface de provedor (`src/lib/pagamentos/provedores/tipos.ts`)

Duas implementações (simulado determinístico e Mercado Pago) — a interface é exigida pela decisão do orquestrador (provedor simulado + real).

```ts
import type { PROVEDORES_DE_PAGAMENTO } from "@/lib/db/schema/_enums/plataforma";

export type ProvedorDeConta = (typeof PROVEDORES_DE_PAGAMENTO)[number];
export type CredencialBase = { segredoWebhook: string; contaExternaId: string };

export type StatusExterno = "pendente" | "aprovado" | "recusado" | "cancelado" | "estornado" | "em_disputa";

export type EstadoExterno = {
  externoId: string;               // id do PAGAMENTO no provedor
  referencia: string | null;       // external_reference = pagamentos.id
  contaRecebedora: string | null;  // conta que recebeu; null = o provedor não informou
  status: StatusExterno;
  statusBruto: string;             // só diagnóstico; nunca decide
  chargeback: boolean;
  valorCentavos: number;
  moeda: string;
  estornadoCentavos: number;
  pagoEm: Date | null;
};

/** `desconhecida` = o provedor respondeu que não conhece a cobrança (404 do objeto). */
export type Cobranca = { tipo: "desconhecida" } | { tipo: "encontrada"; pagamentos: EstadoExterno[] };

export type AlvoCobranca = { metodo: "pix" | "link"; externoId: string; referencia: string };

export type NovaCobranca = {
  idempotencia: string;            // = pagamentos.id
  referencia: string;              // = pagamentos.id
  valorCentavos: number;
  descricao: string;               // "Pedido MS2609-CEN-0001 — Merlo Store Centro"
  expiraEm: Date;
  pagador?: { email?: string; cpf?: string }; // só Pix; nunca persistido
};

export type Notificacao = { eventoExternoId: string; pagamentoExternoId: string; tipoInformado: string | null };

export interface ProvedorDePagamento<C extends CredencialBase = CredencialBase> {
  readonly nome: ProvedorDeConta;
  readonly simulado: boolean;
  readonly exigencias: { pix: { email: boolean; cpf: boolean } };
  /** Zod; inválida = ErroDoCofre. */
  lerCredencial(json: unknown): C;
  /** Recusa = ErroDeIntegracao(permanente). */
  testar(cred: Omit<C, "contaExternaId">): Promise<{ contaExternaId: string }>;
  criarPix(cred: C, c: NovaCobranca): Promise<{ externoId: string; copiaECola: string; expiraEm: Date }>;
  criarLink(cred: C, c: NovaCobranca): Promise<{ externoId: string; url: string; expiraEm: Date }>;
  /** Um pagamento pelo id. `null` = 404. */
  consultarPagamento(cred: C, externoId: string): Promise<EstadoExterno | null>;
  /** Pix: o próprio pagamento. Link: a preferência (404 → desconhecida) + busca por referência (0..n). */
  consultarCobranca(cred: C, alvo: AlvoCobranca): Promise<Cobranca>;
  /** Consulta antes; só cancela o que está pendente. */
  cancelar(cred: C, alvo: AlvoCobranca): Promise<"cancelado" | "ja_pago" | "ja_encerrado" | "desconhecida">;
  conferirNotificacao(req: Request, corpoCru: string, segredo: string): boolean;
  lerNotificacao(req: Request, corpoCru: string): Notificacao | null;
}
```

`provedores/registro.ts`: `provedorDe(nome: string): ProvedorDePagamento` — nome fora de `PROVEDORES_DE_PAGAMENTO` lança `ErroDeConfiguracao`; `pagamento_simulado` com `NODE_ENV = production` lança `ErroDeConfiguracao`.

Erros HTTP normalizados (adaptador real): 400/422 → `ErroDeIntegracao("O Mercado Pago recusou os dados da cobrança.", true)`; 401/403 → `ErroDeIntegracao("O Mercado Pago recusou a credencial desta loja.", true)` com `codigoHttp` lido pelo domínio para marcar a conta (`marcarContaComErro`); 404 → `null`/`desconhecida` conforme o método; 429/5xx/timeout/erro de rede → `ErroDeIntegracao("O Mercado Pago não respondeu.", false)`. Para distinguir 401/403, o adaptador lança a subclasse `ErroDeCredencialRecusada extends ErroDeIntegracao` (em `provedores/tipos.ts`).

### 6.2 Provedor simulado (`provedores/simulado.ts`) — determinístico

- `testar` → `{ contaExternaId: "simulada" }`; `exigencias.pix = { email: false, cpf: false }`; `simulado = true`.
- `criarPix`: `externoId = "sim-" + referencia`; `copiaECola = "TESTE-NAO-PAGUE." + referencia`; `expiraEm` = o pedido.
- `criarLink`: `externoId = "simpref-" + referencia`; `url = "https://pagamento.simulado.invalid/" + referencia` (TLD `.invalid`). `hostsDoLink` não se aplica ao simulado.
- Estado em Redis `pagamento-simulado:<referencia>` (TTL 7 dias): `{ status, valorCentavos, moeda: "BRL", estornadoCentavos }`; ausente = `pendente` com o valor que a cobrança enviou (guardado na criação).
- `consultarPagamento("sim-<ref>" | "simpag-<ref>")` → estado da referência (id de pagamento do link = `"simpag-" + ref`); outro formato → `null`. `consultarCobranca` → `encontrada` com zero pagamentos se pendente de link, um pagamento nos demais casos; referência sem estado e sem criação → `desconhecida`.
- `cancelar`: `aprovado`/`estornado` → `ja_pago`; `cancelado`/`recusado` → `ja_encerrado`; senão grava `cancelado` → `cancelado`.
- `contaRecebedora = "simulada"`.
- `conferirNotificacao`: `x-simulado-assinatura: sha256=<hex>` = HMAC-SHA256 do corpo cru com o segredo, comparado com `compararEmTempoConstante`.
- `lerNotificacao`: corpo `{ eventoId, pagamentoExternoId }` → `{ eventoExternoId: eventoId, pagamentoExternoId, tipoInformado: "pagamento" }`; corpo inválido → `null`.

### 6.3 Provedor real: Mercado Pago (`provedores/mercadopago/`)

| Arquivo | Conteúdo |
|---|---|
| `config.ts` | **todo** contrato de terceiro, cada item com `// CONFERIR` |
| `cliente.ts` | chamadas só por `buscarExterno(url, { provedor: "mercadopago", metodo, corpo, cabecalhos, maxBytes: 256 * 1024 })`, com `Authorization: Bearer <token>`, `MP.cabecalhoIdempotencia` nos POST, e limitador de saída `limitarPorIp("saida:mercadopago", contaId, { janela: 1, max: 5 })` antes de cada chamada (cheio → transitório). Nunca loga cabeçalho, corpo nem token |
| `adaptador.ts` | implementa `ProvedorDePagamento<CredencialMercadoPago>`; valida cada resposta com Zod; valor por `paraCentavos(n.toFixed(2))`; escolhe `campoDoLink` pelo modo da instalação; valida o host do link contra `hostsDoLink` |
| `assinatura.ts` | `x-signature` (`ts=…,v1=…`) → manifesto → HMAC-SHA256 com `segredoWebhook` → `compararEmTempoConstante`; tolerância de `ts`; `data.id` lido da query |

```ts
// CONFERIR — contrato do Mercado Pago não verificado contra conta real.
// NENHUM destes literais pode aparecer fora deste arquivo (T-PG-12), exceto o host em buscarExterno.ts.
export const MP = {
  base: "https://api.mercadopago.com", // CONFERIR
  caminhos: { // CONFERIR
    /** POST: transaction_amount, description, payment_method_id "pix", external_reference, date_of_expiration, payer.email, payer.identification */
    criarPagamento: "/v1/payments",
    /** GET; PUT { status: "cancelled" } */
    pagamento: (id: string) => `/v1/payments/${encodeURIComponent(id)}`,
    busca: (ref: string) => `/v1/payments/search?external_reference=${encodeURIComponent(ref)}`,
    /** POST: items[1] (title, quantity 1, unit_price, currency_id), external_reference, expires, expiration_date_to, payment_methods.excluded_payment_types */
    preferencias: "/checkout/preferences",
    /** GET; PUT { expires: true, expiration_date_to: agora } */
    preferencia: (id: string) => `/checkout/preferences/${encodeURIComponent(id)}`,
    eu: "/users/me",
  },
  campos: { // CONFERIR
    idDaConta: "id",
    site: "site_id",
    contaRecebedora: "collector_id",
    valor: "transaction_amount",
    moeda: "currency_id",
    estornado: "transaction_amount_refunded",
    aprovadoEm: "date_approved",
    referencia: "external_reference",
    copiaECola: "point_of_interaction.transaction_data.qr_code",
    resultadosDaBusca: "results",
  },
  cabecalhoIdempotencia: "X-Idempotency-Key", // CONFERIR
  formatoToken: /^(APP_USR|TEST)-[0-9A-Za-z-]{20,250}$/, // CONFERIR
  prefixoToken: { teste: "TEST-", producao: "APP_USR-" }, // CONFERIR
  site: "MLB", // CONFERIR
  moeda: "BRL", // CONFERIR
  assinatura: { // CONFERIR
    cabecalho: "x-signature",
    requisicao: "x-request-id",
    /** id em minúsculas; par request-id omitido quando o cabeçalho vem vazio */
    manifesto: (id: string, req: string | null, ts: string) =>
      `id:${id.toLowerCase()};${req ? `request-id:${req};` : ""}ts:${ts};`,
    tsEmMilissegundos: false,
    toleranciaSegundos: 300,
    parametroDoId: "data.id",
    parametroDoTipo: "type",
  },
  /** Assinatura garantida só no webhook configurado no painel da aplicação. */
  notificationUrlPorCobranca: false, // CONFERIR
  pix: { exigeEmail: true, exigeCpf: false, validadeMinimaMin: 30 }, // CONFERIR
  link: { tiposExcluidos: ["ticket", "atm"] }, // CONFERIR (sem boleto e lotérica)
  hostsDoLink: ["www.mercadopago.com.br", "sandbox.mercadopago.com.br"], // CONFERIR
  campoDoLink: { producao: "init_point", teste: "sandbox_init_point" }, // CONFERIR
  status: { // CONFERIR
    pending: "pendente", in_process: "pendente", authorized: "pendente",
    approved: "aprovado", rejected: "recusado", cancelled: "cancelado",
    refunded: "estornado", charged_back: "estornado", in_mediation: "em_disputa",
  },
  statusDeChargeback: "charged_back", // CONFERIR
} as const;
```

`testar`: GET `eu` → `site_id` ≠ `MLB` → `ErroDeIntegracao("Esta conta do Mercado Pago não é brasileira.", true)`; devolve `{ contaExternaId: String(id) }`. Prefixo do token incompatível com `PAGAMENTOS_MERCADOPAGO` → `ErroDeValidacao` no campo `accessToken`: "Esta instalação só aceita token de teste (TEST-)." / "…só aceita token de produção (APP_USR-)." (checado **antes** da chamada).

`cancelar` (Pix): GET do pagamento → `approved`/`refunded`/`charged_back`/`in_mediation` → `ja_pago`; `cancelled`/`rejected` → `ja_encerrado`; 404 → `desconhecida`; pendente → PUT `cancelled` → erro no PUT → GET de novo decide. `cancelar` (link): GET da preferência (404 → `desconhecida`) → busca por referência: algum pagamento aprovado, estornado, em disputa **ou pendente (em análise)** → `ja_pago` (conservador: o domínio já recusou esse caso antes pela `consultarCobranca`, R2-PG-15/17, e só reconsulta); nada pago → PUT `expires: true, expiration_date_to = agora` → `cancelado`.

Orientação (vai para `docs/modulos/pagamentos.md`): **uma aplicação do Mercado Pago por loja** (pode ser a mesma conta); webhook no painel da aplicação com a URL que a tela mostra (`<APP_URL>/api/webhooks/pagamentos/mercadopago/<integracaoId>`), evento "Pagamentos", **sem IPN**; chave secreta da aplicação → "Assinatura secreta do webhook"; Access Token → "Access Token". HML: `PAGAMENTOS_MERCADOPAGO=teste` e token `TEST-`. PRD: só depois de todos os CONFERIR anotados, `PAGAMENTOS_MERCADOPAGO=producao`.

### 6.4 Variáveis de ambiente (uma nova, D-12)

| Variável | Valores | Padrão | Efeito |
|---|---|---|---|
| `PAGAMENTOS_MERCADOPAGO` | `desligado` \| `teste` \| `producao` | `desligado` | R2-PG-06. Credencial **não** vai para env: é por loja, no cofre (`INTEGRATIONS_KEY` já existe e é obrigatória). O simulado é decidido por `NODE_ENV` |

"Sem chave = desligado com aviso honesto" vale em dois níveis: instalação (`desligado`) e loja (sem conta conectada). Nenhum dos dois gera 500 nem dado inventado.

### 6.5 Allowlist de saída

`buscarExterno` ganha `mercadopago: ["api.mercadopago.com"]` e o método `PUT` (delta consolidado D-11). O link devolvido pelo provedor **não é buscado**, só validado contra `MP.hostsDoLink` antes de gravar e de enviar.

---

## 7. Telas

Nenhum item novo de navegação. Pagamento vive **no pedido**, **no painel de venda da conversa** e em **Configurações**. Componentes compartilhados em `src/components/comum/pagamentos/` (exceção nominal no mapa de donos, D-19): `secao-pagamento.tsx` (server), `painel-cobranca.tsx`, `dialogo-gerar-cobranca.tsx`, `dialogo-cancelar-cobranca.tsx`, `historico-cobrancas.tsx`, `qr-pix.tsx`, `botao-cobrar.tsx` (client).

### 7.1 Seção "Pagamento" em `/pedidos/[id]`

- **Papel mínimo**: `pagamentos:ler` (vendedor). Sem a chave, nada renderiza (o selo `pagamento_status` do cabeçalho continua com `pedidos:ler`).
- **Server**: `<SecaoPagamento pedidoId />` chama `lerPagamentoDoPedido` e passa o DTO. **Client**: `painel-cobranca.tsx` (cartão da pendente, contagem regressiva, copiar, enviar, cancelar), diálogos e `qr-pix.tsx`.
- **Atualização**: enquanto houver cobrança `pendente` na tela e `document.visibilityState === "visible"`, `router.refresh()` a cada **10 s**; para quando a cobrança sai de `pendente`. Sem `EventSource` próprio (não disputa o teto de conexões SSE por pessoa).

```ts
export type SecaoPagamentoDTO = {
  pedido: { id: string; numero: string; total: string; status: StatusPedido; pagamentoStatus: StatusPagamentoPedido;
    mascStatus: MascStatus; temConversa: boolean; canalDaConversa: string | null; atualizadoEm: string; clienteNome: string | null };
  instalacao: { mercadoPagoLigado: boolean; simuladoDisponivel: boolean };
  conta: null | { provedor: ProvedorDeConta; rotulo: string; status: StatusIntegracao; simulada: boolean;
    ultimoErro: string | null; ultimaSincronizacao: string | null };
  exigencias: { email: boolean; cpf: boolean };
  emailSugerido: string | null;
  bloqueio: null | string; // frase da R2-PG-01..03 ou da conta, pronta para a tela
  pendente: null | {
    id: string; metodo: "pix" | "link"; valor: string; expiraEm: string; geradoPor: string | null; geradoEm: string;
    copiaECola: string | null; qrDataUrl: string | null; link: string | null;
    envio: null | { status: StatusEntrega; em: string; falhaMotivo: string | null; conversaId: string };
  };
  historico: { id: string; metodo: "pix" | "link"; valor: string; status: StatusPagamento; geradoPor: string | null;
    criadoEm: string; pagoEm: string | null; estornadoEm: string | null; motivoCancelamento: string | null }[]; // 20 mais recentes
  podeGerar: boolean;
  podeCancelar: boolean;
  podeEnviar: boolean;
};
```

| Estado | O que aparece (microcopia exata) |
|---|---|
| Carregando | skeleton do cartão com a altura do QR reservada |
| Instalação desligada | faixa `info`: "Cobrança por Pix e link está desligada nesta instalação." |
| Loja sem conta | faixa `info`: "Esta loja ainda não tem conta de pagamento conectada. Cobrança por Pix e link está desligada." + [Conectar conta] (com `integracoes:conectar`) ou "Peça ao administrador para conectar." |
| Conta com erro | faixa `perigo`: "O Mercado Pago recusou a credencial desta loja em 16/09 às 14:05. Novas cobranças estão pausadas." + [Ver conta] (com `integracoes:ler`) |
| Pedido cancelado/devolvido | "Pedido cancelado não recebe cobrança." / "Pedido devolvido não recebe cobrança." (sem botão; histórico abaixo) |
| Vazio | "Nenhuma cobrança gerada para este pedido." + **[Gerar cobrança]** |
| Gerando | botão pendente "Gerando Pix no Mercado Pago…" / "Gerando link no Mercado Pago…" (até 10 s) |
| Pendente — Pix | QR 220 px (`alt="QR Code Pix de R$ 189,90 do pedido MS2609-CEN-0001"`), copia-e-cola em `<code>` com [Copiar] ("Código copiado."), "Vence às 14:32 (em 23 min)", selo `aviso` "Aguardando pagamento", envio (abaixo), [Cancelar cobrança] |
| Pendente — link | URL em `<code>` com [Copiar] ("Link copiado."), "Válido até 17/09 às 14:02", mesmas ações |
| Envio | sem envio: [Enviar pela conversa] (com `podeEnviar`) ou "Este pedido não veio de uma conversa. Use Copiar."; enviado: "Enviado para a cliente às 14:02 · Entregue" (rótulo de `status_entrega`); falhou: faixa `perigo` "A mensagem não foi entregue: <falhaMotivo>." + [Abrir conversa] |
| Pago | selo `sucesso` "Pago" + "R$ 189,90 via Pix em 16/09 às 14:11"; com `masc_status = 'pendente'`: faixa `aviso` "Pago — falta lançar no Masc." |
| Estornado | selo `neutro` "Estornado em 20/09" + "O estorno foi feito no painel do Mercado Pago." |
| Simulado | faixa `aviso` fixa: "Conta de teste: esta cobrança não é pagável." + botões secundários "Simular pagamento aprovado" / "Simular recusa" (só `simuladoDisponivel`) |
| Erro do provedor | toast persistente `role="alert"`: transitório → "O Mercado Pago não respondeu. Nenhuma cobrança foi enviada à cliente." + [Tentar de novo]; permanente → "O Mercado Pago recusou os dados da cobrança. Confira o e-mail do pagador." |
| Cobrança gerada, envio falhou | toast `aviso`: "Cobrança gerada, mas não foi enviada: <mensagem>. Copie o código ou tente enviar de novo." |
| Colisão | faixa padrão de conflito (`04-ui.md §7.2`) + "O total do pedido pode ter mudado. Recarregue antes de cobrar." |
| Histórico | tabela: método · valor (`<Dinheiro>`) · selo · gerado por · quando · motivo do cancelamento |
| Sem permissão | não renderiza |

**Diálogo "Gerar cobrança"** (`sm:max-w-lg`): segmentado **Pix | Link** · validade (Pix: "30 min" / "2 horas" / "24 horas"; link: texto "Válido por 24 horas") · "E-mail do pagador" (pré-preenchido; ajuda "Usado só pelo Mercado Pago. Não fica salvo aqui.") · "CPF do pagador" **só** quando `exigencias.cpf` (mesma ajuda) · checkbox "Enviar para a cliente pela conversa agora" (marcada quando `temConversa`; desabilitada com "Este pedido não veio de uma conversa." quando não) · [Continuar] → **ModalConfirmacaoBlock** (item `gerar-cobranca`):
- `titulo`: "Gerar cobrança por Pix" / "Gerar link de pagamento"
- `resumo`: "Pedido MS2609-CEN-0001 · Maria Souza · R$ 189,90 · Pix válido por 30 min · Mercado Pago · conta 123456789"
- `descricao`: com envio, "A cobrança é criada no Mercado Pago agora. A cliente recebe o valor e o código pela conversa do WhatsApp Vendas Centro."; sem envio, "A cobrança é criada no Mercado Pago agora. Você poderá copiar o código ou enviá-lo depois."; com `mascStatus = 'lancado'`, acrescenta "Este pedido já foi lançado no Masc. Confira se o pagamento não foi registrado lá."; simulada, acrescenta "Conta de teste: a cobrança não é pagável."
- `textoConfirmar`: "Gerar e enviar" / "Gerar cobrança"; `variante: "padrao"`.

**Diálogo "Cancelar cobrança"**: "Motivo" (obrigatório, 8–255) → **ModalConfirmacaoBlock** (item `cancelar-cobranca`), `variante: "destrutiva"`: `titulo` "Cancelar cobrança" · `resumo` "Pix de R$ 189,90 do pedido MS2609-CEN-0001, gerado por Ana às 14:02" · `descricao` "O Mercado Pago é consultado antes. Se a cliente já tiver pago, o pagamento é registrado e a cobrança não é cancelada." · `textoConfirmar` "Cancelar cobrança". Respostas: `cancelada` → sem toast (a tela muda); `jaPago` → toast "Esta cobrança já tinha sido paga. O pagamento foi registrado."; `naoEncontrada` → toast `aviso` persistente "O Mercado Pago não encontrou esta cobrança. Ela foi cancelada aqui; confira no painel do Mercado Pago se houve pagamento."

**Mensagens à cliente** (`mensagens.ts`, puras, horário em `America/Sao_Paulo`):

```
Pix, mensagem 1: "Pedido MS2609-CEN-0001 — total R$ 189,90.
                  Pague com Pix até 14:32 (horário de Brasília). O código vem na próxima mensagem: é só copiar e colar no app do seu banco."
Pix, mensagem 2: "<copia-e-cola>"
Link:            "Pedido MS2609-CEN-0001 — total R$ 189,90.
                  Link para pagamento, válido até 17/09 às 14:02: <url>"
Simulado:        prefixo "[TESTE — NÃO PAGUE] " em todas
```

Chaves de idempotência: `cobranca-<pagamentoId>-resumo`, `cobranca-<pagamentoId>-codigo`, `cobranca-<pagamentoId>-link`. Nenhum dado do pagador no texto.

### 7.2 Painel de venda na conversa (arquivo de M4)

No estado de sucesso do "Fechar venda": **[Cobrar agora]** (`<BotaoCobrar pedidoId />`). O botão chama `lerPagamentoDoPedido` ao abrir e mostra o mesmo `DialogoGerarCobranca`, com "Enviar pela conversa" marcado. Sem `pagamentos:gerar_cobranca` → não aparece. Loja sem conta ou instalação desligada → aparece desabilitado com "Cobrança desligada: a loja não tem conta de pagamento." / "Cobrança desligada nesta instalação." Depois de gerar, o diálogo mostra o código, o QR e "Aguardando pagamento", com a mesma atualização de 10 s (rechamando a action) enquanto aberto. Nada muda no "Fechar venda".

### 7.3 `/configuracoes/pagamentos` (rota nova)

- **Papel mínimo**: `integracoes:ler` (dono/admin). Loja: a do seletor; em "Todas as lojas": "Escolha uma loja no topo da tela para ver a conta de pagamento."
- **Server**: `page.tsx` + `loading.tsx` + `error.tsx`. **Client**: `_components/cartao-conta.tsx`, `_components/formulario-conta.tsx`, `_components/dialogo-desconectar.tsx`.

```ts
export type ContaPagamentoDTO = {
  loja: { id: string; nome: string };
  instalacao: { mercadoPago: "desligado" | "teste" | "producao"; simuladoDisponivel: boolean };
  conta: null | { id: string; provedor: ProvedorDeConta; rotulo: string; status: StatusIntegracao; simulada: boolean;
    tokenFinal: string | null; urlWebhook: string | null; ultimaSincronizacao: string | null; ultimoErro: string | null;
    pendentes: number; atualizadoEm: string };
};
```

`tokenFinal` = `mascarar(accessToken)` (4 últimos); `credenciaisVisiveis` ilegível → "Não foi possível ler esta credencial." sem derrubar a página.

| Estado | Microcopia |
|---|---|
| Instalação desligada, sem conta | "Cobrança pelo Mercado Pago está desligada nesta instalação. Peça ao responsável técnico para ligar depois da conferência em homologação." (o simulado continua oferecido fora de produção) |
| Sem conta | "Nenhuma conta de pagamento nesta loja." + formulário: Provedor (Mercado Pago; "Simulado (teste)" só fora de produção) · "Access Token" (`type="password"`, `autocomplete="off"`) · "Assinatura secreta do webhook" (`type="password"`) · [Conectar]. Em `teste`: ajuda "Esta instalação usa credenciais de teste (TEST-)." |
| Conectando | "Conferindo a credencial no Mercado Pago…" |
| Conectado | selo `sucesso` "Conectado" · rótulo "Mercado Pago · conta 123456789" · "Token terminado em …a1b2" · "URL do webhook" em `<code>` + [Copiar] + ajuda "Cole esta URL no painel da aplicação do Mercado Pago, em Webhooks, evento Pagamentos." · "Última conferência: 14:05" · [Testar conexão] · [Trocar credencial] · [Desconectar] |
| Trocar credencial | mesmo formulário; ajuda "Só é aceito token da mesma conta (123456789). Para usar outra conta, desconecte esta e conecte a nova." |
| Erro | selo `perigo` "Com erro" + `ultimoErro` + "Troque a credencial para voltar a cobrar." |
| Desconectar bloqueado | "Há 2 cobranças aguardando pagamento nesta conta. Cancele-as ou espere vencerem para desconectar." (botão desabilitado) |
| Desconectar | **ModalConfirmacaoBlock** `destrutiva` (item existente `desconectar-integracao`): `titulo` "Desconectar o Mercado Pago da loja Centro" · `resumo` "Conta 123456789 · token terminado em a1b2" · `descricao` "Novas cobranças ficam desligadas. Estornos e contestações de cobranças antigas desta conta deixam de ser registrados aqui." · `textoConfirmar` "Desconectar" |
| Sem permissão / reautenticação | padrões de `04-ui.md §10` e `§7.3` (`SESSAO_NAO_FRESCA` abre `ModalReautenticacao` e refaz a ação) |

### 7.4 Acessibilidade e responsivo

QR com `alt` descritivo e o código sempre em texto ao lado; contagem regressiva com `aria-live="off"` e horário absoluto visível; cartão em coluna única no celular; alvos ≥ 44 px; cor só por tom de `tons.ts`, sempre com rótulo; campos de credencial com `autocomplete="off"`.

---

## 8. Segurança

| # | Ameaça | Resposta | REQ / trava |
|---|---|---|---|
| S1 | Webhook forjado quita pedido (INV-46) | HMAC da aplicação da loja + consulta de volta com o token da loja + referência + loja + id + valor + moeda + conta recebedora | I1–I15, T15, T-PG-04 |
| S2 | Repetição de notificação | único `(provedor, evento_externo_id)` + tolerância de `ts` + claim | I8, T-PG-05 |
| S3 | Replay com `type` trocado apagando a entrega legítima | `type` não decide; todo evento com `data.id` vai à consulta de volta; sem `data.id` → `descartado` com chave nula | T-PG-05 |
| S4 | Balde por conta esgotado por quem conhece o id da URL (I4) | balde por conta consumido **só depois** de autenticar (D-13); antes, só o teto por IP | T-PG-04, `maquina-balde.test.ts` |
| S5 | Confusão entre lojas | conta pela URL → `loja_id`; pagamento buscado com a loja e o provedor da conta; FK composta `pagamentos(pedido_id, loja_id)`; envio confere loja e contato da conversa | H10, H12, T13, T-PG-06, T-PG-15 |
| S6 | Admin desvia recebimentos trocando a conta | identidade fixa (R2-PG-25): trocar credencial só da mesma conta; trocar de conta = desconectar (zero pendentes) + conectar, com sessão fresca e a conta no diff da trilha (`rotulo`) | H7, T-PG-16 |
| S7 | Conta nova confirma cobrança da conta antiga | R2-PG-08 (g) e (h); resposta vazia nunca expira nem confirma | T-PG-07, T-PG-25 |
| S8 | Valor adulterado no cliente | valor lido do pedido sob trava; sem campo de valor; `pedidoAtualizadoEm` | H12, T-PG-02 |
| S9 | Fraude interna "marcar pago" | não existe caminho: chave removida, `'manual'` fora do CHECK, `para: "aprovado"` só em `confirmacao.ts`, simulação só em conta simulada | H5, T12, T-PG-09, T-PG-10 |
| S10 | Enumeração de contas pela URL | 401 corpo nulo, mesmo piso de tempo; comparação roda com segredo aleatório quando a conta não existe | T15, T-PG-04 |
| S11 | SSRF / phishing pelo link | saída só por `buscarExterno` (allowlist, https, DNS sem faixa interna, não-GET sem redirect, credencial descartada ao trocar de host); link validado contra `hostsDoLink` | §12.4 arquitetura, T-PG-11, `ssrf.test.ts` |
| S12 | Vazamento de credencial | cofre AES-256-GCM, AAD = id; tela com 4 últimos; `accessToken`/`segredoWebhook` no `redact` do log e fora de `valores`; diff da trilha pula `credenciais_*` | K2, K3, T18, T-PG-08 |
| S13 | PII do pagador guardada | e-mail/CPF só em memória até o provedor; fora de job, Redis, log, trilha, banco e `valores`; diário mascarado ao processar | K3, LGPD, T-PG-08 |
| S14 | Simulado em produção | registro lança, rota 404, conexão e simulação recusam | T-PG-09 |
| S15 | Token de teste em PRD / real em HML | `PAGAMENTOS_MERCADOPAGO` com prefixo obrigatório por modo | T-PG-16 |
| S16 | Pagamento perdido | 500 quando não enfileira; reenfileira evento parado; expiração pergunta ao provedor; conciliação; alerta de vencida não confirmada | T-PG-07 |
| S17 | Corrida gerar×gerar, cancelar×pagar, devolução×confirmação | índice "uma pendente"; ordem de trava pedido → pagamento; cancelar consulta antes; aprovação tardia registrada + alerta | T-PG-03 |
| S18 | CSRF / action sem portão | `executarAcao`/`executarAcaoExterna` (lista fechada de arquivos) com `conferirOrigem`, sessão, permissão, escopo | J7, T1 |
| S19 | Escrita em ERP por engano | `src/lib/pagamentos/**` não importa `integracoes/bling` nem escreve `masc_*` ou `pedidos.status` | T26, T-PG-13 |
| S20 | Dado de terceiro exibido cru | código e link como texto (React escapa); QR local em `data:` (CSP `img-src 'self' data:`) | J5 |
| S21 | Envio para a cliente errada | conversa conferida por loja, contato e `vivos()`; sem fallback de conta | T-PG-15 |

Limitação escrita (ADR 0036): depois de desconectar (inclusive para trocar de conta), estornos e contestações de cobranças da conta anterior não chegam mais.

---

## 9. PACOTE DE CONSTRUÇÃO — R2-PG · Pagamentos

- **Objetivo**: cobrança de pedido por Pix e link com confirmação exclusiva do provedor, conta de pagamento por loja com identidade fixa, envio pela conversa, cancelamento, expiração confirmada, conciliação e alertas — com provedor simulado determinístico e Mercado Pago real ligado por `PAGAMENTOS_MERCADOPAGO`.
- **Entradas**: este documento; `01-dados-dominio.md §6.3–6.6`; `01-dados.md §4.7, §6.3, §6.4, §7.4`; `02-seguranca.md §2.2, §12, §13, §17`; `03-arquitetura.md §4.3, §6.4, §8, §11, §12`; `04-ui.md §2.4, §5.3, §7, §9, §10`; ADRs 0004, 0017, 0033, 0036–0041, 0049.
- **Pré-requisitos**: **todo o §10 aplicado** pelo orquestrador e `npm run verificar` verde; M1 (`registrarEnvio`), M4 (`cancelarPedido`, página do pedido, painel de venda), M5 (webhooks e diário) e M8 (gerador) fechados.
- **Banco de teste / Redis**: `node scripts/db-teste.mjs --sufixo r2pg` (`merlostore_test_r2pg`), Redis índice **10**.

**CRIA E É DONO**
- `src/lib/pagamentos/index.ts` · `_consultas.ts` · `_regras.ts` · `conta.ts` · `cobranca.ts` · `envio.ts` · `cancelamento.ts` · `confirmacao.ts` · `webhook.ts` · `notificacao.ts` · `expiracao.ts` · `conciliacao.ts` · `alertas.ts` · `mensagens.ts` · `simulacao.ts`
- `src/lib/pagamentos/costuras.ts` (**só o corpo**; assinatura fixa, criada no D-09)
- `src/lib/pagamentos/provedores/tipos.ts` · `registro.ts` · `simulado.ts` · `mercadopago/config.ts` · `mercadopago/cliente.ts` · `mercadopago/adaptador.ts` · `mercadopago/assinatura.ts`
- `src/lib/actions/pagamentos.ts` · `src/lib/validadores/pagamentos.ts`
- `src/app/api/webhooks/pagamentos/[provedor]/[integracaoId]/route.ts`
- `src/components/comum/pagamentos/secao-pagamento.tsx` e `botao-cobrar.tsx` (**só o corpo**; criados no D-09) · `painel-cobranca.tsx` · `dialogo-gerar-cobranca.tsx` · `dialogo-cancelar-cobranca.tsx` · `historico-cobrancas.tsx` · `qr-pix.tsx`
- `src/app/(app)/configuracoes/pagamentos/page.tsx` · `loading.tsx` · `error.tsx` · `_components/cartao-conta.tsx` · `_components/formulario-conta.tsx` · `_components/dialogo-desconectar.tsx`
- `src/server/processadores/pagamentos.ts` (**só o corpo**; criado no D-10)
- `tests/unidade/pagamentos-*.test.ts` · `tests/integracao/pagamentos-*.test.ts` · `tests/componentes/pagamentos-*.test.tsx` · `tests/travas/pagamentos-fonte.test.ts` · `tests/fixtures/mercadopago/*.json`
- `docs/modulos/pagamentos.md` (passo a passo do painel do Mercado Pago, modos da instalação, lista CONFERIR com data e resultado)

**SÓ LÊ**: `src/lib/pagamentos/situacao.ts` (D-08; mudar exige ADR 0033) · `src/lib/db/schema/**` · `src/lib/db/mutacoes.ts` e `src/lib/db/mutacoes/**` (`emTransacao`, `inserirAuditado`, `atualizarComTrava`, `excluirLogico`, `atualizarContador`, `atualizarEstado`, `transicionarPagamento`, `registrarEventoRecebido`, `registrarProcessamentoEvento`, `registrarAuditoria`) · `src/lib/db/consultas.ts` · `src/lib/auth/**` (`guard`, `loja`, `sistema`, `permissoes`) · `src/lib/actions/_base.ts` · `src/lib/seguranca/{maquina,assinaturas,cofre,corpo,limite}.ts` · `src/lib/rede/buscarExterno.ts` · `src/lib/qr.ts` · `src/lib/formato.ts` · `src/lib/erros.ts` · `src/lib/env.ts` · `src/lib/logger.ts` · `src/lib/fila/**` · `src/lib/conversas/saida.ts` · `src/lib/ui/tons.ts` · `src/components/comum/**` (fora de `pagamentos/`) · `src/components/ui/**`.

**Não negociável**
1. Nenhuma chamada de rede dentro de transação; nenhuma transação aberta durante chamada ao provedor. `executarAcaoExterna` só em `actions/pagamentos.ts` (fora deste pacote, também em `actions/inteligencia.ts` e `actions/canais-extras.ts`).
2. `para: "aprovado"` só em `confirmacao.ts`; nada de pessoa leva a `aprovado`; simulação só em conta simulada.
3. O corpo e o `type` da notificação do Mercado Pago **nunca** decidem: sempre consulta de volta.
4. 404, lista vazia ou provedor fora do ar **nunca** viram `expirado`, `cancelado` automático ou `aprovado`.
5. Toda transição de pagamento por `transicionarPagamento`; toda escrita em `pedidos` por `atualizarComTrava`; ordem de trava `pedidos` → `pagamentos`.
6. `pedidos.pagamento_status` só por `statusPagamentoDoPedido` (`situacao.ts`).
7. Conferência (c)…(h) da R2-PG-08 antes de qualquer `aprovado`/`estornado`.
8. Trocar credencial só da mesma conta; conta no `rotulo`.
9. Falha ao persistir o evento = 500; evento persistido e fila fora = 500; resto = 200.
10. E-mail e CPF do pagador nunca em banco, log, trilha, job, Redis ou `valores`.
11. Simulado bloqueado em produção em três camadas; tudo simulado rotulado "TESTE".
12. Literais do Mercado Pago só em `config.ts`; o host só em `config.ts` e `buscarExterno.ts`.
13. Arquivo ≤ 499 linhas; PT-BR; block de 3 s em "Gerar cobrança", "Cancelar cobrança" e "Desconectar".
14. Nenhuma escrita em ERP; nenhuma mudança em `pedidos.status`/`masc_*` por causa de pagamento.
15. Nenhum arquivo fora de "CRIA E É DONO" é editado; faltou algo → para e reporta.

**Aceite verificável**
- `npm run lint && npm run typecheck && npm run compliance && npm run test:compliance && npm run test:travas && npm run test:unidade && npm run test:componentes` verdes.
- `node scripts/db-teste.mjs --sufixo r2pg` + `DATABASE_URL_TESTE=…/merlostore_test_r2pg REDIS_URL=redis://localhost:6382/10 npm run test:integracao` verde.
- Fluxo manual em dev (conta simulada): conectar conta simulada → gerar Pix no pedido que veio de conversa → QR e código aparecem → "Enviar pela conversa" cria 2 mensagens na conversa → "Simular pagamento aprovado" → em até 10 s a seção mostra "Pago" e "Pago — falta lançar no Masc." → a linha do tempo do pedido mostra "Cobrança gerada" e "Pagamento confirmado" (ator sistema).
- `curl -X POST <APP_URL>/api/webhooks/pagamentos/mercadopago/<id>` sem assinatura → 401 corpo vazio; nenhuma linha nova em `pagamentos` nem em `lojas_integracoes_eventos`.
- `NODE_ENV=production`: `/api/webhooks/pagamentos/pagamento_simulado/<id>` → 404; conectar conta simulada → `CONFIGURACAO`.
- HML, antes de ligar PRD: cada CONFERIR de `config.ts` conferido com credencial `TEST-` e anotado em `docs/modulos/pagamentos.md` (data, resultado); só então `PAGAMENTOS_MERCADOPAGO=producao` em PRD.

**Testes obrigatórios**

| ID | Arquivo | Prova |
|---|---|---|
| T-PG-01 | `tests/unidade/pagamentos-transicoes.test.ts` | tabela do §3.3 inteira (cada célula permitida e cada proibida); mapa do Mercado Pago; `rejected` no link não muda nada; `cancelled` vencido → `expirado`, não vencido → `cancelado` |
| T-PG-02 | `tests/integracao/pagamentos-gerar.test.ts` | Pix e link com simulado: linha `pendente`, valor = total, `forma_pagamento`, trilhas `pagamento_gerado`; recusa pedido cancelado, pago, estornado, de outra loja (404), total 0, loja sem conta, conta `erro`, instalação desligada (Mercado Pago), pendente válida, pendente vencida; `pedidoAtualizadoEm` velho → `COLISAO`; falha na transação → `cancelar` chamado no provedor |
| T-PG-03 | `tests/integracao/pagamentos-concorrencia.test.ts` | 2 gerações simultâneas → 1 pendente; cancelar × aprovar em paralelo → final `aprovado` + candidato `pagamento-tardio-*`; duas notificações diferentes do mesmo pagamento em paralelo → uma transição e uma linha de trilha; cancelamento de pedido × confirmação em paralelo sem deadlock (ordem pedido → pagamento) |
| T-PG-04 | `tests/integracao/pagamentos-webhook.test.ts` | assinatura válida → aprovado, pedido `pago`, evento `processado` com corpo mascarado, trilha com ator `sistema`; assinatura inválida / conta inexistente / conta revogada → 401 corpo nulo, mesma forma; `?token=` → 401; corpo > 256 KB → 413; nenhum `JSON.parse` antes de `conferir` (espião); 300 POSTs sem assinatura com o id da conta e depois um POST assinado → 200 |
| T-PG-05 | idem | evento repetido processa uma vez; repetido ainda `recebido` e sem `processado_em` é reenfileirado com o mesmo `jobId`; Redis fora → 500; **replay assinado com `type=foo` seguido da entrega original → pagamento processado**; notificação sem `data.id` → `descartado` com `evento_externo_id` nulo |
| T-PG-06 | idem | notificação na conta da loja B com referência de pagamento da loja A → `descartado`, nada muda; referência desconhecida → `descartado` sem alerta; pagamento 404 → `descartado` |
| T-PG-07 | `tests/integracao/pagamentos-expiracao.test.ts` | vencido + provedor pendente → cancela lá → `expirado`; vencido + provedor aprovado → `aprovado`; **vencido + 404/desconhecida → continua `pendente` e, 30 min depois, candidato `pagamento-vencida-*`**; link com pagamento em análise → continua pendente; provedor fora → continua pendente; conciliação recupera aprovação perdida e estorno de 60 dias |
| T-PG-08 | `tests/integracao/pagamentos-pii.test.ts` | CPF e e-mail digitados não aparecem em nenhuma tabela, `auditoria_eventos`, log capturado, carga de job nem Redis; `valores` de erro sem `accessToken`, `segredoWebhook`, `pagadorCpf`; access token e segredo não aparecem em claro no banco |
| T-PG-09 | `tests/unidade/pagamentos-producao.test.ts` + `tests/integracao/pagamentos-simulacao.test.ts` | `NODE_ENV=production`: `provedorDe("pagamento_simulado")` lança; rota 404; `conectarConta` e `simularEvento` recusam. Fora de produção: simular sobre pagamento `mercadopago` ou em loja cuja conta viva não é simulada → `VALIDACAO` |
| T-PG-10 | `tests/travas/pagamentos-fonte.test.ts` | `para: "aprovado"` só em `confirmacao.ts`; nenhuma action importa `aplicarEstadoExterno`; nenhum `"manual"` como provedor e nenhum `pagamentos:marcar_pago` em `src/**`; `executarAcaoExterna` só nos arquivos da lista fechada do D-05 |
| T-PG-11 | `tests/unidade/pagamentos-mercadopago.test.ts` | `buscarExterno` por `vi.mock` + fixtures: criar Pix/link, consultar, buscar por referência, cancelar Pix/link (cada ramo), 400/401/403/404/429/5xx/timeout classificados; link fora de `hostsDoLink` recusado; `189.9` → `18990`; moeda ≠ BRL e `collector_id` diferente → divergente; prefixo de token × modo da instalação |
| T-PG-12 | `tests/travas/pagamentos-fonte.test.ts` | dentro de `src/lib/pagamentos/**`, `CONFERIR` só em `mercadopago/config.ts`; literais `api.mercadopago.com`, `/v1/payments`, `/checkout/preferences`, `/users/me`, `x-signature`, `x-request-id`, `collector_id`, `init_point` só em `config.ts` (e o host em `buscarExterno.ts`) |
| T-PG-13 | idem | `src/lib/pagamentos/**` não importa `integracoes/bling`, não contém `masc_` e não escreve `pedidos.status` |
| T-PG-14 | `tests/unidade/pagamentos-assinatura.test.ts` | vetor HMAC fixo; `data.id` em maiúsculas vira minúsculas; `x-request-id` vazio omite o par; `ts` fora da tolerância; id adulterado; segredo de isonomia → falso pelo mesmo caminho |
| T-PG-15 | `tests/integracao/pagamentos-envio.test.ts` | 2 mensagens pela conta da conversa com as chaves de idempotência; segunda chamada não duplica; pedido sem conversa → `VALIDACAO`; **`conversa_id` de outra loja ou de outro contato → recusa e nenhuma mensagem**; cobrança vencida → recusa; texto sem dado do pagador; prefixo TESTE no simulado; falha de envio dentro de `gerarCobranca` mantém a cobrança |
| T-PG-16 | `tests/integracao/pagamentos-conta.test.ts` | conectar exige sessão fresca; `rotulo` com o id da conta e diff da trilha com ele; segunda conta viva na loja → recusa; **trocar credencial com token de outra conta → `VALIDACAO`, nada muda**; mesma conta → recifra e `conectado`; testar com 401 → `erro`; desconectar com pendente → recusa; desconectar apaga credencial, carimba `revogada_em` e exclui; gerente e vendedor não alcançam nada; token `TEST-` em modo `producao` → recusa |
| T-PG-17 | `tests/integracao/pagamentos-alertas.test.ts` | cada linha do §5.6 aparece e deixa de voltar quando a condição some; Pix pendente < 20 min não alerta; link não gera `pagamento_pendente`; toda chave começa com `pagamento-` |
| T-PG-18 | `tests/integracao/pagamentos-estorno.test.ts` | estorno total → `estornado` e pedido `estornado`; parcial → sem mudança + erro `estorno_parcial`; chargeback → `estornado` + erro; provedor já estornado com local pendente → duas transições; com Masc lançado → candidato `pagamento-estorno-masc-*` que some quando o pedido vira `devolvido`; aprovado nunca regride |
| T-PG-19 | `tests/unidade/pagamentos-mensagens.test.ts` | textos exatos do §7.1, horário em `America/Sao_Paulo` |
| T-PG-20 | `tests/componentes/pagamentos-secao.test.tsx` | estados da tabela §7.1 (inclusive instalação desligada, envio falhou, `naoEncontrada`); QR com `alt`; copiar; atualização de 10 s só com pendente visível |
| T-PG-21 | `tests/componentes/pagamentos-block.test.tsx` | `gerar-cobranca` e `cancelar-cobranca` passam por `ModalConfirmacaoBlock` com resumo; Esc/clique fora inertes nos 3 s; foco inicial em "Cancelar"; motivo obrigatório; erro mantém o modal |
| T-PG-22 | `tests/componentes/pagamentos-conta.test.tsx` | estados da tabela §7.3; token só com 4 últimos; simulado ausente do seletor em produção; ajuda de troca com o id da conta |
| T-PG-25 | `tests/integracao/pagamentos-conta-trocada.test.ts` | cobrança criada antes da conta atual + notificação válida da conta atual → nada muda, evento `falhou` com `pagamento_conferir:conta_trocada`, candidato de alerta; conciliação não relê a cobrança antiga |
| T-PG-26 | `tests/integracao/pagamentos-cancelar.test.ts` | cancelar: não paga → `cancelado` com motivo; já paga → `jaPago` e `aprovado`; link em análise → recusa; desconhecida → `naoEncontrada` e `cancelado`; provedor fora → recusa, continua `pendente`; `cancelarCobrancasDoPedido` + job (pendente → transitório; cancelado → cancela; já pago → aprovado + alerta tardio) |

(T-PG-23 e T-PG-24 são testes da fundação, entregues no §10: `tests/unidade/pagamentos-situacao.test.ts` e `tests/seguranca/maquina-balde.test.ts`.)

**Riscos**
- Contrato do Mercado Pago diferente do `config.ts` (manifesto, unidade do `ts`, obrigatoriedade de CPF, campos da resposta, `collector_id`) → isolado, marcado e travado; `PAGAMENTOS_MERCADOPAGO` só vira `producao` depois da conferência em HML.
- Exigir e-mail do pagador em todo Pix gera atrito no balcão → ADR 0041; se o Mercado Pago dispensar, é `exigeEmail: false`.
- Duas lojas na **mesma aplicação** do Mercado Pago: a notificação vai para uma URL só; a outra loja depende de expiração e conciliação → desaconselhado na tela e no guia.
- Alerta só por evento (estorno parcial, disputa, duplicidade de link) quando o webhook se perde → a conciliação corrige o estado, mas não gera esse alerta (limitação aceita, ADR 0038).
- Cancelamento de pedido: a cobrança continua pagável no provedor até o job rodar → aprovação tardia registrada e alertada (R2-PG-12).
- `registrarEnvio` de M1 sem o bloqueio de servidor do delta D-16 → a mensagem falha no provedor e a tela mostra "não entregue" (honesto, mas pior); o D-16 é pré-requisito.

**Commits** (Conventional Commits, PT-BR, sem rodapé de coautoria)
1. `feat(pagamentos): interface de provedor, provedor simulado e regras de transição`
2. `feat(pagamentos): confirmação única com conferência de loja, valor e conta`
3. `feat(pagamentos): adaptador Mercado Pago com assinatura e consulta de volta`
4. `feat(pagamentos): webhook por conta, notificação, expiração e conciliação`
5. `feat(pagamentos): cancelamento de cobrança e costura do cancelamento de pedido`
6. `feat(pagamentos): cobrança no pedido e envio pela conversa`
7. `feat(pagamentos): conta de pagamento por loja com identidade fixa`
8. `feat(pagamentos): alertas de cobrança para o gerador`
9. `test(pagamentos): travas de confirmação, conta, PII e contrato isolado`
10. `docs(pagamentos): guia do módulo e conferência do contrato do Mercado Pago`

**Tamanho estimado**: ~38 arquivos de produção (~2.700 linhas; maior: `confirmacao.ts`, ~260) + ~22 de teste e fixtures (~1.700 linhas). Um agente; o risco é o contrato externo, não o volume. Pode rodar em paralelo com R2-A, R2-C, R2-D e R2-E depois do §10.

---

## 10. DELTA DA FUNDAÇÃO (aplicar ANTES da onda 3, pelo orquestrador, nesta ordem)

Legenda: **[global]** = texto consolidado que vale para todos os clusters do R2 (os outros finais citam o mesmo item; aplicar **uma** vez); **[R2-PG]** = só deste cluster. Depois de tudo: `npm run db:teste && npm run db:migrate && npm run db:verificar && npm run verificar` verdes, num commit sequencial por item.

### D-01 [global] Listas fechadas (`src/lib/db/schema/_enums/`)

`plataforma.ts` — substituir `PROVEDORES` e acrescentar `PROVEDORES_DE_PAGAMENTO` antes dele:

```ts
/** Contas que recebem dinheiro (R2, ADR 0036). No máximo uma viva por loja: `uq_lojas_integracoes_pagamento`. */
export const PROVEDORES_DE_PAGAMENTO = ["mercadopago", "pagamento_simulado"] as const;
export type ProvedorDeConta = (typeof PROVEDORES_DE_PAGAMENTO)[number];

/**
 * `tiktok` = mensagem direta (R2-D, ADR 0051). `tiktok_shop` fica no CHECK sem adaptador.
 * `bling` é a conta da rede: `loja_id` nulo. Pagamento: `PROVEDORES_DE_PAGAMENTO`.
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

Em `TIPOS_ALERTA`, depois de `"integracao_com_erro"`: `"pagamento_conferir",`.

`pedidos.ts` — substituir:

```ts
/** `manual` saiu no R2 (ADR 0038): baixa manual não existe, nem no banco. */
export const PROVEDORES_PAGAMENTO = ["mercadopago", "asaas", "pagbank", "pagamento_simulado"] as const;
```

`auditoria.ts`, em `ACOES_AUDITADAS` (13 valores novos, nesta posição; ação que o orquestrador já tenha aceitado para M8 na onda 2 entra no mesmo commit):
- depois de `"negocio_criado"`: `"negocio_alterado",` (R2-A)
- depois de `"pagamento_estornado"`: `"pagamento_cancelado",` e `"pagamento_status_alterado",` (R2-PG)
- depois de `"devolucao_concluida"`: `"pesquisa_enviada",` e `"pesquisa_respondida",` (R2-A)
- depois de `"template_rejeitado"`: `"lookbook_criado",`, `"lookbook_alterado",`, `"lookbook_excluido",`, `"sla_alterado",` (R2-E)
- depois de `"consentimento_registrado"`: `"artigo_criado",`, `"artigo_alterado",`, `"artigo_excluido",`, `"artigo_etiqueta_alterada",` (R2-C)

As demais listas novas dos outros clusters (inteligência, SLA, `CAMPOS_PII`) entram como os finais deles descrevem, no mesmo commit.

### D-02 [R2-PG] Índices e CHECK no schema

`src/lib/db/schema/pedidos/pagamentos.ts`, no array do 3º argumento, depois de `uq_pagamentos_externo`:

```ts
    /** Uma cobrança pendente por pedido (R2-PG-03): duas pendentes = cliente pagando duas vezes. */
    uniqueIndex("uq_pagamentos_um_pendente")
      .on(t.pedido_id)
      .where(sql`status = 'pendente' and is_deleted = false`),
```

e trocar o comentário do topo "FORA DO R1: tabela criada, sem escrita…" por "Escrita só pelo módulo `pagamentos` (R2-PG, ADRs 0036–0041). O QR não é persistido: `qrcode_midia_id` fica nulo (ADR 0041)."

`src/lib/db/schema/integracoes.ts`, em `lojas_integracoes` (importar `listaSql` de `./_enums` e `PROVEDORES_DE_PAGAMENTO` de `./_enums/plataforma`), depois de `uq_lojas_integracoes_referencia`:

```ts
    /** No máximo uma conta de pagamento viva por loja (R2-PG-24). */
    uniqueIndex("uq_lojas_integracoes_pagamento")
      .on(t.loja_id)
      .where(sql.raw(`provedor in (${listaSql(PROVEDORES_DE_PAGAMENTO)}) and is_deleted = false`)),
```

`src/lib/db/schema/auth/usuarios.ts`, no array, depois de `usuarios_bloqueio_coerente` (importar `ATOR_SISTEMA` **não** — o literal fica aqui para o schema não depender de `auth/`):

```ts
    /** O ator de sistema (D-07) nunca entra: a linha semeada fica inativa para sempre. */
    check(
      "usuarios_sistema_inativo",
      sql`${t.id} <> '00000000-0000-4000-8000-000000000001' or ${t.ativo} = false`,
    ),
```

### D-03 [global] Migrações `0018_r2` e `0019_r2_integridade`

1. Aplicar **todas** as mudanças de schema do R2 (D-01, D-02 e as dos outros clusters) e rodar **uma vez** `npm run db:generate -- --name r2` → `0018_r2.sql`. Conferir que todo predicado saiu literal (trava `= $`) e que há exatamente um `DROP/ADD` por constraint de lista. Trechos que o R2-PG espera ver:

```sql
ALTER TABLE "lojas_integracoes" DROP CONSTRAINT "lojas_integracoes_provedor_lista";
ALTER TABLE "lojas_integracoes" ADD CONSTRAINT "lojas_integracoes_provedor_lista" CHECK ("lojas_integracoes"."provedor" in ('whatsapp_oficial', 'uazapi', 'instagram', 'facebook', 'tiktok', 'tiktok_shop', 'bling', 'mercadopago', 'pagamento_simulado'));
ALTER TABLE "lojas_integracoes_eventos" DROP CONSTRAINT "lojas_integracoes_eventos_provedor_lista";
ALTER TABLE "lojas_integracoes_eventos" ADD CONSTRAINT "lojas_integracoes_eventos_provedor_lista" CHECK ("lojas_integracoes_eventos"."provedor" in ('whatsapp_oficial', 'uazapi', 'instagram', 'facebook', 'tiktok', 'tiktok_shop', 'bling', 'mercadopago', 'pagamento_simulado'));
ALTER TABLE "pagamentos" DROP CONSTRAINT "pagamentos_provedor_lista";
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_provedor_lista" CHECK ("pagamentos"."provedor" in ('mercadopago', 'asaas', 'pagbank', 'pagamento_simulado'));
ALTER TABLE "alertas" DROP CONSTRAINT "alertas_tipo_lista";
ALTER TABLE "alertas" ADD CONSTRAINT "alertas_tipo_lista" CHECK ("alertas"."tipo" in ('sla_estourado', 'risco_avaliacao', 'negocio_parado', 'pagamento_pendente', 'primeiro_contato', 'cliente_retornando', 'follow_up_atrasado', 'sessao_uazapi_caiu', 'integracao_com_erro', 'pagamento_conferir'));
ALTER TABLE "auditoria_eventos" DROP CONSTRAINT "auditoria_eventos_acao_lista";
ALTER TABLE "auditoria_eventos" ADD CONSTRAINT "auditoria_eventos_acao_lista" CHECK ("auditoria_eventos"."acao" in (/* ACOES_AUDITADAS inteira, com os 13 valores do D-01 */));
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_sistema_inativo" CHECK ("usuarios"."id" <> '00000000-0000-4000-8000-000000000001' or "usuarios"."ativo" = false);
CREATE UNIQUE INDEX "uq_pagamentos_um_pendente" ON "pagamentos" USING btree ("pedido_id") WHERE status = 'pendente' and is_deleted = false;
CREATE UNIQUE INDEX "uq_lojas_integracoes_pagamento" ON "lojas_integracoes" USING btree ("loja_id") WHERE provedor in ('mercadopago', 'pagamento_simulado') and is_deleted = false;
```

   `pagamentos` não tem linha (tabela sem escrita no R1), então tirar `manual` do CHECK é seguro.
2. `npm run db:generate -- --custom --name r2_integridade` → `0019_r2_integridade.sql` com, além do que os outros finais pedem (FKs compostas de lookbooks, `lojas_ia_usos` append-only), a **única** semeadura do ator de sistema:

```sql
-- Ator de sistema (03-arquitetura.md §6.4; D-07): satisfaz a FK de modified_by
-- em escrita de webhook e worker. Sem conta, sem senha, inativo (CHECK
-- usuarios_sistema_inativo). 'gerente' porque é papel sem loja.
INSERT INTO usuarios (id, nome, email, papel, loja_id, ativo, precisa_configurar_fator)
VALUES ('00000000-0000-4000-8000-000000000001', 'Sistema', 'sistema@merlostore.invalid', 'gerente', NULL, false, true)
ON CONFLICT (id) DO NOTHING;
```

   Se a onda 2 já tiver semeado essa linha, o `ON CONFLICT` a mantém; nenhuma segunda semeadura em outro lugar.
3. `tests/travas/migracoes.test.ts`: acrescentar a `TAGS`, depois de `"0017_totp_framework"`:

```ts
  /** R2 (onda 3): uma migração gerada para todos os clusters e uma custom. */
  "0018_r2",
  "0019_r2_integridade",
```

   e trocar o título "são as 17 de 01-dados.md §9 mais a 0017 da fundação, na ordem" por "são as de 01-dados.md §9, a 0017 da fundação e as duas do R2, na ordem"; as asserções `toBe(48)`/`toHaveLength(48)` viram `50`.
4. `scripts/verificar-schema.mjs`: `TOTAL_TABELAS = 50`, `TOTAL_MODIFIED_BY = 41`, `TOTAL_FK_COMPOSTA = 21`, `APPEND_ONLY` com `"lojas_ia_usos"` (5 itens, 5 gatilhos `trg_*_imutavel`). Pagamentos não muda nenhum desses números. `tests/travas/mutacoes.test.ts`: `colunasPorTabela.size` → `toBe(50)`.
5. Nenhum `DELETE`, nenhum `DROP TABLE`.

### D-04 [global] `mutacoes.ts` vira pasta + funções novas

`src/lib/db/mutacoes.ts` passa a ser **só** reexportador (o caminho de import não muda para ninguém):

```ts
/**
 * Porta ÚNICA de escrita (03-arquitetura.md §6.4). A implementação mora em
 * `src/lib/db/mutacoes/`; `.insert(` e `.update(` só existem lá (trava
 * `tests/travas/mutacoes.test.ts`). Nenhum DELETE em lugar nenhum.
 */
export * from "./mutacoes/base";
export * from "./mutacoes/canais";
export * from "./mutacoes/pedidos";
export * from "./mutacoes/integracoes";
export * from "./mutacoes/pagamentos";
export * from "./mutacoes/pos-venda";
export * from "./mutacoes/transcricao";
```

Distribuição do conteúdo atual (sem mudar uma linha de lógica): `mutacoes/base.ts` = `Transacao`, `TabelaDominio`, `emTransacao`, `inserirAuditado`, `lerAtual`, `colisaoOuEscopo`, `atualizarComTrava`, `excluirLogico`, `exigirPares`, `atualizarContador`, `atualizarEstado`, reexports de `CONTADORES`, `ESTADOS_DE_SISTEMA`, `diffAuditado`, `registrarAuditoria` · `mutacoes/canais.ts` = `CanalDeContato`, `upsertContatoPorCanal`, `violacaoDeTelefone`, `avancarStatusDeEntrega`, `reivindicarReenvio`, `reservarDestinatarios` · `mutacoes/pedidos.ts` = `proximoNumeroDePedido` · `mutacoes/pos-venda.ts` e `mutacoes/transcricao.ts` = o que os finais R2-A e R2-C pedem. Os arquivos da pasta importam `Transacao` e os helpers de `./base`, nunca de `../mutacoes`.

`src/lib/db/mutacoes/integracoes.ts` — **as duas únicas** escritas no diário e a **única** lista branca de cabeçalhos, usadas por M5, R2-PG e R2-D (contrato exigido pelo R2-D, X-5). Se a onda 2 criou equivalente, o orquestrador troca as chamadas de M5 para estas no mesmo commit e remove a outra; `@/lib/integracoes` (M5) pode reexportar.

```ts
import { and, eq, sql } from "drizzle-orm";
import type { EscopoLoja } from "@/lib/auth/loja";
import { ATOR_SISTEMA } from "@/lib/auth/sistema";
import { db } from "../client";
import { vivos } from "../consultas";
import type { Provedor } from "../schema/_enums/plataforma";
import { lojas_integracoes_eventos } from "../schema/integracoes";
import { atualizarEstado, type Transacao } from "./base";

/** Lista branca ÚNICA do diário (01-dados.md §10): nunca authorization, cookie nem assinatura. */
export const CABECALHOS_DO_DIARIO = ["content-type", "content-length", "user-agent", "x-request-id"] as const;

export function cabecalhosDoDiario(h: Headers): Record<string, string> {
  const guardados: Record<string, string> = {};
  for (const nome of CABECALHOS_DO_DIARIO) {
    const valor = h.get(nome);
    if (valor !== null) guardados[nome] = valor.slice(0, 256);
  }
  return guardados;
}

export type EventoRecebido = {
  provedor: Provedor;
  integracaoId: string | null;
  lojaId: string | null;
  tipo: "recebido" | "recusado" | "descartado";
  /** Nulo NÃO consome a chave de deduplicação. */
  eventoExternoId: string | null;
  assinaturaOk: boolean;
  ip: string | null;
  corpo: unknown;
  cabecalhos: Record<string, string>;
  erro: string | null;
};

/**
 * Diário de ingestão (ADR 0017), gravado SÓ depois de autenticar, sem
 * transação de domínio (um INSERT é atômico). Repetido = a linha que já
 * existe; `pendente` = ainda `recebido` e sem `processado_em` (sem piso de
 * tempo: a reentrega recupera enfileiramento que falhou).
 */
export async function registrarEventoRecebido(
  e: EventoRecebido,
): Promise<{ id: string; novo: boolean; pendente: boolean }> {
  const agora = new Date();
  const [linha] = await db
    .insert(lojas_integracoes_eventos)
    .values({
      provedor: e.provedor,
      integracao_id: e.integracaoId,
      loja_id: e.lojaId,
      tipo: e.tipo,
      evento_externo_id: e.eventoExternoId,
      assinatura_ok: e.assinaturaOk,
      ip: e.ip,
      corpo: e.corpo,
      cabecalhos: e.cabecalhos,
      erro: e.erro,
      processado_em: e.tipo === "recebido" ? null : agora,
      created_at: agora,
      updated_at: agora,
      modified_by: ATOR_SISTEMA,
    })
    // repete o predicado do índice parcial, senão o Postgres não acha o alvo
    .onConflictDoNothing({
      target: [lojas_integracoes_eventos.provedor, lojas_integracoes_eventos.evento_externo_id],
      where: sql`evento_externo_id is not null`,
    })
    .returning({ id: lojas_integracoes_eventos.id });
  if (linha) return { id: linha.id, novo: true, pendente: e.tipo === "recebido" };

  const [existente] = await db
    .select({
      id: lojas_integracoes_eventos.id,
      tipo: lojas_integracoes_eventos.tipo,
      processadoEm: lojas_integracoes_eventos.processado_em,
    })
    .from(lojas_integracoes_eventos)
    .where(
      and(
        eq(lojas_integracoes_eventos.provedor, e.provedor),
        eq(lojas_integracoes_eventos.evento_externo_id, e.eventoExternoId ?? ""),
        vivos(lojas_integracoes_eventos),
      ),
    )
    .limit(1);
  if (!existente) throw new Error("diário: conflito sem linha existente");
  return {
    id: existente.id,
    novo: false,
    pendente: existente.tipo === "recebido" && existente.processadoEm === null,
  };
}

export type DesfechoDeEvento = {
  tipo: "processado" | "descartado" | "falhou";
  erro: string | null;
  /** Projeção sem PII que substitui o corpo cru no MESMO update (01-dados.md §6.4). */
  projecao: Record<string, string | number | boolean | null>;
};

/** Fecha o evento: tipo, `processado_em`, erro, corpo mascarado e cabeçalhos zerados. */
export async function registrarProcessamentoEvento(
  tx: Transacao,
  alvo: { id: string; escopo: EscopoLoja },
  d: DesfechoDeEvento,
): Promise<void> {
  await atualizarEstado(tx, lojas_integracoes_eventos, alvo, {
    tipo: d.tipo,
    processado_em: new Date(),
    erro: d.erro,
    corpo: { mascarado: true, ...d.projecao },
    cabecalhos: {},
  });
}
```

`src/lib/db/mutacoes/pagamentos.ts`:

```ts
import { and, eq } from "drizzle-orm";
import type { Contexto } from "@/lib/auth/guard";
import { vivos } from "../consultas";
import type { StatusPagamento } from "../schema/_enums/pedidos";
import { pagamentos } from "../schema/pedidos/pagamentos";
import { diffAuditado, registrarAuditoria, type Transacao } from "./base";

export type AcaoDePagamento =
  | "pagamento_confirmado"
  | "pagamento_estornado"
  | "pagamento_cancelado"
  | "pagamento_status_alterado";

/**
 * Transição de `pagamentos.status` como CLAIM (R2-PG-11): trava a linha e só
 * muda se o status atual estiver em `de`; senão devolve `false` (outra
 * transição venceu). ÚNICA escrita de status de pagamento. O chamador já
 * travou o pedido (R2-PG-14).
 */
export async function transicionarPagamento(
  tx: Transacao,
  alvo: {
    id: string;
    lojaId: string;
    de: readonly StatusPagamento[];
    para: StatusPagamento;
    pagoEm?: Date;
    estornadoEm?: Date;
  },
  ctx: Contexto,
  acao: AcaoDePagamento,
  motivo?: string,
): Promise<boolean> {
  const onde = and(eq(pagamentos.id, alvo.id), eq(pagamentos.loja_id, alvo.lojaId), vivos(pagamentos));
  const [atual] = await tx.select({ status: pagamentos.status }).from(pagamentos).where(onde).for("update");
  if (!atual || !(alvo.de as readonly string[]).includes(atual.status)) return false;
  const depois: Record<string, unknown> = { status: alvo.para };
  if (alvo.pagoEm) depois.pago_em = alvo.pagoEm;
  if (alvo.estornadoEm) depois.estornado_em = alvo.estornadoEm;
  await tx
    .update(pagamentos)
    .set({ ...depois, updated_at: new Date(), modified_by: ctx.autorId })
    .where(onde);
  await registrarAuditoria(
    tx, ctx, acao, "pagamentos", alvo.id,
    diffAuditado("pagamentos", { status: atual.status }, depois),
    motivo,
  );
  return true;
}
```

Travas que leem o fonte de `mutacoes.ts` passam a ler a pasta:
- `ESTADOS_DE_SISTEMA.lojas_integracoes_eventos` (em `listas-fechadas.ts`) já cobre `tipo`, `processado_em`, `erro`, `corpo`, `cabecalhos`: sem mudança.
- `tests/travas/mutacoes.test.ts`: `const MUTACOES_DIR = "src/lib/db/mutacoes/";` · `ISENTOS` = `"src/lib/db/mutacoes.ts"`, `"tests/travas/mutacoes.test.ts"` **e** todo caminho que começa com `MUTACOES_DIR` · o piso confere que `src/lib/db/mutacoes/base.ts` existe · "exporta os helpers" concatena o texto de todos os `.ts` da pasta e acrescenta à lista `transicionarPagamento`, `registrarEventoRecebido`, `registrarProcessamentoEvento` (e confere `export function cabecalhosDoDiario`) (e os nomes de R2-A e R2-C) · os testes de `travaDeColisao`/`condicaoDeLoja` e de `atualizarContador` leem `src/lib/db/mutacoes/base.ts`.
- `tests/travas/soft-delete.test.ts` (linhas 104 e 130) e `tests/seguranca/escopo-loja.test.ts` (linha 132): ler `src/lib/db/mutacoes/base.ts`.
- `.claude/hooks/pre-write-guard.mjs` (mensagem), `.claude/skills/criar-crud/SKILL.md` e `criar-tabela/SKILL.md`: "`src/lib/db/mutacoes.ts` (implementação em `src/lib/db/mutacoes/`)".
- `03-arquitetura.md §6.4`: mesma frase.

### D-05 [global] `src/lib/actions/_base.ts`: um embrulho sem transação + `valores` sem segredo

1. Extrair de `executarAcao` os passos sessão → permissão → validação → escopo (do `const opcoes` até o `throw new ErroFaltaLoja()`) para `async function prepararAcao(cfg, bruto): Promise<{ dados; ctx }>` (privada) e usá-la em `executarAcao`.
2. Acrescentar (ADR 0049):

```ts
export type ConfigAcaoExterna<E extends z.ZodType, T> = Omit<ConfigAcao<E, T>, "executar"> & {
  /**
   * Chamada a provedor externo (pagamento, IA, transcrição) SEM transação aberta:
   * segundos de rede dentro de `emTransacao` seguram conexão e locks. O domínio
   * abre `emTransacao(ctx, …)` curtas antes e depois da chamada (ADR 0049).
   * Uso restrito por trava a `actions/pagamentos.ts`, `actions/inteligencia.ts` e `actions/canais-extras.ts`.
   */
  executar: (dados: z.output<E>, ctx: Contexto) => Promise<T>;
};

export async function executarAcaoExterna<E extends z.ZodType, T>(
  cfg: ConfigAcaoExterna<E, T>,
  bruto: unknown,
): Promise<Resultado<T>> {
  try {
    const { dados, ctx } = await prepararAcao(cfg, bruto);
    // Mesmo fail-closed de `emTransacao`: escopo "nenhuma" nunca executa.
    if (ctx.escopo.tipo === "nenhuma") throw new ErroDeEscopo();
    const saida = await cfg.executar(dados, ctx);
    for (const caminho of cfg.revalidar ?? []) revalidatePath(caminho);
    return { ok: true, dados: saida };
  } catch (erro) {
    if (erro instanceof Error && "digest" in erro && String(erro.digest).startsWith("NEXT_")) throw erro;
    registrarInesperado(erro, cfg.permissao);
    return paraResultado(erro);
  }
}
```

   (`ErroDeEscopo` importado de `@/lib/erros`.) O comentário do topo passa a dizer "Os TRÊS embrulhos".
3. Em `valoresDoFormulario`, trocar a regex por `/senha|password|token|codigo|segredo|secret|assinatura|cpf|cnpj/i`.
4. `tests/seguranca/guarda.test.ts`: `expect(typeof base.executarAcaoExterna).toBe("function")`; regex dos embrulhos `/\b(executarAcao|executarAcaoExterna|executarAcaoPublica|acao|acaoPublica)\s*\(/`; caso novo:

```ts
  it("executarAcaoExterna só em arquivos da lista fechada (ADR 0049)", () => {
    const PERMITIDOS = new Set([
      "src/lib/actions/_base.ts",
      "src/lib/actions/pagamentos.ts",
      "src/lib/actions/inteligencia.ts",
      "src/lib/actions/canais-extras.ts",
    ]);
    const fora = arquivos
      .filter((a) => /\bexecutarAcaoExterna\b/.test(a.texto))
      .map((a) => a.caminho)
      .filter((c) => !PERMITIDOS.has(c));
    expect(fora).toEqual([]);
  });
```
5. Teste novo `tests/unidade/valores-formulario.test.ts`: `FormData` com `senha`, `accessToken`, `segredoWebhook`, `pagadorCpf`, `cnpj`, `assinaturaSecreta` e `nome` → só `nome` volta em `valores` (exportar `valoresDoFormulario` com `/** @internal */` para o teste).
6. `02-seguranca.md §3.2` e `03-arquitetura.md §4.3`: "três embrulhos", com a lista fechada.

### D-06 [global] Permissões

1. **Remover** `src/lib/auth/permissoes/fase-r2.ts`.
2. Novo `src/lib/auth/permissoes/pagamentos.ts`:

```ts
import { OPERACAO, type MapaPermissao } from "./_papeis";

/**
 * Cobrança por Pix e link (R2-PG, ADRs 0036–0041).
 *
 * NÃO existe `pagamentos:marcar_pago`: só o provedor confirma (ADR 0038).
 * `cancelar_cobranca` é exceção escrita de INV-20: cancelar cobrança pendente
 * não move dinheiro, consulta o provedor antes e é o caminho para trocar de
 * método (ADR 0039).
 */
export const PAGAMENTOS: MapaPermissao = {
  "pagamentos:ler": OPERACAO,
  "pagamentos:gerar_cobranca": OPERACAO,
  "pagamentos:cancelar_cobranca": OPERACAO,
};
```

3. Novos `pos-venda.ts` (`POS_VENDA`: `negocios:*`, `devolucoes:*` com `devolucoes:editar` OPERACAO, `pesquisas:ler` GESTAO — conteúdo do final R2-A) e `inteligencia.ts` (`INTELIGENCIA`: `ia:*`, `conhecimento:*` — final R2-C). As quatro `conteudo:*` (lookbooks) vão para o fim de `COMERCIAL` em `comercial.ts`, com os mesmos papéis de hoje (final R2-E, D9).
4. `src/lib/auth/permissoes/index.ts`:

```ts
import { INTELIGENCIA } from "./inteligencia";
import { PAGAMENTOS } from "./pagamentos";
import { POS_VENDA } from "./pos-venda";
// (remover o import de FASE_R2)

/** Tudo o que alguma tela ou action entregue usa. INV-27 vale sobre este mapa. */
export const MATRIZ_ENTREGUE: MapaPermissao = {
  ...ATENDIMENTO,
  ...COMERCIAL,
  ...PLATAFORMA,
  ...PESSOAS,
  ...GOVERNANCA,
  ...CONTA,
  ...POS_VENDA,
  ...PAGAMENTOS,
  ...INTELIGENCIA,
};

/** O que `pode()` consulta. Não existe matriz de fase futura: chave nasce com a tela. */
export const MATRIZ: MapaPermissao = MATRIZ_ENTREGUE;
```

   (remover `export { FASE_R2 }` e `MATRIZ_R1`.)
5. `tests/seguranca/rbac.test.ts`: import `{ MATRIZ, MATRIZ_ENTREGUE, pode, podeChave }`; substituir o `it("as chaves da fase R2 estão SEPARADAS do R1 (INV-27)")` inteiro por:

```ts
  it("não existe matriz de fase futura: pode() só consulta o entregue (INV-27)", () => {
    expect(Object.keys(MATRIZ).sort()).toEqual(Object.keys(MATRIZ_ENTREGUE).sort());
  });

  it("dinheiro saindo é gestão; cobrança é operação; baixa manual não existe", () => {
    expect(podeChave("gerente", "devolucoes:concluir_estorno")).toBe(true);
    expect(podeChave("vendedor", "devolucoes:concluir_estorno")).toBe(false);
    expect(podeChave("vendedor", "pagamentos:gerar_cobranca")).toBe(true);
    // Exceção escrita de INV-20 (ADR 0039): a action se chama cancelar_cobranca.
    expect(podeChave("vendedor", "pagamentos:cancelar_cobranca")).toBe(true);
    expect(podeChave("viewer", "pagamentos:ler")).toBe(false);
    expect(CHAVES).not.toContain("pagamentos:marcar_pago");
  });
```

   e acrescentar `"pagamentos:"`, `"devolucoes:"`, `"negocios:"` à lista de prefixos do primeiro `it`.
6. `02-seguranca.md §2.2`: tirar o parágrafo "Chaves que nascem junto com a fase R2"; linhas `pagamentos:ler|gerar_cobranca|cancelar_cobranca` (vendedor+) e a exceção de INV-20 escrita junto de `agendamentos:cancelar`; `pagamentos:marcar_pago` **não existe**.

### D-07 [global] Ator de sistema

Novo `src/lib/auth/sistema.ts` (se a onda 2 criou um equivalente, este o substitui e as chamadas passam a importar daqui):

```ts
import type { Contexto } from "./guard";

/** Linha semeada em 0019_r2_integridade: inativa, sem conta, sem senha (CHECK usuarios_sistema_inativo). */
export const ATOR_SISTEMA = "00000000-0000-4000-8000-000000000001";

/**
 * Contexto de webhook e worker (03-arquitetura.md §6.4): trilha com
 * `ator_tipo = 'sistema'` e escopo de UMA loja. `papel: "viewer"` em memória:
 * qualquer `pode()` com este contexto falha fechado.
 */
export function contextoDeSistema(lojaId: string, origem: "webhook" | "worker"): Contexto {
  return {
    sessao: {
      usuarioId: ATOR_SISTEMA,
      sessaoId: ATOR_SISTEMA,
      papel: "viewer",
      lojaId,
      ativo: true,
      precisaTrocarSenha: false,
      precisaConfigurarFator: false,
    },
    escopo: { tipo: "uma", lojaId },
    autorId: ATOR_SISTEMA,
    origem,
  };
}
```

M7 (delta sobre arquivo alheio): listagem de usuários, `listar_colegas` e toda ação sobre conta alheia excluem/recusam `id = ATOR_SISTEMA` (`ErroDeEscopo`). Teste em `tests/integracao/usuarios-administracao.test.ts`: o ator não aparece e não pode ser reativado.

### D-08 [R2-PG → consumido por R2-A] `src/lib/pagamentos/situacao.ts` (completo)

Reproduz exatamente R2-TR-10 e R2-TR-14 do final R2-A; é a única implementação (o `_teto.ts` do R2-A delega).

```ts
import { and, eq, sql } from "drizzle-orm";
import type { Transacao } from "@/lib/db/mutacoes";
import { vivos } from "@/lib/db/consultas";
import { ErroDeEscopo } from "@/lib/erros";
import { paraCentavos } from "@/lib/formato";
import type { StatusPagamentoPedido } from "@/lib/db/schema/_enums/pedidos";
import { pedidos_devolucoes } from "@/lib/db/schema/devolucoes";
import { pagamentos } from "@/lib/db/schema/pedidos/pagamentos";
import { pedidos } from "@/lib/db/schema/pedidos/pedidos";

/**
 * Estado de pagamento do pedido e teto de estorno — UM lugar (ADR 0033).
 * Chamado por pagamentos (confirmação, estorno no provedor) e por devoluções
 * (conclusão), sempre com o pedido já travado e na mesma transação do fato.
 * Mudar esta regra exige ADR.
 */
export type OrigemDoPagamento = "provedor" | "masc" | "nenhuma";

export type FatosDePagamento = {
  totalCentavos: number;
  /** `pedidos.masc_status = 'lancado'`: o único fato de pagamento de balcão. */
  mascLancado: boolean;
  /** Σ pagamentos vivos `aprovado`. */
  aprovadoCentavos: number;
  /** Σ pagamentos vivos `estornado` (passou pelo provedor e voltou). */
  estornadoNoProvedorCentavos: number;
  /** Σ `valor_estorno` das devoluções vivas `concluida`. */
  estornoRegistradoCentavos: number;
};

const recebido = (f: FatosDePagamento) => f.aprovadoCentavos + f.estornadoNoProvedorCentavos;

export function origemDoPagamento(f: FatosDePagamento): OrigemDoPagamento {
  if (recebido(f) > 0) return "provedor";
  return f.mascLancado ? "masc" : "nenhuma";
}

export function baseDeEstorno(f: FatosDePagamento): number {
  switch (origemDoPagamento(f)) {
    case "provedor":
      return Math.min(f.totalCentavos, recebido(f));
    case "masc":
      return f.totalCentavos;
    case "nenhuma":
      return 0;
  }
}

/** Quanto ainda pode ser registrado como estorno numa devolução (R2-TR-10). */
export function tetoDeEstorno(f: FatosDePagamento): number {
  return Math.max(0, baseDeEstorno(f) - f.estornoRegistradoCentavos);
}

/**
 * Sem pagamento no provedor, o sistema nunca registrou pagamento: não mexe.
 * `estornado` é final. De `pago` sai quando não resta aprovado ou o registrado
 * cobre a base. De `pendente`/`cancelado` vai a `pago` com aprovado.
 */
export function statusPagamentoDoPedido(
  atual: StatusPagamentoPedido,
  f: FatosDePagamento,
): StatusPagamentoPedido {
  if (recebido(f) === 0 || atual === "estornado") return atual;
  if (atual === "pago") {
    const semAprovado = f.aprovadoCentavos === 0;
    const registradoCobre = f.estornoRegistradoCentavos >= baseDeEstorno(f);
    return semAprovado || registradoCobre ? "estornado" : "pago";
  }
  return f.aprovadoCentavos > 0 ? "pago" : atual;
}

const soma = (valor: unknown) => paraCentavos(String(valor ?? "0"));

export async function lerFatosDePagamento(
  tx: Transacao,
  pedidoId: string,
  lojaId: string,
): Promise<FatosDePagamento> {
  const [linha] = await tx
    .select({
      total: pedidos.total,
      masc: pedidos.masc_status,
      aprovado: sql<string>`coalesce((select sum(p.valor) from ${pagamentos} p
        where p.pedido_id = ${pedidos.id} and p.loja_id = ${pedidos.loja_id}
          and p.status = 'aprovado' and p.is_deleted = false), 0)::text`,
      estornado: sql<string>`coalesce((select sum(p.valor) from ${pagamentos} p
        where p.pedido_id = ${pedidos.id} and p.loja_id = ${pedidos.loja_id}
          and p.status = 'estornado' and p.is_deleted = false), 0)::text`,
      registrado: sql<string>`coalesce((select sum(d.valor_estorno) from ${pedidos_devolucoes} d
        where d.pedido_id = ${pedidos.id} and d.loja_id = ${pedidos.loja_id}
          and d.status = 'concluida' and d.is_deleted = false), 0)::text`,
    })
    .from(pedidos)
    .where(and(eq(pedidos.id, pedidoId), eq(pedidos.loja_id, lojaId), vivos(pedidos)));
  if (!linha) throw new ErroDeEscopo();
  return {
    totalCentavos: soma(linha.total),
    mascLancado: linha.masc === "lancado",
    aprovadoCentavos: soma(linha.aprovado),
    estornadoNoProvedorCentavos: soma(linha.estornado),
    estornoRegistradoCentavos: soma(linha.registrado),
  };
}
```

Teste da fundação **T-PG-23** `tests/unidade/pagamentos-situacao.test.ts` (funções puras): sem provedor e sem Masc → origem `nenhuma`, teto 0, status intacto; sem provedor e Masc lançado → origem `masc`, teto = total, status `pendente` intacto mesmo com estorno total registrado; aprovado → `pago`; `pago` e estornado no provedor sem outro aprovado → `estornado`, e o teto continua = `min(total, recebido)`; duas aprovações → base = total (não o dobro) e estorno de uma mantém `pago`; `pago` com registrado = base → `estornado`; registrado parcial → `pago`; `estornado` nunca muda; `cancelado` sem fatos → `cancelado`; `total < recebido` → base = total; teto nunca negativo; somas `0.10 + 0.20` em centavos.

### D-09 [R2-PG] Costuras de pagamentos (assinatura final, corpo seguro antes do pacote)

`src/lib/pagamentos/costuras.ts`:

```ts
import { and, count, eq } from "drizzle-orm";
import type { Contexto } from "@/lib/auth/guard";
import { vivos } from "@/lib/db/consultas";
import type { Transacao } from "@/lib/db/mutacoes";
import { pagamentos } from "@/lib/db/schema/pedidos/pagamentos";
import { naoImplementado } from "@/lib/erros";

/**
 * COSTURA — dono: R2-PG; consumida por M4 (cancelarPedido) e pelo gerador de
 * alertas de M8 (via `src/lib/alertas/fontes-r2.ts`). Até o R2-PG preencher,
 * não existe cobrança no banco: o caminho sem cobrança é o comportamento certo,
 * e qualquer cobrança pendente faz a costura falhar alto.
 */
export async function cancelarCobrancasDoPedido(
  tx: Transacao,
  pedidoId: string,
  ctx: Contexto,
): Promise<void> {
  const [linha] = await tx
    .select({ n: count() })
    .from(pagamentos)
    .where(and(eq(pagamentos.pedido_id, pedidoId), eq(pagamentos.status, "pendente"), vivos(pagamentos)));
  if ((linha?.n ?? 0) > 0) {
    throw naoImplementado(`cancelarCobrancasDoPedido [${pedidoId}, origem ${ctx.origem}] (pacote R2-PG)`);
  }
}

/** Forma estrutural de `CandidatoDeAlerta` (fontes-r2.ts), sem importar `@/lib/alertas`. */
export type CandidatoDeAlertaDePagamento = {
  tipo: "pagamento_pendente" | "pagamento_conferir";
  severidade: "media" | "alta";
  mensagem: string;
  chaveDeduplicacao: string; // sempre começa com `pagamento-`
  pedidoId: string | null;
  contatoId: string | null;
  conversaId: null;
  negocioId: null;
};

/** Sem cobrança, sem alerta. */
export async function candidatosDeAlertaDePagamento(
  _tx: Transacao,
  _lojaId: string,
  _agora: Date,
): Promise<CandidatoDeAlertaDePagamento[]> {
  return [];
}
```

`src/components/comum/pagamentos/secao-pagamento.tsx`:

```tsx
/**
 * COSTURA — dono: R2-PG; renderizada por M4 em /pedidos/[id]. Ilha de
 * servidor: busca a própria seção pela action (portão reaplicado). Até o R2-PG
 * preencher, não mostra nada — mostrar cobrança sem backend seria fachada (U8).
 */
export async function SecaoPagamento(_props: { pedidoId: string }) {
  return null;
}

/** Fallback do `Suspense` que M4 usa em volta da seção (altura do QR reservada quando preenchido). */
export function EsqueletoSecaoPagamento() {
  return null;
}
```

`src/components/comum/pagamentos/botao-cobrar.tsx`:

```tsx
"use client";

/** COSTURA — dono: R2-PG; renderizada por M4 no sucesso do "Fechar venda". Vazia até o pacote. */
export function BotaoCobrar(_props: { pedidoId: string }) {
  return null;
}
```

`05-plano-construcao.md §5`: 4 linhas novas na tabela de costuras (estes três arquivos e `situacao.ts`, "completo").

### D-10 [global] Filas, worker e agendador

`src/lib/fila/filas.ts`, em `FILAS` (com os itens dos outros clusters no mesmo commit):

```ts
  midia: { jobs: ["baixar-de-url", "gerar-miniatura", "transcrever-audio"], concorrencia: 4 },
  // …
  /** Cobrança (R2-PG): notificação, cancelamento no provedor, expiração e conciliação. */
  pagamentos: {
    jobs: ["processar-notificacao", "cancelar-no-provedor", "expirar-cobrancas", "conciliar-cobrancas"],
    concorrencia: 2,
  },
  /** IA (R2-C). */
  ia: { jobs: ["varrer-ia", "classificar-conversa"], concorrencia: 2 },
  /** Pós-venda (R2-A): conforme o final do R2-A. */
```

Novo `src/server/processadores/pagamentos.ts` (costura, dono R2-PG):

```ts
import type { Job } from "bullmq";
import { naoImplementado } from "@/lib/erros";

/**
 * COSTURA — dono: R2-PG. Fila `pagamentos`. Rede sempre fora de transação;
 * transação trava pedidos antes de pagamentos (R2-PG-14).
 */
export type DadosNotificacao = { eventoId: string };
export type DadosCancelamento = { pagamentoId: string; lojaId: string };
export type DadosConciliacao = { lojaId?: string };

export async function processarNotificacao(job: Job<DadosNotificacao>): Promise<void> {
  throw naoImplementado(`processarNotificacao [#${job.id}] (fila pagamentos, pacote R2-PG)`);
}
export async function cancelarNoProvedor(job: Job<DadosCancelamento>): Promise<void> {
  throw naoImplementado(`cancelarNoProvedor [#${job.id}] (fila pagamentos, pacote R2-PG)`);
}
export async function expirarCobrancas(job: Job): Promise<void> {
  throw naoImplementado(`expirarCobrancas [#${job.id}] (fila pagamentos, pacote R2-PG)`);
}
export async function conciliarCobrancas(job: Job<DadosConciliacao>): Promise<void> {
  throw naoImplementado(`conciliarCobrancas [#${job.id}] (fila pagamentos, pacote R2-PG)`);
}
```

`src/server/worker.ts`: `import { cancelarNoProvedor, conciliarCobrancas, expirarCobrancas, processarNotificacao } from "./processadores/pagamentos";` e, em `PROCESSADORES` (no **mesmo commit** de `FILAS`, senão `conferirCobertura()` derruba o boot):

```ts
  pagamentos: {
    "processar-notificacao": processarNotificacao as Processador,
    "cancelar-no-provedor": cancelarNoProvedor as Processador,
    "expirar-cobrancas": expirarCobrancas as Processador,
    "conciliar-cobrancas": conciliarCobrancas as Processador,
  },
```

`src/lib/fila/agendamentos.ts`, em `AGENDAMENTOS` (enquanto a costura lança, o job falha com 501 a cada ciclo e vai para a DLQ: é o aviso esperado até o pacote fechar):

```ts
  {
    nome: "expirar-cobrancas-5min",
    fila: "pagamentos",
    job: "expirar-cobrancas",
    padrao: "*/5 * * * *",
    porque: "cobrança vencida só vira expirada depois que o provedor confirma que não foi paga",
  },
  {
    nome: "conciliar-cobrancas-diario",
    fila: "pagamentos",
    job: "conciliar-cobrancas",
    padrao: "50 2 * * *",
    porque: "webhook perdido e estorno tardio só aparecem relendo o provedor",
  },
```

`05-plano §5` (costura nova) e `03-arquitetura.md §8.1` (linha da fila `pagamentos`: 4 jobs, concorrência 2, limitador de saída 5 req/s por conta no cliente do provedor).

### D-11 [global] `src/lib/rede/buscarExterno.ts` (um patch só)

Texto único = final R2-D §10 F4 (reproduzido aqui no que o R2-PG usa):

```ts
export type Provedor = "meta" | "uazapi" | "bling" | "discord" | "mercadopago" | "openai" | "tiktok";

// em HOSTS (as demais entradas conforme F4 do R2-D):
  /** Pagamentos (R2-PG). */
  mercadopago: ["api.mercadopago.com"],

/** Teto absoluto: só upload de áudio (R2-C) passa de 8 s, e nunca de 60 s. */
export const TIMEOUT_MAXIMO_MS = 60_000;

/** Cabeçalhos com credencial: nunca atravessam para outro host num salto. */
const CABECALHOS_DE_CREDENCIAL = new Set(["authorization", "access-token", "x-api-key"]);

function semCredencial(cabecalhos: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(cabecalhos ?? {}).filter(([nome]) => !CABECALHOS_DE_CREDENCIAL.has(nome.toLowerCase())),
  );
}

export type OpcoesBusca = {
  provedor: Provedor;
  metodo?: "GET" | "POST" | "PUT";
  corpo?: string | FormData;
  cabecalhos?: Record<string, string>;
  maxBytes?: number;
  /** Padrão TIMEOUT_MS; cortado em TIMEOUT_MAXIMO_MS. */
  timeoutMs?: number;
};
```

Em `uma()`: `signal: AbortSignal.timeout(Math.min(opcoes.timeoutMs ?? TIMEOUT_MS, TIMEOUT_MAXIMO_MS))`. No bloco de redirecionamento: não-GET → `recusar("so GET segue redirecionamento")`; destino com `hostname` diferente → segunda chamada com `semCredencial(opcoes.cabecalhos)`; mesmo host → cabeçalhos iguais. `tests/seguranca/ssrf.test.ts`: os casos do F4 do R2-D, que incluem `api.mercadopago.com` no DNS falso e "host de um provedor não vale para outro" (`api.mercadopago.com` com `openai` recusado).

### D-12 [R2-PG] `src/lib/env.ts` e `.env.example`

Em `env.ts`, novo bloco depois de `// -- Canais` (junto das variáveis de canal/IA dos outros finais):

```ts
    // -- Pagamentos (R2-PG, ADR 0037)
    /** `desligado`: Mercado Pago não é oferecido. `teste`: só token TEST- (HML). `producao`: só token APP_USR- (PRD). */
    PAGAMENTOS_MERCADOPAGO: z.enum(["desligado", "teste", "producao"]).default("desligado"),
```

`.env.example`, bloco "Pagamentos": `PAGAMENTOS_MERCADOPAGO=desligado` com o comentário "HML: teste · PRD: producao, só depois da conferência do config.ts". `03-arquitetura.md §15` e `02-seguranca.md §18`: linha da variável (não é segredo).

### D-13 [global] `src/lib/seguranca/maquina.ts`: balde por conta depois de autenticar

Texto único = final R2-D §10 F5: `limiteIntegracao?: Regra | null` (`null` desliga, para rota assinada pelo app); o bloco "2. Teto por integracao" sai de antes do `GET/HEAD` e entra logo depois do `if (integracao === null || !autentica) { … }`:

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

A rota de pagamento usa o padrão (`limiteIntegracao` omitido = `LIMITE_INTEGRACAO_PADRAO`, 300/min por conta, contado só autenticado). `GET`/`HEAD` consomem só o balde por IP.
Teste **T-PG-24** = `tests/seguranca/maquina-balde.test.ts` do F5 do R2-D, com o caso exigido aqui: `rotaDeMaquina` de prova com `limiteIntegracao: { janela: 60, max: 5 }`; 300 GETs e 300 POSTs sem assinatura com o mesmo id → um POST assinado → **200**; 6 POSTs assinados → o 6º **429**.
`02-seguranca.md §12`: a ordem passa a "teto por IP → content-length → leitura → carregar → validade → assinatura → **teto por integração** → anti-repetição → persistir → enfileirar → 200", e a frase "O teto por IP **e** por `integracaoId` é aplicado **antes** de tocar o banco" vira "O teto por IP é aplicado antes de tocar o banco; o teto por `integracaoId`, depois de autenticar (o id é público: balde antes da assinatura deixaria qualquer um calar a conta)".

### D-14 [global] `src/lib/logger.ts`

`CAMPOS_SENSIVEIS` ganha: `"accessToken"`, `"segredoWebhook"`, `"pagadorCpf"`, `"pagadorEmail"`, `"cpf"`, `"apiKey"`, `"x-api-key"`, `"access-token"`.

### D-15 [global] Alertas (M8, depois que M8 fechar)

Novo `src/lib/alertas/fontes-r2.ts` (dono FUNDAÇÃO; única porta pela qual os clusters do R2 entram no gerador; as fontes não importam `@/lib/alertas`, só devolvem a mesma forma):

```ts
import type { Transacao } from "@/lib/db/mutacoes";
import type { Severidade, TipoAlerta } from "@/lib/db/schema/_enums/plataforma";
import { candidatosDeAlertaDeNegocio } from "@/lib/negocios";
import { candidatosDeAlertaDePagamento } from "@/lib/pagamentos/costuras";

export type CandidatoDeAlerta = {
  tipo: TipoAlerta;
  severidade: Severidade;
  mensagem: string;
  chaveDeduplicacao: string;
  pedidoId: string | null;
  contatoId: string | null;
  conversaId: string | null;
  negocioId: string | null;
};

/**
 * Fonte de alerta do R2. O gerador abre o candidato novo e RESOLVE o alerta
 * aberto cujo `tipo` está em `tipos` E cuja chave começa com `prefixo`, quando
 * a chave não voltou nesta rodada. As duas condições juntas impedem uma fonte
 * de resolver alerta de outra regra do mesmo tipo.
 */
export type FonteDeAlerta = {
  tipos: readonly TipoAlerta[];
  prefixo: string;
  candidatos: (tx: Transacao, lojaId: string, agora: Date) => Promise<CandidatoDeAlerta[]>;
};

export const FONTES_R2: readonly FonteDeAlerta[] = [
  { tipos: ["negocio_parado"], prefixo: "negocio-parado-", candidatos: candidatosDeAlertaDeNegocio },
  {
    tipos: ["pagamento_pendente", "pagamento_conferir"],
    prefixo: "pagamento-",
    candidatos: candidatosDeAlertaDePagamento,
  },
];
```

(A linha do R2-A do §10.3 do final dele — `{ tipo: "negocio_parado", candidatos }` — fica nesta forma, com `prefixo` = o começo da chave que o R2-A já usa. O SLA do R2-E não é fonte: muda a própria regra `sla_estourado`, pelo patch único de M8 do final R2-E.)
Gerador de M8 (uma alteração só): para cada loja viva, para cada fonte de `FONTES_R2`, abre os candidatos novos (dedupe pelo único parcial `(loja_id, chave_deduplicacao)` aberto) e carimba `resolvido_em` nos abertos com `tipo IN (tipos)` e `chave_deduplicacao LIKE prefixo || '%'` que não voltaram. As regras próprias de M8 continuam e **não** resolvem alerta que case com uma fonte registrada.
Mapa de rótulos da trilha de M8 (`Record<AcaoAuditada, …>`), 13 entradas: `negocio_alterado` "Negócio alterado" · `pesquisa_enviada` "Pesquisa de satisfação enviada" · `pesquisa_respondida` "Pesquisa de satisfação respondida" · `pagamento_cancelado` "Cobrança cancelada" · `pagamento_status_alterado` "Situação da cobrança alterada" · `artigo_criado` "Artigo criado" · `artigo_alterado` "Artigo alterado" · `artigo_excluido` "Artigo excluído" · `artigo_etiqueta_alterada` "Etiqueta do artigo alterada" · `lookbook_criado` "Lookbook criado" · `lookbook_alterado` "Lookbook alterado" · `lookbook_excluido` "Lookbook excluído" · `sla_alterado` "Prazos de SLA alterados".

### D-16 [global] M1 (depois que M1 fechar)

`src/lib/conversas/saida.ts` — tipo final:

```ts
export type EnvioParaRegistrar = {
  lojaId: string;
  contatoId: string;
  integracaoId: string;
  conteudo: string;
  chaveIdempotencia: string;
  /** Grava nesta conversa (tem de ser do contato, da loja e da integração). Sem ela, vale a mesclagem. */
  conversaId?: string;
  /** `false`: não reabre nem muda status (R2-A). Padrão `true`. */
  reabrir?: boolean;
  /** Padrão: o que M1 decide pela origem. */
  autorTipo?: "sistema" | "campanha";
  /** Mídias já guardadas (R2-E). */
  midiaIds?: string[];
  /** Cartão derivado (R2-E). */
  card?: { tipo: "produto" | "pedido" | "pagamento" | "lookbook"; id: string };
};
```

Regra no corpo de M1 que o R2-PG usa: envio de **pessoa** (`ctx.origem = "ui"`, sem `autorTipo`) é recusado com `ErroDeValidacao` e **a mesma frase do composer** quando a conta da conversa não está `conectado` ou a janela de resposta do provedor fechou (fonte da janela: `src/lib/canais/janela.ts` do final R2-D); `conversaId` que não seja do `contatoId`, da `lojaId` e da `integracaoId` → `ErroDeEscopo`. Chave de idempotência repetida → devolve a mensagem existente, sem duplicar. Slots de composer e balão: como os finais R2-C/R2-E descrevem (o R2-PG não usa).
`src/lib/tempo-real/canal.ts` e `src/server/sse.ts`: **nenhuma** mudança pelo R2-PG.

### D-17 [R2-PG] Arquivos de M4 e M5 (depois que fecharem; um commit por arquivo)

| Dono | Arquivo | Mudança exata |
|---|---|---|
| M4 | `src/app/(app)/pedidos/[id]/page.tsx` | `import { SecaoPagamento } from "@/components/comum/pagamentos/secao-pagamento";` e, depois da seção "Valores": `<Suspense fallback={<EsqueletoSecaoPagamento />}><SecaoPagamento pedidoId={pedido.id} /></Suspense>` (importar os dois do mesmo arquivo) |
| M4 | `src/app/(app)/conversas/_components/painel-venda.tsx` | `import { BotaoCobrar } from "@/components/comum/pagamentos/botao-cobrar";` e, no estado de sucesso do "Fechar venda": `<BotaoCobrar pedidoId={novo.id} />` |
| M4 | `src/lib/pedidos/**` (`cancelarPedido`) | depois do `FOR UPDATE` do pedido e antes de gravar `cancelado`: `await cancelarCobrancasDoPedido(tx, pedido.id, ctx);` (import de `@/lib/pagamentos/costuras`); teste de M4 ganha "cancelar pedido sem cobrança continua funcionando" |
| M4 | rótulos da linha do tempo do pedido (se o mapa for `Record<AcaoAuditada, …>`) | `pagamento_gerado` "Cobrança gerada" · `pagamento_confirmado` "Pagamento confirmado" · `pagamento_estornado` "Pagamento estornado" · `pagamento_cancelado` "Cobrança cancelada" · `pagamento_status_alterado` "Situação da cobrança alterada" |
| M4 | selo `pagamento_status` do cabeçalho do pedido | usa `tomDe("status_pagamento_pedido", …)` (D-18) |
| M5 | `src/app/(app)/configuracoes/page.tsx` | cartão "Pagamentos — conta do Mercado Pago da loja" → `/configuracoes/pagamentos`, filtrado por `pode(papel, "integracoes", "ler")` |
| M5 | listagem de `/configuracoes/integracoes` e `catalogo-provedores.ts` | filtrar `provedor ∉ PROVEDORES_DE_PAGAMENTO`; se o catálogo for `Record<Provedor, …>`, entradas `mercadopago` e `pagamento_simulado` com `gerenciadoEm: "/configuracoes/pagamentos"` e sem ação de conexão ali |
| M5 | webhooks de canal | inserção e fechamento do diário por `registrarEventoRecebido` / `registrarProcessamentoEvento` e cabeçalhos por `cabecalhosDoDiario` (D-04); se a lista branca de M5 tiver outro nome aceito, ele entra em `CABECALHOS_DO_DIARIO` |

### D-18 [global] `src/lib/ui/tons.ts`

Importar `STATUS_PAGAMENTO`, `STATUS_PAGAMENTO_PEDIDO` (+ tipos) de `_enums/pedidos` e acrescentar:

```ts
const STATUS_PAGAMENTO_TONS: Record<StatusPagamento, Entrada> = {
  pendente: { rotulo: "Aguardando pagamento", tom: "aviso" },
  aprovado: { rotulo: "Pago", tom: "sucesso" },
  recusado: { rotulo: "Recusado", tom: "perigo" },
  expirado: { rotulo: "Vencida", tom: "neutro" },
  cancelado: { rotulo: "Cancelada", tom: "neutro" },
  estornado: { rotulo: "Estornado", tom: "neutro" },
};

/** `pendente` sem selo: a maioria das vendas é paga no balcão e registrada no Masc. */
const STATUS_PAGAMENTO_PEDIDO_TONS: Record<StatusPagamentoPedido, Entrada> = {
  pendente: null,
  pago: { rotulo: "Pago", tom: "sucesso" },
  estornado: { rotulo: "Estornado", tom: "aviso" },
  cancelado: { rotulo: "Pagamento cancelado", tom: "neutro" },
};
```

Em `TONS_POR_DOMINIO` e `VALORES_POR_DOMINIO`: `status_pagamento` e `status_pagamento_pedido`. Em `TIPO_ALERTA_TONS`: `pagamento_conferir: { rotulo: "Pagamento para conferir", tom: "neutro" }` (a cor vem da severidade). Tirar `STATUS_PAGAMENTO` da frase "Enums fora do R1" do comentário. `04-ui.md §2.4`: as duas tabelas.

### D-19 [global] Rotas públicas, caminhos de acesso, árvore canônica e mapa de donos

`src/lib/seguranca/rotas-publicas.ts`: `dono: "fundacao" | "M5" | "R2-PG" | "R2-D";` e, ao fim de `ROTAS_PUBLICAS`:

```ts
  {
    caminho: "/api/webhooks/pagamentos/[provedor]/[integracaoId]",
    metodos: ["POST"],
    portao: "maquina",
    motivo: "confirmacao do provedor de pagamento: HMAC da aplicacao da loja e consulta de volta antes de mudar estado",
    dono: "R2-PG",
  },
```

`docs/seguranca/caminhos-de-acesso.md`: `| /api/webhooks/pagamentos/[provedor]/[integracaoId] | POST | maquina | HMAC da aplicacao da loja; consulta de volta; simulado so fora de producao | pacote R2-PG |` e, nas privadas, `| /configuracoes/pagamentos | GET | sessao + integracoes:ler | conta de pagamento da loja; credencial so com 4 ultimos | pacote R2-PG |`; tirar pagamento da lista "não existem".
Árvore canônica (`04-ui.md §4.1` e `01-dados.md §13.2`): `configuracoes/pagamentos/page.tsx` e `api/webhooks/pagamentos/[provedor]/[integracaoId]/route.ts`. `03-arquitetura.md §5`: linha da rota; retirar `/api/webhooks/pagamento` de "não existem".
`05-plano-construcao.md §8`, linhas novas:

| Caminho | Dono |
|---|---|
| `src/lib/pagamentos/**` (exceto `situacao.ts`, que só muda com ADR 0033), `src/components/comum/pagamentos/**`, `src/app/api/webhooks/pagamentos/**` (exceção nominal dentro de `api/webhooks/**` de M5), `src/app/(app)/configuracoes/pagamentos/**`, `src/lib/actions/pagamentos.ts`, `src/lib/validadores/pagamentos.ts`, `processadores/pagamentos.ts`, `docs/modulos/pagamentos.md` | R2-PG |
| `src/lib/auth/permissoes/pagamentos.ts`, `src/lib/auth/sistema.ts`, `src/lib/alertas/fontes-r2.ts`, `src/lib/db/mutacoes/**` | FUNDAÇÃO |

Linha de observação: "`src/components/comum/pagamentos/` é a única subpasta de `comum/` com dono de pacote: a UI de cobrança é usada por duas telas de pacotes diferentes (M4)."

### D-20 [global] Lista fechada de block (27 itens)

`tests/componentes/block-3s.test.tsx`, em `ACOES_COM_BLOCK`, depois de `"eliminar-dados-do-titular"`, e o comentário "Vinte itens, nem um a mais" vira "Vinte e sete itens, nem um a mais":

```ts
  // R2
  "negar-troca",
  "concluir-troca",
  "gerar-cobranca",
  "cancelar-cobranca",
  "publicar-artigo",
  "enviar-lookbook",
  "salvar-prazos-de-sla",
```

`04-ui.md §9.1`, bloco "R2" renumerado uma vez: 21. **Negar troca/devolução** · 22. **Concluir troca/devolução** · 23. **Gerar cobrança** (Pix ou link; resumo com pedido, cliente, valor, validade e conta) · 24. **Cancelar cobrança** (motivo obrigatório) · 25. **Publicar/editar artigo** da base · 26. **Enviar lookbook** · 27. **Salvar prazos de SLA**. O item 5 passa a citar "negócio" e "artigo da base"; o item 7 cobre "conta de pagamento". A trava de cada tela ligada sobe `PISO_DE_TELAS_LIGADAS` no pacote dela (R2-PG liga `gerar-cobranca` e `cancelar-cobranca`).

### D-21 [global] Alinhamento com o R2-A (estorno)

As regras R2-TR-10, R2-TR-11 e R2-TR-14 e a coordenação do §10.2 do **final R2-A** valem como estão (base provedor/Masc/nenhuma; pagamento de origem `aprovado` ou `estornado`; `estornado` só a partir de `pago`; dois gravadores com a mesma regra). A única exigência deste documento: `src/lib/devolucoes/_teto.ts` **não reimplementa** a fórmula — chama `lerFatosDePagamento`, `origemDoPagamento`, `tetoDeEstorno` e `statusPagamentoDoPedido` de `src/lib/pagamentos/situacao.ts` (D-08) e só monta a microcopia; o teste de teto do R2-A exercita o mesmo módulo. `05-plano §5` registra a costura `situacao.ts` (dono R2-PG, consumida por R2-A). A regra 2 da coordenação (alerta de aprovado em pedido devolvido) está no §5.6.

### D-22 [global] Índices Redis e ADRs

| Pacote | Banco de teste | Redis |
|---|---|---|
| R2-A (A1, A2, A3 em série) | `merlostore_test_r2a` | 9 |
| R2-PG | `merlostore_test_r2pg` | 10 |
| R2-C | `merlostore_test_r2c` | 11 |
| R2-D | `merlostore_test_r2d` | 12 |
| R2-E1 / R2-E2 | `merlostore_test_r2e1` / `_r2e2` | 13 / 14 |

ADRs: A 0031–0035 · B (R2-PG) 0036–0041 · C 0042–0049 · D 0050–0053 · E 0054–0057. Fusões: estorno = **0033** (texto do §11 abaixo, escrito uma vez); action sem transação = **0049** (texto do §11, escrito uma vez; o ADR 0041 deste cluster não trata mais de transação).

### D-23 [global] Documentos

- `01-dados-dominio.md §6.5`: trocar "Fora do R1" por "Escrita só pelo módulo `pagamentos` (R2-PG)"; anotar `uq_pagamentos_um_pendente`, `qrcode_midia_id` nulo (ADR 0041) e `PROVEDORES_PAGAMENTO` sem `manual`. §6.6 item 1: "`pagamento_status` por `statusPagamentoDoPedido` (ADR 0033)".
- `01-dados.md §6.3` (`uq_lojas_integracoes_pagamento`, `PROVEDORES`), `§13.4` e `03-arquitetura.md §4.2/§22`: `pagamentos` passa a módulo entregue.
- `02-seguranca.md`: S-11 vira "Webhook de pagamento por conta (R2-PG)"; §12, linha "Pagamento" = "Mercado Pago: `x-signature` da aplicação da loja sobre `data.id`, `x-request-id` e `ts` + consulta de volta; `type` não decide; simulado só fora de produção".
- `04-ui.md §5.3`, linha `/pedidos/[id]`: trocar "Sem aba de pagamento…" por "Seção Pagamento (R2-PG): Pix/link, envio pela conversa, cancelar; sem baixa manual". `§5.6`: linha `/configuracoes/pagamentos`. `§7.2`: `INTEGRACAO` e `CONFIGURACAO` citam o provedor de pagamento.
- `05-plano-construcao.md §6`: o texto de M5 "Só lê: … `mutacoes.ts` (`registrarProcessamentoEvento`)" passa a "(`registrarEventoRecebido`, `registrarProcessamentoEvento`)".

### D-24 [global] Navegação (o R2-PG não toca)

Nenhum item de navegação novo por pagamentos. A decisão global de `fase` (`"entregue" | "futura"`, teste "nenhum item futuro com `page.tsx`" sem exigir `> 0`) é aplicada conforme os finais R2-A/R2-C/R2-E.

---

## 11. ADRs a criar

Deste cluster (0036–0041):

**0036 — Conta de pagamento por loja, credencial no cofre, identidade fixa**
Cada loja conecta a própria conta (uma viva por loja); access token, assinatura secreta e id da conta ficam cifrados em `lojas_integracoes` (AES-256-GCM, AAD = id), geridos por dono/admin com sessão fresca; o id da conta vai também para o `rotulo`, visível na tela e na trilha.
Trocar credencial só aceita token da mesma conta; trocar de conta é desconectar (exige zero pendentes) e conectar; cobrança criada antes da conta atual não é confirmada por ela.
Custo aceito: depois de desconectar, estornos e contestações de cobranças da conta anterior não chegam mais; a mesma conta pode servir duas lojas (sem único por conta), com uma aplicação por loja.

**0037 — Mercado Pago como único provedor real, ligado por `PAGAMENTOS_MERCADOPAGO`; simulado só fora de produção**
Adaptador real só do Mercado Pago (`asaas`/`pagbank` no CHECK sem adaptador: Asaas exige cadastro de cliente com CPF/CNPJ); contrato isolado em `config.ts` marcado CONFERIR.
`PAGAMENTOS_MERCADOPAGO` = `desligado` (padrão) | `teste` (só token TEST-, HML) | `producao` (só APP_USR-, PRD, depois da conferência); desligar não interrompe a confirmação do que já existe.
`pagamento_simulado` é determinístico, usado em dev e em integração, bloqueado em produção por registro, rota, conexão e simulação, e sempre rotulado "TESTE".

**0038 — Só o provedor confirma; resposta vazia nunca é "não pago"; sem baixa manual**
`aprovado`/`estornado` só por consulta de volta ao provedor, com conferência de loja, provedor, referência, id, valor, moeda, conta recebedora e conta atual; corpo e `type` da notificação não decidem.
404, busca vazia ou provedor fora do ar não mudam estado: a cobrança segue pendente e vira alerta; `pagamentos:marcar_pago` e `manual` não existem; pagamento não muda `pedidos.status`, `masc_*` nem a Receita.
Limitação aceita: alertas que dependem do evento (estorno parcial, disputa, duplicidade de link) não nascem da conciliação quando o webhook se perde.

**0039 — Uma cobrança pendente por pedido, valor fechado, validade fechada, expiração confirmada**
Valor = `pedidos.total` sob trava; no máximo uma pendente por pedido; Pix 30 min/2 h/24 h, link 24 h sem boleto; ordem de trava pedido → pagamento.
Cancelar é de operação (exceção escrita de INV-20: não move dinheiro), com motivo, block e consulta prévia; o que o provedor não encontra só a pessoa cancela.
Vencida vira `expirado` só com o provedor encontrando a cobrança sem pagamento e aceitando o cancelamento; conciliação noturna de 7 dias (não pagas) e 90 dias (pagas).

**0040 — Pagamento depois do encerramento é registrado e alertado; cancelar pedido cancela as cobranças**
Aprovação que chega para cobrança cancelada/vencida/recusada ou para pedido cancelado/devolvido é registrada (dinheiro recebido é fato) e vira alerta "estorne pelo painel"; o sistema nunca devolve dinheiro sozinho.
Cancelar o pedido cancela as pendentes na mesma transação e pede o cancelamento no provedor por job; a janela até o job rodar é coberta pelo alerta.
Estorno no provedor com a venda lançada no Masc vira alerta que só se resolve quando o pedido é devolvido ou cancelado no sistema.

**0041 — Dados do pagador não persistidos, QR local, envio só por pessoa**
E-mail e CPF do pagador vão só ao provedor (nunca banco, log, trilha, job, Redis ou eco de formulário); a descrição da cobrança não leva nome nem itens.
QR gerado no servidor a partir do copia-e-cola e não persistido (`qrcode_midia_id` nulo); a cliente recebe texto (resumo + código, ou link) só quando a vendedora manda, pela conversa do pedido, conferida por loja e contato; nenhuma mensagem automática de "pago".
Ponto para o Paulo validar com o cliente: atrito de pedir e-mail em todo Pix (se o Mercado Pago dispensar, é uma linha em `config.ts`).

Compartilhados (texto único; o orquestrador grava uma vez):

**0033 — Estorno no R2: registrado na devolução, executado fora, teto pelo recebido e estado do pedido num lugar só** (conjunto R2-A/R2-PG; texto-base no final R2-A)
O sistema não inicia estorno: Pix, maquininha, crédito na loja ou painel do Mercado Pago acontecem fora; a devolução registra valor, forma e pagamento de origem, e o estorno feito no provedor chega ao pedido pelo R2-PG.
Teto em centavos, com o pedido travado: recebido pelo provedor (aprovado ou já estornado) ou, sem provedor, o total da venda lançada no Masc (único fato de pagamento de balcão, porque não há baixa manual), menos o já registrado; `pagamento_status` vira `estornado` só a partir de `pago`, pelos dois caminhos, de forma idempotente.
A regra mora só em `src/lib/pagamentos/situacao.ts`; o alerta de pagamento em pedido devolvido não dispara quando o estorno registrado cobre o aprovado.

**0049 — Action sem transação para chamada externa** (fusão R2-PG + R2-C)
`executarAcaoExterna` repete sessão, permissão, validação e escopo de `executarAcao`, mas não abre transação; o domínio abre transações curtas antes e depois da chamada ao provedor.
Rede nunca dentro de transação (pagamento, IA, transcrição): segurar conexão e trava durante segundos de rede derruba o pool.
Uso restrito por trava a `src/lib/actions/pagamentos.ts`, `src/lib/actions/inteligencia.ts` e `src/lib/actions/canais-extras.ts` (Messenger/TikTok, R2-D).

---

## 12. Críticas: como ficaram resolvidas

| # | Severidade | Crítica | Resolução neste documento |
|---|---|---|---|
| 1 | alta | troca de credencial aceitava outra conta; 404 virava "não pago" | R2-PG-08 (g)(h), R2-PG-10, R2-PG-17, R2-PG-25; `contaExternaId` no cofre e no `rotulo`; T-PG-07, T-PG-16, T-PG-25; ADRs 0036/0038 |
| 2 | média | balde por conta antes da autenticação | D-13 (global) + T-PG-04 + T-PG-24; texto do `02-seguranca §12` |
| 3 | média | envio confiava em `pedidos.conversa_id` | R2-PG-20, §5.2 `enviarCobrancaNaConversa`, T-PG-15 |
| 4 | média | deltas conflitantes (embrulho, `dono`, `buscarExterno`, ator de sistema) | D-05 (um embrulho, lista fechada com pagamentos, inteligência e canais extras), D-19 (`dono` com R2-PG e R2-D), D-11 (um patch), D-07 (um ator, uma semeadura) |
| 5 | baixa | credencial reenviada em redirecionamento | D-11 (`CABECALHOS_DE_CREDENCIAL` + não-GET não segue 3xx) e caso no `ssrf.test.ts` |
| 6 | baixa | `type` não assinado decidia descarte | R2-PG-09; §5.3; T-PG-05 |
| 7 | baixa | segredo e CPF voltavam em `valores` | D-05 item 3 + teste; D-14 |
| 8 | baixa | simulação atuava sobre pagamento real | R2-PG-27; §5.2; T-PG-09 |
| 9 | bloqueante | cinco migrações 0018 | D-03: `0018_r2` gerada uma vez + `0019_r2_integridade`; `TAGS` ajustado uma vez |
| 10 | alta | contagens divergentes | D-03 item 4 (50/41/21/5) |
| 11 | alta | `mutacoes.ts` > 500 linhas | D-04: pasta `mutacoes/` + reexportador; travas que leem o fonte ajustadas |
| 12 | alta | dois embrulhos sem transação | D-05 + ADR 0049 |
| 13 | bloqueante | estorno de venda paga fora do gateway nunca concluía | R2-PG-29/30 e D-08 (`situacao.ts` completo, com a regra do final R2-A: provedor, Masc lançado ou nenhuma), D-21, §5.6 (alerta tardio), ADR 0033 |
| 14 | alta | remover `marcar_pago` quebrava o `rbac.test.ts` | D-06 item 5 (texto exato do teste); T-PG-10 restrita a `src/**` |
| 15 | alta | vários clusters editando arquivos de M1 | D-16: um delta de M1 com `EnvioParaRegistrar` final; o R2-PG não edita M1 |
| 16 | alta | vários clusters editando M4/M8/M2 | D-09 (costuras `comum/pagamentos/*`, `costuras.ts`), D-15 (`fontes-r2.ts` com prefixo), D-17 (uma linha por arquivo de M4/M5) |
| 17 | alta | índice Redis 9 repetido | D-22: R2-PG = 10 |
| 18 | média | ADRs sobrepostos | D-22 e §11: R2-PG 0036–0041; fusões 0033 e 0049 |
| 19 | média | lista de block colidindo | D-20: 27 itens com slugs |
| 20 | média | `fase` da navegação | D-24 (R2-PG não toca; decisão global citada) |
| 21 | média | permissões sem regra única | D-06: `FASE_R2` removido, `MATRIZ_ENTREGUE`, um arquivo por domínio |
| 22 | média | arquivos compartilhados com textos que não se compõem | D-10, D-11, D-14, D-18, D-19 escritos como patch único |
| 23 | média | três portas de escrita do diário | D-04: `registrarEventoRecebido` + `registrarProcessamentoEvento`, só em `mutacoes/integracoes.ts`, usadas por M5, R2-PG e R2-D |
| 24 | média | rótulos de ação da trilha | D-15 (13 rótulos no mapa de M8) + D-17 (linha do tempo de M4) |
| 25 | média | mapa de donos | D-19 (linhas nominais) e UI em `comum/pagamentos/` para não cair na árvore de M4 |
| 26 | baixa | referência de base velha | cabeçalho: `9481ef8` |

### Decisões próprias desta consolidação (não pedidas pela crítica)

- `PAGAMENTOS_MERCADOPAGO` (D-12, ADR 0037): cumpre "provedor real ligado por env" e impede PRD com token de teste ou ligar antes da conferência do `config.ts`.
- Sem evento de tempo real `pagamento-atualizado`: a tela atualiza a cada 10 s só enquanto há cobrança pendente visível; evita tocar `canal.ts`/`sse.ts` e não disputa o teto de conexões SSE por pessoa.
- `pagamento_conferir` com tom `neutro` em `tons.ts` (o arquivo manda a cor vir da severidade).
- `testarContaPagamento` sem sessão fresca (só lê no provedor); conectar, trocar e desconectar continuam exigindo.
- Cancelamento pela pessoa quando o provedor não encontra a cobrança (R2-PG-15): é decisão humana com motivo e trilha, e é a saída do alerta de cobrança vencida sem confirmação.

---

## 13. Problemas rejeitados

| Crítica | Parte rejeitada | Motivo |
|---|---|---|
| #13 | "teto = `pedidos.total` sempre que não há pagamento de gateway" | Adotada a versão do final R2-A, mais conservadora: sem pagamento no provedor, o teto é o total **só** se a venda está lançada no Masc (o único fato de pagamento de balcão); sem isso o teto é 0 e a tela explica como lançar. Venda nunca lançada não tem prova de pagamento, e estornar o que não se sabe se foi pago é o defeito T-01 voltando. |
| #1 | "mostrar o id da conta em `detalhes` da trilha" | `auditoria_eventos` não tem coluna `detalhes` (só `antes`, `depois`, `motivo`) e o schema está fechado. O id vai para `lojas_integracoes.rotulo`, que entra no diff de `integracao_conectada` e aparece na tela — mesmo efeito, sem coluna nova. |
| #1 | "404 → continua pendente" também para ação de pessoa | Mantido para todo caminho automático. Para a pessoa, cancelar uma cobrança que o provedor não conhece é permitido (com motivo, trilha e aviso para conferir no painel): sem isso, o alerta de cobrança vencida nunca teria saída e o pedido ficaria travado para sempre em "aguardando pagamento". Pagamento que aparecer depois cai na R2-PG-12. |
| #2 | teste "300 GETs com o id da conta" na rota de pagamento | A rota não exporta `GET` (o Next responde 405 sem tocar o limitador). O caso de GET fica no teste do wrapper (`maquina-balde.test.ts`); na rota, o teste usa POSTs sem assinatura. |
| #16 | `venceEmSql` como fonte de `fontes-r2.ts` | `venceEmSql` troca a expressão do prazo da regra de SLA que já é de M8; não produz candidatos. `fontes-r2.ts` recebe só fontes que devolvem candidatos (pagamentos e, pelo final do R2-A, negócio parado). |
| #10 | números 41/21/5 como verificados | Registrados como os valores finais da crítica; este cluster não cria tabela, `modified_by`, FK composta nem trilha append-only, então não os altera nem pode confirmá-los além disso. O orquestrador confere com `npm run db:verificar` depois do D-03. |
