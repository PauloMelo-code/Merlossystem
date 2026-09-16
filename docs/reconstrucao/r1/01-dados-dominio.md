# 01 — Modelo de dados (FINAL, parte 2: domínio)

Continuação de `spec/final/01-dados.md`. As convenções da parte 1 (timestamps `timestamptz(3)`, `uuid`, dinheiro, enums por constante, FK `RESTRICT` + FK composta `(id, loja_id)`, índice único parcial com predicado literal, trava de colisão por padrão, JSON tipado) valem aqui **sem repetição**: toda tabela desta parte tem `...colunasAuditoria`, FK `RESTRICT` e trava de colisão, salvo quando a parte 1 §4.7 lista a exceção.

**31 tabelas**: 20 em §2–§5, 11 em §6–§7.

---

## 1. O que muda em relação ao sistema antigo

| Defeito estrutural do antigo | Correção neste modelo |
|---|---|
| `conversations`, `messages`, `message_media`, `orders`, `payments`, `returns`, `products`, `scheduled_messages`, `broadcast_recipients` sem colunas de auditoria (`01/D-20`, `03/A12`) | as 5 colunas em todas |
| arrays de ids sem FK (`media_ids`, `product_ids`, `image_urls`, `tags`, `template_vars`) | 9 tabelas de ligação |
| `orders.items` e `deals.products` como JSON livre (`02/O-01`) | `pedidos_itens` com FK e preço-snapshot |
| unicidade total convivendo com soft delete (`02/C-01`, `04/F01`) | todo índice único é parcial `WHERE is_deleted = false` |
| `loja_id` redundante sem garantia de bater com o pai | **FK composta `(id, loja_id)`** (parte 1, §4.6) |
| conversa sem conta de entrada → resposta pelo `.env` (`01/D-04`) | `conversas.integracao_id NOT NULL` |
| status como texto livre (`02/D-02`) | `CHECK` gerado da constante TS em todos |
| reserva de estoque por produto, não por tamanho (`02/O-08`) | `produtos_variacoes` + `pedidos_itens.variacao_id` |
| número do pedido por `max(substr)` + retry, sigla derivada do nome (`06/T-25`, `06/D-19`) | `pedidos_numeracao` (contador atômico) + `lojas.sigla` cadastrada |
| mesmo `masc_venda_id` em dois pedidos (`02/O-02`) | único parcial `(loja_id, masc_venda_id)` |
| destinatário de campanha duplicado (`03/C1`) | único `(campanha_id, contato_id)` |
| mensagem da cliente perdida quando já existia contato do CRM com o mesmo telefone (`02/C-01`, `01/D-03`) | **casamento em duas etapas** na mesma transação (§2.1) |
| eliminação LGPD física, fora de transação, sem prova (`02/L-03`) | anonimização em transação + `lgpd_solicitacoes` (§8) |

---

## 2. Contatos e conversas (6 tabelas)

### 2.1 `contatos`

| Coluna | Tipo | Nulo | Default | Nota |
|---|---|---|---|---|
| id | uuid PK | não | `defaultRandom()` | |
| loja_id | uuid → lojas | não | | carteira isolada por loja (DN-05, `06/INV-13`) |
| nome | text | sim | | |
| telefone | text | sim | | **E.164 só dígitos** (`5551999990000`), CHECK `^[1-9][0-9]{9,14}$` |
| email | text | sim | | CHECK formato simples |
| whatsapp_id / instagram_id / facebook_id / tiktok_id | text | sim | | id do remetente no canal |
| avatar_url | text | sim | | |
| tamanho_preferido | text | sim | | CHECK `IN ('slim','plussize','ambos')` |
| observacoes | text | sim | | |
| aniversario | `date` (`mode:"string"`) | sim | | |
| endereco | jsonb | sim | | tipo fechado (parte 1, §10) |
| ultimo_contato_em | timestamptz(3) | sim | | **contador/cache** |
| ultima_compra_em | timestamptz(3) | sim | | **contador/cache**; o filtro "dias desde a compra" usava `last_contact_at` (`02/C-04`) |
| opt_out | boolean | não | `false` | **espelho** da última linha de `consentimentos` (§7.2) |
| opt_out_em | timestamptz(3) | sim | | |
| pedidos_contagem | integer | não | `0` | **contador/cache** |
| pedidos_valor_total | numeric(12,2) | não | `'0'` | **contador/cache** |
| anonimizado_em | timestamptz(3) | sim | | LGPD (§8) |
| ...colunasAuditoria | | | | |

- Únicos parciais (todos `WHERE <coluna> IS NOT NULL AND is_deleted = false`): `(loja_id, telefone)`, `(loja_id, whatsapp_id)`, `(loja_id, instagram_id)`, `(loja_id, facebook_id)`, `(loja_id, tiktok_id)`.
- Único `(id, loja_id)` (pai de FK composta). Índices: `(loja_id, ultimo_contato_em DESC)`, `(loja_id, opt_out)`, `(loja_id, is_deleted)`.
- CHECK `contatos_opt_out_coerente`: `(opt_out = false) OR (opt_out_em IS NOT NULL)`.

**Casamento do contato na entrada de mensagem — três passos, uma transação** (fecha `02/C-01` e `01/D-03`, o defeito CRÍTICO em que **toda** mensagem daquele cliente se perdia para sempre com 200 devolvido ao provedor). O upsert simples do rascunho não bastava: `ON CONFLICT (loja_id, whatsapp_id)` não enxerga o contato criado pelo CRM, que tem o mesmo telefone e `whatsapp_id` nulo — a inserção nova violava `(loja_id, telefone)`.

```ts
// 1) upsert pelo identificador do canal. targetWhere REPETE o predicado do índice parcial:
//    sem ele o Postgres não encontra o índice e o comando levanta erro.
const [porCanal] = await tx.insert(contatos).values(novo)
  .onConflictDoUpdate({
    target: [contatos.loja_id, contatos.whatsapp_id],
    targetWhere: sql`whatsapp_id is not null and is_deleted = false`,
    set: { ultimo_contato_em: agora },
  }).returning().catch(violacaoDeTelefone);      // 2) cai aqui quando (loja_id, telefone) colide

// 2) carimba o whatsapp_id no contato que já existia sem ele (CRM/importação)
const [porTelefone] = await tx.update(contatos)
  .set({ whatsapp_id: id, ultimo_contato_em: agora })
  .where(and(eq(contatos.loja_id, lojaId), eq(contatos.telefone, telefone),
             isNull(contatos.whatsapp_id), vivos(contatos)))
  .returning();

// 3) só então cria. Nenhum caminho responde 200 sem ter gravado a mensagem.
```

Contato **excluído** que volta a escrever: o índice parcial libera a criação de um novo; reativar o antigo é decisão de produto (a tela mostra "existe um contato excluído com este número"), nunca do gateway.

