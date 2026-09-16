# Módulo de catálogo e pedidos (pacote M4)

Espelho do Bling (somente leitura), disponibilidade calculada, pedido com
numeração atômica e a ponte manual com o Masc. Fontes: `01-dados-dominio.md
§4, §6`, `03-arquitetura.md §12.1`, `04-ui.md §5.2, §5.3`, ADR 0015 e 0019.

## Onde mora

| Caminho | Papel |
|---|---|
| `src/lib/integracoes/bling/config.ts` | URL da API v3, balde de 3 req/s por conta, cache de 60 s, chave `access_token` do cofre |
| `src/lib/integracoes/bling/cliente.ts` | `contaBling()` (conta da rede, credencial do cofre) e `lerDoBling()` — único `GET` ao Bling, via `buscarExterno`, depois de consumir o balde |
| `src/lib/integracoes/bling/leitura.ts` | `listarProdutos`, `detalharProduto`, `lerSaldos`, `listarDepositos` com Zod tolerante |
| `src/lib/integracoes/bling/depositos.ts` | **costura** para o M5: `listarDepositosBling(): Promise<DepositoBling[]>` (`{ id, descricao, padrao, ativo }`), só `GET /depositos`, sem cache |
| `src/lib/integracoes/bling/cache.ts` | `saldosNoDeposito()` — 60 s por depósito, single-flight, última leitura quando o Bling falha |
| `src/lib/catalogo/_regras.ts` | grade, tamanho do rótulo do Bling, `itemReserva`, `reservadoDe`, `disponivelDe`, `leituraAntiga`. Puro |
| `src/lib/catalogo/_cursor.ts` | cursor `(created_at, id)` das listas de produtos e pedidos |
| `src/lib/catalogo/_consultas.ts` | leituras do catálogo e da reserva |
| `src/lib/catalogo/disponibilidade.ts` | **costura**: `calcularDisponivel(lojaId, sku)` e `calcularDisponiveis(lojaId, skus)` |
| `src/lib/catalogo/sincronizacao.ts` | `sincronizarCatalogoBling({ integracaoId, lojaId? })`, chamado pelo processador `integracoes/sincronizar-bling` (M5) |
| `src/lib/pedidos/_regras.ts` | `anoMesDaVenda` (fuso de São Paulo), `numeroDoPedido`, `calcularTotais`, `pedidoEncerrado`. Puro |
| `src/lib/pedidos/_consultas.ts` | lista, fila do Masc, detalhe, linha do tempo, pedidos do contato |
| `src/lib/pedidos/criacao.ts` | `criarPedido()` — "Fechar venda" |
| `src/lib/pedidos/operacao.ts` | Masc (lançar, dispensar, voltar para a fila), status, rastreio, cancelamento |
| `src/lib/actions/catalogo.ts` | `listarProdutos`, `verProduto`, `buscarProdutosParaVenda`, `produtoParaVenda` (todas de leitura) |
| `src/lib/actions/pedidos.ts` | `listarPedidos`, `verPedido`, `listarPedidosDoContato`, `fecharVenda`, `lancarNoMasc`, `dispensarDoMasc`, `voltarParaFilaMasc`, `cancelarPedido`, `mudarStatusDoPedido`, `salvarRastreio` |
| `src/lib/validadores/{catalogo,pedidos}.ts` | entradas e filtros da URL; `STATUS_OPERACIONAIS` e `REGEX_VENDA_MASC` |
| `src/app/(app)/produtos/` | `/produtos` e `/produtos/[id]` (somente leitura) |
| `src/app/(app)/pedidos/` | `/pedidos` (fila do Masc) e `/pedidos/[id]`; `_components/nova-venda.tsx` |
| `src/app/(app)/conversas/_components/painel-venda.tsx` | **costura**: seção "Pedidos" do painel do contato + "Nova venda" (componente de servidor) |
| `src/app/(app)/conversas/_components/seletor-produto.tsx` | **costura**: busca de produto; `onEscolher(sku)`, `lojaId` opcional para gestão |

