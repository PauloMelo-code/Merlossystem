# R2-A — Pós-venda: funil de negócios, trocas e devoluções, pesquisa de satisfação (CSAT) · ESPECIFICAÇÃO FINAL

> **Documento final**: substitui `rascunho-r2a-posvenda.md`. O agente construtor lê só este documento, mais os arquivos citados em "Entradas" (§9).
> **Alvo**: `C:\Users\Paulo\Documents\MerlostoreChat`, branch `refactor/reconstrucao-estrutura-base`, **base commitada `9481ef8`**. A diferença para `565c92f` não toca nenhum arquivo usado aqui.
> **Conferido no código commitado**: `src/lib/db/schema/{negocios,devolucoes,lgpd,contatos,midias,auditoria}.ts`, `schema/conversas/{conversas,mensagens,mensagens-midias}.ts`, `schema/_enums/{pedidos,auditoria,conversas,catalogo,plataforma}.ts`, `schema/_compartilhado.ts`, `migrations/0012…0016`, `db/{mutacoes,consultas,listas-fechadas,erros}.ts`, `auditoria/gravador.ts`, `auth/{guard,loja}.ts`, `auth/permissoes/**`, `actions/_base.ts`, `validadores/comum.ts`, `formato.ts`, `marca.ts`, `env.ts`, `.env.example`, `fila/{filas,agendamentos}.ts`, `server/worker.ts`, `server/processadores/mensagens-entrada.ts`, `conversas/saida.ts`, `navegacao.ts`, `components/layout/navegacao-lateral.tsx`, `components/comum/{modal-confirmacao-block,confirmar-exclusao}.tsx`, `ui/tons.ts`, `docs/seguranca/caminhos-de-acesso.md`, `scripts/verificar-schema.mjs` e os testes `rbac`, `inventario`, `guarda`, `mutacoes`, `migracoes`, `block-3s`, `segredos`.
> **Interfaces do R1** (M1, M2, M4, M8): valem `05-plano-construcao.md §5–§6` e `03-arquitetura.md`. Cada ponto em que este pacote depende delas está no delta por módulo (§10.3), que o orquestrador aplica sobre o código **final** de cada módulo.

---

## 0. Premissas de consolidação (decisões globais do R2 que este documento já adota)

Estas decisões valem para os cinco clusters. O orquestrador aplica cada uma **uma vez**. Este documento só descreve a parte do R2-A.

| # | Decisão global | Efeito no R2-A |
|---|---|---|
| G1 | Uma migração só, `0018_r2` (gerada), mais `0019_r2_integridade` (custom). Enums finais somados uma vez. `TAGS` de `migracoes.test.ts` ajustada uma vez | O R2-A **não gera migração**. Contribui com o fragmento do §10.1-D2 |
| G2 | `src/lib/db/mutacoes.ts` vira **reexportador** da pasta `src/lib/db/mutacoes/{base,canais,pagamentos,pos-venda,transcricao}.ts`, **sem `index.ts`** (dois pontos de entrada seriam uma armadilha). A trava isenta a pasta e lê os exports de todos os arquivos dela | As duas funções do R2-A moram em `src/lib/db/mutacoes/pos-venda.ts`. `atualizarComTrava` (em `base.ts`) ganha o parâmetro `motivo` |
| G3 | Um único embrulho de action sem transação, restrito a `actions/pagamentos.ts` e `actions/inteligencia.ts` | O R2-A **não usa**: nenhuma action daqui chama rede |
| G4 | Um único contexto de sistema: `src/lib/auth/sistema.ts` com `ATOR_SISTEMA` (uuid semeado, `ativo = false`) e `contextoDeSistema(lojaId, origem)` (escopo `uma`). O `contextoDoSistema` que o M1 criou passa a delegar para ele | Job de pesquisa e ingestão gravam com esse contexto |
| G5 | `FASE_R2` é esvaziado. Cada família entregue ganha um arquivo por domínio, incluído em `MATRIZ_ENTREGUE` (novo nome de `MATRIZ_R1`) | Arquivo `permissoes/pos-venda.ts` (§4) |
| G6 | `ItemNav.fase: "entregue" \| "futura"`. O teste de inventário exige "nenhum item `futura` com `page.tsx`" e deixa de exigir `> 0` | Funil, Trocas e Satisfação ficam `entregue` |
| G7 | A lista fechada do block de 3 s fica com **27** itens | Itens `negar-troca` e `concluir-troca`. "Excluir negócio" cabe em `excluir-registro` |
| G8 | Um índice Redis por pacote: r2a = **9**, r2pg = 10, r2c = 11, r2d = 12, r2e1 = 13, r2e2 = 14 | §9 |
| G9 | ADRs em blocos: **R2-A = 0031–0035**, R2-PG = 0036–0041, R2-C = 0042–0049, R2-D = 0050–0053, R2-E = 0054–0057. Os ADRs de estorno se fundem no **0033** (conjunto R2-A/R2-PG) | §11 |
| G10 | `EnvioParaRegistrar` final = `{ lojaId, contatoId, integracaoId, conteudo, chaveIdempotencia, conversaId?, reabrir?, autorTipo?, midiaIds?, card? }` | O R2-A usa `conversaId`, `reabrir` e `autorTipo` (§10.3-M1) |
| G11 | Uma costura de fontes de alerta, `src/lib/alertas/fontes-r2.ts`, para nenhum cluster editar o gerador do M8 | O R2-A entrega `candidatosDeAlertaDeNegocio` (§5.6) |
| G12 | Um delta por arquivo de outro módulo (M1, M2, M4, M8), aplicado **uma vez** e **depois** que o módulo fechar | §10.3 |
| G13 | O mapa de donos (`05-plano §8`) ganha as linhas do R2 | §10.1-D12 |

### 0.1 Como cada problema da crítica foi tratado

| Crítica | Tratamento |
|---|---|
| SAIR ignorado (depois da nota, depois de 24 h, variações) | R2-CS-08/11: SAIR é classificado **antes** da nota e do comentário, vale por 30 dias depois de qualquer pesquisa e usa uma lista fechada ampliada. Nunca vira comentário |
| Escritas com `loja: "le"` | Toda escrita passa a `loja: "grava"` (§5). O teste de `FALTA_LOJA` está no §9. A obrigatoriedade no Zod foi rejeitada em parte (§12) |
| Teto do estorno impossível para venda de balcão | R2-TR-10: o teto passa a ser o valor recebido pelo provedor (aprovado ou já estornado) **ou** o total do pedido quando ele está lançado no Masc. ADR 0033 é conjunto com o R2-PG |
| Deltas conflitantes (embrulho, `dono`, `buscarExterno`, ator de sistema) | G3 e G4. O R2-A não toca em `buscarExterno` nem em `rotas-publicas.ts` |
| `buscarExterno` reenvia credencial no redirecionamento | Não afeta o R2-A, que não usa rede. Fica registrado para o delta único de `buscarExterno` (§10.4) |
| Microcopia do SAIR promete demais | R2-CS-11: o texto cita a loja. A propagação para as outras lojas foi rejeitada (§12) |
| Resposta de pesquisa sem trilha | Ação nova `pesquisa_respondida`. Os dois registros gravam `updated_at`, `modified_by` e a trilha (§10.1-D3) |
| Cinco migrações 0018 | G1 |
| Contagens do `verificar-schema` | O R2-A não cria tabela. Os valores finais (50/41/21/5) são do orquestrador |
| `mutacoes.ts` acima de 500 linhas | G2 |
| Dois embrulhos sem transação | G3 (fora do R2-A) |
| Arquivos de M1 editados por vários clusters | G10 e G12. O R2-A não edita composer nem balão |
| Arquivos de M4/M8/M2 editados por vários clusters | G11 e G12. A regra de negócio parado sai pela costura de fontes |
| Índice Redis | G8 |
| Numeração de ADR | G9 |
| Lista do block | G7 |
| `fase` da navegação | G6 |
| Estratégia de permissões | G5 |
| Deltas de arquivos compartilhados | Texto exato no §10.1. As partes que outros clusters também mexem estão marcadas como "fundir" |
| Rótulos da trilha no M8 | §10.3-M8: três rótulos, conferidos contra o código final do M8 |
| Mapa de donos | §10.1-D12. O R2-A não cria arquivo em árvore alheia |
| HEAD velho | Base atualizada para `9481ef8` |

---

## 1. Escopo e o que o sistema antigo tinha

### 1.1 Escopo

| Área | Entra no R2-A | Fica de fora (e por quê) |
|---|---|---|
| Funil (`negocios`) | Quadro kanban por loja. Criar, editar, mover, perder, reabrir e excluir. Detalhe com linha do tempo. Alerta de negócio parado. Vínculo com o pedido que ganha o negócio | Itens do negócio: não há tabela, e o valor é estimativa manual. Notas livres: não há coluna. Atalho "criar negócio a partir da conversa": `/funil` já resolve |
| Trocas e devoluções (`pedidos_devolucoes*`) | Criação com escolha de itens e de fotos da cliente. Aprovar, negar, registrar envio e recebimento. Concluir com estorno **registrado**. Efeitos no pedido e nos contadores | Estorno **executado** por provedor (ADR 0033). Mensagem automática à cliente. Nova peça da troca: sai por "Nova venda", fluxo do M4 |
| CSAT (`pesquisas_satisfacao`) | Disparo automático pela conta de entrada. Captura de nota, comentário e SAIR pela mensagem de entrada. SAIR vira opt-out. Painel `/satisfacao` | Envio manual. Modelo (template) da Meta para janela fechada. Alerta de nota baixa. IA. Canais Facebook e TikTok (ADR 0034) |

### 1.2 O que existia (commit `5e902d4`) e os defeitos que **não podem voltar**

**Funil (`deals` + `deal_events`)**: kanban de 6 colunas em `/pipeline`. O arrasto não checava a resposta. "Novo Deal" pedia para colar o UUID do contato. A perda tinha lista fechada na tela e texto livre na API. `POST /api/orders` com `dealId` marcava o deal como ganho, mas o Painel de Venda nunca mandava `dealId`: **nenhum deal era ganho na prática**.

| ID antigo | Defeito | Como este desenho fecha |
|---|---|---|
| D-01 | Pedido fechava qualquer deal por id, sem loja, sem contato e sem evento | O M4 só aceita negócio **aberto**, da mesma loja e do mesmo contato, e grava `negocio_estagio_alterado` na mesma transação. O painel de venda oferece o negócio aberto (§10.3-M4) |
| D-02 | `stage` livre sumia do quadro | `CHECK negocios_estagio_lista` e `z.enum` da mesma constante |
| D-03 | Evento gravado antes do update, fora de transação, "Deal criado" sem autor | Trilha pelas funções de mutação, na mesma transação, com autor da sessão |
| D-04 | Perda sem motivo, motivo antigo mantido ao reabrir, won/lost reabríveis sem regra | `CHECK negocios_perda_com_motivo` e Zod. Reabrir limpa o motivo. `ganho` é terminal |
| D-05 | `assignedTo`/`conversationId` sem conferência de loja | Responsável conferido contra a loja; conversa escolhida pelo servidor (R2-FN-08) |
| D-06 | Mudança de valor ou responsável sem evento | `negocio_valor_alterado` e `negocio_alterado` |
| D-07 | `GET` sem paginação; ganhos e perdidos listados para sempre | 30 cartões por coluna com cursor. Colunas terminais mostram só os últimos 30 dias |
| D-08 | Dois arrastos: o último vencia | Trava de colisão por `updated_at` |
| D-09 | Tela não checava erro; era preciso colar UUID | Resultado tratado; busca de cliente por nome ou telefone |
| D-10 | `value` negativo; `products` sem formato | `CHECK valor >= 0`, dinheiro como string, sem `products` |
| D-11 | Alerta `deal_stale` deduplicado por contato | Chave por negócio, resolvida pelo gerador |

**Trocas (`returns`)**: a rota de criação não era chamada por nenhuma tela. `/returns` tinha Aprovar, Negar, "Em trânsito" e Concluir sem modal. O fluxo travava em `shipping_back` (não havia botão para `received`). `refundAmount` não tinha teto, e nada acontecia no pedido. A política semeada nunca foi aplicada: "Prazo: 7 dias. Peça com etiqueta. Frete por nossa conta".

| ID antigo | Defeito | Como fecha |
|---|---|---|
| T-01 (CRÍTICO) | Estorno livre, sem teto, aprovado por vendedor sem modal nem trilha | Teto calculado no servidor (R2-TR-10). `devolucoes:concluir_estorno` só para gestão, com sessão fresca, motivo, block de 3 s e trilha **antes** do efeito |
| T-02 | `orderId` sem loja nem contato | FK composta `(pedido_id, loja_id)`. O contato vem do pedido, nunca do corpo |
| T-03 | Sem máquina de estados e sem efeito no pedido, pagamento, contadores, reserva e Masc | Máquina fechada (§3.2) e efeitos da conclusão na mesma transação (R2-TR-13..15) |
| T-04 | Tela travava em "Enviando" | Ações por estado, incluindo "Registrar recebimento" |
| T-05 | Tipo, motivo e itens livres; prazo não validado | `CHECK` e Zod. Itens de `pedidos_itens` com teto de quantidade. O prazo vira **aviso** (ADR 0032) |
| T-06 | Sem paginação; PUT sem Zod | Cursor e Zod em todas as entradas |
| T-07 | Sem tela de criação | `/trocas/nova` |

**CSAT (`satisfaction_surveys`)**: `POST /api/surveys` gravava `sent_at` **sem enviar nada**. Não havia coleta de resposta, gatilho nem tela.

| ID antigo | Defeito | Como fecha |
|---|---|---|
| S-01 | "Enviada" sem envio, sem coleta e sem tela | A linha só existe com `mensagem_id`, gravado na mesma transação do registro de saída. A resposta é capturada na entrada. O painel é real |
| S-02 | Média das 50 últimas; `triggerType` livre; ids sem loja | Média por período, `CHECK GATILHOS_PESQUISA`, conversa e pedido sempre da mesma loja |

Defeitos vizinhos que este cluster também não pode reintroduzir:
- **C-03**: os contadores do contato nunca desciam. Agora descem quando o pedido vira `devolvido`.
- **A-05**: ganho era contado por `updated_at`. O painel do funil não é relatório de conversão.
- **L-06**: PII em campo livre sem anonimização (§10.3-M2).
- **L-08**: opt-out sem palavra-chave (R2-CS-11).

---

## 2. Regras de negócio

### 2.1 Funil (ADR 0031)

- **R2-FN-01** Estágios fechados, nesta ordem: `lead` (Lead) → `interessada` (Interessada) → `negociando` (Negociando) → `fechando` (Fechando) → `ganho` (Ganho) | `perdido` (Perdido). **Abertos** são os quatro primeiros (`ESTAGIOS_NEGOCIO_ABERTOS`).
- **R2-FN-02** Entre estágios abertos, o movimento é livre (para frente e para trás).
- **R2-FN-03** `ganho` acontece **só** pela venda: pedido criado com `negocio_id` (regra do M4). Nenhuma action deste pacote grava `estagio = 'ganho'`. Motivo da decisão conservadora: "ganho sem pedido" inflaria o funil com venda que o sistema não conhece.
- **R2-FN-04** `ganho` é terminal: não reabre, não edita, não exclui. Se o pedido for cancelado depois, o ganho **não** é desfeito. O cartão mostra o selo "Venda cancelada", lido de `pedidos.status`.
- **R2-FN-05** Perder exige `motivo_perda` de `MOTIVOS_PERDA`: Preço, Tamanho indisponível, Concorrente, Sem resposta, Mudou de ideia, Outro. `observacao_perda` é opcional (até 500 caracteres) e **obrigatória com `outro`** (de 3 a 500). Só se perde a partir de estágio aberto.
- **R2-FN-06** `perdido` pode ser reaberto para qualquer estágio aberto. Reabrir **limpa** `motivo_perda` e `observacao_perda` no mesmo `UPDATE`.
- **R2-FN-07** **Um negócio aberto por cliente** (por contato, logo por loja), garantido pelo índice único parcial `uq_negocios_aberto_por_contato`. A action confere antes só para dar mensagem amigável; o índice segura a corrida. Reabrir um perdido quando já existe outro aberto é recusado.
- **R2-FN-08** O negócio pertence à loja resolvida da escrita. O contato precisa ser dessa loja, estar vivo e não estar anonimizado (a FK composta já cobre a loja). `responsavel_id`, quando presente, é usuário ativo com papel `dono`, `admin`, `gerente` ou `vendedor`; se for `vendedor`, tem de ser da mesma loja. `conversa_id` é preenchido pelo servidor com a conversa viva mais recente do contato naquela loja (nulo se não houver) e nunca vem do corpo.
- **R2-FN-09** `valor` é estimativa manual, em string `"1234.56"` (`REGEX_DINHEIRO`), maior ou igual a zero, com padrão `"0"`. `previsao_fechamento` é data pura opcional, entre hoje − 365 e hoje + 365 dias.
- **R2-FN-10** Atividade é qualquer mudança no **próprio** negócio: criar, editar, mover, perder ou reabrir. Cada uma grava `ultima_atividade_em = agora` por `atualizarContador`. Mensagem na conversa **não** conta, porque o alerta existe justamente para lembrar de atualizar o funil.
- **R2-FN-11** Negócio vivo em `negociando` ou `fechando` com `ultima_atividade_em < agora − 3 dias` gera alerta `negocio_parado`, severidade `alta`, **um por negócio**. A chave é `negocio_parado|negocio|<negocioId>` e a mensagem, "Negócio sem movimentação há 3 dias ou mais." (sem PII). O gerador resolve o alerta quando a chave deixa de voltar da fonte: o negócio saiu desses estágios, teve atividade nova ou foi excluído.
- **R2-FN-12** Excluir é lógico (`negocio_excluido`), só para gestão, com block de 3 s. Negócio `ganho` não é excluído, porque o pedido aponta para ele.
- **R2-FN-13** A linha do tempo lê `auditoria_eventos` por `(entidade = 'negocios', entidade_id)`.