### 2.2 `conversas`

| Coluna | Tipo | Nulo | Default | Nota |
|---|---|---|---|---|
| id | uuid PK | não | | |
| loja_id | uuid → lojas | não | | |
| contato_id | uuid → contatos | não | | FK composta com `loja_id` |
| integracao_id | uuid → lojas_integracoes | **não** | | conta de entrada; responde por ela (`06/INV-55`) |
| status | text | não | `'aberta'` | CHECK `STATUS_CONVERSA` |
| prioridade | text | não | `'media'` | CHECK `PRIORIDADES` |
| responsavel_id | uuid → usuarios | sim | | filtro "minhas" |
| ultima_mensagem_em | timestamptz(3) | sim | | **contador/cache** |
| ultima_mensagem_previa | text | sim | | **contador/cache**, 100 chars |
| **ultima_entrada_em** | timestamptz(3) | sim | | **contador/cache** — instante da última mensagem **de entrada**; é a fonte da janela de 24 h |
| nao_lidas | integer | não | `0` | **contador/cache**, CHECK `>= 0` |
| primeira_resposta_em | timestamptz(3) | sim | | **contador/cache**; SLA de verdade (`01/R-21`) |
| sla_estourado_em | timestamptz(3) | sim | | **contador/cache** |
| resolvida_em / resolvida_por | timestamptz(3) / uuid → usuarios | sim | | |
| ...colunasAuditoria | | | | |

- **Único parcial** `(contato_id, integracao_id) WHERE status IN ('aberta','pendente') AND is_deleted = false`.
- Único `(id, loja_id)`. Índices: `(loja_id, status, ultima_mensagem_em DESC)`, `(integracao_id, status)`, `(responsavel_id, status)`, `(contato_id, created_at DESC)`.
- **`ultima_entrada_em` existe porque a UI bloqueia o composer quando a janela de 24 h fecha** (`04-ui.md §5.2`). Sem ela, descobrir a última mensagem de entrada exigiria varrer `conversas_mensagens` a cada render da lista. É atualizada na **mesma transação** da mensagem de entrada, por `atualizarContador()`.
- **Sem coluna `canal`**: o canal vem de `lojas_integracoes.provedor` por join. Coluna duplicada é coluna que diverge.
- `channel_conversation_id`, `sla_deadline` e `ai_summary` não existem (nunca foram escritos / IA fora de escopo).

**Conversa resolvida que recebe mensagem: REABRE** (decisão fechada; `04-ui.md` P-10, `01/R-19`, `01/D-38`). Regra exata do gateway, na mesma transação:

1. `UPDATE conversas SET status = 'aberta' WHERE id = <última conversa `resolvida` do par (contato, integracao)> AND is_deleted = false RETURNING id`;
2. violação do único parcial (já existe outra aberta criada nesse meio-tempo) → usa a **existente**, não cria nem falha;
3. conversa `arquivada` **não** reabre: nasce uma nova (arquivar é decisão explícita de encerrar o histórico);
4. a reabertura grava `conversa_reaberta` em `auditoria_eventos`, e a UI mostra o aviso inline "Enviar reabre a conversa".

### 2.3 `conversas_mensagens`

Colunas: `id uuid PK`, `loja_id`, `conversa_id NOT NULL → conversas` (FK composta), `direcao text NOT NULL` CHECK `DIRECOES`, `autor_tipo text NOT NULL` CHECK `AUTOR_TIPOS`, `autor_usuario_id uuid → usuarios` (da sessão, nunca do corpo — `06/INV-29`), `conteudo text` (CHECK `char_length <= 8000`), `tipo_conteudo text NOT NULL DEFAULT 'texto'` CHECK `TIPOS_CONTEUDO`, `externo_id text`, `status_entrega text` CHECK `STATUS_ENTREGA`, `status_atualizado_em`, `falha_motivo text`, `nota_interna boolean NOT NULL DEFAULT false`, `responde_a_id uuid → self`, `chave_idempotencia text`, `ocorrida_em timestamptz(3) NOT NULL` (**horário do provedor**), `metadados jsonb NOT NULL DEFAULT '{}'`, `...colunasAuditoria` (`created_at` = horário de gravação).

- Únicos parciais: `(loja_id, externo_id) WHERE externo_id IS NOT NULL AND is_deleted = false` (idempotência de webhook); `(conversa_id, chave_idempotencia) WHERE chave_idempotencia IS NOT NULL`.
- Único `(id, loja_id)`. Índice de cursor `(conversa_id, ocorrida_em DESC, id DESC)` — o antigo paginava por `created_at` em segundos e pulava mensagens (`01/D-27`). Índices `(loja_id, created_at DESC)`, `(autor_usuario_id)`.
- CHECK `mensagens_nota_sem_canal`: `(nota_interna = false) OR (externo_id IS NULL AND status_entrega IS NULL)`.
- CHECK `mensagens_conteudo_presente`: `conteudo IS NOT NULL OR tipo_conteudo <> 'texto'`. **A anonimização LGPD não viola este CHECK** porque grava um marcador, não `NULL` (§8).
- **Sem trava de colisão** (exceção da parte 1, §4.7): a linha é escrita uma vez e o estado é do provedor.

**Status de entrega — monotônico, com uma exceção escrita.** O `UPDATE` de recibo compara a posição na escala (`pendente < enviada < entregue < lida`, `falhou` terminal) no próprio `where`; `delivered` atrasado não rebaixa `lida` (`01/D-26`). **O reenvio é a única transição que sai de `falhou`** (`01/R-10`: uma mensagem, um estado; só `failed` é reenviável; sucesso limpa o motivo), e ele é um *claim* atômico:

```sql
UPDATE conversas_mensagens SET status_entrega = 'pendente', falha_motivo = NULL,
       status_atualizado_em = now()
WHERE id = $1 AND status_entrega = 'falhou' AND is_deleted = false RETURNING id;
```

Zero linhas = alguém já reenviou; nada acontece. O recibo vindo do provedor **nunca** sai de `falhou`. Um teste por transição.

**Card de produto / pedido / pagamento é derivado, não é tipo de conteúdo.** A mensagem é `tipo_conteudo = 'texto'` e `metadados.card = { tipo, id }`; a UI reconhece e renderiza o cartão. Motivo: o antigo tinha `content_type = 'product' | 'payment'`, valores que o adaptador não sabia enviar e que viravam falha de envio (`01/D-35`). Assim o cartão sobrevive a "pagamento não existe no R1" sem tocar no CHECK.

### 2.4 `conversas_mensagens_midias`

