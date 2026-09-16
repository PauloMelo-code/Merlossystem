# ADR 0004 — Fontes da verdade: Masc vende, Bling controla estoque

- **Status**: Substituído por ADR-0008..0024 (reconstrução na branch `refactor/reconstrucao-estrutura-base`)
- **Data**: 17/08/2026
- **Decide**: a decisao 8 de [../integracoes.md](../integracoes.md), que bloqueava a etapa 8

## Contexto

A etapa 8 estava escrita como "escrita no Bling (pedido/estoque) e eventual
integracao com o Masc". Ela ficou bloqueada desde o inicio por uma pergunta sem
resposta: **quem e o dono da verdade de produto, estoque e pedido?**

A Merlo Store opera em tres sistemas ao mesmo tempo:

| Sistema | O que e |
|---------|---------|
| **Masc** | ERP/PDV de varejo de moda. A venda da loja fisica acontece aqui |
| **Bling** | ERP. Conta unica da rede; a separacao Centro / Cerro Azul e por deposito |
| **este sistema** | atendimento por WhatsApp/Instagram/TikTok + CRM + pedidos do canal |

## Decisao

O cliente respondeu:

> O Masc e o dono da venda, nao escreve estoque, ele e vinculado com Bling para
> estoque.

Disso decorre o desenho, e ele nao e negociavel por conveniencia de
implementacao:

| Dado | Dono da verdade | Este sistema |
|------|-----------------|--------------|
| **Venda / pedido** | **Masc** | registra o pedido do canal e acompanha ate ser lancado no Masc |
| **Estoque** | **Bling** (alimentado pelo vinculo Masc -> Bling) | **le**, nunca escreve |
| **Produto / preco** | Bling | le |
| **Conversa, contato, atendimento** | **este sistema** | dono |

### Consequencia direta: este sistema NAO escreve no ERP

Nem pedido, nem estoque, nem produto. Nao e cautela temporaria a espera de mais
informacao — e a consequencia de haver um dono definido para cada dado.

O motivo em uma frase: **a peca na prateleira e uma so**. Se a venda do WhatsApp
baixar estoque no Bling e a mesma venda for lancada no Masc (que baixa o Bling
pelo vinculo), a mesma peca sai duas vezes do saldo. Dois donos do mesmo numero
nao e configuracao, e contradicao.

O mesmo vale ao contrario: criar o pedido de venda no Bling duplicaria a venda
que o Masc e dono de registrar — com efeito fiscal, nao so de estoque.

### O que este sistema faz no lugar

1. **Le o saldo do Bling por deposito** e mostra no atendimento, para a vendedora
   nao prometer o que nao existe.

   O vinculo Masc -> Bling e **em tempo real** (Paulo, 17/08/2026). Isso importa
   mais do que parece: significa que o saldo do Bling ja reflete a venda da loja
   fisica no instante em que ela acontece, entao o numero que mostramos e
   confiavel na hora do atendimento — nao e um saldo do fechamento do caixa de
   ontem. Se o vinculo fosse em lote, tudo o que mostrassemos durante o dia
   estaria velho, e a vendedora nao poderia confiar.
2. **Registra o pedido do canal** como pedido deste sistema, com identidade
   propria e rastreavel.
3. **Acompanha o lancamento no Masc**: cada pedido de canal fica pendente ate
   alguem lancar a venda no Masc e anotar o numero. O que fecha o ciclo e uma
   pessoa, nao uma API.

O passo 3 e uma ponte operacional, nao uma integracao: **nao ha evidencia de que
o Masc tenha API publica** (ver "Riscos" abaixo). Assumir que tem seria projetar
sobre suposicao.

## A unica janela de furo que sobra

Com o vinculo em tempo real, todo caminho que consome estoque chega ao Bling na
hora — **menos um**:

| Caminho | Chega ao Bling | Demora |
|---------|----------------|--------|
| Venda da loja fisica | Masc -> Bling | tempo real |
| Venda do canal **ja lancada** no Masc | Masc -> Bling | tempo real |
| **Venda do canal ainda pendente de lancamento** | **nao chegou** | **ate alguem lancar** |

Ou seja: a janela de oversell e exatamente **o tempo que um pedido fica
`masc_status = 'pendente'`**. Enquanto ele espera, o Bling ainda conta aquela
peca como disponivel, e tanto a loja fisica quanto outro atendimento do canal
podem prometer a mesma peca.

Exemplo: VLC-001 tam M com 1 peca no deposito Centro. As 10h00 a vendedora do
WhatsApp fecha a venda — nosso pedido nasce `pendente`, e o Bling continua
dizendo 1. As 10h05 a loja fisica vende a mesma peca no Masc, e o Bling vai a 0
na hora. As 10h30 alguem lanca o pedido do WhatsApp no Masc: estoque negativo, e
uma das duas clientes vai receber um telefonema.

**Consequencia de desenho**: a fila "falta lancar no Masc" nao e burocracia de
conferencia — e o controle de oversell. Quanto menor o tempo de espera, menor a
janela. Por isso a fila e consultavel (`GET /api/orders?masc=pendente`),
indexada, e o que ja foi prometido e descontado do saldo mostrado (ver
"disponivel para prometer" em [../api.md](../api.md)).

## Alternativas descartadas

**Escrever o pedido no Bling e deixar o Masc so para a loja fisica.**
Descartada: o cliente disse que o Masc e o dono da venda. Dois sistemas criando
pedido na mesma conta do Bling geram duplicata sem defesa possivel — a API v3
**nao tem idempotencia** (nenhum header de idempotencia em nenhum dos 162
caminhos da collection oficial, nenhum `409` declarado), entao nem retry seguro
existe.

**Espelhar o estoque local e reconciliar depois.**
Descartada por ora: reconciliacao entre tres numeros (nosso, Bling, prateleira)
sem chave de correlacao nao converge. `products.stock` continua existindo como
catalogo local, mas **nao e verdade de estoque** — quem responde isso e o Bling.

**Integrar direto com o Masc.**
Nao descartada, mas nao planejavel hoje: depende de o fornecedor liberar API.
Fica como pergunta aberta, nao como etapa.

## Riscos e o que ainda nao se sabe

- **O Masc tem modulo proprio de sincronizacao com canais.** O fornecedor
  (Informezz) anuncia "integracao com marketplaces de moda" com "sincronizacao
  de estoque, precos e pedidos". Se esse modulo estiver ativo na Merlo, ha um
  segundo sistema mexendo no estoque antes mesmo deste. **Verificar antes de
  qualquer automacao.**
- **Nao ha documentacao publica de API do Masc**, nem evidencia de integracao
  nativa Masc <-> Bling na Central de Extensoes do Bling. O vinculo existe e e
  **em tempo real** (Paulo, 17/08/2026), mas o mecanismo nao foi verificado.
- **`stores.bling_deposito_id` esta nulo nas duas lojas.** Sem o de-para
  preenchido, a leitura de saldo responde `409` — de proposito, porque saldo do
  deposito errado e pior do que saldo nenhum.

## Como isto e travado no codigo

- `src/lib/bling/cliente.ts` nao tem metodo de escrita, e `tests/bling.test.ts`
  falha se aparecer um: sem `PUT`/`PATCH`/`DELETE`, e exatamente dois `POST`
  (os dois do OAuth).
- O saldo e lido por deposito (`GET /estoques/saldos/{idDeposito}`), e o teste
  trava que o total da rede (`saldoFisicoTotal`) nao seja usado no lugar do
  saldo do deposito.

Quem quiser ligar escrita no ERP quebra esses testes. Isso e proposital: a
conversa tem que acontecer antes do merge, e este ADR e o lugar de registrar a
mudanca de decisao.
