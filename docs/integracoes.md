# Integracoes multi-loja — especificacao

Briefing para implementar **Bling, TikTok Shop, Instagram e WhatsApp (uazapi)**
com credencial propria por loja e acesso de vendedor restrito a sua loja.

> [!IMPORTANT]
> Este documento e especificacao, nao descricao. Nada aqui existe no codigo
> ainda. O que existe hoje esta na secao "Ponto de partida".

---

## Ponto de partida (estado real em 17/08/2026)

Levantado lendo `prisma/schema.prisma`, `src/lib/channels/` e `src/lib/auth.ts`.

| Item | Hoje | O que a demanda exige |
|------|------|----------------------|
| Multi-loja | **nao existe** — nenhum dos 24 models tem `storeId` | toda tabela operacional passa a pertencer a uma loja |
| Credenciais de canal | `process.env` global (`getConfig()` em `src/lib/channels/whatsapp.ts`) — **uma credencial por instalacao** | uma credencial por loja, guardada no banco e cifrada |
| WhatsApp | Meta Cloud API (`graph.facebook.com/v21.0`) | **uazapi** (API nao-oficial, por instancia) — adapter novo, nao substituicao direta |
| Instagram | adapter de mensagens ja existe, com token global | token por loja |
| TikTok | adapter de **mensagens** (`src/lib/channels/tiktok.ts`) | TikTok **Shop** e outra API (e-commerce: pedidos, produtos, estoque) — integracao nova, nao e o mesmo TikTok |
| Bling | **nao existe** | ERP: produtos, estoque, pedidos, notas |
| Papel do usuario | global (`User.role`: admin/agent/viewer), aplicado no middleware | papel **por loja** |
| Webhooks | uma rota por canal, sem saber de qual loja veio | rota precisa resolver a loja |

**Consequencia:** isto nao e "configurar integracoes". E introduzir multi-tenancy
num sistema que nasceu single-tenant, e as integracoes vem em cima disso. A
ordem importa — fazer integracao antes de loja significa refazer depois.

---

## As lojas

Duas unidades fisicas, definidas pelo cliente:

| Loja | Slug sugerido |
|------|---------------|
| Centro | `centro` |
| Cerro Azul | `cerro-azul` |

O desenho continua suportando a terceira loja sem mudanca de schema — o que
esta fixado e a **cardinalidade**, nao a quantidade.

## Decisoes

### Respondidas

1. **Um vendedor atende uma loja so.** (Paulo, 17/08/2026)

   Isso derruba a tabela de vinculo: o vendedor carrega a loja no proprio
   cadastro (`users.store_id`). Modelo mais simples, JWT mais simples, filtro de
   query mais simples.

   A excecao sao **admin e gerente** (item 2), que enxergam as duas lojas: para
   eles `store_id` fica nulo. Ou seja, `store_id` nulo significa "nao pertence a
   uma loja, alcanca todas", e so papel de gestao pode te-lo — com constraint no
   banco garantindo isso.

2. **Admin e gerente veem as duas lojas.** (Paulo, 17/08/2026)

   Entra um papel novo, `gerente`, que nao existe hoje no sistema (`User.role`
   hoje aceita `admin`, `agent` e `viewer`). O desenho fica:

   | Papel | `store_id` | Alcance |
   |-------|-----------|---------|
   | `admin` | nulo | as duas lojas, tudo |
   | `gerente` | nulo | as duas lojas, tudo menos configuracao e usuario (item 7) |
   | `vendedor` | obrigatorio | so a loja dele (hoje chamado `agent`) |
   | `viewer` | obrigatorio | leitura da loja dele |

   `store_id` nulo passa a significar "papel de gestao": e por isso que a
   constraint do banco aceita nulo para `admin` e `gerente`, e exige loja para
   `vendedor` e `viewer`.

3. **Cada loja tem seus numeros de WhatsApp — no plural.** (Paulo, 17/08/2026)

   Isso derruba a regra de "uma integracao por (loja, provedor)": no WhatsApp e
   **N instancias por loja**, cada uma com numero, token e webhook proprios. Tem
   duas consequencias que nao sao obvias:

   - **A conversa precisa saber por qual numero entrou.** Sem isso, a resposta
     sai pelo numero errado — a cliente escreve para o Cerro Azul e recebe
     resposta do Centro. `conversations` ganha o vinculo com a instancia.
   - **Enviar deixa de ser `getAdapter(canal)`** e passa a ser
     `getAdapter(canal, instancia)`: o adapter precisa das credenciais daquele
     numero, nao das da loja.

4. **Os dados de hoje sao mock.** (Paulo, 17/08/2026)

   `prisma/seed.ts` (225 linhas) cria usuarios, produtos, contatos e conversas
   de exemplo. Backfill vira **limpar e resemear** com as duas lojas — nao ha
   historico real a preservar. Some a etapa mais chata da migracao.

5. **Contato e isolado por loja.** (Paulo, 17/08/2026)

   Cada loja tem a propria carteira. A mesma pessoa escrevendo para o Centro e
   para o Cerro Azul vira **dois contatos**, e isso e o comportamento desejado —
   nao e duplicata para corrigir, e a tela nao deve sugerir merge.

   Tres consequencias, detalhadas em "Isolamento de contato" abaixo: a chave de
   deduplicacao passa a ser por loja, o gateway de mensagem precisa saber a loja
   antes de procurar o contato, e a exclusao LGPD deixa de ser global.

6. **Bling e uma conta unica, com deposito por loja.** (Paulo, 17/08/2026)

   Quebra a simetria "uma credencial por loja": o Bling e **da rede**, nao da
   loja. A separacao entre Centro e Cerro Azul acontece **dentro** do Bling, por
   deposito.

   Consequencias:
   - a credencial do Bling e uma so, com `store_id` nulo em `stores_integracoes`
     (mesma convencao de `users`: nulo = alcanca todas);
   - `stores` ganha `bling_deposito_id` — o de-para entre loja daqui e deposito
     de la;
   - estoque lido do Bling vem por deposito e cai na loja correspondente;
   - pedido enviado ao Bling precisa carregar o deposito da loja de origem,
     senao baixa estoque da loja errada.