`id uuid PK`, `loja_id`, `mensagem_id NOT NULL → conversas_mensagens` (FK composta), `midia_id uuid → lojas_midias`, `url_externa text`, `externo_id text`, `tipo_arquivo text NOT NULL` CHECK `TIPOS_ARQUIVO_MENSAGEM`, `mime_type text NOT NULL`, `tamanho_bytes integer`, `legenda text`, `baixada boolean NOT NULL DEFAULT false`, `transcricao text`, `transcricao_status text` CHECK `STATUS_TRANSCRICAO`, `...colunasAuditoria`.

- Índices `(mensagem_id)`, `(transcricao_status) WHERE transcricao_status = 'pendente'`.
- CHECK `midias_origem`: `midia_id IS NOT NULL OR url_externa IS NOT NULL`. CHECK `url_externa ~ '^https?://'` (o antigo gravava base64 inteira quando o upload falhava — `01/D-33`).
- **`url_externa` é coluna de trabalho do job de download, não endereço de leitura.** O job `baixar-de-url` preenche `midia_id`, marca `baixada = true` e **limpa `url_externa` para `NULL`** no mesmo `UPDATE` (o CHECK continua satisfeito por `midia_id`). Se o download falhar, a UI mostra "mídia indisponível" — **nunca** o link do provedor. Motivo: a URL do provedor é pública e contornaria o portão de mídia (sessão + escopo de loja); o desenho de segurança afirma que "a URL persistida é sempre a rota interna", e só isto torna a afirmação verdadeira. **Trava**: `url_externa` presente em DTO de mensagem reprova.
- A leitura é sempre `GET /api/midias/[id]` (`?miniatura=1`), com `exigirSessao()` + escopo; mídia de outra loja responde 404.

### 2.5 `conversas_agendamentos`

`id uuid PK`, `loja_id`, `contato_id NOT NULL` (FK composta), `conversa_id`, `integracao_id NOT NULL`, `conteudo text`, `tipo_conteudo text NOT NULL` CHECK `TIPOS_CONTEUDO_AGENDAMENTO`, `template_id uuid → lojas_integracoes_templates`, `variaveis jsonb NOT NULL DEFAULT '[]'`, `midia_id uuid → lojas_midias`, `agendada_para timestamptz(3) NOT NULL`, `gatilho text NOT NULL` CHECK `GATILHOS_AGENDAMENTO`, `status text NOT NULL DEFAULT 'agendada'` CHECK `STATUS_AGENDAMENTO`, `enviada_em`, `mensagem_id uuid → conversas_mensagens`, `erro text`, `cancelada_por uuid → usuarios`, `...colunasAuditoria`.
Índice `(status, agendada_para) WHERE status = 'agendada'`. CHECK `(tipo_conteudo <> 'template') OR (template_id IS NOT NULL)`.
Agendamento **promocional** (gatilhos `promocao`, `reativacao`, `abandono`) respeita opt-out (§7.2); `manual`, `follow_up`, `pos_venda` e `aniversario`, não.

### 2.6 `contatos_etiquetas`

`id uuid PK`, `loja_id`, `contato_id NOT NULL → contatos`, `etiqueta_id NOT NULL → lojas_etiquetas`, `origem text NOT NULL DEFAULT 'manual'` CHECK `ORIGENS_ETIQUETA`, `...colunasAuditoria`. Único parcial `(contato_id, etiqueta_id) WHERE is_deleted = false`. Índice `(etiqueta_id)` (segmentação de campanha). Ligação pura: sem trava de colisão.

---

## 3. Mídia (2 tabelas)

### 3.1 `lojas_midias`

`id uuid PK` (gerado **antes** do upload: a chave depende dele), `loja_id → lojas`, `nome_original text`, `chave_objeto text NOT NULL` (`{loja}/{origem}/{uuid}.{ext}`; único), `chave_miniatura text`, `tipo_arquivo text NOT NULL` CHECK `TIPOS_ARQUIVO_MIDIA`, `mime_type text NOT NULL` (conferido contra a allowlist **e** os magic bytes), `tamanho_bytes integer NOT NULL` CHECK `> 0`, `largura`/`altura integer`, `duracao_ms integer`, `hash_sha256 text`, `origem text NOT NULL` CHECK `ORIGENS_MIDIA`, `pasta text` CHECK `PASTAS_MIDIA`, `enviada_por uuid → usuarios`, `...colunasAuditoria`.

- Único `chave_objeto`; único parcial `(loja_id, hash_sha256) WHERE hash_sha256 IS NOT NULL AND is_deleted = false`; único `(id, loja_id)`.
- Índices `(loja_id, origem, created_at DESC)`, `(loja_id, tipo_arquivo)`.
- CHECK `midias_pasta_por_origem`: `(origem = 'upload' AND pasta IS NOT NULL) OR (origem <> 'upload' AND pasta IS NULL)`. A galeria de produtos filtra `origem = 'upload'` por construção — a foto da cliente não cai mais lá (`01/D-51`).
- **Sem `produto_id`**: o vínculo é `produtos_midias` (o antigo tinha dois vínculos concorrentes que nunca se falavam).
- Exclusão é lógica e o binário fica; a rota de leitura **serve mídia soft-deletada quando referenciada por mensagem** (`03/RN-M06`). O binário só some na anonimização LGPD (§8) e na rotina `limpar-midia`, que remove objeto de linha excluída há mais de **90 dias** (default escrito, era a pendência `06/P-14`); o backup do bucket sai junto do `pg_dump` antes de deploy em PRD.

### 3.2 `lojas_midias_etiquetas`

`id`, `loja_id`, `midia_id → lojas_midias`, `etiqueta_id → lojas_etiquetas`, `...colunasAuditoria`. Único parcial `(midia_id, etiqueta_id) WHERE is_deleted = false`. Ligação pura.

---

## 4. Catálogo (4 tabelas)

**Fonte da verdade de produto, preço e estoque é o Bling, somente leitura** (ADR 0004/0015, `06/INV-79`). Fecha a pergunta `03/18.2`, que nenhum rascunho respondia:

- **Quem alimenta**: o job `sincronizar-bling` (fila `integracoes`) cria e atualiza `produtos` e `produtos_variacoes` casando por `codigo`/SKU, e carimba `sincronizado_em`. **Não existe cadastro manual de produto.**
- A tela `/produtos` é **100% leitura** e a matriz de permissão **não tem** `produtos:criar|editar|excluir` — apenas `produtos:ler`. (A linha correspondente de `02-seguranca.md §2.2` cai.)
- A trilha registra `produto_sincronizado` e `preco_alterado`, com ator `sistema`.

### 4.1 `produtos_categorias`

`id`, `loja_id → lojas`, `nome text NOT NULL`, `slug text NOT NULL`, `...colunasAuditoria`. Único parcial `(loja_id, slug) WHERE is_deleted = false`. Virou tabela porque a categoria era texto livre no banco e lista fechada na UI, e o filtro "Todas" mandava `all` e zerava a lista (`03/3.4.3`).