### 2.2 Trocas e devoluções (ADR 0032 e ADR 0033)

- **R2-TR-01** Tipos:
  - `troca`: a peça volta e outra vai;
  - `devolucao`: a peça volta e o dinheiro ou crédito volta;
  - `reembolso`: o dinheiro volta sem a peça voltar (extravio, defeito leve).

  Motivos: `MOTIVOS_DEVOLUCAO`.
- **R2-TR-02** Só se abre solicitação para pedido vivo com `status IN ('enviado','entregue')`.
  - Pedido `confirmado` ou `preparando`: recusa com "Este pedido ainda não saiu da loja. Para desistir da compra, cancele o pedido."
  - Pedido `cancelado` ou `devolvido`: recusa com "Este pedido está cancelado ou já foi devolvido."
- **R2-TR-03** Nada disto vem livre do corpo:
  - `loja_id` = loja resolvida da escrita, igual a `pedidos.loja_id` (se não for, 404);
  - `contato_id` = `pedidos.contato_id`;
  - `conversa_id` = a informada, se for viva, do mesmo contato e da mesma loja; caso contrário, `pedidos.conversa_id`.
- **R2-TR-04** Itens: de 1 a 50 linhas. Cada uma é um `pedidos_itens` **do mesmo pedido**, com quantidade inteira de 1 até o **disponível para devolução**. Disponível = `pedidos_itens.quantidade` − Σ `quantidade` já pedida em solicitações vivas que não estejam `negada`. A leitura roda com o pedido travado (`SELECT … FOR UPDATE`), o que serializa duas criações ou duas conclusões do mesmo pedido.
- **R2-TR-05** `motivo_detalhe` (até 1000 caracteres) é obrigatório com `defeito` e `outro` (mínimo de 3). A tela avisa: "Não escreva dados pessoais além do necessário."
- **R2-TR-06** Fotos: de 0 a 10 `lojas_midias` vivas **da mesma loja**, com `origem = 'recebida'` e ligadas por `conversas_mensagens_midias.midia_id` a uma mensagem de **conversa deste contato**. Não há upload nesta tela: a prova é o que a cliente mandou.
- **R2-TR-07** O prazo da política da loja (7 dias) é **aviso, nunca bloqueio**.
  - Referência: `criado_em` do evento `pedido_status_alterado` com `depois->>'status' = 'entregue'` desse pedido; sem esse evento, `pedidos.created_at`.
  - Passaram 7 dias e o motivo não é `defeito`: faixa `aviso` com "Fora do prazo de 7 dias da política da loja. A decisão é da gerência."
  - Motivo: o direito de arrependimento e o prazo de vício são garantidos por lei. O sistema não deve impedir o registro de um direito; a gerência decide, e a decisão fica na trilha.
- **R2-TR-08** Máquina de estados no §3.2. Estados terminais (`concluida`, `negada`) não reabrem; um erro vira nova solicitação.
- **R2-TR-09** Aprovar e negar são só da gestão. Negar exige motivo (`motivoSchema`, 8 a 255 caracteres), grava `resolvido_por`/`resolvido_em` e passa pelo block de 3 s. Registrar envio (rastreio opcional `^[A-Za-z0-9-]{4,40}$`) e registrar recebimento são ações de operação (`devolucoes:editar`).
- **R2-TR-10** **Teto do estorno** (ADR 0033), todo em centavos (`paraCentavos`/`deCentavos`):
  ```
  recebido_provedor = Σ pagamentos.valor  WHERE pedido_id = X AND vivo AND status IN ('aprovado','estornado')
  se recebido_provedor > 0          → base = min(total, recebido_provedor)   · origem = "provedor"
  senão se masc_status = 'lancado'   → base = total                           · origem = "masc"
  senão                              → base = 0                               · origem = "nenhuma"
  ja_estornado = Σ valor_estorno das devoluções vivas e 'concluida' do mesmo pedido
  limite       = max(0, base − ja_estornado)
  ```
  `valor_estorno ≤ limite`.
  - **Por que `estornado` entra na soma**: o estorno feito no painel do provedor pode chegar (R2-PG) antes de a gerência registrar a devolução. Sem isso, o teto viraria zero.
  - **Por que "lançado no Masc" vale como recebido**: a venda de balcão é paga fora do gateway, e o Masc é o dono da venda (ADR 0004). No R2 não existe baixa manual de pagamento (R2-PG).
  - Com `limite = 0`, o campo mostra: "Este pedido não tem pagamento confirmado pelo provedor nem venda lançada no Masc, então não há valor para estornar. Se a venda foi paga no balcão, lance-a no Masc e marque o pedido como lançado antes de concluir. Uma troca pode ser concluída sem estorno."
- **R2-TR-11** Regras da conclusão:
  - `troca`: `valor_estorno` e `metodo_estorno` nulos; motivo opcional.
  - `devolucao` e `reembolso`: exigem `valor_estorno > 0`, `metodo_estorno` de `METODOS_ESTORNO` e motivo (`motivoSchema`).
  - `pagamento_id` é opcional e, se vier, tem de ser um `pagamentos` vivo **deste** pedido com `status IN ('aprovado','estornado')`.
  - A conclusão reconfere que o pedido ainda está `enviado` ou `entregue`. Se não estiver, recusa com "O pedido foi cancelado ou já está devolvido. Negue esta solicitação."
- **R2-TR-12** **O estorno é registrado, não executado** (ADR 0033). Pix, maquininha, crédito na loja ou estorno no painel do Mercado Pago são feitos fora do sistema, e a tela diz isso com todas as letras. Nenhum provedor é chamado e `pagamentos` não é alterado por este pacote.
- **R2-TR-13** **O pedido vira `devolvido`** só quando as devoluções concluídas dos tipos `devolucao`/`reembolso` (incluindo a atual) cobrem **todas** as quantidades de **todos** os itens vivos. Devolução parcial e troca **não** mudam `pedidos.status`. Ao virar `devolvido`:
  - o pedido sai da reserva e da fila do Masc sem código extra (o índice e a fórmula já excluem `devolvido`);
  - `contatos.pedidos_contagem` recebe `−1` e `contatos.pedidos_valor_total` recebe `−(paraCentavos(total)/100)`, por `atualizarContador`, no mesmo formato que o M4 usa ao cancelar.
- **R2-TR-14** `pedidos.pagamento_status` vira `estornado` só quando o atual é `pago` **e** `ja_estornado + valor_estorno = base`. Estorno parcial mantém `pago`. Se o pedido já estiver `estornado` (estorno que veio do provedor), nada muda. Com origem `masc`, `pagamento_status` não é tocado, porque o sistema nunca registrou esse pagamento. Os dois escritores de `estornado` estão descritos no ADR 0033.
- **R2-TR-15** **Ajuste no Masc** (substitui o item 4 de `01-dados-dominio.md §6.6`, ADR 0032):
  - Se `pedidos.masc_status = 'lancado'` **e** o tipo é `devolucao` ou `reembolso`, concluir exige `confirmacaoMasc` (de 3 a 255 caracteres, por exemplo "Devolução 4512 registrada no Masc"). O texto vai para o `motivo` do evento `devolucao_concluida` como `Ajuste no Masc: <texto>`.
  - **Não** se gera alerta `pagamento_pendente`: o sistema não tem onde marcar "ajustado no Masc", então o gerador nunca resolveria esse alerta.
  - Pedido `pendente` no Masc que vira `devolvido` sai da fila. A tela avisa: "O pedido sai da fila 'falta lançar no Masc'."
  - Nenhuma escrita em ERP (ADR 0004).
- **R2-TR-16** Trilha, toda na mesma transação:
  - `devolucao_criada`: cabeçalho, cada item e cada foto;
  - `devolucao_status_alterado`: aprovar, negar (com motivo), envio e recebimento;
  - `devolucao_estorno_aprovado`: gravada **antes** do efeito quando há valor;
  - `devolucao_concluida`: com a confirmação do Masc ou o motivo;
  - `pedido_status_alterado`: quando o pedido muda, com o motivo `Devolução concluída (<8 primeiros caracteres do id>)`.
- **R2-TR-17** Nenhuma mensagem sai automaticamente para a cliente (humano no meio). A tela oferece "Abrir conversa".

### 2.3 CSAT (ADR 0034 e ADR 0035)

- **R2-CS-01** Desligado por padrão: `CSAT_ATIVO=false`. Desligado, nenhuma pesquisa é criada. O painel continua mostrando o histórico, com a faixa "A pesquisa de satisfação está desligada neste ambiente. Nenhuma pesquisa nova é enviada."
- **R2-CS-02** Gatilhos (`GATILHOS_PESQUISA`), avaliados pelo job `pos-venda/disparar-pesquisas` a cada 15 min, **das 09:00 às 19:59 em America/Sao_Paulo** (cron `*/15 9-19 * * *` com `tz`, mais uma guarda no código com `Intl`, nunca `getHours()`):
  - `pedido_entregue`: evento `pedido_status_alterado` da loja, com `depois->>'status' = 'entregue'` e `criado_em` entre agora − 72 h e agora − 30 min. O pedido tem de estar vivo, ainda `entregue` e com `pedidos.conversa_id` não nulo. Sem conversa, não há pesquisa: nunca se escolhe "outra conversa".
  - `conversa_encerrada`: conversa `resolvida` com `resolvida_em` entre agora − 12 h e agora − 30 min.

  Se os dois gatilhos forem elegíveis para o mesmo contato no mesmo ciclo, vale `pedido_entregue` (ele é avaliado primeiro, e o limite de R2-CS-05 descarta o outro).
- **R2-CS-03** A pesquisa **sai pela conta de entrada da conversa** (`conversas.integracao_id`), sem alternativa. Exigências:
  - a conversa (para `pedido_entregue`, a do pedido) precisa estar **`resolvida`** e viva;
  - a integração precisa estar viva, com `status = 'conectado'` e `revogada_em` nula;
  - o provedor precisa estar em `PROVEDORES_COM_PESQUISA = ["whatsapp_oficial", "uazapi", "instagram"]` (constante em `src/lib/pesquisas/_regras.ts`). Facebook e TikTok ficam fora (ADR 0034).
- **R2-CS-04** **Só com a janela aberta**: `conversas.ultima_entrada_em ≥ agora − 23 h`. Janela fechada significa não enviar e não criar linha. Não há modelo da Meta (custo e categoria marketing).
- **R2-CS-05** No máximo **uma pesquisa por contato a cada 30 dias**, qualquer que seja o gatilho: não pode existir pesquisa viva do contato com `enviada_em ≥ agora − 30 dias`. Há também uma pesquisa `conversa_encerrada` por conversa, para sempre (`uq_pesquisas_satisfacao_conversa`), e uma por pedido (`uq_pesquisas_satisfacao_pedido`, que já existe). Trava por contato: `pg_advisory_xact_lock(hashtextextended('pesquisa:' || contato_id, 0))`.
- **R2-CS-06** Opt-out é respeitado: contato com opt-out vigente não recebe. A regra vem de uma fonte só: `optOutVigente(tx, contatoId)` de `@/lib/lgpd` (§10.3-M2), a mesma regra que a materialização de campanha usa. Contato anonimizado (`anonimizado_em` não nulo) ou excluído também não recebe.
- **R2-CS-07** Texto fixo e versionado (`PESQUISA_V1` em `src/lib/pesquisas/_regras.ts`), com a marca (`NOME_CURTO`) e o nome da loja (`lojas.nome`):
  - conversa: "Oi! Aqui é a {marca} {loja}. De 1 a 5, o quanto você ficou satisfeita com o nosso atendimento? Responda só com o número (5 = muito satisfeita). Se não quiser mais receber esta pergunta, responda SAIR."
  - pedido: "Oi! Aqui é a {marca} {loja}. Seu pedido {numero} foi entregue. De 1 a 5, como foi a sua compra? Responda só com o número (5 = muito satisfeita). Se não quiser mais receber esta pergunta, responda SAIR."

  Ordem, na mesma transação: primeiro `registrarEnvio(...)` com `conversaId`, `reabrir: false`, `autorTipo: "sistema"` e chave de idempotência determinística (`pesquisa-conversa-<conversaId>` ou `pesquisa-pedido-<pedidoId>`); depois `inserirAuditado(pesquisas_satisfacao, { …, mensagem_id, enviada_em: agora }, ctx, "pesquisa_enviada")`. Se qualquer um falhar, não existe pesquisa.
- **R2-CS-08** **Como a resposta volta.** Toda mensagem de **entrada** do contato passa por `classificarEntradaDePesquisa`, dentro da ingestão do M1 e antes de ele escolher ou reabrir a conversa. Ficam de fora eco, `deMim` e nota interna. O texto é normalizado por `normalizarResposta` (em `src/lib/pesquisas/_normalizacao.ts`, junto com `PALAVRAS_DE_SAIDA`): `trim`, NFKC, remoção de U+FE0F e U+20E3 (assim "5️⃣" vira "5"), minúsculas, remoção de acento (NFD sem `\p{M}`), remoção da pontuação `.,;:!?` nas pontas e espaços internos reduzidos a um. A ordem de avaliação é **fixa**:
  1. **sair**: `tipo_conteudo = 'texto'` e o texto normalizado é **igual** a um item de `PALAVRAS_DE_SAIDA` = `sair`, `quero sair`, `parar`, `pare`, `stop`, `descadastrar`, `parar de receber`, `nao quero receber`, `nao quero mais receber`, `nao quero receber mais`, `nao quero mais mensagens`, `nao mande mais`, `nao me mande mais`, `nao envie mais`. Casa com a pesquisa **mais recente** do contato na loja com `enviada_em ≥ ocorrida_em − 30 dias`, qualquer que seja o estado (respondida ou não) e a integração.
  2. **nota**: `tipo_conteudo = 'texto'` e o texto normalizado casa `^[1-5]$`. Casa com a pesquisa do contato na loja que tenha `respondida_em` nula e `enviada_em ≥ ocorrida_em − 24 h`, com conversa viva, **na mesma `integracao_id`** da mensagem e com status `resolvida`, `aberta` ou `pendente` (arquivada não). "5 estrelas", "cinco" e áudio não são nota e seguem o fluxo normal.
  3. **comentario**: `tipo_conteudo = 'texto'`, não é sair nem nota, existe pesquisa do contato na loja com `nota` presente, `comentario` nulo e `respondida_em ≥ ocorrida_em − 30 min`, e a conversa dela está na mesma `integracao_id`.
  4. **nenhuma**: fluxo normal do M1.
- **R2-CS-09** **Resposta não reabre a conversa** (ADR 0035, exceção escrita à regra "resolvida reabre").
  - Nota **3–5**: é gravada na conversa da pesquisa **sem mudar o status**, **sem somar `nao_lidas`** e **sem** `conversa_reaberta`.
  - SAIR com conversa de destino (R2-CS-11): mesmo tratamento.
  - Nota **1–2**: é gravada na conversa da pesquisa e **reabre** pelo fluxo normal, porque cliente insatisfeita precisa de uma pessoa.
  - Comentário: segue o fluxo normal e reabre, porque comentário é para alguém ler.
- **R2-CS-10** **Nota**: só a **primeira** resposta vale (registro atômico `registrarRespostaDePesquisa`, que grava a trilha `pesquisa_respondida`).
  - Nota 3–5 recebe "Obrigada! Sua nota foi registrada. Se quiser contar mais, é só escrever aqui." (`autorTipo: "sistema"`, `reabrir: false`, chave `pesquisa-obrigado-<pesquisaId>`), só se o registro foi deste processamento.
  - Nota 1–2 **não** recebe mensagem automática: a conversa reabriu e a vendedora responde.
- **R2-CS-11** **SAIR = opt-out de marketing** pela porta única do M2, `registrarConsentimento`, com:
  - `tipo: "opt_out"`, `concedido: true`, `origem: "mensagem"`;
  - `canal` = provedor da integração, `mensagemId` = id da mensagem de entrada;
  - `termoVersao: "pesquisa-satisfacao-v1"` e `ip: null`.

  Efeitos, na mesma transação:
  - **Opt-out já vigente**: nada é registrado e nada é enviado. A mensagem fica na conversa.
  - **Senão**: registra o consentimento. Se a pesquisa casada está pendente (`respondida_em` nula), registra `respondida_em` com `nota` nula; a trilha leva o motivo "pediu para sair". Depois envia a confirmação "Pronto: a {marca} {loja} não vai mais te enviar pesquisas nem promoções. Se mudar de ideia, é só avisar a loja." (`autorTipo: "sistema"`, `reabrir: false`, chave `pesquisa-sair-<mensagemId>`).
  - **Conversa de destino**: é a da pesquisa quando ela está viva, não arquivada e na mesma integração da mensagem. Aí a mensagem é gravada sem reabrir. Nos outros casos, `conversaId` volta nulo e vale o fluxo normal do M1.
  - O texto do SAIR **nunca** vira comentário.

  Escopo: o opt-out vale para o contato **desta loja** (contatos são por loja, DN-05). O texto diz isso.