7. **`gerente` pode tudo, menos configuracao e usuario.** (Paulo, 17/08/2026)

   Ou seja: `gerente` **nao** e um `viewer` com alcance maior — ele opera. Cria,
   edita e exclui em qualquer dominio de negocio das duas lojas. O que fica de
   fora sao duas areas, e so elas:

   | Area | Exemplos | Quem |
   |------|----------|------|
   | **Configuracao** | conectar/desconectar integracao, cadastrar loja, regra de SLA, automacao, canal | so `admin` |
   | **Usuario** | criar, editar, desativar, trocar papel | so `admin` |
   | Todo o resto | conversa, pedido, produto, contato, devolucao, midia, campanha, LGPD, trilha de auditoria | `admin` e `gerente` |

   Duas leituras que nao sao obvias e ficam registradas para nao virar discussao
   na implementacao:

   - **LGPD nao e configuracao.** Exportar e apagar dados de cliente e operacao
     de atendimento, entao `gerente` pode — inclusive `DELETE /api/lgpd`. O
     fato de a tela morar em `/settings/lgpd` nao muda isso: quem define a
     permissao e o recurso, nao a pasta onde a tela ficou.
   - **Trilha de auditoria `gerente` le.** E papel de gestao acompanhar o que a
     equipe fez. Escrever na trilha continua sendo do sistema.

### Respondida na etapa 8

8. ~~**O que e o Masc, e qual o papel dele?**~~ **RESPONDIDA por Paulo em
   17/08/2026** — registrada em [adr/0004-fontes-da-verdade.md](adr/0004-fontes-da-verdade.md).

   > O Masc e o dono da venda, nao escreve estoque, ele e vinculado com Bling
   > para estoque.

   | Dado | Dono da verdade | Este sistema |
   |------|-----------------|--------------|
   | Venda / pedido | **Masc** | registra o pedido do canal e acompanha ate ser lancado la |
   | Estoque | **Bling** (alimentado pelo vinculo Masc -> Bling) | **le**, nunca escreve |
   | Produto / preco | Bling | le |
   | Conversa, contato, atendimento | **este sistema** | dono |

   **Consequencia: este sistema NAO escreve no ERP** — nem pedido, nem estoque.
   A peca na prateleira e uma so: se a venda do WhatsApp baixar estoque no Bling
   e a mesma venda for lancada no Masc (que baixa o Bling pelo vinculo), a peca
   sai duas vezes do saldo. Dois donos do mesmo numero nao e configuracao, e
   contradicao.

   O que ficou aberto, e **nao bloqueia codigo**:

   - o Masc tem modulo proprio de sincronizacao com canais (o fornecedor,
     Informezz, anuncia "sincronizacao de estoque, precos e pedidos"). Se
     estiver ativo na Merlo, ha um segundo sistema mexendo no estoque —
     **verificar antes de qualquer automacao**;
   - **como** e o vinculo Masc <-> Bling (automatico? arquivo? digitacao?). Nao
     ha documentacao publica de API do Masc nem mencao a ele na Central de
     Extensoes do Bling. Isso muda o desenho da ponte, nao a decisao.

---

## Modelo de dados

### Novas tabelas

```
stores                      loja / unidade de negocio (Centro, Cerro Azul)
stores_integracoes          credencial de UMA conta/numero de um provedor
integracoes_eventos         log de sincronizacao (append-only)
```

Nao ha tabela de vinculo usuario-loja: como o vendedor atende uma loja so
(decisao 1), o vinculo e uma coluna em `users`.

`stores_integracoes` guarda **uma linha por conta conectada**, nao por provedor:
a loja do Centro com dois numeros de WhatsApp tem duas linhas de `uazapi`
(decisao 3).

Esqueleto (Drizzle — codigo novo nasce em Drizzle, ver ADR-0002):

```typescript
// src/lib/db/schema/stores.ts
export const stores = pgTable("stores", {
  id: uuid("id").primaryKey().defaultRandom(),
  nome: text("nome").notNull(),
  slug: text("slug").notNull().unique(),        // usado na URL do webhook
  ativo: boolean("ativo").notNull().default(true),
  // De-para com o Bling: a conta e unica da rede, a separacao la e por
  // deposito (decisao 6). Sem isto, o pedido baixa estoque da loja errada.
  bling_deposito_id: text("bling_deposito_id"),

  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
  deleted_at: timestamp("deleted_at"),
  is_deleted: boolean("is_deleted").notNull().default(false),
  modified_by: uuid("modified_by").notNull(),
});

// users ganha a loja. NULL so vale para papel de gestao (admin, gerente).
// A constraint mora no banco, porque "so gestao fica sem loja" nao pode
// depender de a aplicacao lembrar:
//
//   ALTER TABLE users ADD CONSTRAINT users_loja_por_papel
//     CHECK ((role IN ('admin','gerente') AND store_id IS NULL)
//         OR (role IN ('vendedor','viewer') AND store_id IS NOT NULL));

// src/lib/db/schema/stores-integracoes.ts
export const storesIntegracoes = pgTable("stores_integracoes", {
  id: uuid("id").primaryKey().defaultRandom(),
  // NULL = integracao da rede, nao de uma loja (hoje so o Bling, decisao 6).
  // Mesma convencao de users.store_id: nulo alcanca todas.
  store_id: uuid("store_id")
    .references(() => stores.id, { onDelete: "restrict" }),
  provedor: text("provedor").notNull(),         // bling | tiktok_shop | instagram | uazapi
  // Nome que o operador ve: "WhatsApp Vendas Centro", "WhatsApp SAC Centro".
  // Com varios numeros por loja, sem rotulo ninguem sabe qual e qual.
  rotulo: text("rotulo").notNull(),
  status: text("status").notNull().default("desconectado"),
                                                // desconectado | conectado | expirado | erro
  // NUNCA em texto plano. AES-256-GCM, chave em INTEGRATIONS_KEY.
  credenciais_cifradas: text("credenciais_cifradas"),
  // Identificador NAO-secreto da conta no provedor, e a chave de roteamento do
  // webhook de entrada: numero/instancia (uazapi), id da conta (Instagram),
  // shop id (TikTok Shop), id da empresa (Bling).
  referencia_externa: text("referencia_externa").notNull(),
  expira_em: timestamp("expira_em"),            // token com validade
  ultimo_erro: text("ultimo_erro"),
  ultima_sincronizacao: timestamp("ultima_sincronizacao"),

  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
  deleted_at: timestamp("deleted_at"),
  is_deleted: boolean("is_deleted").notNull().default(false),
  modified_by: uuid("modified_by").notNull(),
});
```