### 4.2 `produtos`

`id`, `loja_id`, `categoria_id uuid → produtos_categorias`, `nome text NOT NULL`, `sku text` (= `codigo` do Bling; único elo entre os catálogos), `descricao text`, `tipo_grade text NOT NULL DEFAULT 'ambos'` CHECK `TIPOS_GRADE`, `preco numeric(12,2) NOT NULL` CHECK `>= 0`, `preco_comparacao numeric(12,2)` CHECK `>= preco` quando presente, `preco_custo numeric(12,2)` (exposto só a dono/admin/gerente na camada de leitura), `peso_gramas integer`, `destacado boolean NOT NULL DEFAULT false`, `bling_produto_id text`, `sincronizado_em timestamptz(3)`, `...colunasAuditoria`.

Único parcial `(loja_id, sku) WHERE sku IS NOT NULL AND is_deleted = false` — o mesmo SKU pode existir nas duas lojas. Único `(id, loja_id)`. Índices `(loja_id, categoria_id)`, `(loja_id, destacado)`.
**`stock jsonb` não existe**: não era verdade de estoque e ainda assim alimentava o seletor de produto no chat, contradizendo o painel de venda (`03/A6`). `active` virou `is_deleted`.

**Grade de tamanhos (`03/RN-C08`)**, em `_enums/catalogo.ts`: `slim` = `PP, P, M, G, GG`; `plussize` = `46, 48, 50, 52, 54, 56, 58`; `ambos` = as duas, nessa ordem. É a grade que a UI oferece e que o job usa ao criar variações.

**Disponibilidade nunca é persistida** — é calculada (`06/INV-86`):

```
disponível(variação) = saldo do depósito da loja no Bling − reservado
reservado = Σ quantidade dos pedidos_itens cujo pedido tem
            masc_status = 'pendente' AND status NOT IN ('cancelado','devolvido'),
            casado por SKU; sem SKU não desconta; nunca negativo
```

A fórmula mora em `src/lib/catalogo/` (uma função, um teste) e o cálculo **não escreve** em lugar nenhum.

### 4.3 `produtos_variacoes`

`id`, `loja_id`, `produto_id NOT NULL → produtos` (FK composta), `tamanho text NOT NULL`, `sku text`, `bling_produto_id text`, `...colunasAuditoria`.
Únicos parciais `(produto_id, tamanho) WHERE is_deleted = false` e `(loja_id, sku) WHERE sku IS NOT NULL AND is_deleted = false`. Existe para a reserva ser **por tamanho** (`02/O-08`); sem SKU por variação, o cálculo degrada para o nível do produto — sem migração futura.

### 4.4 `produtos_midias`

`id`, `loja_id`, `produto_id NOT NULL → produtos`, `midia_id NOT NULL → lojas_midias` (as duas FKs compostas), `ordem integer NOT NULL DEFAULT 0`, `...colunasAuditoria`. Único parcial `(produto_id, midia_id) WHERE is_deleted = false`. Índice `(produto_id, ordem)`. Ligação pura.
A "1ª foto" (`ordem = 0`) vai ao chat como **mídia** (URL assinada de 600 s gerada no envio), nunca como link — o bucket é privado e o link quebrava para a cliente (`03/3.4.9`).

---

## 5. Conteúdo e campanhas (8 tabelas)

### 5.1 `lookbooks`, `lookbooks_midias`, `lookbooks_produtos`

- `lookbooks`: `id`, `loja_id`, `nome text NOT NULL`, `descricao text`, `capa_midia_id uuid → lojas_midias`, `...colunasAuditoria`. **Com trava de colisão.**
- `lookbooks_midias` e `lookbooks_produtos`: ligação com `ordem integer NOT NULL DEFAULT 0` e único parcial `(lookbook_id, <alvo>_id) WHERE is_deleted = false`. Ligações puras.
Os três arrays sem FK do antigo (`cover_media_id`, `media_ids`, `product_ids`) permitiam referência cruzada entre lojas e ids mortos. **Fora do R1** (tabelas criadas, sem tela).

### 5.2 `respostas_rapidas`

`id`, `loja_id`, `titulo text NOT NULL`, `conteudo text NOT NULL`, `categoria text` CHECK `CATEGORIAS_RESPOSTA`, `atalho text` CHECK `^/[a-z0-9-]{1,30}$`, `ativa boolean NOT NULL DEFAULT true`, `...colunasAuditoria`. Único parcial `(loja_id, atalho) WHERE atalho IS NOT NULL AND is_deleted = false` (excluir `/frete` e recriar dava 500 — `03/7.3.1`). **Com trava de colisão.**

### 5.3 `base_conhecimento_artigos` e `base_conhecimento_artigos_etiquetas`

`id`, `loja_id`, `titulo text NOT NULL`, `conteudo text NOT NULL`, `categoria text` CHECK `CATEGORIAS_ARTIGO`, `criado_por uuid → usuarios`, `...colunasAuditoria`. **Com trava de colisão.** Ligação de etiquetas igual às demais. `is_public` sai (não tinha semântica nem consumidor). **Fora do R1.**

### 5.4 `campanhas`

`id`, `loja_id`, `nome text NOT NULL`, `integracao_id uuid NOT NULL → lojas_integracoes` (conta de saída explícita), `template_id uuid → lojas_integracoes_templates`, `conteudo_texto text` (uazapi, sem template), **`variaveis jsonb NOT NULL DEFAULT '[]'`**, `segmento jsonb NOT NULL DEFAULT '{}'`, `status text NOT NULL DEFAULT 'rascunho'` CHECK `STATUS_CAMPANHA`, `agendada_para`, `iniciada_em`, `concluida_em`, `total_destinatarios integer NOT NULL DEFAULT 0` (retrato da materialização), `criada_por uuid NOT NULL → usuarios`, `...colunasAuditoria`.

- CHECK `campanhas_conteudo`: `template_id IS NOT NULL OR conteudo_texto IS NOT NULL`. Índices `(loja_id, status)`, `(status, agendada_para) WHERE status = 'agendada'`. Único `(id, loja_id)`.
- **`variaveis` existe porque o defeito `03/C1`/`C3` era exatamente a falta dela**: o disparo oficial mandava sempre uma variável (`[nome do contato]`), e a Meta **recusa** template com 0 ou 2+ variáveis. Mesmo tipo fechado de `conversas_agendamentos.variaveis`; o marcador `{nome_contato}` é resolvido por destinatário. **Regra de aplicação com teste**: a campanha não sai de `rascunho` se `variaveis.length <> template.variaveis_contagem`.
- Contadores derivados (`enviados`, `entregues`, `lidos`, `respondidos`, `falhas`) **não são colunas**: são `count(*)` sobre `campanhas_destinatarios`. O antigo tinha 6 contadores e 4 nunca eram atualizados — métrica que mente.