- **R2-CS-12** **Comentário**: o texto, cortado em 1000 caracteres, vai para `comentario` pelo registro atômico `registrarComentarioDePesquisa`. Ele grava uma vez só e registra a trilha `pesquisa_respondida` com o valor mascarado (`CAMPOS_PII`).
- **R2-CS-13** Não há envio manual, reenvio nem lembrete: quem não respondeu não é perguntado de novo.
- **R2-CS-14** Envio automático de dentro da ingestão (agradecimento e confirmação) roda em SAVEPOINT (`tx.transaction(...)`). `ErroDoAplicativo` (conta desconectada, janela recusada pelo M1) é registrado em log, sem PII (`pesquisa_resposta_sem_envio`, com ids e código), e **não derruba** a ingestão. Erro de banco sobe normalmente.
- **R2-CS-15** Indicadores do painel (período pelo dia de São Paulo; "últimos N dias" começa às 00:00 de hoje − (N−1)):
  - **Enviadas**: pesquisas vivas com `enviada_em` no período.
  - **Não entregues**: dessas, as de mensagem com `status_entrega = 'falhou'`.
  - **Respondidas**: `nota` não nula.
  - **Taxa de resposta**: respondidas ÷ enviadas.
  - **Média**: média de `nota` das respondidas, com uma casa decimal.
  - **CSAT**: notas 4 e 5 ÷ respondidas, em %.
  - **Saíram**: linhas de `consentimentos` da loja com `tipo = 'opt_out'`, `concedido`, `origem = 'mensagem'`, `termo_versao = 'pesquisa-satisfacao-v1'` e `criado_em` no período.

  Cada indicador tem a definição no `?`. Divisão por zero aparece como "—".
- **R2-CS-16** `comentario` é PII (já está em `CAMPOS_PII` e na anonimização). O painel é só para gestão.

---

## 3. Modelo de dados usado

Nenhuma tabela ou coluna nova. Todas as tabelas existem (migrações 0012, 0014, 0015 e 0016). As colunas abaixo foram conferidas no schema commitado. Mudanças de schema: só índices e enums (§10.1-D1/D2).

### 3.1 `negocios`

Colunas:
- `id`;
- `loja_id` e `contato_id`, com FK composta `fkc_negocios_contato` → `contatos(id, loja_id)`;
- `conversa_id` (FK simples, conferida na aplicação);
- `responsavel_id` (FK simples, conferida na aplicação);
- `estagio` (`CHECK negocios_estagio_lista`, padrão `lead`);
- `valor numeric(12,2)` (`CHECK negocios_valor_positivo`, padrão `'0'`);
- `motivo_perda` (`CHECK negocios_motivo_perda_lista`) e `observacao_perda`;
- `previsao_fechamento date` (modo string);
- `ultima_atividade_em` (contador em `CONTADORES.negocios`);
- `...colunasAuditoria`.

Restrições e índices:
- `CHECK negocios_perda_com_motivo`;
- índices existentes: `ix_negocios_funil (loja_id, estagio, ultima_atividade_em DESC)`, `ix_negocios_contato`, `ix_negocios_responsavel`, `ix_negocios_loja`;
- **novo**: `uq_negocios_aberto_por_contato`.

Lido de outros domínios:
- `pedidos (id, numero, status, negocio_id, loja_id)`;
- `contatos (id, nome, telefone, loja_id, anonimizado_em, is_deleted)`;
- `conversas (id, contato_id, loja_id, integracao_id, created_at, is_deleted)`;
- `lojas_integracoes (id, rotulo, provedor)`;
- `usuarios (id, nome, papel, loja_id, ativo)`;
- `lojas (id, nome)`;
- `auditoria_eventos`.

Transições (ação da trilha):

| De \ Para | lead…fechando | ganho | perdido | (excluído) |
|---|---|---|---|---|
| (novo) | `criarNegocio` → `negocio_criado` | — | — | — |
| aberto | `moverNegocio` → `negocio_estagio_alterado` | **só o M4** (pedido) | `marcarNegocioPerdido` → `negocio_estagio_alterado` | `excluirNegocio` → `negocio_excluido` |
| perdido | `reabrirNegocio` → `negocio_estagio_alterado` | — | — | `excluirNegocio` → `negocio_excluido` |
| ganho | — | — | — | — |

Edição de campos (só em estágio aberto): `editarNegocio` grava `negocio_valor_alterado` se `valor` mudou; senão, `negocio_alterado`. É uma linha só, com o diff completo.

### 3.2 `pedidos_devolucoes`, `pedidos_devolucoes_itens`, `pedidos_devolucoes_midias`

**`pedidos_devolucoes`** (**com trava de colisão**):
- colunas: `id`, `loja_id`, `pedido_id`, `contato_id` (FK simples), `conversa_id` (FK simples), `tipo`, `motivo`, `motivo_detalhe`, `status` (padrão `solicitada`), `rastreio_codigo`, `valor_estorno numeric(12,2)`, `metodo_estorno`, `pagamento_id`, `resolvido_por`, `resolvido_em`, `...colunasAuditoria`;
- FK composta `fkc_pedidos_devolucoes_pedido` → `pedidos(id, loja_id)`;
- restrições: os `CHECK`s de lista, `pedidos_devolucoes_estorno_positivo` e `pedidos_devolucoes_resolucao`;
- índices: `ix_pedidos_devolucoes_pedido`, `ix_pedidos_devolucoes_status (loja_id, status)` e `ix_pedidos_devolucoes_loja`.

**`pedidos_devolucoes_itens`**:
- colunas: `loja_id`, `devolucao_id`, `pedido_item_id` (FK simples; a aplicação confere que é do mesmo pedido), `quantidade > 0`;
- FK composta → `pedidos_devolucoes(id, loja_id)`;
- único parcial `uq_pedidos_devolucoes_itens`.

**`pedidos_devolucoes_midias`**:
- colunas: `loja_id`, `devolucao_id`, `midia_id` (FK simples; a aplicação confere loja, origem e contato);
- único parcial `uq_pedidos_devolucoes_midias`.

Máquina de estados:

| De | Para | Ação | Permissão | Tipos |
|---|---|---|---|---|
| — | `solicitada` | `criarDevolucao` | `devolucoes:criar` | todos |
| `solicitada` | `aprovada` | `aprovarDevolucao` | `devolucoes:aprovar` | todos |
| `aprovada` | `em_transito` | `registrarEnvioDevolucao` | `devolucoes:editar` | troca, devolucao |
| `aprovada`, `em_transito` | `recebida` | `registrarRecebimentoDevolucao` | `devolucoes:editar` | troca, devolucao |
| `recebida` | `concluida` | `concluirDevolucao` | `devolucoes:concluir_estorno` | troca, devolucao |
| `aprovada` | `concluida` | `concluirDevolucao` | `devolucoes:concluir_estorno` | reembolso |
| `solicitada`, `aprovada`, `em_transito`, `recebida` | `negada` | `negarDevolucao` | `devolucoes:negar` | todos |

Qualquer outro par gera `ErroDeValidacao({ _: ["Esta solicitação não pode ir de <rótulo X> para <rótulo Y>."] })`. A tabela existe **uma vez**, como dado puro, em `src/lib/devolucoes/_regras.ts` (`TRANSICOES_DEVOLUCAO`). A mesma tabela decide os botões: `acoesPermitidas(status, tipo, podeFn)` roda no servidor e vai no DTO.

Lido de outros domínios:
- `pedidos (id, loja_id, contato_id, conversa_id, numero, status, pagamento_status, total, masc_status, masc_lancado_em, masc_lancado_por, created_at, updated_at, is_deleted)`, com `FOR UPDATE`;
- `pedidos_itens (id, pedido_id, nome, tamanho, quantidade, preco_unitario, is_deleted)`;
- `pagamentos (id, pedido_id, valor, status, metodo, provedor, is_deleted)`;
- `lojas_midias`, `conversas_mensagens_midias`, `conversas_mensagens` e `conversas` (fotos da cliente);
- `auditoria_eventos` (data de entrega e linha do tempo).

Escrito em outros domínios (na mesma transação, sempre pelas funções de mutação):
- `pedidos.status` e `pedidos.pagamento_status`, por `atualizarComTrava(tx, pedidos, { …, updatedAtOriginal: <lido sob FOR UPDATE> }, ctx, "pedido_status_alterado", motivo)`;
- `contatos.pedidos_contagem` e `contatos.pedidos_valor_total`, por `atualizarContador`.

### 3.3 `pesquisas_satisfacao`

Colunas: `id`, `loja_id`, `contato_id`, `conversa_id`, `pedido_id` (FKs simples), `nota` (`CHECK pesquisas_satisfacao_nota`, 1 a 5, nula permitida), `comentario`, `gatilho` (`CHECK GATILHOS_PESQUISA`), `mensagem_id` (FK para `conversas_mensagens`), `enviada_em`, `respondida_em`, `...colunasAuditoria` (inclui `modified_by`).

Índices existentes: `uq_pesquisas_satisfacao_pedido (pedido_id, gatilho)`, `ix_pesquisas_satisfacao_contato` e `ix_pesquisas_satisfacao_loja`. **Novos**: `uq_pesquisas_satisfacao_conversa` e `ix_pesquisas_satisfacao_periodo`.

Estados (derivados, sem coluna de status):

```
(não existe) ──job──► pendente           [mensagem_id, enviada_em; respondida_em nula]
pendente ──nota 1..5 em ≤ 24 h──────────► respondida         [nota, respondida_em]
pendente ──SAIR em ≤ 30 dias────────────► saiu               [nota nula, respondida_em]
pendente ──24 h sem nota nem SAIR───────► sem resposta       (leitura: enviada_em < agora − 24 h)
respondida ──texto em ≤ 30 min──────────► respondida com comentário [comentario]
qualquer ──SAIR em ≤ 30 dias────────────► (consentimento opt_out; a pesquisa não muda se já respondida)
```

Escritas:
- criação por `inserirAuditado`, já com `mensagem_id` (`pesquisa_enviada`);
- resposta e comentário pelos registros atômicos de `mutacoes/pos-venda.ts` (`pesquisa_respondida`).

Não há trava de colisão, porque ninguém edita pela tela. Não há entrada em `ESTADOS_DE_SISTEMA`.

`consentimentos` (append-only) é **lido** para o indicador "Saíram" e escrito **só** pelo M2.

---

## 4. Permissões

Arquivo novo `src/lib/auth/permissoes/pos-venda.ts` (§10.1-D4), incluído em `MATRIZ_ENTREGUE`. As chaves saem de `FASE_R2`.

| Chave | dono | admin | gerente | vendedor | viewer | Uso |
|---|:--:|:--:|:--:|:--:|:--:|---|
| `negocios:ler` | ✅ | ✅ | ✅ | ✅ | ✅ | `/funil`, `/funil/[id]`, leituras |
| `negocios:criar` | ✅ | ✅ | ✅ | ✅ | | `criarNegocio`, `buscarClientesParaNegocio` |
| `negocios:editar` | ✅ | ✅ | ✅ | ✅ | | editar, mover, perder, reabrir |
| `negocios:excluir` | ✅ | ✅ | ✅ | | | `excluirNegocio` |
| `devolucoes:ler` | ✅ | ✅ | ✅ | ✅ | | `/trocas`, `/trocas/[id]` |
| `devolucoes:criar` | ✅ | ✅ | ✅ | ✅ | | `/trocas/nova`, `criarDevolucao`, `buscarPedidoParaDevolucao` |
| `devolucoes:editar` | ✅ | ✅ | ✅ | ✅ | | registrar envio e recebimento (**nova**) |
| `devolucoes:aprovar` | ✅ | ✅ | ✅ | | | `aprovarDevolucao` |
| `devolucoes:negar` | ✅ | ✅ | ✅ | | | `negarDevolucao` |
| `devolucoes:concluir_estorno` | ✅ | ✅ | ✅ | | | `concluirDevolucao` (sessão fresca) |
| `pesquisas:ler` | ✅ | ✅ | ✅ | | | `/satisfacao` (**nova**) |

Não existem, de propósito:
- `negocios:ganhar`: ganho só pelo pedido;
- `devolucoes:excluir`: negar cobre o caso;
- `pesquisas:enviar` e `pesquisas:editar`: não há envio manual.

Invariantes que continuam valendo:
- viewer não escreve;
- vendedor não exclui nem cancela;
- `dono ⊇ admin`;
- INV-27 nos dois sentidos: toda chave acima tem uso listado.

---

## 5. Server Actions, jobs e costuras

Regras comuns:
- Todas as actions são `export async function` em arquivo `"use server"` e usam `executarAcao` (ordem de `03 §4.3`).
- **Leitura usa `loja: "le"`; toda escrita usa `loja: "grava"`.**
- Toda entrada de escrita tem `loja: uuidSchema.optional()`. A tela **sempre** envia o `loja_id` do próprio registro. Para vendedor e viewer, o campo é ignorado por `resolverLojaPedida`.
- Gestão com "Todas as lojas" e sem `loja` recebe `FALTA_LOJA` e não grava nada, nem trilha (INV-05). `loja` diferente da loja do registro dá 404.
- Mapeamento de campos **explícito**, nunca `...dados` sobre a linha.
- `updatedAt` é `z.coerce.date()`. Se o registro relido na transação tiver `updated_at` diferente, o resultado é `ErroDeColisao`, antes de validar o estado.
- Recusa de regra é `ErroDeValidacao`, com a chave do campo ou `_`.
- `23505` é traduzido por `sanitizarErroBanco(erro).constraint`, com mensagem fixa (sem `detail`).

Validadores compartilhados:
- `dinheiroSchema = z.string().trim().regex(REGEX_DINHEIRO, "Use o formato 1234,56.")`, em `src/lib/validadores/negocios.ts` e reexportado por `devolucoes.ts` (a tela converte a vírgula no blur);
- `uuidSchema` e `motivoSchema` vêm de `validadores/comum.ts`.

### 5.1 `src/lib/actions/negocios.ts` (A1)

| Action | Entrada Zod (`src/lib/validadores/negocios.ts`) | Efeito | Trilha | Permissão | Loja |
|---|---|---|---|---|---|
| `listarFunil` | `{ responsavel?: "meus"\|"todos"\|uuid, estagio?: enum ESTAGIOS_NEGOCIO, cursor?: { em: z.coerce.date(), id: uuid } }` | Sem `estagio`: 6 colunas com 30 cartões cada, e contagem e soma de `valor` por coluna aberta. Com `estagio` e `cursor`: próxima página daquela coluna. Colunas abertas ordenadas por `(ultima_atividade_em DESC, id)`. `ganho`/`perdido` só com `updated_at ≥ agora − 30 d`, ordenadas por `(updated_at DESC, id)`. DTO: `id, loja {id, nome}, estagio, valor, previsao_fechamento, ultima_atividade_em, updated_at, contato {id, nome}, responsavel {id, nome} \| null, pedido {id, numero, status} \| null, dias_parado` | — | `negocios:ler` | le |
| `obterNegocio` | `{ id: uuid }` | Negócio, contato, conversa (id e rótulo da conta), pedidos com esse `negocio_id` e os 50 últimos eventos da trilha. Fora do escopo: 404 | — | `negocios:ler` | le |
| `buscarClientesParaNegocio` | `{ termo: string 2–60 }` | Até 10 contatos vivos e não anonimizados do escopo: `nome ILIKE termo%` ou dígitos do telefone `LIKE %dígitos%` (só se houver ao menos 4 dígitos). DTO: `id, nome, telefone, loja {id, nome}, negocio_aberto_id \| null` | — | `negocios:criar` | le |
| `negocioAbertoDoContato` | `{ contatoId: uuid }` | 0 ou 1 negócio aberto do contato no escopo: `id, loja_id, estagio, valor, updated_at` (consumida pelo painel de venda, §10.3-M4) | — | `negocios:ler` | le |
| `criarNegocio` | `{ loja?, contatoId, valor: dinheiroSchema.default("0"), estagio: enum ABERTOS.default("lead"), responsavelId?: uuid, previsaoFechamento?: z.iso.date() }` + `superRefine` da janela de datas | Aplica R2-FN-07/08/09. `conversa_id` vem do servidor. Responsável padrão: a própria sessão, se o papel for de operação da loja; senão, nulo. `inserirAuditado` e `atualizarContador(ultima_atividade_em)`. `23505 uq_negocios_aberto_por_contato` → `ErroDeValidacao({ contatoId: ["Esta cliente já tem um negócio aberto."] })` | `negocio_criado` | `negocios:criar` | **grava** |
| `editarNegocio` | `{ loja?, id, updatedAt, valor?, responsavelId?: uuid\|null, previsaoFechamento?: date\|null }` | Só em estágio aberto. Aplica R2-FN-08/09 | `negocio_valor_alterado` ou `negocio_alterado` | `negocios:editar` | **grava** |
| `moverNegocio` | `{ loja?, id, updatedAt, para: enum ABERTOS }` | De aberto para aberto (R2-FN-02/03). Devolve `{ updated_at, de }` para o "Desfazer" | `negocio_estagio_alterado` | `negocios:editar` | **grava** |
| `marcarNegocioPerdido` | `{ loja?, id, updatedAt, motivoPerda: enum MOTIVOS_PERDA, observacaoPerda?: string ≤ 500 }` + `superRefine` (obrigatória com `outro`) | Aplica R2-FN-05 | `negocio_estagio_alterado` | `negocios:editar` | **grava** |
| `reabrirNegocio` | `{ loja?, id, updatedAt, para: enum ABERTOS }` | Aplica R2-FN-06/07, com a mesma tradução do `23505` | `negocio_estagio_alterado` | `negocios:editar` | **grava** |
| `excluirNegocio` | `{ loja?, id, updatedAt }` | Aplica R2-FN-12. `excluirLogico` | `negocio_excluido` | `negocios:excluir` | **grava** |