Restricoes:

- **Nao ha unicidade por (loja, provedor)** — uma loja tem varios numeros de
  WhatsApp (decisao 3).
- Unico ativo por **conta**: indice unico parcial em
  `(provedor, referencia_externa)` onde `is_deleted = false`. O mesmo numero nao
  pode estar conectado em duas lojas ao mesmo tempo — senao a mensagem que
  chega nao tem dono definido.
- Indice de roteamento em `(provedor, referencia_externa)`: e a busca que roda
  em **todo** webhook recebido.
- **Bling tem `store_id` nulo** (conta unica da rede, decisao 6). A loja entra
  na conta pelo `bling_deposito_id` de `stores`, nao por credencial separada.
- Para TikTok Shop, "uma por loja" e regra de aplicacao, nao de banco — se
  amanha a loja tiver duas contas, o schema aguenta.

### Tabelas existentes

Ganham `store_id NOT NULL` (FK `restrict`): `contacts`, `conversations`,
`messages`, `products`, `deals`, `orders`, `returns`, `media_files`,
`lookbooks`, `broadcasts`, `scheduled_messages`, `whatsapp_templates`,
`quick_replies`, `knowledge_articles`, `alerts`, `satisfaction_surveys`,
`consent_logs`, `activity_logs`.

`users` ganha `store_id` **nullable** (nulo = admin ou gerente, alcanca todas).

`conversations` ganha tambem **`store_integracao_id`** (FK `restrict`): por qual
conta/numero a conversa entrou. Sem essa coluna nao da para responder pelo mesmo
numero que a cliente procurou — e com dois numeros na mesma loja o erro nao e
teorico. `channel` continua existindo (whatsapp/instagram/...), mas quem manda
no envio e a integracao.

Migracao — os dados sao mock (decisao 4), entao nao precisa de rito de
zero-downtime:
1. cria `stores` com Centro e Cerro Azul;
2. limpa as tabelas operacionais e adiciona `store_id NOT NULL` de uma vez;
3. reescreve `prisma/seed.ts` distribuindo os mocks entre as duas lojas — com
   pelo menos **dois numeros na mesma loja**, senao o bug de responder pelo
   numero errado so aparece em producao;
4. cria indices e a constraint de papel.

Indice obrigatorio: `store_id` em toda tabela que ganhou a coluna — todas as
consultas vao filtrar por ele.

### Isolamento de contato

Decisao 5: cada loja tem a propria carteira. Isso exige tres mudancas, e a
segunda e um bug esperando para acontecer.

**1. Unicidade por loja — que hoje nao existe de jeito nenhum.**

`Contact` no schema atual nao tem **nenhuma** constraint de unicidade: `phone`,
`whatsappId`, `instagramId`, `facebookId` e `tiktokId` sao apenas
`String?`. A deduplicacao inteira depende de um `findFirst` no codigo
(`src/lib/channels/gateway.ts:27`). Duas mensagens simultaneas do mesmo numero
ja criam dois contatos hoje, sem multi-loja nenhuma.

Aproveitar a migracao para criar o que falta, agora com a loja na chave:

```sql
-- um telefone por loja, nao por sistema
CREATE UNIQUE INDEX contacts_loja_whatsapp
  ON contacts (store_id, whatsapp_id)
  WHERE whatsapp_id IS NOT NULL AND is_deleted = false;

CREATE UNIQUE INDEX contacts_loja_instagram
  ON contacts (store_id, instagram_id)
  WHERE instagram_id IS NOT NULL AND is_deleted = false;

-- idem para facebook_id, tiktok_id e phone
```

Indice parcial porque os campos sao nulos na maioria das linhas: contato que
so tem Instagram nao pode colidir com outro que so tem telefone.

**2. O gateway precisa saber a loja ANTES de procurar o contato.**

Hoje:

```typescript
// src/lib/channels/gateway.ts — busca global
let contact = await prisma.contact.findFirst({
  where: { [campoDoCanal]: msg.senderId },
})
```

Sem a loja no `where`, uma mensagem que chega no numero do Cerro Azul encontra a
contato do Centro e pendura a conversa na carteira errada. E o vendedor do Cerro
Azul passa a ver o historico de compras da outra loja.

A loja vem da integracao que recebeu o evento (roteamento de webhook, adiante):
`webhook -> stores_integracoes -> store_id -> busca do contato`. Ou seja, a
etapa 3 da ordem de execucao nao e so sobre responder pelo numero certo; e o que
mantem as carteiras separadas.

**3. Exclusao LGPD passa a ser por loja.**

`DELETE /api/lgpd?contactId=...` apaga o contato de **uma** loja. Se a titular
pedir exclusao total e ela for cliente das duas, sao duas operacoes.

A rota nao deve procurar sozinha "a mesma pessoa na outra loja" — isso
atravessaria o isolamento que a decisao 5 estabeleceu. A tela avisa que a
exclusao vale para a loja atual, e quem opera decide.

---

## Seguranca das credenciais

Nao negociavel — sao chaves que movimentam dinheiro e dados de cliente.

1. **Cifrar antes de gravar.** AES-256-GCM, chave de 32 bytes em
   `INTEGRATIONS_KEY` (fora do git, como todo segredo). Guardar `iv` e `authTag`
   junto do payload cifrado.
2. **Nunca devolver segredo pela API.** A tela mostra status, nome da conta,
   validade e os 4 ultimos caracteres. Ler o segredo e privilegio do servidor.