### 5.5 `campanhas_destinatarios`

`id`, `loja_id`, `campanha_id NOT NULL → campanhas` (FK composta), `contato_id NOT NULL → contatos` (FK composta), `status text NOT NULL DEFAULT 'pendente'` CHECK `STATUS_DESTINATARIO`, `mensagem_id uuid → conversas_mensagens`, `externo_id text`, `erro text`, `reservado_em`, `enviado_em`, `entregue_em`, `lido_em`, `respondido_em`, `tentativas integer NOT NULL DEFAULT 0`, `...colunasAuditoria`.

- Único parcial `(campanha_id, contato_id) WHERE is_deleted = false` — a corrida na materialização mandava a campanha duas vezes para a mesma cliente (`03/C1`).
- Índice `(campanha_id, status, created_at)` (reserva `FOR UPDATE SKIP LOCKED`) e `(reservado_em) WHERE status = 'reservado'` (lease: linha reservada há mais de N minutos volta a `pendente` — corrige `03/A2`).
- `mensagem_id` é o que faz a campanha **aparecer na conversa** da cliente e o recibo atualizar o destinatário.
- Máquina de estado de sistema: usa `atualizarEstado()`, sem trava de colisão.

---

## 6. CRM e pedidos (8 tabelas)

### 6.1 `negocios`

`id`, `loja_id`, `contato_id NOT NULL → contatos` (FK composta), `conversa_id uuid → conversas`, `responsavel_id uuid → usuarios`, `estagio text NOT NULL DEFAULT 'lead'` CHECK `ESTAGIOS_NEGOCIO`, `valor numeric(12,2) NOT NULL DEFAULT '0'` CHECK `>= 0`, `motivo_perda text` CHECK `MOTIVOS_PERDA`, `observacao_perda text`, `previsao_fechamento date`, `ultima_atividade_em timestamptz(3) NOT NULL DEFAULT now()` (**contador/cache**), `...colunasAuditoria`.

- CHECK `negocios_perda_com_motivo`: `(estagio <> 'perdido') OR (motivo_perda IS NOT NULL)`.
- Índices `(loja_id, estagio, ultima_atividade_em DESC)`, `(contato_id)`, `(responsavel_id)`.
- **Sem `negocios_eventos`**: a linha do tempo lê `auditoria_eventos` por `(entidade = 'negocios', entidade_id)`.
- **Regra `02/RN-DL5` + `06/INV-100`, que faltava em todos os rascunhos**: criar pedido com `negocio_id` preenchido move o negócio para `ganho` e grava `negocio_estagio_alterado` **na mesma transação** do pedido. Vale mesmo com o funil fora do R1 — são três linhas dentro de uma transação que já existe; se a regra não nascer agora, ela dorme com a tabela e o dado fica errado no dia em que a tela ligar.
- **Fora do R1** (tabela criada, sem tela).

### 6.2 `pedidos_numeracao`

Contador atômico por loja e mês. `loja_id uuid NOT NULL → lojas`, `ano_mes text NOT NULL`, `ultimo_numero integer NOT NULL DEFAULT 0`, `...colunasAuditoria`. **PK composta `(loja_id, ano_mes)`** (exceção a "uuid em tudo", ADR 0019: é contador, não entidade).

- CHECK `numeracao_ano_mes`: `ano_mes ~ '^[0-9]{2}(0[1-9]|1[0-2])$'` — o `^\d{4}$` do rascunho aceitava `0000` e `9999` como se fossem `AAMM` válidos.
- **CHECK `numeracao_nunca_excluida`: `is_deleted = false`.** Sem ele, uma linha marcada como excluída (por engano ou rotina) travaria a numeração da loja no mês: o `INSERT ... ON CONFLICT` colide com a PK e o `UPDATE` filtrado por `vivos()` não acha a linha.
- **A consulta do contador não passa por `vivos()`** (é estrutura de sistema, e o CHECK acima garante que não há linha morta):
  ```sql
  INSERT INTO pedidos_numeracao (loja_id, ano_mes) VALUES ($1,$2) ON CONFLICT DO NOTHING;
  UPDATE pedidos_numeracao SET ultimo_numero = ultimo_numero + 1, updated_at = now()
  WHERE loja_id = $1 AND ano_mes = $2 RETURNING ultimo_numero;
  ```
- `ano_mes` é calculado em `America/Sao_Paulo` — o antigo usava o fuso do container e jogava a venda das 21h do último dia no mês seguinte (`02/O-09`).

### 6.3 `pedidos`

`id`, `loja_id`, `contato_id NOT NULL → contatos` (FK composta), `negocio_id uuid → negocios`, `conversa_id uuid → conversas`, `numero text NOT NULL` (`MS{AAMM}-{SIGLA}-{NNNN}`), `status text NOT NULL DEFAULT 'confirmado'` CHECK `STATUS_PEDIDO`, `pagamento_status text NOT NULL DEFAULT 'pendente'` CHECK `STATUS_PAGAMENTO_PEDIDO`, `subtotal`/`frete`/`desconto`/`total numeric(12,2) NOT NULL DEFAULT '0'` (CHECK `>= 0` cada), `forma_pagamento text` CHECK `FORMAS_PAGAMENTO`, `entrega_metodo text`, `rastreio_codigo text`, `rastreio_url text` CHECK `^https://`, `endereco_entrega jsonb`, `observacoes text`, `masc_status text NOT NULL DEFAULT 'pendente'` CHECK `MASC_STATUS`, `masc_venda_id text`, `masc_lancado_em`, `masc_lancado_por uuid → usuarios`, `masc_observacao text`, `cancelado_em`, `cancelado_motivo text`, `criado_por uuid NOT NULL → usuarios`, `...colunasAuditoria`.

- CHECK `pedidos_total_coerente`: `total = subtotal + frete - desconto`; CHECK `desconto <= subtotal`.
- CHECK `pedidos_masc_lancado`: `(masc_status <> 'lancado') OR (masc_venda_id IS NOT NULL AND masc_lancado_em IS NOT NULL)`.
- CHECK `pedidos_masc_dispensado`: `(masc_status <> 'dispensado') OR (masc_observacao IS NOT NULL)`.
- Únicos parciais `(loja_id, numero) WHERE is_deleted = false` e `(loja_id, masc_venda_id) WHERE masc_venda_id IS NOT NULL AND is_deleted = false`. Único `(id, loja_id)`.
- **Índice da fila "falta lançar" (corrigido)**: `(loja_id, masc_status) WHERE masc_status = 'pendente' AND status NOT IN ('cancelado','devolvido')`. O do rascunho não filtrava `status` — pedido cancelado continuava reservando estoque e poluindo a fila, que é o defeito `02/O-06`. O mesmo filtro é o que faz a fórmula do reservado (§4.2) bater com o índice.
- Demais índices: `(loja_id, created_at DESC)`, `(contato_id)`, `(negocio_id)`.
- Voltar para `pendente` **preserva** `masc_venda_id`, `masc_lancado_em` e `masc_lancado_por` (`06/INV-96`).