Toda escrita de estágio ou de campo também chama `atualizarContador(tx, negocios, { id, escopo }, { ultima_atividade_em: agora })`. `excluirNegocio` não chama.

### 5.2 `src/lib/actions/devolucoes.ts` (A2)

| Action | Entrada Zod (`src/lib/validadores/devolucoes.ts`) | Efeito | Trilha | Permissão | Loja |
|---|---|---|---|---|---|
| `listarDevolucoes` | `{ filtro?: "acao"\|"todas"\|enum STATUS_DEVOLUCAO, tipo?: enum, periodo?: 30\|90\|365, cursor?: { em, id } }` | 50 por página, por `(created_at DESC, id)`. `acao` (padrão) = `solicitada`, `recebida` e `aprovada` do tipo reembolso. DTO: `id, loja {id, nome}, status, tipo, motivo, valor_estorno, created_at, updated_at, pedido {id, numero}, contato {id, nome}` | — | `devolucoes:ler` | le |
| `obterDevolucao` | `{ id }` | Devolução; itens (`nome, tamanho, quantidade`); ids das fotos; pedido (`numero, status, masc_status, masc_lancado_em, masc_lancado_por_nome, total, pagamento_status`); `base_estorno`, `origem_base` (`provedor\|masc\|nenhuma`), `ja_estornado`, `limite_estorno`, `valor_sugerido` (proporcional às peças, em centavos, nunca acima do limite), `cobre_tudo_se_concluir`, `exige_confirmacao_masc`; pagamentos elegíveis (`id, metodo, valor, status`); aviso de prazo; `acoesPermitidas`; 50 eventos | — | `devolucoes:ler` | le |
| `buscarPedidoParaDevolucao` | `{ numero: string 4–30 }` ou `{ pedidoId: uuid }` (união Zod) | Pedido vivo no escopo (número exato em maiúsculas, único na rede porque a sigla da loja é única). Traz os itens com `disponivel_para_devolucao`, até 30 fotos recebidas do contato nos últimos 60 dias (`id, tipo_arquivo, created_at`), `bloqueio` (texto de R2-TR-02 ou nulo), `aviso_prazo` e `loja {id, nome}` | — | `devolucoes:criar` | le |
| `criarDevolucao` | `{ loja?, pedidoId, tipo, motivo, motivoDetalhe?: ≤1000, itens: [{ pedidoItemId, quantidade: int ≥ 1 }] 1..50 (sem id repetido), midiaIds: uuid[] 0..10 (sem repetido), conversaId?: uuid }` + `superRefine` de R2-TR-05 | `pedidos … FOR UPDATE`, depois R2-TR-02..06. `inserirAuditado` do cabeçalho, de cada item e de cada foto | `devolucao_criada` (1 + N + M linhas) | `devolucoes:criar` | **grava** |
| `aprovarDevolucao` | `{ loja?, id, updatedAt }` | `solicitada → aprovada` | `devolucao_status_alterado` | `devolucoes:aprovar` | **grava** |
| `negarDevolucao` | `{ loja?, id, updatedAt, motivo: motivoSchema }` | Estado não terminal → `negada`, com `resolvido_por = ctx.autorId` e `resolvido_em = agora` | `devolucao_status_alterado` (motivo no 6º parâmetro) | `devolucoes:negar` | **grava** |
| `registrarEnvioDevolucao` | `{ loja?, id, updatedAt, rastreioCodigo?: regex }` | `aprovada → em_transito` (troca e devolução) | `devolucao_status_alterado` | `devolucoes:editar` | **grava** |
| `registrarRecebimentoDevolucao` | `{ loja?, id, updatedAt }` | `aprovada` ou `em_transito` → `recebida` (troca e devolução) | `devolucao_status_alterado` | `devolucoes:editar` | **grava** |
| `concluirDevolucao` | `{ loja?, id, updatedAt, valorEstorno?: dinheiroSchema, metodoEstorno?: enum METODOS_ESTORNO, pagamentoId?: uuid, motivo?: motivoSchema, confirmacaoMasc?: string trim 3–255 }` | Ordem fixa abaixo, em `src/lib/devolucoes/_conclusao.ts` | `devolucao_estorno_aprovado` (antes do efeito, se houver valor), `devolucao_concluida` e `pedido_status_alterado` (se o pedido mudar) | `devolucoes:concluir_estorno`, **`fresca: true`** | **grava** |

Ordem de `concluirDevolucao`, numa transação:
1. Relê a devolução viva no escopo. Se `updated_at ≠ updatedAt`, `ErroDeColisao`.
2. `SELECT … FROM pedidos WHERE id = devolucao.pedido_id AND <escopo> AND vivo FOR UPDATE`.
3. Valida a transição (§3.2), R2-TR-11 (inclusive o status do pedido) e R2-TR-15. Calcula `base`, `ja_estornado` e `limite` (R2-TR-10) e a cobertura total (R2-TR-13), em centavos.
4. Se `valor_estorno > 0`: `registrarAuditoria(tx, ctx, "devolucao_estorno_aprovado", "pedidos_devolucoes", id, { antes: null, depois: { valor_estorno, metodo_estorno, pagamento_id } }, motivo)`, **antes** do efeito.
5. `atualizarComTrava(tx, pedidos_devolucoes, { id, escopo, updatedAtOriginal: updatedAt, dados: { status: "concluida", valor_estorno, metodo_estorno, pagamento_id, resolvido_por: ctx.autorId, resolvido_em: agora } }, ctx, "devolucao_concluida", exigeConfirmacaoMasc ? \`Ajuste no Masc: ${confirmacaoMasc}\` : motivo)`.
6. Se o pedido muda (R2-TR-13/14): `atualizarComTrava(tx, pedidos, { id, escopo, updatedAtOriginal: <updated_at do passo 2>, dados: { status?, pagamento_status? } }, ctx, "pedido_status_alterado", \`Devolução concluída (${id.slice(0, 8)})\`)`. Se o pedido virou `devolvido`: `atualizarContador(tx, contatos, { id: pedido.contato_id, escopo }, { pedidos_contagem: -1, pedidos_valor_total: -(paraCentavos(pedido.total) / 100) })`.

### 5.3 `src/lib/actions/pesquisas.ts` (A3)

| Action | Entrada | Efeito | Permissão | Loja |
|---|---|---|---|---|
| `indicadoresSatisfacao` | `{ periodo: 7\|30\|90 }` (padrão 30) | Os 7 indicadores de R2-CS-15, a distribuição de 1 a 5 e `csatAtivo` (lido de `env`) | `pesquisas:ler` | le |
| `listarRespostas` | `{ periodo, nota?: "baixas"\|"neutras"\|"altas", gatilho?: enum GATILHOS_PESQUISA, situacao?: "respondidas"\|"aguardando"\|"sem_resposta"\|"sairam", cursor?: { em, id } }` | 50 por página, por `(enviada_em DESC, id)`. Faixas de nota: baixas = 1–2, neutras = 3, altas = 4–5. Situações: `aguardando` = sem resposta e enviada há menos de 24 h; `sem_resposta` = sem resposta e enviada há 24 h ou mais; `sairam` = `respondida_em` com `nota` nula. DTO: `id, loja {id, nome}, gatilho, nota, comentario, enviada_em, respondida_em, contato {id, nome}, conversa_id, pedido {id, numero} \| null, responsavel_conversa {nome} \| null, entrega_falhou` | `pesquisas:ler` | le |

Não há action de escrita de pesquisa.

### 5.4 Job `pos-venda/disparar-pesquisas` (A3)

- **Agendador** `disparar-pesquisas-15min`: `*/15 9-19 * * *`, fuso `America/Sao_Paulo`. A fila `pos-venda` tem concorrência 1.
- **Processador** `src/server/processadores/pos-venda.ts` → `dispararPesquisas(job)` chama `dispararPesquisasDoCiclo(agora)` de `src/lib/pesquisas/disparo.ts`.
- **Corpo**:
  1. Sai cedo se `!env.CSAT_ATIVO` ou se `agora` estiver fora de 09:00–19:59 em São Paulo.
  2. Para cada loja viva, busca os candidatos `pedido_entregue` e depois `conversa_encerrada` (R2-CS-02..04), com **no máximo 50 por loja por ciclo**, os mais antigos primeiro.
     - `pedido_entregue`: `auditoria_eventos` (índice `ix_auditoria_eventos_acao`) com `acao = 'pedido_status_alterado'`, `entidade = 'pedidos'`, `loja_id = L`, `depois->>'status' = 'entregue'` e janela de 30 min a 72 h. Junta com `pedidos` por `id = entidade_id::uuid`, usa `DISTINCT` por pedido e exclui pedido que já tenha pesquisa.
     - `conversa_encerrada`: `conversas` com `loja_id = L`, viva, `resolvida`, `resolvida_em` entre 30 min e 12 h atrás, `ultima_entrada_em ≥ agora − 23 h`, e sem pesquisa `conversa_encerrada`.
  3. **Cada candidato roda em transação própria**, `emTransacao(contextoDeSistema(lojaId, "worker"), …)`:
     1. trava por contato;
     2. reconfere toda a elegibilidade (R2-CS-03..06, inclusive `PROVEDORES_COM_PESQUISA` e `optOutVigente`);
     3. `registrarEnvio(tx, { lojaId, contatoId, integracaoId: conversa.integracao_id, conteudo, chaveIdempotencia, conversaId, reabrir: false, autorTipo: "sistema" }, ctx)`;
     4. `inserirAuditado(pesquisas_satisfacao, { loja_id, contato_id, conversa_id, pedido_id, gatilho, mensagem_id, enviada_em: agora }, ctx, "pesquisa_enviada")`.
- **Idempotência**:
  - `jobId` do agendador;
  - chaves determinísticas `pesquisa-conversa-<id>` e `pesquisa-pedido-<id>` no único `(conversa_id, chave_idempotencia)`;
  - `uq_pesquisas_satisfacao_conversa` e `uq_pesquisas_satisfacao_pedido`;
  - trava por contato e limite de 30 dias.
- **Retentativa**:
  - `ErroDoAplicativo` num candidato (M1 recusou o envio, contato mudou) vai para o log `pesquisa_nao_enviada`, com `lojaId`, ids e `codigo`, sem PII. **Não derruba o lote.** Como nenhuma linha foi criada, o próximo ciclo tenta de novo enquanto a janela valer.
  - `23505` num candidato (corrida) é tratado como já feito e o lote segue.
  - Falha de infraestrutura (banco, Redis) é lançada, usa `attempts` padrão (5, exponencial) e termina na DLQ.
- **Envio**: o job de saída do M1 (`mensagens-saida/enviar-mensagem`) é enfileirado **depois do commit** (contrato do M1). Se a transação cair depois do `registrarEnvio`, nenhum envio acontece (teste obrigatório, §9).

### 5.5 Costura de entrada: `src/lib/pesquisas/entrada.ts` (criada no delta, corpo do A3)

```ts
export type EntradaParaPesquisa = {
  lojaId: string; contatoId: string; integracaoId: string;
  tipoConteudo: string; texto: string | null; ocorridaEm: Date;
};

export type ClassificacaoDePesquisa =
  | { tipo: "nenhuma" }
  | { tipo: "nota"; pesquisaId: string; conversaId: string; nota: 1 | 2 | 3 | 4 | 5; reabrir: boolean }
  | { tipo: "sair"; pesquisaId: string; conversaId: string | null; pendente: boolean }
  | { tipo: "comentario"; pesquisaId: string };

export type MensagemGravada = {
  mensagemId: string; conversaId: string; integracaoId: string;
  provedor: string; texto: string | null; ocorridaEm: Date;
};

/** Leitura pura (R2-CS-08). Nunca lança por regra de pesquisa. */
export async function classificarEntradaDePesquisa(tx: Transacao, entrada: EntradaParaPesquisa): Promise<ClassificacaoDePesquisa>;

/** Efeitos (R2-CS-10..12, R2-CS-14). Chamado DEPOIS de gravar a mensagem, na mesma transação. */
export async function aplicarEntradaDePesquisa(
  tx: Transacao,
  classificacao: Exclude<ClassificacaoDePesquisa, { tipo: "nenhuma" }>,
  mensagem: MensagemGravada,
  ctx: Contexto,
): Promise<void>;
```

O que cada classificação faz:
- **`nota`**: `registrarRespostaDePesquisa(tx, pesquisaId, { nota, respondidaEm: ocorridaEm }, ctx)`. Se o registro foi deste processamento e `nota ≥ 3`, envia o agradecimento em SAVEPOINT.
- **`sair`**: se `optOutVigente` for verdadeiro, não faz nada. Senão, `registrarConsentimento(...)`; se `pendente`, `registrarRespostaDePesquisa(tx, pesquisaId, { nota: null, respondidaEm: ocorridaEm }, ctx)`; por fim, a confirmação em SAVEPOINT, na `mensagem.conversaId`.
- **`comentario`**: `registrarComentarioDePesquisa(tx, pesquisaId, texto.slice(0, 1000), ctx)`.

`ctx` é o contexto de sistema da ingestão (escopo `uma`).

### 5.6 Fonte de alerta para o M8: `src/lib/negocios/alertas.ts` (A1, primeiro commit)

Exportada por `@/lib/negocios`, só leitura, sem importar nada de `@/lib/alertas`:

```ts
export type CandidatoNegocioParado = {
  tipo: "negocio_parado"; severidade: "alta"; mensagem: string; chaveDeduplicacao: string;
  negocioId: string; contatoId: string; conversaId: null; pedidoId: null;
};
/** R2-FN-11: vivos, estágio negociando|fechando, ultima_atividade_em < agora − 3 dias, na loja. Usa ix_negocios_funil. */
export async function candidatosDeAlertaDeNegocio(tx: Transacao, lojaId: string, agora: Date): Promise<CandidatoNegocioParado[]>;
```

`conversaId` vai nulo de propósito: o alerta abre o negócio (`/funil/<id>`), não a conversa.

---

## 6. Integrações externas

**Nenhuma.** Este cluster não abre conexão com terceiro.
- O CSAT sai e entra pelo canal já conectado, pelas costuras do M1 (`registrarEnvio` e ingestão).
- Nenhum host novo em `buscarExterno`, nenhuma rota pública nova e nenhum Route Handler.
- O estorno é **registrado**, não executado (ADR 0033). Não há interface de provedor, provedor simulado nem credencial. O estorno pelo Mercado Pago é feito no painel do provedor e chega ao pedido pelo R2-PG. Esta tela só registra e aponta o `pagamento_id`.
- Masc e Bling: nenhuma escrita (ADR 0004). Há trava de fonte (§9).
- Única variável de ambiente nova: `CSAT_ATIVO` (interruptor, não credencial).

---

## 7. Telas

Os padrões de `04-ui.md` valem por inteiro:
- 4 estados, mais sem permissão, reautenticação, desatualizado e desconectado;
- formulário único com `useActionState`;
- cursor e filtros na URL;
- tabela vira cartões abaixo de 768 px;
- `COLISAO` com faixa e sem sobrescrever;
- `FALTA_LOJA` com o seletor de loja.

Todo segmento tem `loading.tsx` e `error.tsx`. `page.tsx` é Server Component: chama `exigirSessao`, confere a permissão da rota com `pode()` e usa as actions de leitura. A interação fica em `_components/*` (client). **Todo formulário de escrita leva o campo oculto `loja` com o `loja_id` do registro.** `window.confirm` é proibido.

### 7.1 `/funil` (permissão `negocios:ler`)

- **Server**: `responsavel` vem da URL. O padrão é `meus` para vendedor e `todos` para gestão. Depois, `listarFunil`.
- **Client** (`quadro-funil`, `coluna-funil`, `cartao-negocio`, `menu-mover`, `dialogo-perda`, `dialogo-novo-negocio`, `filtros-funil`):
  - 6 colunas, com cabeçalho no formato "Negociando · 7 · R$ 2.340,00".
  - No topo, "Em aberto: R$ 5.120,00 em 18 negócios", com `?`: "Soma do valor estimado dos negócios em Lead, Interessada, Negociando e Fechando. Não é receita."
  - O cartão é um link para `/funil/[id]` e mostra cliente, valor (`tabular-nums`), responsável, previsão, a loja (quando o escopo é "Todas") e o chip `aviso` "Parado há 4 dias" (3 dias ou mais em Negociando ou Fechando). Em Ganho, mostra o selo do pedido e, quando for o caso, "Venda cancelada".