3. **Nunca logar credencial** — nem em `console.error` de falha de integracao.
4. **Rotacao**: token com `expira_em` proximo entra em fila de refresh; falha de
   refresh marca `status = "expirado"` e alerta o admin da loja.
5. **Desconectar apaga a credencial** (delete fisico do campo cifrado, nao soft
   delete) e mantem o registro com `status = "desconectado"` para a trilha.
6. `INTEGRATIONS_KEY` **nunca** compartilhada entre HML e PRD.

---

## Provedores

> [!WARNING]
> Os detalhes de cada API abaixo sao o desenho pretendido, **conferir contra a
> documentacao oficial vigente antes de implementar**. Versao de API, nome de
> campo e fluxo de autorizacao mudam com frequencia nos quatro.

### Bling (ERP) — conta unica da rede

- **Escopo**: uma conta para as duas lojas (decisao 6). Uma linha em
  `stores_integracoes` com `store_id` nulo. **Nao** e "conectar Bling" dentro
  da tela de cada loja — e uma conexao so, na configuracao da rede.
- **Autenticacao**: OAuth 2.0. `client_id`/`client_secret` do app em env;
  `access_token`/`refresh_token` obtidos uma vez, cifrados no banco.
- **Fluxo**: admin conecta -> redirect para o Bling -> callback em
  `/api/integracoes/bling/callback?state=<assinado>` -> troca code por token ->
  cifra e grava.
- **`state` obrigatorio e assinado.** Sem isso, um callback forjado troca a
  conta conectada da rede inteira.
- **Deposito**: a leitura de estoque vem por deposito, pelo `bling_deposito_id`
  da loja. **Corrigido em 22/09/2026**: a Merlo Store usa um deposito SO, e as
  duas lojas apontam para o mesmo. Quem separa a operacao entre as lojas e o
  **Masc** — vendeu no Masc, ele baixa no Bling. Deposito repetido nas duas
  lojas **nao** e erro de configuracao, e o esperado.
- **Refresh**: token expira; renovar antes do vencimento por job.
- **JWT, nao token opaco.** O Bling DESCONTINUOU o token opaco e anunciou
  bloqueio com data "em definicao" — pode cair sem aviso util. O header
  `enable-jwt: 1` (`CABECALHO_JWT`, em `src/lib/bling/config.ts`) vai nas TRES
  situacoes: ao trocar o code, ao **renovar** e em **toda** requisicao
  autenticada. O da renovacao e o que se esquece: sem ele, a proxima renovacao
  devolve token opaco de novo e a migracao se desfaz sozinha, em silencio,
  horas depois. O JWT tem de 1.500 a 3.000 caracteres (o opaco tem dezenas) e
  cabe em `stores_integracoes.credenciais_cifradas`, que e `text`.
- **Confirmado na collection OpenAPI oficial** (rebaixada em 22/09/2026 de
  `developer.bling.com.br/build/assets/openapi-BVqLYFZn.json` — o hash do
  arquivo muda quando o portal e publicado de novo, e a URL antiga
  `openapi-BvBfsn8J.json` responde 404; para achar a atual, leia o portal e
  procure `openapi-*.json`): API v3, prefixo
  `/Api/v3`, e o **deposito nao existe no corpo do pedido** — ele so entra em
  `POST /pedidos/vendas/{id}/lancar-estoque/{idDeposito}`, uma segunda chamada.
  A API **nao tem idempotencia** (nenhum header, nenhum 409 declarado).
- **Fechado, nao "por enquanto"**: este sistema **nao escreve** pedido nem
  estoque no Bling. O Masc e o dono da venda e o Bling e a autoridade de
  estoque, alimentado pelo vinculo Masc -> Bling (decisao 8,
  [ADR 0004](adr/0004-fontes-da-verdade.md)).

#### Espelho do catalogo (`POST /api/integracoes/bling/sincronizar`)

A tela de Produtos, o seletor de produto do chat e a reserva de estoque leem a
tabela `products` local. O botao **Sincronizar catalogo**, na tela de
integracoes, traz o catalogo do Bling para ela. Continua sendo leitura do lado
do Bling: o `POST` e da nossa rota, e daqui so sai `GET`.

Como a v3 devolve uma loja de roupa, e o que cada detalhe custou:

- **Cada tamanho e uma variacao e vem como LINHA PROPRIA na listagem**, marcada
  por `idProdutoPai`. O produto de topo e a peca. Quem pagina tem de decidir
  pelo tamanho da pagina **crua**: decidir pela lista ja filtrada fez a primeira
  sincronizacao (22/09/2026) parar na pagina 1 com 10 produtos, porque 90 das
  100 linhas eram tamanho.
- **O preco vive na variacao.** O pai de uma peca com variacoes vem com
  `preco: 0` — foi o que trouxe o catalogo inteiro a R$ 0,00. O preco da peca e
  o do proprio produto e, quando ele vem zerado, o preco **mais repetido** entre
  os tamanhos. **Empate fica com o maior**: subcotar tira margem da loja sem
  ninguem perceber, e desconto a vendedora ainda pode dar na conversa.
- **A categoria nao esta na listagem, e no detalhe so vem o `categoria.id`** —
  `ProdutosCategoriaDTO` tem um campo so. O nome legivel esta em
  `GET /categorias/produtos`. Perguntar o detalhe de cada produto custaria uma
  requisicao por peca, a 3 por segundo; filtrar a listagem por `idCategoria`
  custa uma passada a mais no catalogo e da a mesma informacao.
- **`filtroSaldoEstoque` tem `default: 1` (so saldo positivo) e o enum nao tem
  valor para "todos"** — omitir e a unica forma de pedir sem filtro. Se o Bling
  aplicar esse default ao parametro omitido, o catalogo perde toda peca
  esgotada, sem erro nenhum. A varredura pergunta uma pagina das fatias `0` e
  `2` e desiste da fatia assim que a resposta prova que ja tinha vindo tudo.
- **`criterio: 2` (Ativos).** `5` ("Todos") traz tambem os excluidos, e `1`
  — o default — e "Ultimos incluidos", que **nao** e "todos".