As telas leem pelas actions (página não importa domínio, `03-arquitetura.md
§4.1`); cada leitura reaplica o portão.

## Permissões

| Ação | Chave | Papéis |
|---|---|---|
| ver catálogo, saldo, pedidos e linha do tempo | `produtos:ler`, `pedidos:ler` | todos |
| ver custo do produto | `produtos:ver_custo` | dono, admin, gerente |
| fechar venda (block 3 s) | `pedidos:criar` | dono, admin, gerente, vendedor |
| status e rastreio | `pedidos:editar` | dono, admin, gerente, vendedor |
| lançar no Masc (block 3 s) e voltar para a fila | `pedidos:lancar_masc` | dono, admin, gerente, vendedor |
| dispensar do Masc (block 3 s) | `pedidos:dispensar_masc` | dono, admin, gerente |
| cancelar (block 3 s) | `pedidos:cancelar` | dono, admin, gerente |

Não existe `produtos:criar|editar|excluir`: o catálogo só muda pela sincronização.

## Regras

**Disponibilidade** — `saldo do depósito da loja no Bling − reservado`, nunca
negativa, calculada a cada pergunta e nunca gravada. Reserva = itens de pedido
vivo com `masc_status = 'pendente'` e `status` fora de `cancelado`/`devolvido`,
casados por SKU; item sem SKU não desconta. O SKU do item é o da variação ou,
sem ele, o do produto (a reserva degrada para o nível do produto). Saldo
desconhecido (loja sem depósito, SKU sem id do Bling, Bling fora do ar) é
`null` e a tela mostra "Não sabemos". Leitura com mais de 5 minutos aparece
como "Leitura antiga".

**Bling** — somente `GET` (trava T26). O balde de 3 req/s por conta
(`limite:bling:<integracaoId>`) é o mesmo para a tela e para o job. Resposta
401/403/4xx é erro permanente (a fila não insiste); 429/5xx é temporário.

**Sincronização** — casa `codigo` do Bling com `produtos.sku`, em cada loja com
`bling_deposito_id`. Produto sem `codigo` é ignorado. Variações viram tamanhos
da grade (`Tamanho:P;Cor:Azul` → `P`; tamanho fora da grade é ignorado; dois
registros no mesmo tamanho: vale o primeiro). Sem variação reconhecível, cria a
grade `ambos` com SKU nulo. Só grava o que mudou; preço diferente registra
`produto_preco_alterado`, o resto `produto_sincronizado`. Grava com
`contextoDeSistema({ origem: "worker", lojaId })` (ADR 0031): `modified_by` e
`ator_id` recebem o `ATOR_SISTEMA`, com `ator_tipo = 'sistema'`. Produto que
some do Bling não é excluído. Ao terminar, carimba
`lojas_integracoes.ultima_sincronizacao` (ou `ultimo_erro`) com o contexto de
sistema de escopo `todas` (a conta é da rede). O agendador
`sincronizar-bling-hora` roda o job de hora em hora (minuto 17).

**Numeração** — `MS{AAMM}-{SIGLA}-{NNNN}`, `AAMM` no fuso `America/Sao_Paulo`,
sigla cadastrada da loja, contador de `proximoNumeroDePedido()` na mesma
transação do pedido (o rollback devolve o número: sem buraco).

**Fechar venda** — o cliente manda variação e quantidade; nome e preço vêm do
catálogo no servidor. Totais em centavos (`total = subtotal + frete −
desconto`, desconto ≤ subtotal). O pedido nasce `confirmado` e `pendente` no
Masc. Na mesma transação: itens, negócio para `ganho` (quando há
`negocio_id`), `contatos.pedidos_contagem +1`, `pedidos_valor_total + total` e
`ultima_compra_em`.

**Masc** — lançar exige o número da venda (único por loja; repetido vira erro
de validação, em savepoint). Dispensar exige observação e pedido na fila.
Voltar para a fila preserva `masc_venda_id`, `masc_lancado_em` e
`masc_lancado_por`. Pedido cancelado ou devolvido não entra nem volta.