- **Mover**:
  - O menu "Mover para…" existe em todo cartão (teclado e celular). Arrastar é atalho no desktop (HTML nativo, sem biblioteca nova).
  - Soltar em **Ganho** não move e mostra "O negócio vira ganho quando a venda é fechada na conversa.", com link para a conversa.
  - Soltar em **Perdido** abre `dialogo-perda`.
  - Mover entre abertos é **reversível**: executa na hora e mostra o toast "Movido para Fechando. [Desfazer]" por 5 s. O Desfazer chama `moverNegocio` com `para = de` e o `updated_at` novo.
  - O movimento não é otimista: a tela espera o servidor e, se houver recusa, o cartão volta e o erro aparece.
- **Novo negócio** (`negocios:criar`): `dialog` com:
  - busca de cliente (`command`, "Buscar nome ou telefone"). Resultado que já tem negócio aberto aparece desabilitado, com "Já tem negócio aberto" e link para ele;
  - valor (`inputMode="decimal"`);
  - estágio inicial (radio com os 4 abertos);
  - responsável (`command`, pré-preenchido com "Eu");
  - previsão (`<input type="date">`).

  O `loja` enviado é o do cliente escolhido. CTA: "Criar negócio".
- **Ações críticas**: nenhuma nesta tela (excluir fica no detalhe).
- **Celular**: um estágio por vez (segmentado com contagem) e lista de cartões.
- **Estados**:
  - carregando: skeleton de 6 colunas;
  - vazio geral: "Nenhum negócio aberto." com [Novo negócio];
  - coluna vazia: "Nada aqui.";
  - vazio por filtro: [Limpar filtros];
  - colunas terminais: rodapé "Mostrando os últimos 30 dias";
  - erro: "Tentar de novo";
  - viewer: vê o quadro sem menus.

### 7.2 `/funil/[id]` (permissão `negocios:ler`)

- **Server**: `obterNegocio`. Negócio de outra loja → `notFound()`.
- **Client** (`formulario-negocio` em `sheet`, `acoes-negocio`, `linha-do-tempo-negocio`): dados, cliente (link `/contatos/[id]`), conversa (link `/conversas/[id]` com a conta), pedidos vinculados (link `/pedidos/[id]`) e linha do tempo rotulada pelo que o evento é ("Ana moveu de Negociando para Fechando · 14:32"). O motivo de perda aparece em texto; `observacao_perda` aparece como "(alterado)", porque é PII.
- **Ações**: Editar (em aberto), Mover, Marcar como perdido, Reabrir (em perdido: "Reabrir em…") e **Excluir** (só gestão; não aparece em Ganho).
- **Ação crítica**: **Excluir negócio** usa `ConfirmarExclusao` (item `excluir-registro`), com `entidade` = "o negócio de Maria S. (R$ 350,00 · Negociando)" e `descricao` = "Ele sai do funil; a trilha continua."
- **Microcopia**:
  - perda: "Por que o negócio foi perdido?";
  - observação: "Observação (opcional). Não escreva dados pessoais da cliente.";
  - reabrir recusado: "Esta cliente já tem outro negócio aberto. Feche ou perca aquele antes."

### 7.3 `/trocas` (permissão `devolucoes:ler`)

- **Server**: `listarDevolucoes` com os filtros da URL (padrão `acao`).
- **Client** (`filtros-trocas`, `tabela-trocas`):
  - chips "Precisa de ação (3)", "Todas" e um por status; filtros de tipo e de período;
  - colunas: pedido (link), cliente, loja (no escopo "Todas"), tipo (`selo-status` do domínio `tipo_devolucao`), motivo, status (domínio `status_devolucao`), estorno (moeda ou "—"), aberta em;
  - botão "Nova solicitação" (com `devolucoes:criar`).
- **Estados**:
  - vazio em `acao`: "Nenhuma troca ou devolução esperando ação.";
  - vazio geral: "Nenhuma solicitação ainda." com [Nova solicitação];
  - vendedor vê tudo, sem os botões de gestão.

### 7.4 `/trocas/nova` (permissão `devolucoes:criar`)

- **Server**: se houver `?pedido=<id>`, chama `buscarPedidoParaDevolucao({ pedidoId })`.
- **Client** (`formulario-solicitacao`, `busca-pedido`, `seletor-itens`, `seletor-fotos`): coluna única `max-w-3xl`, em blocos:
  1. **Pedido**: campo "Número do pedido" (placeholder `MS2609-CEN-0042`) que abre um cartão com cliente, loja, data, status, total e selo do Masc. Se houver `bloqueio`, ele aparece em faixa `perigo` e o resto fica desabilitado. `aviso_prazo` aparece em faixa `aviso`.
  2. **O que aconteceu**:
     - tipo (radio): "Troca — a peça volta e outra vai", "Devolução — a peça volta e o dinheiro volta", "Reembolso — o dinheiro volta sem a peça voltar";
     - motivo (radio, 5 opções);
     - "Conte o que aconteceu", obrigatório com Defeito e Outro. A dica diz "Não escreva dados pessoais além do necessário."
  3. **Peças**: lista dos itens com passo numérico de 0 até o disponível ("2 de 3 podem ser devolvidas"). Item sem disponível aparece desabilitado, com "Já está em outra solicitação".
  4. **Fotos (opcional)**: grade das fotos que a cliente mandou (via `/api/midias/[id]?miniatura=1`), com seleção de até 10. Vazio: "A cliente não mandou fotos nas conversas dos últimos 60 dias."

  CTA: "Abrir solicitação". Não é ação crítica: nada sai para fora e a gerência ainda decide. Sucesso leva a `/trocas/[id]`. O `loja` enviado é o do pedido.
- **Estados**:
  - pedido não encontrado: "Nenhum pedido com esse número nas lojas que você vê.";
  - erros de campo com `resumo-de-erros`.

### 7.5 `/trocas/[id]` (permissão `devolucoes:ler`)

- **Server**: `obterDevolucao`.
- **Client** (`cabecalho-troca` com trilho de etapas, `acoes-troca`, `dialogo-envio`, `dialogo-negar`, `dialogo-concluir`, `linha-do-tempo-troca`):
  - etapas do tipo (reembolso não mostra envio nem recebimento), dados, peças, fotos e "Abrir conversa";
  - pedido: link, selo do Masc ("Lançado no Masc por Ana em 12/09") e a linha "Recebido: R$ 299,70 (Mercado Pago) · Já estornado: R$ 0,00 · Limite: R$ 299,70". Com origem `masc`, o recebido aparece como "R$ 299,70 (venda lançada no Masc)"; com origem `nenhuma`, "Sem pagamento registrado".
- **Barra de ações** (só o que `acoesPermitidas` devolve): Aprovar · Negar · Registrar envio · Registrar recebimento · Concluir.
  - **Aprovar**: `AlertDialog` simples, "Aprovar a solicitação? A cliente ainda não é avisada automaticamente." Não está na lista do block: nada sai e nada muda no pedido.
  - **Registrar envio**: `dialog` com o rastreio opcional.
  - **Registrar recebimento**: `AlertDialog` simples, "Confirma que as peças chegaram na loja?".
  - **Negar**: formulário com motivo, seguido de **`ModalConfirmacaoBlock`** (variante `destrutiva`, item `negar-troca`) com o resumo "Negar a solicitação de devolução do pedido MS2609-CEN-0042 (2 peças). Não dá para desfazer; um novo pedido de troca vira outra solicitação."
  - **Concluir** (gestão): se a resposta for `SESSAO_NAO_FRESCA`, abre `ModalReautenticacao` e reenvia. O formulário em `dialog` tem:
    - valor do estorno, pré-preenchido com `valor_sugerido`, editável, com a dica "Limite: R$ 299,70";
    - forma (radio: Pix / Cartão / Crédito na loja);
    - pagamento de origem (select dos elegíveis, opcional);
    - motivo;
    - se `exige_confirmacao_masc`: "Como o ajuste foi registrado no Masc" (obrigatório).

    A faixa fixa `info` diz "O estorno é feito fora do sistema (Pix, maquininha, crédito na loja ou painel do Mercado Pago). Aqui fica o registro." Depois vem o **`ModalConfirmacaoBlock`** (item `concluir-troca`) com o resumo "Concluir a devolução de 2 peças do pedido MS2609-CEN-0042. Estorno registrado: R$ 179,80 por Pix. O pedido passa para Devolvido, sai da fila do Masc e deixa de contar nas compras da cliente." Cada frase de efeito aparece só quando vale. Na troca: "Concluir a troca de 1 peça do pedido MS2609-CEN-0042. O pedido não muda."
- **Estados**:
  - terminal: mostra quem resolveu e quando;
  - `COLISAO`: faixa;
  - recusa de teto: aparece no campo valor ("Passa do que foi recebido e ainda não estornado: R$ 120,00.");
  - limite zero: o texto de R2-TR-10 no campo, e o valor desabilitado para devolução e reembolso.

### 7.6 `/satisfacao` (permissão `pesquisas:ler`)

- **Server**: `indicadoresSatisfacao` e `listarRespostas` (período padrão de 30 dias).
- **Client** (`indicadores-csat`, `distribuicao-notas`, `lista-respostas`, `filtros-satisfacao`):
  - o cabeçalho diz a loja e o período;
  - 7 cartões, cada um com `?`;
  - barras de 1 a 5 com `--chart-*` **e** tabela alternativa;
  - a lista mostra: data; nota como texto e número ("5 — Muito satisfeita", "1 — Muito insatisfeita", nunca só cor); gatilho ("Conversa encerrada" / "Pedido entregue"); cliente (link; anonimizado aparece como "Titular anonimizado"); conversa (link); pedido (link); responsável da conversa; comentário (2 linhas e "Ver tudo"); "Não entregue" quando a mensagem falhou; "Pediu para sair" quando for o caso.
- **Faixas**:
  - com `csatAtivo = false`: faixa `info` "A pesquisa de satisfação está desligada neste ambiente. Nenhuma pesquisa nova é enviada.";
  - sempre, no `?` geral: "A pesquisa só sai em horário comercial, pelo número em que a cliente falou, com a conversa resolvida e a janela de 24 h aberta, no máximo uma vez a cada 30 dias por cliente, e nunca para quem pediu para sair."
- **Estados**: vazio "Nenhuma pesquisa enviada neste período."; filtro vazio com [Limpar filtros]. Não há ação crítica (tela só de leitura).

### 7.7 Mensagens na conversa (renderizadas pelo M1)

As mensagens da pesquisa, do agradecimento e da confirmação são `autor_tipo = 'sistema'` e aparecem como balão de sistema do M1. A resposta que não reabriu a conversa aparece normalmente na linha do tempo. Nenhum componente novo é criado no M1.

---

## 8. Segurança

| Ameaça | Resposta do desenho | REQ |
|---|---|---|
| Id de outra loja no corpo (`pedidoId`, `pedidoItemId`, `midiaId`, `conversaId`, `responsavelId`, `pagamentoId`, `contatoId`, `loja`) | Toda referência é conferida na transação contra o escopo **e** contra o pai: item do mesmo pedido, foto do mesmo contato e da mesma loja, pagamento do mesmo pedido, conversa do mesmo contato. As FKs compostas existentes são a rede de segurança. Fora do escopo = 404 | H10, H12 |
| Gravar na loja errada com "Todas as lojas" | Escrita com `loja: "grava"`: sem loja, `FALTA_LOJA` e nenhuma trilha; com loja diferente da do registro, 404 | H10 (INV-05) |
| Vendedora aprovando estorno ou inflando o valor (T-01) | `devolucoes:concluir_estorno` só para gestão, com **sessão fresca**, motivo, teto calculado no servidor em centavos, `FOR UPDATE` no pedido contra duas conclusões simultâneas, block de 3 s e trilha `devolucao_estorno_aprovado` **antes** do efeito, na mesma transação | H5, H4 |
| Marcar "lançado no Masc" só para liberar o teto | Marcar lançado é trilhado (`pedido_lancado_masc`) e exige o número da venda. Concluir exige gestão, sessão fresca e a confirmação escrita do ajuste. A tela mostra quem marcou e quando | H4 |
| Pular etapas da máquina | Transição conferida no servidor contra o estado relido na transação, mais a trava de colisão. A tela só mostra `acoesPermitidas` | H5 |
| Atribuição em massa (`...entrada` sobre a linha) | Mapeamento campo a campo, com trava de fonte (§9) | H12 |
| Escrita em ERP pela porta dos fundos | `negocios`, `devolucoes` e `pesquisas` não importam `@/lib/integracoes/bling`. T26 continua valendo | — |
| Spam ou assédio por mensagem automática | `CSAT_ATIVO` desligado por padrão, horário comercial, janela de 23 h, conta de entrada, só provedores do R1, limite de 30 dias, opt-out lido da fonte única, sem reenvio e sem envio manual | — |
| Promessa de opt-out sem mecanismo (I6) | SAIR classificado antes de tudo, por 30 dias, com lista fechada e testes. O texto diz o escopo (a loja) | L-08 |
| Resposta forjada ou atribuída a outra pesquisa | Nota casa só com entrada do **mesmo contato**, **mesma loja** e **mesma integração**, em 24 h. Eco, `deMim` e nota interna são ignorados. Só a primeira nota vale (registro atômico). A nota precisa ser um dígito isolado | — |
| Falso SAIR | Frase inteira de uma lista fechada, só com pesquisa nos últimos 30 dias. O efeito é a opção **mais protetora** (opt-out), tem saída ("avise a loja") e fica provado em `consentimentos` | — |
| Ingestão derrubada pela pesquisa | Envio automático em SAVEPOINT; erro de regra vai para o log e não derruba a ingestão. A classificação é leitura pura | — |
| PII em campo livre | `comentario` já é PII. **`negocios.observacao_perda` e `pedidos_devolucoes.motivo_detalhe` entram em `CAMPOS_PII` e na anonimização.** A mensagem do alerta não tem nome. Os campos de motivo têm a microcopia "Não escreva dados pessoais" (a trilha é append-only). O painel de CSAT é só da gestão. O log do job leva só ids | K3, L5 |
| Vazamento de erro do banco | `23505` traduzido pelo nome da constraint em mensagem fixa. Nada de `detail` na tela ou no log (`sanitizarErroBanco`) | K4 |
| CSRF em action | `exigirSessao` confere a origem em toda action mutante | J7 |
| XSS por comentário ou motivo | Renderizado como texto (React), sem `dangerouslySetInnerHTML` e sem Markdown | — |
| Negação por volume | 30 cartões por coluna, 50 linhas por página, 10 resultados de busca, 50 pesquisas por loja por ciclo, índices para as leituras quentes (`ix_negocios_funil`, `ix_pesquisas_satisfacao_periodo`, `ix_auditoria_eventos_acao`, `ix_consentimentos_loja`) | — |
| Mídia da cliente exposta | Fotos só por `/api/midias/[id]` (sessão e escopo). Nenhuma URL de provedor em DTO | — |

---

## 9. PACOTE DE CONSTRUÇÃO: R2-A Pós-venda

São três subpacotes com caminhos disjuntos, que podem correr em paralelo depois que o delta (§10) for aplicado. Tamanho estimado: ~60 arquivos e ~5.900 linhas (A1 ~19 arq./1.800 l · A2 ~24 arq./2.500 l · A3 ~17 arq./1.600 l).

| Subpacote | Banco de teste | Redis |
|---|---|---|
| A1 Funil | `merlostore_test_r2a1` (`node scripts/db-teste.mjs --sufixo r2a1`) | 9. Nenhum teste de A1 escreve no Redis |
| A2 Trocas | `merlostore_test_r2a2` | 9. Nenhum teste de A2 escreve no Redis |
| A3 CSAT | `merlostore_test_r2a3` | **9** (único que usa fila) |

Se A1 ou A2 precisarem de Redis em algum teste, esse teste roda em série com o A3.

### Objetivo
Ligar o funil, as trocas e devoluções e o CSAT com backend de verdade: sem tela de fachada, sem escrita em ERP e sem mensagem automática além da pesquisa e das duas respostas dela.

### Entradas
- este documento;
- `01-dados-dominio.md §6.1, §6.6, §7`;
- `03-arquitetura.md §4, §6, §8`;
- `04-ui.md §4–§10`;
- `02-seguranca.md §2.2, §2.4`;
- o código entregue do R1 **depois** do delta §10.3:
  - M1: ingestão e `registrarEnvio`;
  - M2: `registrarConsentimento` e `optOutVigente` em `@/lib/lgpd`;
  - M4: criação de pedido com `negocio_id`;
  - M8: costura `fontes-r2.ts`.

### Cria e é dono

**A1 Funil**
- domínio: `src/lib/negocios/{index.ts,_consultas.ts,_regras.ts,alertas.ts}`;
- action e validador: `src/lib/actions/negocios.ts` · `src/lib/validadores/negocios.ts`;
- rotas: `src/app/(app)/funil/{page,loading,error}.tsx` · `src/app/(app)/funil/[id]/{page,loading,error}.tsx`;
- componentes: `src/app/(app)/funil/_components/{quadro-funil,coluna-funil,cartao-negocio,menu-mover,dialogo-perda,dialogo-novo-negocio,filtros-funil,formulario-negocio,acoes-negocio,linha-do-tempo-negocio}.tsx`;
- testes: `tests/unidade/negocios-regras.test.ts` · `tests/integracao/negocios-funil.test.ts` · `tests/integracao/negocios-alerta.test.ts` · `tests/componentes/negocios-funil.test.tsx` · `tests/travas/negocios-fonte.test.ts`;
- documentação: `docs/modulos/negocios.md`.