- **A categoria do Bling cobre pouco.** Na rodada de 22/09/2026 o Bling tinha 8
  categorias (BLUSA, VESTIDO, CONJUNTO, CALCA, BODY, SAIA, CAMISA, T-SHIRT) e so
  **68 das 569 pecas** estavam classificadas la. Para as outras, a categoria e
  deduzida do NOME da peca — casando **so** contra as categorias que a propria
  loja cadastrou no Bling. "VESTIDO DUDA LISO PLUS SIZE" vira `VESTIDO`;
  "BLAZER HOT PINK" fica sem categoria, porque BLAZER nao e categoria dela.
  Nao e adivinhacao de taxonomia: e o vocabulario da loja aplicado ao nome dela.
- **Grade de tamanhos e retrato do estoque.** Como cada variacao e um tamanho, a
  grade sai do nome das variacoes (a v3 nao tipa os atributos da variacao em
  resposta nenhuma) e `stock` recebe o `saldoVirtualTotal` de cada uma. Esse
  numero e a soma de TODOS os depositos — serve aqui porque a Merlo Store usa um
  deposito so.

**`products.stock` e um retrato, nao a autoridade.** Quem PROMETE peca continua
sendo a rota de disponibilidade, que le o Bling ao vivo e desconta o reservado
(ADR 0004). O retrato existe porque o seletor de produto do chat monta o texto
que vai para a cliente a partir de `sizes` e `stock`: com os dois vazios, ele
dizia "No momento sem estoque" para o catalogo inteiro e a vendedora recusava
venda de peca que existia.

O que a sincronizacao **nao** escreve, e por que: `active` (e assim que a loja
exclui um produto) e `featured` (curadoria da equipe). Foto e descricao so
entram quando o campo **daqui** esta vazio — a Galeria existe para a loja subir
foto propria, melhor que a miniatura do ERP. Grade e estoque so entram quando a
peca tem variacoes: gravar grade vazia por cima de uma existente faria o mesmo
estrago. E a linha **nunca** e recriada — `orders.items[].productId` e
`media_files.product_id` apontam para o id local, e recriar orfanaria pedido e
zeraria reserva.

### Masc (sistema de vendas das lojas)

**Dono da venda** (decisao 8, [ADR 0004](adr/0004-fontes-da-verdade.md)). Nao
escreve estoque diretamente: e vinculado ao Bling, e o Bling e que responde pelo
saldo.

O que este sistema faz a respeito: registra o pedido do canal como **pendente de
lancamento no Masc** e o mantem visivel na fila ate alguem lancar a venda la e
anotar o numero (`PUT /api/orders/[id]/masc`). **Nao ha chamada a API do Masc** —
nao ha evidencia de que exista uma publica, e fingir integracao seria pior do
que assumir que o passo e manual.

Levantamento do fornecedor (17/08/2026, confianca media): o "Masc" e o ERP/PDV
de varejo de moda da **Informezz** (Parana). Cobre PDV, condicional, estoque em
grade tamanho-cor e multi-filial — o nicho bate exatamente com a Merlo Store.
**Confirmar com o cliente**, porque nada liga publicamente a Merlo ao fornecedor.

**O que ainda vale perguntar** — nao bloqueia codigo, mas muda o tamanho da
ponte manual:

1. **O modulo de e-commerce do Masc esta ligado?** O fornecedor anuncia
   "sincronizacao de estoque, precos e pedidos" com marketplaces. Se estiver
   ativo, ha um segundo sistema mexendo no estoque — verificar **antes** de
   automatizar qualquer coisa.
2. **Como e o vinculo Masc -> Bling?** Automatico, por arquivo, ou alguem
   digita? Se for automatico e em tempo real, a leitura de saldo do Bling e
   confiavel na hora do atendimento. Se for no fechamento do caixa, o saldo que
   mostramos fica velho durante o dia — e isso muda o que a vendedora pode
   prometer.
3. **O Masc tem API?** Se tiver, o lancamento deixa de ser manual. Sem ela, a
   fila de "falta lancar" e o melhor que da para fazer com honestidade.

### TikTok Shop (e-commerce)

- **Nao confundir** com o adapter de mensagens que ja existe
  (`src/lib/channels/tiktok.ts`). Sao APIs diferentes.
- **Autenticacao**: app no Partner Center com `app_key`/`app_secret` (env); a
  loja autoriza e gera `access_token` + identificador da loja no TikTok.
- **Assinatura**: as chamadas exigem assinatura HMAC dos parametros — mesmo tipo
  de mecanismo ja usado em `src/lib/webhook-auth.ts` para a Meta.
- **Webhooks assinados** — validar como ja se faz com os da Meta.
- **A confirmar**: nome exato dos campos de autorizacao, formato da assinatura,
  se o token expira e qual o fluxo de refresh.

### Instagram (mensagens)

- Ja existe adapter (`src/lib/channels/instagram.ts`), lendo token de env.
- **Muda**: token por loja. Cada loja conecta a propria conta profissional e a
  pagina vinculada.
- **`META_APP_SECRET` continua unico** (e do app, nao da loja) — a assinatura
  `X-Hub-Signature-256` ja validada em `src/lib/webhook-auth.ts` seque valendo.
- **Roteamento**: o payload da Meta traz o id da conta/pagina; e por ele que se
  descobre a loja. Guardar esse id em `referencia_externa` e indexar.
- **A confirmar**: permissoes necessarias e o fluxo de Instagram Login vigente.

### WhatsApp — uazapi (etapa 7, IMPLEMENTADO)

**A recomendacao foi seguida: os dois provedores convivem.** O canal `whatsapp`
tem dois provedores, e a loja escolhe em cada numero:

| Provedor | O que e | Credencial | Webhook |
|----------|---------|------------|---------|
| `whatsapp_oficial` | Meta Cloud API | `phone_id` + `access_token` | `/api/webhooks/whatsapp` (HMAC da Meta) |
| `uazapi` | API nao-oficial sobre o WhatsApp Web | `token` da instancia | `/api/webhooks/uazapi` (segredo compartilhado) |