### 6.4 `pedidos_itens`

`id`, `loja_id`, `pedido_id NOT NULL → pedidos` (FK composta), `produto_id NOT NULL → produtos` (RESTRICT: produto de pedido não some), `variacao_id uuid → produtos_variacoes`, `sku text` (snapshot), `nome text NOT NULL` (snapshot), `tamanho text NOT NULL`, `quantidade integer NOT NULL` CHECK `> 0`, `preco_unitario numeric(12,2) NOT NULL` CHECK `>= 0`, `total_item numeric(12,2) NOT NULL` CHECK `>= 0`, `...colunasAuditoria`.
CHECK `itens_total_coerente`: `total_item = preco_unitario * quantidade`. Índices `(pedido_id)`, `(produto_id)`, `(variacao_id)`.
**Preço e nome vêm do catálogo no servidor**, nunca do cliente (`02/O-01`); o snapshot serve para o histórico não mudar quando o preço mudar.

### 6.5 `pagamentos`

`id`, `loja_id NOT NULL → lojas`, `pedido_id NOT NULL → pedidos` (FK composta), `provedor text NOT NULL` CHECK `PROVEDORES_PAGAMENTO`, `metodo text NOT NULL` CHECK `METODOS_PAGAMENTO`, `status text NOT NULL DEFAULT 'pendente'` CHECK `STATUS_PAGAMENTO`, `valor numeric(12,2) NOT NULL` CHECK `> 0`, `externo_id text`, `pix_copia_cola text`, `qrcode_midia_id uuid → lojas_midias`, `link_pagamento text`, `expira_em`, `pago_em`, `estornado_em`, `criado_por uuid → usuarios`, `...colunasAuditoria`.
Único parcial `(provedor, externo_id) WHERE externo_id IS NOT NULL AND is_deleted = false` (o webhook antigo buscava `external_id` global, sem provedor e sem loja). Índices `(pedido_id)`, `(loja_id, status)`, `(status, expira_em) WHERE status = 'pendente'`. O QR vai para o MinIO, não para a linha.
**Fora do R1**: tabela criada, sem escrita (não há provedor contratado e não há webhook de pagamento na v2).

### 6.6 `pedidos_devolucoes`, `pedidos_devolucoes_itens`, `pedidos_devolucoes_midias`

- `pedidos_devolucoes`: `id`, `loja_id`, `pedido_id NOT NULL → pedidos` (FK composta), `contato_id NOT NULL → contatos`, `conversa_id uuid → conversas`, `tipo text NOT NULL` CHECK `TIPOS_DEVOLUCAO`, `motivo text NOT NULL` CHECK `MOTIVOS_DEVOLUCAO`, `motivo_detalhe text`, `status text NOT NULL DEFAULT 'solicitada'` CHECK `STATUS_DEVOLUCAO`, `rastreio_codigo text`, `valor_estorno numeric(12,2)` CHECK `>= 0`, `metodo_estorno text` CHECK `METODOS_ESTORNO`, `pagamento_id uuid → pagamentos`, `resolvido_por uuid → usuarios`, `resolvido_em`, `...colunasAuditoria`. **Com trava de colisão.**
  - CHECK `devolucoes_resolucao`: `(status NOT IN ('concluida','negada')) OR (resolvido_por IS NOT NULL AND resolvido_em IS NOT NULL)`.
  - `valor_estorno <= pedidos.total` é regra de aplicação com teste (CHECK não cruza tabela) — corrige `02/T-01`.
- `pedidos_devolucoes_itens`: `id`, `loja_id`, `devolucao_id → pedidos_devolucoes` (FK composta), `pedido_item_id → pedidos_itens`, `quantidade integer NOT NULL` CHECK `> 0`, `...colunasAuditoria`. Único parcial `(devolucao_id, pedido_item_id)`. Regra: soma por item ≤ quantidade do pedido.
- `pedidos_devolucoes_midias`: ligação para `lojas_midias` (fotos do defeito).

**Efeito de uma devolução concluída — as quatro consequências que faltavam** (`02/T-03`, `02/14.17`), todas na **mesma transação**:

1. `pedidos.status` vira `devolvido` (e `pagamento_status` vira `estornado` quando há estorno registrado);
2. **sai da reserva** automaticamente — o índice e a fórmula do §4.2 excluem `status IN ('cancelado','devolvido')`, então não há nada a mais a fazer;
3. `contatos.pedidos_valor_total` é reduzido pelo valor do pedido e `pedidos_contagem` decrementado, via `atualizarContador()`;
4. se o pedido já estava `lancado` no Masc, **gera alerta** `pagamento_pendente` com a mensagem "estornar no Masc" — o sistema **não** escreve no ERP (a ponte é manual, DN).

Grava `devolucao_concluida` em `auditoria_eventos`. **Fora do R1**: tabelas criadas, sem tela.

---

## 7. Pós-venda, consentimento e LGPD (3 tabelas)

### 7.1 `pesquisas_satisfacao`

`id`, `loja_id`, `contato_id NOT NULL`, `conversa_id`, `pedido_id`, `nota integer` CHECK `BETWEEN 1 AND 5`, `comentario text`, `gatilho text NOT NULL` CHECK `GATILHOS_PESQUISA`, `mensagem_id uuid → conversas_mensagens` (prova de que foi **enviada**), `enviada_em`, `respondida_em`, `...colunasAuditoria`.
Único parcial `(pedido_id, gatilho) WHERE pedido_id IS NOT NULL AND is_deleted = false`. `comentario` é campo livre com PII → entra na anonimização (§8). **Fora do R1**: tabela criada, sem tela.

### 7.2 `consentimentos` — `compliance:append-only`

`id uuid PK`, `criado_em timestamptz(3) NOT NULL DEFAULT now()`, `loja_id uuid NOT NULL`, `contato_id uuid NOT NULL`, `tipo text NOT NULL` CHECK `TIPOS_CONSENTIMENTO`, `concedido boolean NOT NULL`, `origem text NOT NULL` CHECK `ORIGENS_CONSENTIMENTO`, `canal text`, `mensagem_id uuid`, `termo_versao text NOT NULL`, `ip text`, `registrado_por uuid`.
Sem FK (é trilha). Índices `(contato_id, criado_em DESC)`, `(loja_id, tipo, criado_em DESC)`. `ip` vem do servidor, nunca do corpo (`02/L-08`). `termo_versao` existe para provar **o que** a pessoa aceitou.