**A2 Trocas**
- domínio: `src/lib/devolucoes/{index.ts,_consultas.ts,_regras.ts,_teto.ts,_conclusao.ts}`;
- action e validador: `src/lib/actions/devolucoes.ts` · `src/lib/validadores/devolucoes.ts`;
- rotas: `src/app/(app)/trocas/{page,loading,error}.tsx` · `src/app/(app)/trocas/nova/{page,loading,error}.tsx` · `src/app/(app)/trocas/[id]/{page,loading,error}.tsx`;
- componentes: `src/app/(app)/trocas/_components/{filtros-trocas,tabela-trocas,formulario-solicitacao,busca-pedido,seletor-itens,seletor-fotos,cabecalho-troca,acoes-troca,dialogo-envio,dialogo-negar,dialogo-concluir,linha-do-tempo-troca}.tsx`;
- testes: `tests/unidade/devolucoes-regras.test.ts` · `tests/integracao/devolucoes-fluxo.test.ts` · `tests/integracao/devolucoes-conclusao.test.ts` · `tests/componentes/devolucoes-trocas.test.tsx` · `tests/travas/devolucoes-fonte.test.ts`;
- documentação: `docs/modulos/devolucoes.md`.

**A3 CSAT**
- domínio: `src/lib/pesquisas/{index.ts,_consultas.ts,_regras.ts,_normalizacao.ts,disparo.ts}`;
- corpos das costuras criadas no delta: `src/lib/pesquisas/entrada.ts` e `src/server/processadores/pos-venda.ts`;
- action e validador: `src/lib/actions/pesquisas.ts` · `src/lib/validadores/pesquisas.ts`;
- rotas: `src/app/(app)/satisfacao/{page,loading,error}.tsx`;
- componentes: `src/app/(app)/satisfacao/_components/{indicadores-csat,distribuicao-notas,lista-respostas,filtros-satisfacao}.tsx`;
- testes: `tests/unidade/pesquisas-regras.test.ts` · `tests/integracao/pesquisas-disparo.test.ts` · `tests/integracao/pesquisas-resposta.test.ts` · `tests/integracao/pesquisas-ingestao.test.ts` · `tests/componentes/pesquisas-satisfacao.test.tsx` · `tests/travas/pesquisas-fonte.test.ts`;
- documentação: `docs/modulos/pesquisas.md`.

Nenhum arquivo é compartilhado entre A1, A2 e A3. A2 não importa de A1 e A3 não importa de A1 nem de A2.

### Só lê
- `src/lib/db/**`: schema, `mutacoes.ts` e a pasta `mutacoes/`, `consultas.ts`, `listas-fechadas.ts`, `erros.ts`;
- `src/lib/auth/**`, inclusive `sistema.ts`;
- `src/lib/actions/_base.ts`, `src/lib/validadores/comum.ts`;
- `src/lib/{formato,marca,env,erros,logger,navegacao}.ts`, `src/lib/fila/**`, `src/lib/ui/tons.ts`, `src/components/**`;
- `src/lib/conversas/saida.ts` (costura);
- `@/lib/lgpd`: `registrarConsentimento`, `optOutVigente`;
- `src/app/api/midias/[id]`, só como URL.

### Não negociável
1. `ganho` nunca é gravado por este pacote. `ganho` e os estados terminais de devolução não reabrem.
2. Um negócio aberto por cliente, garantido pelo índice. A checagem prévia serve só para a mensagem.
3. Toda escrita usa `loja: "grava"`, e a tela envia o `loja_id` do registro.
4. O teto do estorno é calculado no servidor, em centavos, com `SELECT … FOR UPDATE` do pedido. Recebido pelo provedor conta `aprovado` **e** `estornado`; sem provedor, vale o total só se o pedido estiver lançado no Masc. Concluir exige gestão, sessão fresca, motivo (quando há valor) e block de 3 s. `devolucao_estorno_aprovado` é gravado **antes** do efeito, na mesma transação.
5. O pedido só vira `devolvido` com cobertura total. Os contadores do contato só mudam nesse momento. `pagamento_status = 'estornado'` só a partir de `pago` e com estorno total.
6. Nenhuma chamada a provedor de pagamento, Bling ou Masc. Nenhuma mensagem automática nas trocas.
7. CSAT:
   - `CSAT_ATIVO` desligado por padrão;
   - a pesquisa sai pela `integracao_id` da conversa e só por `PROVEDORES_COM_PESQUISA`;
   - só com janela de 23 h, horário comercial, limite de 30 dias e sem opt-out;
   - pesquisa sem `mensagem_id` não existe;
   - todo `registrarEnvio` deste pacote passa `reabrir: false` e `autorTipo: "sistema"`.
8. Resposta:
   - SAIR é avaliado antes de nota e de comentário e vale por 30 dias;
   - nota é só um dígito de 1 a 5 isolado, em 24 h, e só a primeira vale;
   - nota 3–5 e SAIR não reabrem; nota 1–2 reabre;
   - SAIR nunca vira comentário;
   - toda resposta grava a trilha `pesquisa_respondida`.
9. Máquina de estados e rótulos têm **uma** fonte (`_regras.ts` e `tons.ts`). A tela não recalcula transição.
10. Arquivo com menos de 500 linhas, PT-BR, `window.confirm` proibido, nenhuma tela mostra o que o backend não faz.

### Aceite verificável
- `npm run lint && npm run typecheck && npm run compliance && npm run test:compliance && npm run test:travas` verdes.
- `node scripts/db-teste.mjs --sufixo r2aN` e `npm run test:integracao` verdes nos arquivos do subpacote, com `REDIS_URL=redis://localhost:6382/9`.
- `npm run test:unidade && npm run test:componentes` verdes.
- Fluxo manual no banco de dev (delta aplicado, R1 inteiro no ar):
  - **Funil**: criar negócio buscando a cliente pelo telefone; mover e usar o Desfazer; perder com motivo; reabrir; fechar venda na conversa marcando o negócio. O cartão aparece em Ganho com o número do pedido.
  - **Troca de gateway**: pedido pago pelo simulado do R2-PG e entregue; abrir `/trocas/nova` com duas peças e uma foto da cliente; aprovar; registrar recebimento; concluir com Pix. O pedido fica `Devolvido`, sai da fila do Masc, `pedidos_contagem` do contato cai e `pagamento_status` fica `estornado`.
  - **Venda de balcão**: pedido lançado no Masc e sem pagamento no gateway. A conclusão aceita estornar até o total e exige a confirmação do Masc.
  - **CSAT**:
    1. Ligar `CSAT_ATIVO=true` e usar uma conversa resolvida há 31 min, com entrada recente.
    2. Rodar o job. A mensagem sai pela conta da conversa, e a conversa continua **resolvida**.
    3. Responder "5" pelo webhook simulado. A nota é registrada, o agradecimento é enviado e a conversa continua resolvida.
    4. Responder "SAIR". O opt-out é registrado, a confirmação cita a loja e o SAIR não vira comentário.
    5. Responder "1" em outra conversa. A conversa **reabre**.
- `select count(*) from pesquisas_satisfacao where mensagem_id is null` = 0.
- `npm run verificar` verde.

### Testes obrigatórios

**Unidade**
- Tabela de transições do funil (todos os pares).
- Tabela tipo × estado × ação da devolução.
- Teto de estorno em centavos:
  - `0.10 + 0.20`;
  - pagamento `estornado` somado;
  - sem provedor com Masc `lancado` → total;
  - sem provedor e Masc `pendente` → 0;
  - estornos anteriores;
  - `total < recebido`.
- Cobertura total: parcial; total em duas solicitações; troca não conta.
- `normalizarResposta` e classificação de texto:
  - viram nota: `"5"`, `" 4 "`, `"5️⃣"`, `"4."`;
  - viram sair: `"Sair"`, `"SAIR!"`, `" stop "`, `"Não quero receber"`, `"PARAR DE RECEBER"`, `"quero sair"`;
  - não viram nada: `"5 estrelas"`, `"cinco"`, `"cancelar"`, `"não quero mais esse vestido"`, `"sair de casa"`, `"5 sair"`.
- Janela de horário em São Paulo: 08:59, 09:00, 19:59 e 20:00, com o relógio do processo em UTC.

**Integração: funil**
- Contato de outra loja → 404.
- Segundo negócio aberto recusado; **duas criações simultâneas deixam um**.
- Mover com `updatedAt` velho → `COLISAO`.
- Mover para `ganho` recusado.
- Perder sem motivo recusado pelo Zod e, forçado por SQL, pelo `CHECK`.
- Reabrir limpa o motivo e respeita o único.
- Excluir ganho recusado.
- Responsável vendedor de outra loja recusado.
- Viewer em qualquer escrita → 403 e `recusa_403`.
- **Gestão com cookie em "todas" e sem `loja` em `moverNegocio` → `FALTA_LOJA`, sem trilha**; com `loja` de outra loja → 404.
- Cada transição grava 1 linha de trilha com autor.
- **Contrato com o M4**:
  - pedido com `negocio_id` aberto → `ganho` e `negocio_estagio_alterado`;
  - com negócio perdido, ganho ou de outro contato → recusado.
- `candidatosDeAlertaDeNegocio` acha o negócio de 4 dias e não o de 2. Depois de `moverNegocio`, a chave some.

**Integração: trocas**
- Pedido `confirmado` ou `cancelado` recusado.
- Item de outro pedido recusado.
- Quantidade acima do disponível recusada, inclusive quando a outra parte está em solicitação aberta por outra pessoa.
- Foto de outra loja, de outro contato ou com `origem = 'upload'` recusada.
- Transições inválidas recusadas (uma por par).
- Vendedor em aprovar, negar ou concluir → 403.
- Concluir sem sessão fresca → `SESSAO_NAO_FRESCA`.
- **`concluirDevolucao` com cookie em "todas" e sem `loja` → `FALTA_LOJA` e nenhuma linha em `auditoria_eventos`.**
- Negar sem motivo recusado.
- Devolução total → pedido `devolvido`; some da fila `masc_status = 'pendente'` e da reserva (`calcularDisponivel`); contadores `−1` e `−total`.
- Devolução parcial → pedido intacto.
- Troca com valor recusada.
- Valor acima do limite recusado.
- Sem provedor e sem Masc → recusado, com a microcopia de R2-TR-10.
- **Lançado no Masc sem pagamento no gateway → conclui até o total, exige `confirmacaoMasc` e grava a trilha antes do efeito.**
- **Pagamento já `estornado` pelo provedor → o teto continua valendo e `pagamento_status` fica como está.**
- **Duas conclusões concorrentes que, somadas, passam do recebido → uma falha.**
- Pedido cancelado entre a aprovação e a conclusão → conclusão recusada.
- `devolucao_estorno_aprovado` tem `criado_em` ≤ o de `devolucao_concluida` e **some junto** quando a transação é forçada a falhar depois do efeito.
- `pagamento_status = 'estornado'` só no estorno total a partir de `pago`.

**Integração: CSAT (disparo)**
- Desligado → nada.
- Conversa elegível → 1 linha com `mensagem_id` preenchido; `registrarEnvio` recebe a `integracao_id` da conversa, `reabrir: false` e `autorTipo: "sistema"`; a conversa segue `resolvida`; a trilha tem `pesquisa_enviada`.
- Job rodado duas vezes → 1 linha.
- Opt-out vigente → nada; opt-in posterior → envia.
- Limite de 30 dias respeitado.
- Nada é enviado quando: a janela está fechada; a integração está desconectada; o provedor é `facebook`; o contato está anonimizado; é fora do horário.
- Pedido entregue (via M4) → gatilho `pedido_entregue` com `pedido_id`.
- Conversa e pedido elegíveis juntos → só 1 pesquisa.
- Falha de envio de um candidato não impede o próximo.
- Transação forçada a falhar depois do `registrarEnvio` → nem mensagem, nem pesquisa, nem job de saída.

**Integração: CSAT (resposta)**
- Nota → registro atômico, `updated_at` e `modified_by = ATOR_SISTEMA`, trilha `pesquisa_respondida`.
- Segunda nota não sobrescreve.
- Nota 1–2 → `reabrir: true` e sem agradecimento.
- **"5" seguido de "SAIR"** → `consentimentos` com `origem = 'mensagem'`, espelho `opt_out = true`, `comentario` nulo, nota 5 mantida e confirmação enviada.
- **"SAIR" 30 h depois do envio** → opt-out, pesquisa marcada respondida com nota nula.
- SAIR com opt-out já vigente → nenhuma linha nova e nenhuma confirmação.
- SAIR 31 dias depois → não classificado.
- Comentário em 20 min gravado uma vez, com diff `"(alterado)"` na trilha; em 40 min, não.
- Pesquisa de outra integração ou enviada há 25 h → nota não classificada.
- Conta desconectada no momento do agradecimento → ingestão conclui e o log registra `pesquisa_resposta_sem_envio`.

**Integração: contrato com o M1** (`pesquisas-ingestao.test.ts`)
- Evento simulado "5" em conversa resolvida com pesquisa pendente → mensagem gravada na conversa da pesquisa; `status` continua `resolvida`; `nao_lidas` igual; nenhuma `conversa_reaberta`.
- "1" → a conversa reabre.
- "SAIR" → não reabre.
- Texto comum → fluxo normal.

**Componentes**
- 4 estados de cada página e de cada diálogo.
- Excluir negócio (`ConfirmarExclusao`), Negar e Concluir passam por `ModalConfirmacaoBlock` com `resumo` preenchido; Esc e clique fora são inertes nos 3 s; foco inicial em Cancelar; erro mantém o modal aberto.
- Todo formulário de escrita leva o campo `loja`.
- Soltar em Ganho não chama action.
- Faixa "desligada" aparece quando `csatAtivo = false`.
- Nota nunca é só cor.
- Limite zero desabilita o valor.

**Travas de fonte** (`*-fonte.test.ts`)
- `src/lib/{negocios,devolucoes,pesquisas}/**` e as três actions não têm:
  - import de `integracoes/bling`, `pagamentos/provedores` ou `buscarExterno`;
  - `...dados` / `...entrada` dentro de chamada de `inserirAuditado`/`atualizarComTrava`;
  - SDK de IA.
- Toda action de escrita dos três arquivos declara `loja: "grava"`.
- Todo `registrarEnvio(` em `src/lib/pesquisas/**` contém `reabrir: false`.
- Nenhum arquivo deste pacote grava `estagio: "ganho"`.

### Riscos
- **Contrato do M1 diferente do previsto** (ordem de reabertura, `registrarEnvio` ignorando `reabrir`, envio enfileirado antes do commit): o teste de contrato falha. A correção vai para o delta §10.3-M1, nunca para um contorno aqui.
- **Ingestão concorrente da mesma cliente** (nota e comentário processados em paralelo): o comentário pode não ser capturado. A mensagem fica na conversa normalmente, que é perda aceita. Se o M1 serializar por conversa, o problema some.
- **Evento de entrega em outro formato** (M4 sem `depois.status`): `pedido_entregue` nunca dispara. O teste de integração pega; ajusta-se o M4.
- **Receita do M8 conta pedido devolvido lançado no Masc** (definição de `04-ui §5.5`): fora deste pacote, registrado como pergunta ao cliente no ADR 0032.
- **Quadro pesado com "Todas as lojas"**: 30 cartões por coluna e `ix_negocios_funil`. Medir antes de otimizar.
- **Fuso do container**: cron com `tz` e guarda com `Intl` em `America/Sao_Paulo`.

### Commits (Conventional PT-BR, sem rodapé de coautoria)
- A1:
  - `feat(negocios): regras do funil, ações com trava e fonte de alerta`
  - `feat(funil): quadro kanban, detalhe e linha do tempo do negócio`
  - `test(negocios): cobrir transições, único aberto e contrato com pedidos`
  - `docs(negocios): documentar o módulo negocios`
- A2:
  - `feat(devolucoes): máquina de estados, teto de estorno e efeitos no pedido`
  - `feat(trocas): lista, criação com peças e fotos e conclusão com block`
  - `test(devolucoes): cobrir teto concorrente, Masc e trilha antes do efeito`
  - `docs(devolucoes): documentar o módulo devolucoes`
- A3:
  - `feat(pesquisas): disparo pela conta de entrada e captura da resposta`
  - `feat(satisfacao): painel de CSAT com definições explícitas`
  - `test(pesquisas): cobrir elegibilidade, SAIR e contrato com a ingestão`
  - `docs(pesquisas): documentar o módulo pesquisas`

---

## 10. DELTA DA FUNDAÇÃO (aplicar antes da onda 3)

Ordem: §10.1 (fundação, sequencial) → §10.2 (coordenação com o R2-PG) → §10.3 (arquivos de M1, M2, M4 e M8, depois que cada módulo fechar). Itens marcados **[fundir]** também são mexidos por outros clusters: o orquestrador aplica o texto somado uma vez.

### 10.1 Arquivos da fundação

**D1 — Enums [fundir]**

`src/lib/db/schema/_enums/pedidos.ts`, logo depois de `MOTIVOS_PERDA`:
```ts
/** Estágios em que o negócio ainda está em jogo (ADR 0031). Único parcial por contato. */
export const ESTAGIOS_NEGOCIO_ABERTOS = ["lead", "interessada", "negociando", "fechando"] as const;
export type EstagioNegocioAberto = (typeof ESTAGIOS_NEGOCIO_ABERTOS)[number];
```