**Andamento** — status escolhível: `confirmado`, `preparando`, `enviado`,
`entregue` (`devolvido` só pela devolução, fora do R1). Pedido cancelado ou
devolvido não muda mais. Rastreio aceita só link `https://` e grava a ação
`pedido_rastreio_informado` ("Rastreio informado" na linha do tempo).

**Cancelar** — motivo obrigatório, grava `cancelado_em` e `cancelado_motivo`,
sai da reserva e da fila pelo filtro de `status`, e devolve os contadores do
contato (mesma regra da devolução concluída, `01-dados-dominio.md §6.6`).

**Trilha antes do efeito** — cancelar e dispensar do Masc chamam
`atualizarComTrava(..., { trilhaAntes: true, motivo })` (`01-dados.md §7.4`):
a linha da trilha é gravada antes do UPDATE, com o motivo (ou a observação da
dispensa) na coluna `motivo`. Se o UPDATE colidir, a transação volta atrás e a
linha da trilha vai junto.

Toda escrita usa `atualizarComTrava()` com o `updated_at` que a tela levou;
cada action devolve o `updated_at` novo.

## Decisões e pendências

- **Saldo** vem de `GET /estoques/saldos/{idDeposito}?idsProdutos[]=…`, campo
  `saldoFisicoTotal`. Conferir contra a documentação vigente da API v3.
- **Depósitos** vêm de `GET /depositos?pagina=N&limite=100`, campos `id`,
  `descricao`, `situacao` (0 = inativo; ausente conta como ativo) e `padrao`.
  Conferir contra a documentação vigente da API v3.
- **Categorias** do Bling não são importadas (`categoria_id` fica nulo).
- **Cache** de saldo é por processo (app e worker separados); o limitador é
  compartilhado no Redis.

## Testes

| Arquivo | O que prova |
|---|---|
| `tests/unidade/disponibilidade.test.ts` | cancelado/devolvido/lançado não reservam; sem SKU não desconta; nunca negativo; `null` nunca vira zero; grade |
| `tests/unidade/numeracao.test.ts` | 100 transações concorrentes → 1..100 sem repetir; rollback não deixa buraco; CHECKs do contador (Postgres; pulado sem `DATABASE_URL_TESTE`) |
| `tests/unidade/pedidos-regras.test.ts` | ano-mês em São Paulo (venda das 21h do último dia), número, totais, validadores |
| `tests/unidade/catalogo-cache-bling.test.ts` | cache de 60 s por depósito, single-flight, falha do Bling |
| `tests/unidade/catalogo-cliente-bling.test.ts` | só GET, balde da conta antes de sair, erro permanente × temporário, leitura de depósitos |
| `tests/integracao/pedidos-fluxo.test.ts` | fechar venda, negócio → ganho, CHECKs `pedidos_total_coerente` e `itens_total_coerente`, Masc, cancelamento, trilha antes do efeito com motivo (e sem trilha na colisão), `pedido_rastreio_informado`, escopo, índice parcial da fila |
| `tests/integracao/catalogo-disponibilidade.test.ts` | fórmula no banco, loja sem depósito, SKU de outra loja |
| `tests/integracao/catalogo-sincronizacao.test.ts` | criação, grade, idempotência, `produto_preco_alterado`, `ATOR_SISTEMA` na trilha e em `modified_by`, conta errada |
| `tests/componentes/pedidos-acoes.test.tsx` | block de 3 s no Masc e no cancelamento, erro mantém o modal, estados do seletor |
| `tests/travas/bling-somente-leitura.test.ts` (fundação) | T26 sobre `src/lib/integracoes/bling/` |

```
node scripts/db-teste.mjs --sufixo m4
DATABASE_URL_TESTE=postgres://…/merlostore_test_m4 REDIS_URL=redis://localhost:6382/4 npm run test:integracao
# (mais as variáveis obrigatórias de src/lib/env.ts, com valores fictícios)
```