**Opt-out: decisão fechada** (`01/R-28`, `01/D-54` — hoje só a campanha confere; o chat não confere nada):

- **Opt-out é de marketing.** Bloqueia **campanha** e **agendamento promocional** (gatilhos `promocao`, `reativacao`, `abandono`). **Não bloqueia** a resposta 1:1 do atendimento: impedir a vendedora de responder uma cliente que escreveu para a loja seria pior para a cliente e para a LGPD (a resposta a um contato iniciado pela titular tem outra base legal).
- A ficha do contato mostra o **selo de opt-out**, para a vendedora conhecer o contexto antes de oferecer promoção.
- **Espelho sem porta dos fundos**: `contatos.opt_out`/`opt_out_em` só são escritos por `registrarConsentimento()`, a **única** função que grava em `consentimentos`, e sempre na mesma transação. Não existe segundo caminho de escrita.
- **O filtro de campanha lê a verdade, não o espelho**: a materialização de destinatários consulta a última linha de `consentimentos` por contato (índice `(contato_id, criado_em DESC)`), não `contatos.opt_out`. O espelho serve para listar e exibir.
- O job noturno de reconciliação (espelho × última linha; `pedidos_contagem`/`pedidos_valor_total` × `pedidos`) **gera alerta** quando acha divergência — **não corrige em silêncio**. Correção silenciosa esconde o bug que causou a divergência.

### 7.3 `lgpd_solicitacoes`

`id`, `loja_id NOT NULL`, `contato_id NOT NULL → contatos`, `tipo text NOT NULL` CHECK `TIPOS_LGPD` (`acesso`, `eliminacao`, `correcao`), `protocolo text NOT NULL`, `motivo text`, `solicitado_em timestamptz(3) NOT NULL`, `executado_por uuid → usuarios`, `executado_em`, `resultado jsonb`, `...colunasAuditoria`. Único parcial `(loja_id, protocolo) WHERE is_deleted = false`.

**Conteúdo do dossiê de `acesso`** (fecha `02/L-11`, em que a exportação saía incompleta — sem negócios, trocas e pagamentos): `contatos` (dados cadastrais e etiquetas) · `conversas` + `conversas_mensagens` + legendas e transcrições de mídia · `pedidos` + `pedidos_itens` + `pagamentos` · `pedidos_devolucoes` + itens · `negocios` · `consentimentos` (histórico completo) · `pesquisas_satisfacao` · `conversas_agendamentos`. Sai paginado (nunca "todas as mensagens numa resposta"), com `Cache-Control: no-store`, e o download é registrado na trilha (`lgpd_exportado`).

**Fluxo mínimo de `correcao`**: registra a solicitação e o protocolo; a correção em si sai pela **edição normal do contato** (com trilha `contato_alterado`); `resultado` guarda quais campos foram corrigidos. Não há tela nova — é direito do art. 18, III e custa uma linha de registro.

---

## 8. LGPD: anonimização no lugar do delete físico

**Decisão** (ADR 0013): a eliminação do art. 18, VI é **anonimização irreversível em transação única**, nunca `DELETE`.

`anonimizarContato(contatoId, protocolo, motivo)` — ordem exata:

1. grava `auditoria_eventos` (`lgpd_anonimizado`) **antes** do efeito, com `contato_id` e protocolo, **sem PII** (o efeito destrói o estado anterior; trilha depois seria trilha nenhuma);
2. `UPDATE contatos SET nome = 'Titular anonimizado', telefone = NULL, email = NULL, whatsapp_id = NULL, instagram_id = NULL, facebook_id = NULL, tiktok_id = NULL, avatar_url = NULL, observacoes = NULL, endereco = NULL, aniversario = NULL, anonimizado_em = now()`;
3. **`UPDATE conversas_mensagens SET conteudo = '[removido a pedido do titular]', metadados = '{}'`** nas conversas do contato. **Marcador, não `NULL`** — `NULL` violaria o CHECK `mensagens_conteudo_presente` (`conteudo IS NOT NULL OR tipo_conteudo <> 'texto'`) e abortaria a transação inteira em qualquer contato que tivesse ao menos uma mensagem de texto, ou seja, **todos**. Era o defeito que tornava o caminho LGPD inexecutável;
4. `UPDATE conversas_mensagens_midias SET legenda = NULL, transcricao = NULL` e `UPDATE pesquisas_satisfacao SET comentario = NULL` nas linhas do contato — campos livres também guardam PII;
5. as mídias recebidas daquele contato ficam marcadas `is_deleted` com `deleted_at`; **o objeto no MinIO não é apagado aqui** (ver abaixo);
6. `lgpd_solicitacoes.resultado` recebe a contagem por tabela; `objetos_removidos` é preenchido depois, pelo job;
7. pedidos, itens e pagamentos **permanecem** com valores, número e SKU (registro fiscal), apontando para o contato anonimizado.

**O binário sai fora da transação.** A transação enfileira `limpar-midia` com `jobId` determinístico; o job apaga os objetos **depois do commit** e é idempotente (objeto já ausente = sucesso), e então atualiza `objetos_removidos`. Motivo: I/O externo dentro da transação é o pior dos dois mundos — se o commit falhar depois do `DELETE` no S3, o binário já foi e a linha continua apontando para ele; se o S3 demorar, a transação segura locks. É a **única** exclusão física do sistema, e ela é de arquivo, não de linha.

**Alcance completo (o que o rascunho não alcançava)**:

| Depósito de PII | Como é tratado |
|---|---|
| `contatos`, `conversas_mensagens`, mídias | passos 2–5 acima |
| `conversas_mensagens_midias.transcricao`, `pesquisas_satisfacao.comentario` | passo 4 |
| `lojas_integracoes_eventos.corpo` (corpo cru do webhook) | **não acumula PII**: o corpo é mascarado no mesmo `UPDATE` que marca `processado_em`, e a retenção de 30 dias anonimiza o resto (parte 1, §6.4). Não há o que caçar por titular |
| `auditoria_eventos.antes/depois` | **não guarda valor de campo PII**: o diff grava `"(alterado)"` para os campos de `CAMPOS_PII` (parte 1, §7.2) |
| `auth_eventos.email_hash` | é HMAC, não e-mail; e é de colaborador, não de cliente |

**Teste de aceitação obrigatório**: anonimizar um contato com mensagem de texto, mídia com transcrição, pesquisa respondida e pedido lançado; a transação fecha; e uma varredura pelo telefone do titular em **todas** as tabelas volta vazia.

Escopo continua **por loja** (DN-05): a mesma pessoa nas duas lojas são dois contatos e duas solicitações; a tela avisa.

---