`src/lib/db/schema/_enums/auditoria.ts`:
- em `ACOES_AUDITADAS`, inserir `"negocio_alterado",` logo depois de `"negocio_criado",`;
- em `ACOES_AUDITADAS`, inserir `"pesquisa_enviada",` e `"pesquisa_respondida",` logo depois de `"devolucao_concluida",`;
- em `CAMPOS_PII`, acrescentar:
  ```ts
    negocios: ["observacao_perda"],
    pedidos_devolucoes: ["motivo_detalhe"],
  ```

**D2 — Índices e fragmento da `0018_r2` [fundir]**

`src/lib/db/schema/negocios.ts`: importar `uniqueIndex` (de `drizzle-orm/pg-core`), `listaSql` (de `./_enums`) e `ESTAGIOS_NEGOCIO_ABERTOS`. No array de restrições:
```ts
    /** Um negócio aberto por cliente (ADR 0031). Predicado literal: nunca parâmetro. */
    uniqueIndex("uq_negocios_aberto_por_contato")
      .on(t.contato_id)
      .where(sql.raw(`estagio in (${listaSql(ESTAGIOS_NEGOCIO_ABERTOS)}) and is_deleted = false`)),
```

`src/lib/db/schema/lgpd.ts`, no array de `pesquisas_satisfacao`:
```ts
    /** Uma pesquisa por conversa encerrada (ADR 0034). */
    uniqueIndex("uq_pesquisas_satisfacao_conversa")
      .on(t.conversa_id)
      .where(sql`gatilho = 'conversa_encerrada' and is_deleted = false`),
    /** Painel /satisfacao por loja e período. */
    index("ix_pesquisas_satisfacao_periodo")
      .on(t.loja_id, t.enviada_em.desc())
      .where(sql`is_deleted = false`),
```

Linhas que o `drizzle-kit generate` da `0018_r2` tem de conter por causa do R2-A (conferir byte a byte; `grep -n "= \$"` tem de sair vazio):
```sql
-- dentro do DROP/ADD único de "auditoria_eventos_acao_lista": 'negocio_alterado', 'pesquisa_enviada', 'pesquisa_respondida'
CREATE UNIQUE INDEX "uq_negocios_aberto_por_contato" ON "negocios" USING btree ("contato_id") WHERE estagio in ('lead', 'interessada', 'negociando', 'fechando') and is_deleted = false;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_pesquisas_satisfacao_conversa" ON "pesquisas_satisfacao" USING btree ("conversa_id") WHERE gatilho = 'conversa_encerrada' and is_deleted = false;--> statement-breakpoint
CREATE INDEX "ix_pesquisas_satisfacao_periodo" ON "pesquisas_satisfacao" USING btree ("loja_id","enviada_em" DESC NULLS LAST) WHERE is_deleted = false;
```
Nenhuma tabela nova. Nenhuma mudança em `TOTAL_TABELAS`, `TOTAL_MODIFIED_BY` ou `TOTAL_FK_COMPOSTA` por causa do R2-A. Motivo: o único por contato é regra de negócio que o banco segura melhor; o único por conversa é a idempotência do disparo; o índice de período sustenta o painel. Aceite: `npm run db:teste && npm run db:migrate && npm run db:verificar` e `enums-check` verdes.

**D3 — Mutações [fundir com G2]**

(a) `src/lib/db/mutacoes/base.ts`: `atualizarComTrava` ganha o 6º parâmetro e o repassa.
```ts
export async function atualizarComTrava(
  tx: Transacao,
  tabela: TabelaDominio,
  alvo: Alvo & { dados: Linha },
  ctx: Contexto,
  acao: AcaoAuditada,
  /** Vai para `auditoria_eventos.motivo` (negar, concluir, ajuste no Masc). */
  motivo?: string,
): Promise<Linha> {
```
A chamada final passa a ser `await registrarAuditoria(tx, ctx, acao, nome, alvo.id, diffAuditado(nome, antes, alvo.dados), motivo);`.

(b) Arquivo novo `src/lib/db/mutacoes/pos-venda.ts`:
```ts
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { diffAuditado, registrarAuditoria } from "@/lib/auditoria/gravador";
import type { Contexto } from "@/lib/auth/guard";
import { condicaoDeLoja, vivos } from "../consultas";
import { pesquisas_satisfacao } from "../schema/lgpd";
import type { Transacao } from "./base";

const p = pesquisas_satisfacao;

/**
 * Resposta de pesquisa de satisfação (ADR 0034): registro atômico. Só a PRIMEIRA
 * resposta vale; zero linhas = já respondida e nada acontece. `nota` nula = a
 * cliente pediu para sair. Grava `updated_at`, `modified_by` e a trilha.
 */
export async function registrarRespostaDePesquisa(
  tx: Transacao,
  pesquisaId: string,
  resposta: { nota: number | null; respondidaEm: Date },
  ctx: Contexto,
): Promise<boolean> {
  const dados = { nota: resposta.nota, respondida_em: resposta.respondidaEm };
  const linhas = await tx
    .update(p)
    .set({ ...dados, updated_at: new Date(), modified_by: ctx.autorId })
    .where(and(eq(p.id, pesquisaId), isNull(p.respondida_em), condicaoDeLoja(p as never, ctx.escopo), vivos(p)))
    .returning({ id: p.id });
  if (linhas.length === 0) return false;
  await registrarAuditoria(
    tx, ctx, "pesquisa_respondida", "pesquisas_satisfacao", pesquisaId,
    diffAuditado("pesquisas_satisfacao", { nota: null, respondida_em: null }, dados),
    resposta.nota === null ? "pediu para sair" : undefined,
  );
  return true;
}

/** Comentário depois da nota: grava uma vez só. O diff sai mascarado (CAMPOS_PII). */
export async function registrarComentarioDePesquisa(
  tx: Transacao,
  pesquisaId: string,
  comentario: string,
  ctx: Contexto,
): Promise<boolean> {
  const linhas = await tx
    .update(p)
    .set({ comentario, updated_at: new Date(), modified_by: ctx.autorId })
    .where(and(eq(p.id, pesquisaId), isNotNull(p.nota), isNull(p.comentario), condicaoDeLoja(p as never, ctx.escopo), vivos(p)))
    .returning({ id: p.id });
  if (linhas.length === 0) return false;
  await registrarAuditoria(
    tx, ctx, "pesquisa_respondida", "pesquisas_satisfacao", pesquisaId,
    diffAuditado("pesquisas_satisfacao", { comentario: null }, { comentario }),
  );
  return true;
}
```

`src/lib/db/mutacoes.ts` (reexportador) ganha `export * from "./mutacoes/pos-venda";`. Em `tests/travas/mutacoes.test.ts`, `registrarRespostaDePesquisa` e `registrarComentarioDePesquisa` entram na lista de exports obrigatórios.

**D4 — Permissões [fundir com G5]**

Arquivo novo `src/lib/auth/permissoes/pos-venda.ts`:
```ts
import { GESTAO, OPERACAO, TODOS, type MapaPermissao } from "./_papeis";

/**
 * Pós-venda (R2-A, ADRs 0031–0035): funil, trocas/devoluções e CSAT.
 * `ganho` não tem chave (só a venda ganha). Estorno é gestão com sessão
 * fresca. O painel de CSAT mostra comentário (PII) e fica com a gestão.
 */
export const POS_VENDA: MapaPermissao = {
  "negocios:ler": TODOS,
  "negocios:criar": OPERACAO,
  "negocios:editar": OPERACAO,
  "negocios:excluir": GESTAO,

  "devolucoes:ler": OPERACAO,
  "devolucoes:criar": OPERACAO,
  /** Registrar envio (rastreio) e recebimento: é a loja que recebe a peça. */
  "devolucoes:editar": OPERACAO,
  "devolucoes:aprovar": GESTAO,
  "devolucoes:negar": GESTAO,
  /** Motivo obrigatório, sessão fresca, trilha antes do efeito: é dinheiro saindo. */
  "devolucoes:concluir_estorno": GESTAO,

  "pesquisas:ler": GESTAO,
};
```
Nos arquivos já existentes:
- `permissoes/index.ts`: `import { POS_VENDA } from "./pos-venda";` e `...POS_VENDA,` dentro de `MATRIZ_ENTREGUE`.
- `fase-r2.ts`: remover as chaves `negocios:*` e `devolucoes:*`.
- `tests/seguranca/rbac.test.ts`: a asserção de `devolucoes:concluir_estorno` sai do `it` da fase R2 e vira `it("estorno e painel de CSAT são da gestão")`, com os casos:
  - `concluir_estorno`: gerente `true`, vendedor `false`;
  - `pesquisas:ler`: vendedor `false`, viewer `false`;
  - `devolucoes:editar`: vendedor `true`, viewer `false`.

**D5 — Navegação [fundir com G6]**

`src/lib/navegacao.ts`:
- os itens "Funil" e "Trocas e devoluções" passam a `fase: "entregue"`;
- entre "Auditoria" e "Base de conhecimento", entra:
```ts
  {
    rotulo: "Satisfação",
    rota: "/satisfacao",
    icone: "satisfacao",
    grupo: "Gestão",
    permissao: "pesquisas:ler",
    fase: "entregue",
  },
```

`src/components/layout/navegacao-lateral.tsx`: importar `Smile` de `lucide-react` e acrescentar `satisfacao: Smile,` em `ICONES_NAV`.

**D6 — Tons**

`src/lib/ui/tons.ts`: importar `ESTAGIOS_NEGOCIO`, `STATUS_DEVOLUCAO`, `TIPOS_DEVOLUCAO` e os tipos de `_enums/pedidos`, e acrescentar:
```ts
const ESTAGIO_NEGOCIO_TONS: Record<EstagioNegocio, Entrada> = {
  lead: { rotulo: "Lead", tom: "neutro" },
  interessada: { rotulo: "Interessada", tom: "info" },
  negociando: { rotulo: "Negociando", tom: "info" },
  fechando: { rotulo: "Fechando", tom: "marca" },
  ganho: { rotulo: "Ganho", tom: "sucesso" },
  perdido: { rotulo: "Perdido", tom: "neutro" },
};

const STATUS_DEVOLUCAO_TONS: Record<StatusDevolucao, Entrada> = {
  solicitada: { rotulo: "Solicitada", tom: "aviso" },
  aprovada: { rotulo: "Aprovada", tom: "info" },
  em_transito: { rotulo: "A caminho da loja", tom: "info" },
  recebida: { rotulo: "Recebida na loja", tom: "aviso" },
  concluida: { rotulo: "Concluída", tom: "sucesso" },
  negada: { rotulo: "Negada", tom: "neutro" },
};

/** Tipo é rótulo, não estado: tom neutro. */
const TIPO_DEVOLUCAO_TONS: Record<TipoDevolucao, Entrada> = {
  troca: { rotulo: "Troca", tom: "neutro" },
  devolucao: { rotulo: "Devolução", tom: "neutro" },
  reembolso: { rotulo: "Reembolso", tom: "neutro" },
};
```
Também:
- as chaves `estagio_negocio`, `status_devolucao` e `tipo_devolucao` entram em `TONS_POR_DOMINIO` e `VALORES_POR_DOMINIO`;
- o comentário do topo perde `ESTAGIOS_NEGOCIO`, `STATUS_DEVOLUCAO` e `GATILHOS_PESQUISA` da frase "Enums fora do R1". Gatilho não ganha selo: o rótulo dele mora em `pesquisas/_regras.ts`.

**D7 — Fila, agendador, worker e costura do processador [fundir]**

`src/lib/fila/filas.ts`, em `FILAS`:
```ts
  "pos-venda": { jobs: ["disparar-pesquisas"], concorrencia: 1 },
```

`src/lib/fila/agendamentos.ts`, em `AGENDAMENTOS`:
```ts
  {
    nome: "disparar-pesquisas-15min",
    fila: "pos-venda",
    job: "disparar-pesquisas",
    padrao: "*/15 9-19 * * *",
    porque: "pesquisa sai 30 min depois de resolver, só em horário comercial e com a janela de 24 h aberta",
  },
```

Arquivo novo `src/server/processadores/pos-venda.ts` (costura; dono R2-A):
```ts
import type { Job } from "bullmq";
import { env } from "@/lib/env";
import { naoImplementado } from "@/lib/erros";

/** COSTURA — dono: R2-A (pós-venda). Desligado por padrão: nada roda sem CSAT_ATIVO. */
export async function dispararPesquisas(job: Job): Promise<void> {
  if (!env.CSAT_ATIVO) return;
  throw naoImplementado(`dispararPesquisas [#${job.id}] (fila pos-venda, pacote R2-A)`);
}
```

`src/server/worker.ts`: `import { dispararPesquisas } from "./processadores/pos-venda";` e, em `PROCESSADORES`, `"pos-venda": { "disparar-pesquisas": dispararPesquisas as Processador },`. Esta linha entra **no mesmo commit** de `FILAS`, porque `conferirCobertura()` derruba o boot se as duas listas divergirem.

`03-arquitetura.md §8.1`: linha da fila `pos-venda` (1 job, concorrência 1).

**D8 — Ambiente [fundir]**

`src/lib/env.ts`, seção Operação, depois de `DISCORD_WEBHOOK_ALERTAS`:
```ts
    /** Pesquisa de satisfação automática (ADR 0034). Desligada até o cliente aprovar o texto. */
    CSAT_ATIVO: booleano.default(false),
```

`.env.example`, seção Operacao, no fim:
```
# Pesquisa de satisfacao automatica (true/false). Desligada ate o cliente aprovar o texto.
CSAT_ATIVO=false
```

**D9 — Costura de entrada da pesquisa**

Arquivo novo `src/lib/pesquisas/entrada.ts` (dono R2-A). Traz os tipos exatos do §5.5 e os corpos provisórios:
```ts
/**
 * COSTURA — dono: R2-A (pós-venda), consumida pela ingestão do M1 (ADR 0035).
 * A ingestão CLASSIFICA antes de escolher/reabrir a conversa e APLICA depois
 * de gravar a mensagem, na mesma transação.
 */
export async function classificarEntradaDePesquisa(_tx: Transacao, _entrada: EntradaParaPesquisa): Promise<ClassificacaoDePesquisa> {
  return { tipo: "nenhuma" };
}
export async function aplicarEntradaDePesquisa(
  _tx: Transacao,
  classificacao: Exclude<ClassificacaoDePesquisa, { tipo: "nenhuma" }>,
  _mensagem: MensagemGravada,
  _ctx: Contexto,
): Promise<void> {
  throw naoImplementado(`aplicarEntradaDePesquisa [${classificacao.tipo}] (pacote R2-A)`);
}
```
Imports: `type Contexto` de `@/lib/auth/guard`, `type Transacao` de `@/lib/db/mutacoes`, `naoImplementado` de `@/lib/erros`. Como o corpo provisório de `classificar` devolve sempre `nenhuma`, o `throw` de `aplicar` nunca é alcançado enquanto o A3 não entregar os dois corpos juntos.

Acrescentar à tabela de costuras (`05-plano §5`):
- `src/lib/pesquisas/entrada.ts` | `classificarEntradaDePesquisa(tx, entrada)`, `aplicarEntradaDePesquisa(tx, classificacao, mensagem, ctx)` | R2-A, consumida por M1;
- `src/server/processadores/pos-venda.ts` | `dispararPesquisas(job)` | R2-A.

**D10 — Lista do block [fundir com G7]**

`tests/componentes/block-3s.test.tsx`, em `ACOES_COM_BLOCK`, depois de `"cancelar-pedido",`:
```ts
  "negar-troca",
  "concluir-troca",