Os dois implementam a mesma interface `ChannelAdapter`: quem envia
(`/api/messages`, `/api/media/send`) nao sabe por qual provedor a mensagem sai.
A escolha esta na conta conectada, nao no codigo de envio.

**Riscos que continuam valendo — nao sao detalhe tecnico:**

- **o numero pode ser BANIDO**: e uso fora dos termos do WhatsApp;
- **a sessao cai** (celular sem bateria, sessao derrubada) e alguem precisa ler
  o QR de novo — por isso existe a tela de sessao;
- **nao ha template aprovado nem janela de 24h**. `sendTemplate` no uazapi
  **falha de proposito**, com mensagem explicando: mandar o nome do template
  como texto entregaria "boas_vindas" para a cliente. O model
  `WhatsappTemplate` continua valendo **so para numeros `whatsapp_oficial`**.

O aviso de banimento aparece na tela de integracoes, no `.env.example` e no
`config.ts` — e `tests/uazapi.test.ts` trava que ele nao seja removido.

**Por numero, nao por loja**: cada numero e uma instancia com token proprio, e a
loja tem varios (decisao 3). Cada instancia e uma linha em `stores_integracoes`,
com `rotulo` ("Vendas Centro", "SAC Centro") e o id da instancia em
`referencia_externa`. O token da instancia **da acesso total aquele numero** —
nao ha escopo, entao vale o mesmo cuidado do cofre.

**Ciclo de vida da sessao** — nao existe equivalente na API oficial:

| Rota | O que faz |
|------|-----------|
| `GET /api/integracoes/uazapi/[id]/sessao` | estado atual; alinha `status` no banco |
| `POST /api/integracoes/uazapi/[id]/sessao` | inicia o pareamento e devolve o QR |

So admin (cai na excecao `/api/integracoes` do RBAC). O QR expira em segundos;
a tela gera outro sob demanda.

**Host por instalacao**: o uazapi nao tem dominio unico como Bling ou TikTok
Shop — cada cliente tem o proprio subdominio, em `UAZAPI_BASE_URL`.

**Onde esta a incerteza**: a documentacao do uazapi e Swagger renderizado por JS
e nao pode ser lida por fetch. Os caminhos (`/send/text`, `/instance/status`...),
o nome do header do token e os campos do corpo vieram do padrao publico do
uazapiGO e estao **todos** em `src/lib/uazapi/config.ts`, marcados `CONFERIR`.
Conferir no Swagger da propria instalacao (URL do painel + `/docs`) e mudar
**so aquele arquivo**. Um teste impede que qualquer caminho vaze para o adapter,
o webhook ou as rotas.

---

## Roteamento de webhook

Hoje as rotas sao globais (`/api/webhooks/whatsapp`). O handler precisa
descobrir nao so a loja, mas **qual conta** recebeu o evento — com dois numeros
na mesma loja, saber a loja nao basta. Duas formas:

1. **Conta na URL** — `/api/webhooks/uazapi/[integracaoId]`. Cada instancia
   recebe uma URL propria, com segredo proprio. Melhor para uazapi e TikTok
   Shop, onde a URL e configurada por conta. A loja sai da integracao, nao da
   URL — assim mudar a loja de dono do numero nao exige reconfigurar o provedor.
2. **Conta resolvida pelo payload** — a Meta manda o id da conta/pagina; busca-se
   `stores_integracoes` por `(provedor, referencia_externa)` e dali sai a loja.
   Necessario no Instagram, onde a URL do webhook e unica por app.

Payload de conta desconhecida: responder `200` e **descartar**, registrando o
evento. Nao criar loja nem conversa a partir de webhook nao reconhecido.

Em qualquer caso, o que ja esta valendo continua valendo:
**assinatura ou segredo verificado antes de processar**, e segredo ausente
responde `403` em vez de aceitar (ver [api.md](api.md)). As rotas novas entram
na lista de `src/lib/api-publica.ts` — e cada uma leva a propria checagem.

---

## Acesso: vendedor so ve a propria loja

**Como funciona hoje** ([rbac.md](rbac.md)): `src/middleware.ts` le `role` do
JWT e decide por caminho + metodo. O papel ja esta la; o que falta e o escopo.

**Como passa a funcionar** — com um vendedor por loja (decisao 1), o escopo nao
precisa ser escolhido a cada requisicao: ele vem junto com a sessao.

1. O JWT passa a carregar `storeId` alem de `role` — os dois saem do cadastro
   do usuario no login (`src/lib/auth.ts`, callback `jwt`).
2. O middleware continua decidindo o papel como hoje; o escopo entra junto.
3. **Toda query filtra `store_id` = o da sessao.** Sem excecao. Um `findMany`
   sem filtro de loja mistura o Centro com o Cerro Azul, e e o tipo de bug que
   so aparece depois de ja ter vazado.
4. **`admin` e `gerente` sao a excecao**: `storeId` nulo, enxergam as duas lojas
   e as duas caixas de WhatsApp. A loja ativa vem de um seletor na interface
   (`?loja=centro`) e o servidor **valida que quem pediu tem papel de gestao**
   antes de aceitar o parametro. Sem loja no parametro, veem tudo.

Vendedor nao manda loja: o servidor usa a da sessao e ignora o parametro. Loja
escolhida pelo navegador e loja falsificavel — o mesmo erro da autoria que ja
corrigimos ([api.md](api.md)).

| Papel | `store_id` | Escopo |
|-------|-----------|--------|
| `admin` | nulo | as duas lojas, **tudo** |
| `gerente` | nulo | as duas lojas, tudo **menos configuracao e usuario** (decisao 7) |
| `vendedor` | obrigatorio | opera a **sua** loja: conversa, pedido, CRM |
| `viewer` | obrigatorio | leitura da sua loja |

O papel `agent` de hoje vira `vendedor` na migracao; e o mesmo escopo com nome
que o cliente usa.

### Como isso vira regra em `src/lib/rbac.ts`

A politica de hoje decide por caminho + metodo, com um padrao e tres excecoes.
Com quatro papeis, o desenho continua o mesmo — muda a tabela:

| Metodo | admin | gerente | vendedor | viewer |
|--------|:-----:|:-------:|:--------:|:------:|
| `GET` | sim | sim | sim | sim |
| `POST` / `PUT` / `PATCH` | sim | sim | sim | nao |
| `DELETE` | sim | **sim** | nao | nao |

`gerente` passa a poder excluir — hoje `DELETE` e so `admin`. E o que "pode
tudo menos configuracao e usuario" significa na pratica.

Sobre esse padrao, **duas areas viram excecao de `admin`**, em qualquer metodo:

```typescript
// Configuracao: integracoes, lojas e ajustes de operacao.
/^\/api\/integracoes\//        -> ["admin"]
/^\/api\/lojas(\/|$)/          -> ["admin"]
// (rotas de SLA, automacao e canal quando existirem — hoje sao so telas)

// Usuario: criar, editar, desativar, trocar papel.
/^\/api\/usuarios(\/|$)/       -> ["admin"]
/^\/api\/register$/            -> ["admin"]   // ja e hoje, na propria rota
```

Leitura dessas areas tambem e so `admin`: ver a lista de integracoes ja mostra
qual conta esta conectada e ate quando o token vale. Nao e segredo, mas e
superficie de configuracao — e a regra fica mais simples de auditar sem
excecao de leitura.

O que **nao** entra na lista, apesar de a tela morar em `/settings`:
`/api/lgpd` e `/api/activity-logs`. Sao operacao e gestao, e `gerente` alcanca
os dois (decisao 7). As excecoes que existem hoje para essas duas rotas
([rbac.md](rbac.md)) deixam de existir — passam a seguir o padrao.

> [!CAUTION]
> Duas regras precisam de teste automatizado, no mesmo estilo dos que ja
> existem — sem teste, elas duram ate a primeira pressa:
>
> 1. **Nenhuma consulta sem `store_id`** (vendedor nao ve a outra loja).
> 2. **Resposta sai pela integracao de entrada** (cliente do numero de SAC nao
>    recebe resposta pelo numero de vendas).
> 3. **Mensagem que chega cria/acha contato dentro da loja da integracao** (a
>    mesma pessoa nas duas lojas continua sendo dois contatos).
> 4. **`gerente` nunca alcanca configuracao nem usuario** — no estilo do
>    `tests/rbac.test.ts` que ja existe: varrer as rotas e provar que a lista de
>    caminhos negados ao `gerente` e exatamente a esperada. Se alguem criar
>    `/api/integracoes/nova` sem por na lista, o teste acusa.

---

## Telas

```
/settings/lojas                      Centro e Cerro Azul (admin)
/settings/lojas/[id]                 dados da loja + vendedores
/settings/lojas/[id]/integracoes     contas conectadas da loja
/settings/lojas/[id]/integracoes/nova    conectar Bling / TikTok Shop / Instagram / numero de WhatsApp
```

A tela de integracoes e **lista**, nao formulario de quatro campos: a loja tem
N numeros de WhatsApp, entao mostra uma linha por conta, com `rotulo`, status,
conta conectada, validade do token, ultima sincronizacao e ultimo erro. Nunca o
segredo.

O seletor de loja (para `admin` e `gerente`) fica no cabecalho, junto com o
filtro de caixa de entrada — quem atende as duas lojas precisa saber, o tempo
todo, em qual esta olhando.

Desconectar e acao critica: usar o modal de confirmacao com block de 3s exigido
pelo `CLAUDE.md` (template em `templates/component.tsx`).

---

## Ordem de execucao

Cada etapa fecha com `npm run compliance`, `npm test` e build passando.

1. ~~**Multi-loja primeiro.**~~ **FEITO em 17/08/2026** — em Prisma, nao em
   Drizzle ([ADR-0003](adr/0003-multi-loja-em-prisma.md)). Entregue: `stores`
   (Centro e Cerro Azul), papeis (`gerente` novo, `agent`->`vendedor`),
   `users.store_id` + constraint `users_loja_por_papel`, `store_id` em 18
   tabelas, indices unicos de contato por loja, `storeId` no JWT, escopo em
   toda consulta (`src/lib/loja.ts`), `seed.ts` com as duas lojas.
   Seletor de loja no cabecalho entregue em seguida: a escolha da gestao vai no
   cookie `loja_ativa` (ver [api.md](api.md)), em vez de virar parametro nas ~48
   chamadas `fetch` espalhadas pelos componentes.
   **Falta desta etapa**: as paginas continuam sem RBAC — qualquer usuario
   logado abre `/settings`.
2. ~~**Cofre de credenciais.**~~ **FEITO em 17/08/2026.** Entregue:
   `stores_integracoes` (com as 5 colunas de auditoria — as tabelas legadas
   ainda nao tem), cifra AES-256-GCM em `src/lib/cofre.ts`, rotas
   `/api/integracoes` e `/api/integracoes/[id]` (so `admin`), e a tela
   `/settings/integracoes`. Detalhe em [api.md](api.md).
   **Falta desta etapa**: a tela lista, mostra estado e desconecta, mas nao
   conecta conta nova — conectar depende do fluxo de cada provedor (OAuth do
   Bling, QR do WhatsApp), que sao as etapas 4 a 7.
3. ~~**Roteamento por conta.**~~ **FEITO em 17/08/2026.** Entregue:
   `conversations.store_integracao_id`, `contaExterna` extraida do payload pelos
   parsers, resolucao por `(provedor, referencia_externa)` em
   `src/lib/roteamento.ts`, conversa procurada **por conta** e nao so por canal,
   e `getAdapterDaConta` no envio. Detalhe em [api.md](api.md).

   Achado no caminho: o sistema tem canal **Facebook Messenger**, que nao estava
   na lista de quatro integracoes. Sem provedor correspondente o webhook dele
   ficaria mudo — `facebook` entrou em `PROVEDORES`.

   **Falta desta etapa**: credencial por conta so o WhatsApp usa. Instagram,
   Facebook e TikTok seguem lendo do ambiente — correto enquanto for uma conta
   por aplicativo, que e o caso hoje.