## 9. Diagrama de relacionamento (domínio)

```
lojas ─┬─1:N─ contatos ─┬─1:N─ contatos_etiquetas ──N:1── lojas_etiquetas
       │                ├─1:N─ conversas ──N:1── lojas_integracoes
       │                │        ├─1:N─ conversas_mensagens ─┬─1:N─ conversas_mensagens_midias ──N:1── lojas_midias
       │                │        │        └─self─ responde_a_id (citação)
       │                │        └─1:N─ conversas_agendamentos
       │                ├─1:N─ negocios ──0:1── conversas          (pedido com negocio_id ⇒ estágio 'ganho')
       │                ├─1:N─ pedidos ─┬─1:N─ pedidos_itens ──N:1── produtos / produtos_variacoes
       │                │               ├─1:N─ pagamentos
       │                │               └─1:N─ pedidos_devolucoes ─┬─1:N─ devolucoes_itens ──N:1── pedidos_itens
       │                │                                          └─1:N─ devolucoes_midias ──N:1── lojas_midias
       │                ├─1:N─ campanhas_destinatarios ──N:1── campanhas ──N:1── lojas_integracoes_templates
       │                ├─1:N─ pesquisas_satisfacao
       │                ├─1:N─ consentimentos            (append-only, sem FK)
       │                └─1:N─ lgpd_solicitacoes
       ├─1:N─ produtos_categorias ─1:N─ produtos ─┬─1:N─ produtos_variacoes
       │                                          └─1:N─ produtos_midias ──N:1── lojas_midias
       ├─1:N─ lookbooks ─┬─1:N─ lookbooks_midias ──N:1── lojas_midias
       │                 └─1:N─ lookbooks_produtos ──N:1── produtos
       ├─1:N─ respostas_rapidas
       ├─1:N─ base_conhecimento_artigos ─1:N─ ..._etiquetas ──N:1── lojas_etiquetas
       ├─1:N─ lojas_midias ─1:N─ lojas_midias_etiquetas
       ├─1:N─ pedidos_numeracao   (PK loja_id + ano_mes; nunca excluída)
       └─1:N─ alertas → conversa | contato | pedido | negocio

auditoria_eventos (append-only, sem FK) ← linha do tempo por (entidade, entidade_id, criado_em)
```

Toda tabela acima tem `loja_id` próprio **e** FK composta `(id, loja_id)` para o pai, quando o pai tem loja (parte 1, §4.6). É o que torna mecânica a varredura "toda consulta de domínio filtra `loja_id`" (`07/REQ-H10`) **e** impossível um filho apontar para pai de outra loja.

---

## 10. De-para com o sistema antigo (nada perdido)

| Modelo antigo | Vira | Observação |
|---|---|---|
| `stores` | `lojas` | `+sigla`, `-ativo` |
| `stores_integracoes` | `lojas_integracoes` | `+segredo_webhook_hash`, `+credenciais_aad`, `+revogada_em`; CHECK de equivalência rede × loja |
| `users` | `usuarios` | `+5 colunas`, `+bloqueio`, `+flags de 2º fator`; nunca apagado; 5 papéis |
| — | `usuarios_contas/sessoes/verificacoes/totp/passkeys/convites/senhas_historico/trocas_email` | novas (Better Auth endurecido) |
| `activity_logs` | `auditoria_eventos` | append-only real, lista fechada, sem PII no diff |
| — | `auth_eventos` | nova: login, falha, bloqueio, logout, 403, posse |
| — | `lojas_integracoes_eventos` | nova: diário de ingestão com corpo mascarado |
| `contacts` | `contatos` (+`contatos_etiquetas`) | telefone E.164; `tags[]` → catálogo; `+ultima_compra_em` |
| `conversations` | `conversas` | `integracao_id NOT NULL`; `+ultima_entrada_em`; sem `channel`, `sla_deadline`, `ai_summary` |
| `messages` | `conversas_mensagens` | `+direcao`, `+ocorrida_em`, `+chave_idempotencia`, reply real, card por `metadados` |
| `message_media` | `conversas_mensagens_midias` | `+auditoria`, `+índice`, sem data-URI, `url_externa` limpa após download |
| `media_files` | `lojas_midias` (+etiquetas) | `+origem`, `+hash`, `-folder livre`, `-produto_id` |
| `products` | `produtos` (+categorias, variações, mídias) | `-stock jsonb`, `-image_urls[]`, `-active`; alimentado pelo Bling |
| `lookbooks` | `lookbooks` + 2 ligações | arrays viram FK |
| `quick_replies` | `respostas_rapidas` | `-media_ids[]`, atalho validado |
| `whatsapp_templates` | `lojas_integracoes_templates` | preso à conta/WABA, `+variaveis_contagem` |
| `knowledge_articles` | `base_conhecimento_artigos` (+etiquetas) | `-is_public` |
| `broadcasts` | `campanhas` | `integracao_id NOT NULL`, `+variaveis`, contadores derivados |
| `broadcast_recipients` | `campanhas_destinatarios` | `+único (campanha, contato)`, `+lease`, `+mensagem_id` |
| `scheduled_messages` | `conversas_agendamentos` | `+auditoria`, `+integracao_id` |
| `deals` | `negocios` | `+CHECK de perda`, valor ≥ 0, `+regra de negócio ganho` |
| `deal_events` / `order_events` | `auditoria_eventos` | trilha única |
| `orders` | `pedidos` (+`pedidos_numeracao`) | `+soft delete`, `+CHECKs`, índice da fila com filtro de status |
| `orders.items` | `pedidos_itens` | JSON → tabela com FK |
| `payments` | `pagamentos` | `+loja_id`, `+autor`, `+único por provedor` |
| `returns` | `pedidos_devolucoes` (+itens, +mídias) | `+4 consequências escritas` |
| `satisfaction_surveys` | `pesquisas_satisfacao` | `+nota 1..5`, `+mensagem_id` |
| `consent_logs` | `consentimentos` | `+termo_versao`, `+origem`, IP do servidor, espelho por função única |
| `alerts` | `alertas` | `+chave_deduplicacao`, resolução pelo gerador |
| — | `lgpd_solicitacoes` | nova: prova do atendimento ao titular, dossiê definido |

Colunas removidas (`channel_conversation_id`, `sla_deadline`, `media_files.duration` nunca preenchida, `messages.ai_classification`, `conversations.ai_summary`, `products.stock`, `knowledge_articles.is_public`, `quick_replies.media_ids`, `stores.ativo`, `users.email_pendente`) estão justificadas uma a uma no texto ou eram código morto declarado em `01/§19` e `03/§17`.

---

**Catálogo de nomes, papéis e enums**: `spec/final/01-dados.md §16`. **Problemas rejeitados**: `§15` do mesmo arquivo.