```
O comentário da lista passa a dizer o total real (27), definido pelo orquestrador. No fechamento do R2, `telasLigadas` ganha os dois identificadores e `excluir-registro` (se ainda não estiver), e o `PISO_DE_TELAS_LIGADAS` sobe junto.

`04-ui.md §9.1`, "Atendimento e vendas":
- o item 5 passa a citar "negócio" entre os registros excluíveis;
- itens novos: "**Negar troca/devolução** (motivo obrigatório; resumo com pedido e nº de peças)" e "**Concluir troca/devolução** (resumo com estorno, efeito no pedido e ajuste no Masc)";
- renumerar uma vez.

`04-ui.md §9.2`: acrescentar "mover negócio entre estágios abertos" à lista de reversíveis com Desfazer.

**D11 — Documentação versionada**

`docs/seguranca/caminhos-de-acesso.md` (ASCII, como o resto do arquivo):
- na §3 (vendas), acrescentar:
  ```
  | `/trocas` | `devolucoes:ler` | pacote R2-A |
  | `/trocas/nova` | `devolucoes:criar` | pacote R2-A |
  | `/trocas/[id]` | `devolucoes:ler` | pacote R2-A |
  ```
- na §2 (atendimento):
  ```
  | `/funil` | `negocios:ler` | pacote R2-A |
  | `/funil/[id]` | `negocios:ler` | pacote R2-A |
  ```
- na §5 (gestão):
  ```
  | `/satisfacao` | `pesquisas:ler` | pacote R2-A |
  ```
- na §7, retirar `/trocas`, `/funil` e `/csat` da lista. `/csat` não existe e não vai existir; a rota é `/satisfacao`.

Nas especificações:
- `04-ui.md §4.1`: retirar `/trocas*` e `/funil` de "Rotas que não existem"; incluir `/funil`, `/funil/[id]`, `/trocas`, `/trocas/nova`, `/trocas/[id]` e `/satisfacao` na árvore canônica.
- `01-dados-dominio.md §6.6`: o item 4 passa a ser "confirmação escrita do ajuste no Masc na conclusão (ADR 0032)". Retirar "Fora do R1" de §6.1, §6.6 e §7.1.
- `03-arquitetura.md §4.2`: módulos `negocios`, `devolucoes` e `pesquisas`. `01-dados.md §13.4`: as três áreas passam a entregues no R2.
- `docs/regras-negocio.md`: seção "Pós-venda" com as regras R2-FN, R2-TR e R2-CS (texto da §2).

**D12 — Mapa de donos [fundir com G13]**

`05-plano §8`, linhas novas:

| Caminho | Dono |
|---|---|
| `src/lib/negocios/**`, `src/lib/actions/negocios.ts`, `src/lib/validadores/negocios.ts`, `src/app/(app)/funil/**`, `docs/modulos/negocios.md` | R2-A1 |
| `src/lib/devolucoes/**`, `src/lib/actions/devolucoes.ts`, `src/lib/validadores/devolucoes.ts`, `src/app/(app)/trocas/**`, `docs/modulos/devolucoes.md` | R2-A2 |
| `src/lib/pesquisas/**` (incl. a costura `entrada.ts`), `src/lib/actions/pesquisas.ts`, `src/lib/validadores/pesquisas.ts`, `src/app/(app)/satisfacao/**`, `src/server/processadores/pos-venda.ts`, `docs/modulos/pesquisas.md` | R2-A3 |

O R2-A não cria arquivo em árvore de M1, M2, M4, M5 ou M8.

**D13 — O que o R2-A NÃO toca**

`rotas-publicas.ts`, `buscarExterno.ts`, `logger.ts`, `tempo-real/*`, `listas-fechadas.ts` (nenhum contador ou estado novo), `verificar-schema.mjs` (nenhuma tabela nova) e o embrulho sem transação.

### 10.2 Coordenação com o R2-PG (vai para o documento final do R2-PG e para o ADR 0033)

1. **Dois escritores de `pedidos.pagamento_status = 'estornado'`**:
   - R2-PG: estorno do provedor, quando não resta pagamento `aprovado`;
   - R2-A: estorno total registrado.

   Os dois só saem de `pago`; `estornado` → `estornado` não faz nada. A trilha é `pagamento_estornado` (R2-PG) ou `pedido_status_alterado` (R2-A).
2. **Regra de alerta "aprovado em pedido devolvido"** (`pos-cancelamento-<id>` do R2-PG): **não dispara** para pedido `devolvido` quando a soma de `valor_estorno` das devoluções concluídas e vivas do pedido é maior ou igual à soma dos pagamentos `aprovado` dele. Nesse caso, o estorno já foi registrado fora do provedor, e o alerta mandaria estornar duas vezes.
3. **Seleção de pagamento de origem**: a devolução só lê `pagamentos` (`status IN ('aprovado','estornado')`). O R2-PG não lê `pedidos_devolucoes`, exceto na regra do item 2.
4. **Sem baixa manual** (`pagamentos:marcar_pago` removida): a venda de balcão entra no teto pela marcação "lançado no Masc" (R2-TR-10).

### 10.3 Arquivos de módulos do R1 (um delta por arquivo, aplicado depois que o módulo fechar)

**M1: `src/lib/conversas/saida.ts` [fundir com G10]**

Campos do tipo final usados pelo R2-A:
```ts
  /** Grava NESTA conversa (tem de ser viva, do contato e da integração). Sem ela, vale a regra de mesclagem. */
  conversaId?: string;
  /** `false`: grava sem mudar status, sem somar não lidas e sem `conversa_reaberta` (ADR 0035). Padrão `true`. */
  reabrir?: boolean;
  /** Autor da mensagem. Padrão: o que o M1 já decide para a origem. */
  autorTipo?: "sistema" | "campanha";
```
Regras do corpo do M1:
- Com `conversaId`, confere loja, contato e integração (se falhar, `ErroDeEscopo`).
- Com `reabrir: false`, a mensagem é gravada; `ultima_mensagem_em` e `ultima_mensagem_previa` são atualizadas; `status` e `nao_lidas` não mudam; não há `conversa_reaberta`.
- `autor_tipo = 'sistema'` **não** conta como primeira resposta nem zera SLA.
- O job `mensagens-saida/enviar-mensagem` é enfileirado **depois do commit**.
- O envio de mensagem inexistente (transação desfeita) termina sem erro.

**M1: ingestão (a função que `processadores/mensagens-entrada.ts` chama)**

Para mensagem de **entrada** do contato (não eco, não `deMim`), depois de resolver contato e integração e **antes** de escolher ou reabrir a conversa:
```ts
const pesquisa = await classificarEntradaDePesquisa(tx, { lojaId, contatoId, integracaoId, tipoConteudo, texto, ocorridaEm });
const destino =
  pesquisa.tipo === "nota" ? pesquisa.conversaId
  : pesquisa.tipo === "sair" ? pesquisa.conversaId      // pode ser null → regra normal
  : null;
const semReabrir =
  (pesquisa.tipo === "nota" && !pesquisa.reabrir) || (pesquisa.tipo === "sair" && destino !== null);
// destino !== null → grava a mensagem EM `destino` (em vez da regra de mesclagem).
// semReabrir → sem mudar status, sem somar nao_lidas, sem conversa_reaberta;
//              ultima_entrada_em e ultima_mensagem_* atualizam normalmente.
// senão → fluxo normal (inclui reabrir resolvida).
// ... gravação da mensagem (mensagemId, conversaId) ...
if (pesquisa.tipo !== "nenhuma") {
  await aplicarEntradaDePesquisa(tx, pesquisa, { mensagemId, conversaId, integracaoId, provedor, texto, ocorridaEm }, ctx);
}
```
O `ctx` é `contextoDeSistema(lojaId, "worker")` (G4). O contrato é provado por `tests/integracao/pesquisas-ingestao.test.ts` (A3).

**M2: `@/lib/lgpd`**
- Exportar `optOutVigente(tx: Transacao, contatoId: string): Promise<boolean>`: lê a última linha de `consentimentos` do contato cujo `optOutDe(tipo, concedido)` não é nulo e devolve esse valor (sem linha, `false`), usando `ix_consentimentos_contato`. A materialização de campanha do M6 passa a usar esta função, se hoje tiver SQL próprio.
- `registrarConsentimento` continua sendo a única escrita, com a assinatura que o M2 entregou; no código em construção em 16/09 é `(tx, ctx, novo)`. O A3 usa essa assinatura.
- `anonimizarContato`, no passo dos campos livres: `negocios.observacao_perda = NULL` e `pedidos_devolucoes.motivo_detalhe = NULL` nas linhas do contato, pelo mesmo caminho de mutação que o M2 usa para `pesquisas_satisfacao.comentario`. [fundir com as linhas do R2-C e do R2-D]
- `tests/integracao/lgpd-anonimizacao.test.ts`: cria um negócio perdido com observação e uma devolução com detalhe, e confere que os dois ficam nulos.
- Conferir que o dossiê de `acesso` inclui `negocios`, `pedidos_devolucoes` (com itens) e `pesquisas_satisfacao` (`01-dados-dominio §7.3`).

**M4: `src/lib/pedidos/*` (criação do pedido)**

`negocioId` só é aceito se o negócio estiver vivo, na mesma loja, do mesmo contato e com `estagio IN ESTAGIOS_NEGOCIO_ABERTOS`. Caso contrário: `ErroDeValidacao({ negocioId: ["Este negócio não está aberto para esta cliente."] })`. Ganho ou perdido **não** são aceitos. O movimento para `ganho` grava `negocio_estagio_alterado` e `ultima_atividade_em` na mesma transação.

**M4: `src/app/(app)/conversas/_components/painel-venda.tsx` [fundir com o R2-PG]**

Ao abrir, o painel chama `negocioAbertoDoContato({ contatoId })` (de `@/lib/actions/negocios`). Se houver um negócio aberto:
- acima do resumo, aparece a caixa marcada por padrão "Fechar o negócio aberto como ganho (R$ 350,00 · Negociando)", e `negocioId` é enviado quando ela está marcada;
- o resumo do block de "Fechar venda" ganha a linha "O negócio vai para Ganho."

Sem negócio aberto, nada muda.

**M4: `src/app/(app)/pedidos/[id]/page.tsx` [fundir com o R2-PG]**

Link "Solicitar troca ou devolução" para `/trocas/nova?pedido=<id>`, quando o pedido está `enviado` ou `entregue` e `pode(papel, "devolucoes", "criar")`.

**M8: `src/lib/alertas/fontes-r2.ts` [costura G11]**

Linha do R2-A: `{ tipo: "negocio_parado", candidatos: candidatosDeAlertaDeNegocio }`, com `import { candidatosDeAlertaDeNegocio } from "@/lib/negocios"`.

O gerador, para cada loja viva e cada fonte:
- abre o candidato novo (deduplicado pelo único parcial `(loja_id, chave_deduplicacao) WHERE resolvido_em IS NULL`);
- resolve (`resolvido_em = now()`) o alerta aberto do **mesmo tipo** cuja chave não voltou.

`negocio_parado` entra nos tipos gerados com severidade `alta`.

**M8: roteamento do alerta**

`rotaDoAlerta` recebe `negocioId` e, quando ele existe, devolve `/funil/${negocioId}` antes de conversa, pedido e contato.

**M8: rótulos da trilha em `/auditoria`**

Conferir no código final do M8 que `negocio_alterado`, `pesquisa_enviada` e `pesquisa_respondida` aparecem como "Negócio alterado", "Pesquisa de satisfação enviada" e "Pesquisa de satisfação respondida". O M8 em construção deriva o rótulo por regra genérica; se ele fechar com mapa fechado (`Record<AcaoAuditada, …>`), as três entradas entram no mesmo acréscimo único das ações novas do R2. `pedidos_devolucoes` e `pesquisas_satisfacao` ganham rótulo de entidade ("troca/devolução" e "pesquisa de satisfação") se o mapa de entidades for fechado.

### 10.4 Registro para outros deltas (não é do R2-A)

`buscarExterno`: no redirecionamento para outro host, descartar `authorization`, `access-token` e `x-api-key` (ou recusar redirecionamento em chamada com credencial), com um teste de 302 para host permitido. O R2-A não usa esse caminho; o item fica aqui só para não se perder na consolidação.

---

## 11. ADRs a criar (R2-A = 0031–0035)

- **0031 — Funil com estágios fechados, um negócio aberto por cliente e ganho só pela venda.** Os seis estágios são lista fechada; entre os quatro abertos, o movimento é livre; perder exige motivo; reabrir limpa o motivo. `ganho` só nasce do pedido com `negocio_id` aberto e é terminal: pedido cancelado mostra selo, não desfaz. Um negócio aberto por contato, garantido por índice único parcial. Alerta de negócio parado em 3 dias, um por negócio, resolvido pelo gerador quando a fonte deixa de apontá-lo.
- **0032 — Trocas e devoluções: fluxo por tipo, prazo como aviso e efeitos só com cobertura total.** A solicitação só existe para pedido enviado ou entregue, com teto de quantidade por item e fotos só das enviadas pela cliente. Aprovar, negar e concluir são da gestão, sem mensagem automática. O prazo de 7 dias da loja é aviso (arrependimento e vício são direitos de lei). O pedido vira `devolvido` (sai da reserva e da fila do Masc, contadores descem) só quando tudo voltou. O ajuste no Masc é **confirmado por escrito** na conclusão de devolução ou reembolso de pedido lançado, em vez do alerta previsto em `01-dados-dominio §6.6`, que não teria condição de resolução. Pergunta ao cliente: a "Receita" dos relatórios deve descontar pedido devolvido?
- **0033 — Estorno no R2: registrado na devolução, executado fora e com teto pelo recebido (conjunto R2-A/R2-PG).** O sistema não inicia estorno. Pix, maquininha, crédito na loja ou painel do Mercado Pago acontecem fora; a devolução registra valor, forma e pagamento de origem; o estorno feito no provedor chega ao pedido pelo R2-PG. O teto em centavos, com o pedido travado, é o recebido pelo provedor (aprovado ou já estornado) ou, sem provedor, o total da venda lançada no Masc, menos os estornos já registrados. Como não existe baixa manual, "lançado no Masc" é o único fato de pagamento de balcão. `pagamento_status` vira `estornado` só a partir de `pago`, por qualquer um dos dois caminhos, de forma idempotente. O alerta de pagamento em pedido devolvido não dispara quando o estorno registrado cobre o pagamento.
- **0034 — Pesquisa de satisfação automática, conservadora e desligada por padrão.** Dispara para conversa resolvida (30 min a 12 h) ou pedido entregue (30 min a 72 h), pela conta de entrada e só em WhatsApp oficial, uazapi e Instagram (Facebook e TikTok ficam de fora até o cliente pedir). Exige janela de 23 h, horário comercial, no máximo uma vez a cada 30 dias por cliente, sem opt-out. Não há modelo da Meta, envio manual, lembrete nem alerta de nota baixa. Resposta = dígito de 1 a 5 isolado em 24 h (só a primeira vale); comentário em até 30 min. SAIR e variações de uma lista fechada, por 30 dias depois de qualquer pesquisa, registram opt-out de marketing **da loja** pela porta única de consentimento e nunca viram comentário; toda resposta vai para a trilha. Perguntas ao cliente: aprovar o texto; propagar o opt-out para as outras lojas da marca (hoje não, DN-05); criar palavra-chave de opt-out fora da pesquisa (hoje não).
- **0035 — Resposta de pesquisa não reabre a conversa (exceção à regra de reabertura).** Nota de 3 a 5 e SAIR são gravados na conversa da pesquisa sem mudar o status, sem somar não lidas e sem disparar SLA, para a pesquisa não encher a caixa de entrada. Nota de 1 a 2, comentário e qualquer outra mensagem reabrem pelo fluxo normal, porque aí existe alguém para atender. A decisão vive numa costura única, chamada pela ingestão antes de escolher a conversa. Os envios automáticos de agradecimento e confirmação rodam em savepoint e nunca derrubam a ingestão.

---

## 12. Problemas rejeitados (total ou parcialmente)

| Crítica | Decisão | Motivo |
|---|---|---|
| "Tornar `loja` obrigatória no schema" (escritas) | **Rejeitado em parte**: `loja: "grava"` foi adotado; o campo continua `optional()` no Zod | Com o campo obrigatório, a ausência vira `VALIDACAO` ("Identificador inválido") e nunca `FALTA_LOJA`, que é o contrato da base (INV-05) e o teste que a própria crítica pede. Vendedor e viewer não precisam do campo (é ignorado). A garantia de que a tela manda a loja é o teste de componente e a trava de fonte |
| "SAIR pela palavra-chave global de opt-out do M2" | **Rejeitado em parte**: foi adotada a alternativa "qualquer pesquisa do contato nos últimos 30 dias" | Não existe palavra-chave global no R1 (M1/M2), e criar uma muda o comportamento de campanhas e de toda conversa. É pergunta aberta ao cliente (levantamento 02, pergunta 4). Registrado no ADR 0034. Os 30 dias coincidem com o limite de envio: toda promessa feita por uma pesquisa fica coberta até a próxima poder existir |
| "Propagar o opt-out para os contatos com o mesmo telefone nas outras lojas" | **Rejeitado**; a microcopia com escopo explícito foi adotada | Contato e consentimento são por loja (DN-05, `uq_contatos_telefone` por loja). Propagar exige decisão do cliente e mudaria a regra do M2 para todas as origens. O texto passou a dizer "a {marca} {loja}". Pergunta registrada no ADR 0034 |
| "Pasta `src/lib/db/mutacoes/` com `index.ts`" | **Rejeitado em parte**: a pasta foi adotada, **sem** `index.ts` | Com `mutacoes.ts` e `mutacoes/index.ts` juntos, `@/lib/db/mutacoes` resolve para o arquivo e o `index.ts` vira um segundo ponto de entrada que ninguém usa, mas alguém edita. Um reexportador só |
| "Rótulos da trilha: o mapa do M8 é `Record<AcaoAuditada, …>` e o build quebra" | **Ajustado** | O M8 em construção deriva o rótulo por regra genérica. O delta manda conferir e, se o mapa final for fechado, acrescentar as três entradas no acréscimo único |
| `negocioContinuaParado` (rascunho) | **Removido** | Com a costura de fontes (G11), o gerador resolve o alerta cuja chave não voltou. A segunda função seria uma segunda fonte da mesma regra |
| `ESTADOS_DE_SISTEMA.pesquisas_satisfacao` e a escrita de `mensagem_id` depois do insert (rascunho D3) | **Removido** | `registrarEnvio` roda antes do `inserirAuditado`, então a linha já nasce com `mensagem_id`. Não é preciso abrir uma exceção de máquina de estados |
| Arquivos comuns aos três subpacotes (`docs/modulos/pos-venda.md`, trava e block compartilhados) | **Removido** | Três agentes gravando o mesmo arquivo quebra o contrato de paralelismo. Agora cada subpacote tem o seu doc, a sua trava e o seu teste de block |