4. ~~**Bling somente leitura**~~ **FEITO em 17/08/2026.** Entregue: OAuth com
   `state` assinado, cliente com renovacao automatica de token, e leitura de
   catalogo + saldo por deposito. Nenhum caminho de escrita — garantido por
   teste. Detalhe em [api.md](api.md).

   **Ressalva:** a mecanica do OAuth foi confirmada na documentacao oficial
   (Basic auth, code de 1 min, refresh de 30 dias), mas os **caminhos dos
   endpoints** nao — a doc e renderizada por JavaScript e a collection OpenAPI
   responde 404. Ficaram isolados em `src/lib/bling/config.ts`, marcados com
   `CONFERIR`, e um teste impede que vazem para outros arquivos.
5. ~~**Instagram**, que ja tem adapter: so trocar env por credencial da loja.~~
   **FEITO em 17/08/2026.** Instagram e Facebook viraram fabricas por conta
   (mesma forma do WhatsApp na etapa 3), `getAdapterDaConta` cobre os tres, e as
   chaves de cada provedor ficaram declaradas em `CHAVES_ESPERADAS` — conectar
   com chave faltando responde `400` em vez de gravar credencial que so falha no
   primeiro envio.

   O Facebook entrou junto porque e a mesma forma e ficaria como assimetria
   conhecida (ver o achado da etapa 3). Conectar uma conta e feito pela tela,
   colando o token da pagina — o Instagram nao ganhou fluxo OAuth proprio.
6. ~~**TikTok Shop**, integracao nova de e-commerce.~~ **FEITO em 17/08/2026.**
   Entregue: assinatura HMAC das chamadas, OAuth (reusando o `state` assinado do
   Bling), cliente somente leitura (lojas, produtos, pedidos) e o webhook
   passando a validar assinatura de verdade — antes usava um segredo
   compartilhado provisorio. Detalhe em [api.md](api.md).

   **Ressalva:** um detalhe da assinatura nao foi confirmado — se o caminho da
   rota entra na string assinada. Esta na constante `ASSINATURA_INCLUI_CAMINHO`
   (`src/lib/tiktok/config.ts`). Errar faz toda chamada falhar com erro de
   assinatura, entao o sintoma e imediato.

   A conta do TikTok nasce **sem loja**: e por loja, e chutar seria pior.
   Escolher a loja depois de conectar ainda nao tem tela.
7. ~~**WhatsApp uazapi** por ultimo — maior risco operacional.~~
   **FEITO em 17/08/2026.** Entregue: provedor `uazapi` convivendo com
   `whatsapp_oficial` no mesmo canal, adapter cumprindo a interface
   `ChannelAdapter`, webhook proprio com segredo, e tela de sessao com QR code
   (a sessao do WhatsApp Web cai e precisa reparear).

   **Corrigido de tabela:** o webhook da Meta resolvia a conta pelo provedor
   `uazapi` — sobra da etapa 3, quando canal e provedor ainda eram a mesma
   coisa. Nunca teria achado a conta, e a mensagem seria descartada em silencio.
   Agora resolve por `whatsapp_oficial`, e ha teste travando os dois lados.

   **Ressalva:** a documentacao do uazapi e Swagger por JavaScript e nao pode
   ser lida por fetch. Caminhos, header do token e campos do corpo vieram do
   padrao publico do uazapiGO e ficaram isolados em `src/lib/uazapi/config.ts`,
   marcados `CONFERIR` — conferir no Swagger da propria instalacao.

   **Decisao de negocio ainda aberta:** o risco de banimento do numero e real e
   nao e mitigavel por codigo. O sistema avisa em tres lugares, mas quem decide
   quais numeros entram no uazapi (e quais ficam na API oficial) e o cliente.
8. **Escrita no Bling (pedido/estoque) e eventual integracao com o Masc** —
   depois de fechada a decisao 8. Pode nunca acontecer, se o Masc for o dono do
   pedido.

Nao fazer 4 a 7 antes de 1, 2 e 3: integracao construida sobre credencial global
tem que ser reescrita depois. E nao antecipar a 8: sem a fonte da verdade
definida, escrita em ERP vira divergencia de estoque.

**Em paralelo, sem depender de codigo:** levantar o Masc (decisao 8). E o unico
item que trava escrita em ERP, e a resposta vem do cliente, nao do repositorio —
quanto antes comecar, menos ele bloqueia.

---

## O que ja esta pronto e deve ser reaproveitado

| Peca | Onde | Serve para |
|------|------|-----------|
| Verificacao de assinatura HMAC | `src/lib/webhook-auth.ts` | webhooks de TikTok Shop e Meta |
| Lista de rotas publicas | `src/lib/api-publica.ts` | registrar os webhooks novos |
| Autoria pela sessao | `src/lib/sessao.ts` | `modified_by` das tabelas novas |
| RBAC por caminho+metodo | `src/lib/rbac.ts` | base para o RBAC por loja |
| Interface de canal | `src/lib/channels/types.ts` | uazapi implementa a mesma interface |
| Templates-ouro | `templates/` | tabela, action e componente ja no padrao |
| Skills | `/criar-tabela`, `/criar-crud` | criar as tabelas novas sem esquecer regra |

---

## Variaveis de ambiente novas

Do **app** (uma por instalacao, em `.env`):

```
INTEGRATIONS_KEY=          # 32 bytes hex — cifra as credenciais das lojas
BLING_CLIENT_ID=
BLING_CLIENT_SECRET=
BLING_REDIRECT_URI=
TIKTOK_SHOP_APP_KEY=
TIKTOK_SHOP_APP_SECRET=
UAZAPI_BASE_URL=           # host da instalacao uazapi
```

Credencial **de loja** (token, instancia, shop id) **nao** vai para o `.env` —
vai cifrada no banco. Se aparecer credencial de loja em variavel de ambiente, o
desenho saiu do trilho.

---

## Pendencias que continuam abertas no projeto

Nao sao pre-requisito, mas convivem com este trabalho — detalhe em
[api.md](api.md):

- paginas ainda sem RBAC;
- trilha de auditoria nao automatica;
- 10 rotas ainda com delete fisico;
- `DATABASE_URL` do `.env` (porta 5435) diverge do `docker-compose.yml` (5437).
