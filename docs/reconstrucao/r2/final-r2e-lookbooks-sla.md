# R2-E — Lookbooks e SLA configurável (especificação FINAL)

- **Alvo**: `C:\Users\Paulo\Documents\MerlostoreChat`, branch `refactor/reconstrucao-estrutura-base`.
- **Base**: a fundação commitada termina em `9481ef8` (`fix(auth): não registrar a sessão pré-2FA como login_sucesso`). Nenhum arquivo da fundação mudou depois disso. No momento desta consolidação o HEAD já tem commits de módulo (M3, M4 e M8, por exemplo `e88d181 feat(alertas)`). Onde este documento cita código de módulo do R1, a citação vem marcada **"código de M-x em andamento"**. O contrato que vale é o desta especificação e o do teste que o prova.
- **Fontes**: `spec/final/01-dados.md` §4.6, §4.7, §6.6, §13, §16; `01-dados-dominio.md` §2.2–2.4, §5.1, §7.2; `02-seguranca.md` §2.2, §2.4; `03-arquitetura.md` §4.3, §8, §10, §13.3, §14; `04-ui.md` §2.9, §4.1, §5.2, §5.5, §5.6, §7, §8.1, §9.1, §10; `05-plano-construcao.md` §2, §3.3, §5, §6, §8. Levantamento: `03` §2.4 e §6, `04` §9, `05` §5.22, `06` P-18. Os outros quatro rascunhos do R2 foram lidos para manter a consistência.
- **Numeração final**:
  - migrações: `0018_r2` (gerada, **única** para os cinco clusters) e `0019_r2_integridade` (custom, **única**);
  - ADRs: **0054 a 0057**;
  - banco de teste: `merlostore_test_r2e1` e `merlostore_test_r2e2`;
  - Redis: índices **13** e **14**.
- **Dois subpacotes independentes**, que rodam **depois** do delta da §10: **R2-E1 Lookbooks** e **R2-E2 SLA**. Eles não compartilham arquivo e podem rodar em paralelo.
- **Leitor-alvo**: o agente construtor. Ele não lê o rascunho. Tudo o que precisa está aqui.

---

## 1. Escopo e o que o sistema antigo tinha

### 1.1 Escopo do R2-E

| Entra | Não entra (e por quê) |
|---|---|
| **Lookbook**: montar, em ordem, a partir de **fotos enviadas à Galeria** e de **produtos do catálogo** da loja, com lista, editor e exclusão lógica | Página ou link público do lookbook (sem URL pública, R2-LB-11) |
| **Enviar lookbook pela conversa**: prévia, block de 3 s e **uma** mensagem com N fotos e um texto, pela conta de entrada da conversa | Envio por campanha ou agendamento; envio por IA (no R2 há sempre uma pessoa no meio) |
| **SLA configurável** por loja: prazo de resposta **por canal** e **por prioridade**, em tela só para dono e admin | Horário comercial; aviso "X minutos antes"; e-mail ou push de SLA (ADR 0056 e 0057) |
| A regra `sla_estourado` de M8 passa a ler o prazo da loja pela costura `src/lib/sla/prazo.ts`. A resolução passa a ser conservadora: afrouxar o prazo não esconde atraso (delta D16) | Novos tipos de alerta; mudança na dedupe de M8 |
| Prazos vigentes visíveis a **todos** em `/alertas` (hoje o texto é fixo) | Contagem regressiva por conversa na lista. O chip "SLA estourado" do R1 continua |

### 1.2 O que existia (commit `5e902d4`) e os defeitos que não podem voltar

**Lookbooks** (`levantamento/03` §2.4 e §6)

| # | Defeito antigo | Como o R2-E fecha |
|---|---|---|
| LB-D1 | A funcionalidade era **casca**: a tela só editava nome e descrição. Não havia como pôr foto, produto ou capa, nem como enviar no chat | Editor completo (R2-LB-02..05) e envio pela conversa (R2-LB-09..15) |
| LB-D2 | A tela ficava **fora do menu** (só pela URL `/gallery/lookbooks`) | Item "Lookbooks" no catálogo de navegação (D10) |
| LB-D3 | `product_ids`, `media_ids` e `cover_media_id` eram **arrays sem FK** e **sem conferência de loja**: referência cruzada entre lojas e ids mortos (achado A10) | Ligações `lookbooks_midias`/`lookbooks_produtos` (já existem). O app confere a loja (INV-10) **e** o banco recusa pelas **FKs compostas** `(id, loja_id)` (D4) |
| LB-D4 | `PUT` sem Zod; update sem `modifiedBy`; sem trilha; sem trava de colisão | Zod estrito, `atualizarComTrava`, `inserirAuditado`/`excluirLogico` com ação da lista fechada |
| LB-D5 | Lista sem paginação (achado M14) | Cursor `(created_at, id)`, 30 por página |
| LB-D6 | Galeria do chat com problemas: legenda única; arquivo não encontrado **pulado em silêncio**; envio que falhava **não gravava mensagem `failed`**; exceção no meio do laço fazia o reenvio **duplicar**; nenhum teste de tipo por canal | Prévia que mostra o que fica de fora; o servidor confere se as fotos e o texto são os da prévia; **uma** mensagem por `registrarEnvio`, com `ordem` das fotos (D4, D15); `chave_idempotencia`; só JPEG/PNG |
| LB-D7 | Flag `active` sem nenhum uso | Não volta: retirar de uso = excluir (R2-LB-06) |

**SLA** (`levantamento/04` §9, `05` §5.22)

| # | Defeito antigo | Como o R2-E fecha |
|---|---|---|
| SLA-D1 | `/settings/sla` era **tela falsa**: "Salvar" só mostrava um toast e nada era gravado (A1/F09) | Tabela `lojas_sla` e action com trilha (U8) |
| SLA-D2 | Qualquer papel abria a tela; o índice dizia "somente leitura" e a tela tinha botão "Salvar" | Só `configuracao:ler/editar` (dono e admin). O gerente não alcança (DN-07) |
| SLA-D3 | O SLA real era **constante no código** (5/15/30/60) e a **prioridade não existia no backend** (a tela falsa mostrava Urgente 2, Alta 5, Média 15, Baixa 60) | Prazo por canal **e** por prioridade, por loja, numa fonte única. A prioridade não tem valor padrão |
| SLA-D4 | O motor media `last_message_at`/`unread_count`, e não "sem resposta da equipe" (01/R-21, parcial) | "Sem resposta da equipe" com início na **primeira** mensagem não respondida (R2-SLA-01) |
| SLA-D5 | Alerta reconhecido **voltava** (F05) | A dedupe continua de M8. O R2-E proíbe que afrouxar a regra "desestoure" uma conversa (R2-SLA-06) |
| SLA-D6 | O botão "verificar agora" chamava a rota de cron sem Bearer e falhava calado | Não existe. A tela diz de quanto em quanto tempo o sistema confere |
| SLA-D7 | Toggles de notificação que não faziam nada | Não existem (ADR 0057) |
| SLA-D8 | A documentação dizia cron de 1 min no código e de 5 min no deploy; o R1 roda a cada **15 min** com prazo de **5 min** | Agendador de **5 min**. A tela não aceita prazo menor que o intervalo (D8, R2-SLA-04) |
| SLA-D9 | **Achado no código de M8 em andamento (`e88d181`)**, em três pontos: (a) o prazo conta da **última** entrada, então a cliente que escreve de novo reinicia o relógio; (b) mensagem de campanha ou de sistema conta como resposta; (c) a resolução reavalia o prazo, então **subir o prazo resolveria o alerta e apagaria `sla_estourado_em`** | Delta D16: início na primeira entrada não respondida; só autor `usuario` responde; alerta e carimbo ficam abertos enquanto durar o mesmo turno sem resposta |

---

## 2. Regras de negócio

### 2.1 Lookbooks (ADR 0054 e ADR 0055)

| Regra | Enunciado | Decisão conservadora | ADR |
|---|---|---|---|
| **R2-LB-01** | O lookbook pertence a **uma** loja. Capa, fotos e produtos são **da mesma loja** | O app confere cada id contra a loja do lookbook (INV-10, REQ-H12), e a FK composta recusa no banco | 0054 |
| **R2-LB-02** | Composição: **0 a 10 fotos** e **0 a 20 produtos**, em ordem explícita e sem repetição. **Enviar** exige ≥ 1 foto disponível | Teto baixo, por causa do ritmo de 1 msg/s do uazapi e do tamanho do envio | 0054 |
| **R2-LB-03** | Só entra foto com `lojas_midias.origem = 'upload'`, `tipo_arquivo = 'imagem'`, `mime_type IN ('image/jpeg','image/png')` e `is_deleted = false`, de qualquer pasta | **Foto recebida de cliente nunca entra**: é dado pessoal. Só entra o formato que todos os canais aceitam (o WhatsApp recusa webp/gif) | 0055 |
| **R2-LB-04** | A capa é nula ou uma das fotos da composição. Tirar a foto que é capa zera a capa na mesma gravação. Sem capa, a lista usa a 1ª foto disponível | Nenhuma capa "órfã" | 0054 |
| **R2-LB-05** | Foto excluída da Galeria ou produto que saiu do catálogo (`is_deleted = true`) continua na ligação, mas **não vai no envio**. O editor mostra "excluída — sai ao salvar". Ao salvar, o cliente não reenvia o id, e o servidor recusa o id se ele voltar | Nenhuma exclusão em cascata; nada some sem a pessoa ver | 0054 |
| **R2-LB-06** | Não existe estado "ativo/inativo". Retirar de uso = **excluir** (exclusão lógica, sem restaurar, igual ao R1) | O `active` antigo não tinha consumidor | 0054 |
| **R2-LB-07** | Ver: todos (`conteudo:ler`). Criar e editar: vendedor para cima (`conteudo:criar`, `conteudo:editar`). Excluir: gerente para cima (`conteudo:excluir`) | Mantém a política já escrita na fundação, agora em `comercial.ts` (D9) | 0054 |
| **R2-LB-08** | "Salvar" é **uma** operação (nome, descrição, capa, fotos e produtos), com trava de colisão em `lookbooks.updated_at`. A ligação é **recriada** (exclusão lógica + inserção), nunca editada | Ligação pura (`01-dados.md` §4.7). A trava da linha-mãe serializa duas edições | 0054 |
| **R2-LB-09** | O envio sai **só de dentro de uma conversa**, feito por quem tem `conversas:escrever`, **pela conta de entrada da conversa** (`registrarEnvio`), e grava com a **loja da conversa** (`loja: "grava"`) | Não existe envio "para várias clientes": isso seria campanha | 0055 |
| **R2-LB-10** | O envio é **uma** mensagem com as N fotos disponíveis (na ordem) e um texto montado **no servidor**: nome, descrição e lista de **nomes** dos produtos disponíveis. `metadados.card = { tipo: "lookbook", id }` | **Sem preço** (preço anunciado obriga a loja, CDC art. 30, e o catálogo é espelho do Bling, que pode estar velho). **Sem disponibilidade. Sem link** | 0055 |
| **R2-LB-11** | **Sem URL pública**: nenhuma rota pública, nenhum link assinado persistido, nenhum "compartilhar" | O binário vai ao provedor pelo adaptador de M1 (`03` §13.3) | 0055 |
| **R2-LB-12** | Contato com **opt-out vigente** não recebe lookbook. A fonte da verdade é a **última linha de `consentimentos`**, lida por `optOutVigente(tx, contatoId)` de `@/lib/lgpd`, e **nunca** o espelho `contatos.opt_out` | Lookbook é divulgação. O composer continua livre (opt-out é de marketing e não bloqueia a resposta 1:1): se a cliente pedir fotos, a vendedora envia pela Galeria | 0055 |
| **R2-LB-13** | Enviar exige **prévia** e **block de 3 s**. A action confere que as fotos (na mesma ordem) **e** o texto a enviar são **exatamente** os da prévia. Se mudaram, recusa com `COLISAO`. A `chave_idempotencia` é gerada ao abrir o diálogo e impede envio duplo | O envio é irreversível e visível para fora (`04` §9) | 0055 |
| **R2-LB-14** | Canais que aceitam lookbook: `whatsapp_oficial`, `uazapi` e `instagram`. A janela de resposta e a conta desconectada seguem os bloqueios do composer, aplicados pelo composer (botão desabilitado) **e** no servidor por `registrarEnvio` (D15) | Messenger fica fora: depois de 24 h só aceita `HUMAN_AGENT`, e a política da Meta proíbe conteúdo promocional com essa tag. TikTok fica fora: só uma imagem por mensagem, e os detalhes estão marcados CONFERIR. Entrar depois = uma linha em `PROVEDORES_COM_LOOKBOOK` mais um ADR | 0055 |
| **R2-LB-15** | Texto do envio com no máximo **1.000 caracteres**. Se passar, a lista de produtos termina em "… e mais N produtos" | Nunca cortar no meio de um nome | 0055 |
| **R2-LB-16** | A IA não monta, não sugere e não envia lookbook no R2 | Uma pessoa no meio (decisão do orquestrador) | 0055 |
| **R2-LB-17** | Trilha: `lookbook_criado`, `lookbook_alterado` (na linha-mãe e em cada ligação) e `lookbook_excluido`. O envio fica na trilha da **mensagem**, gravada por M1 em `registrarEnvio` | Nada de trilha duplicada | 0054 |
| **R2-LB-18** | Contato anonimizado (`contatos.anonimizado_em IS NOT NULL`) não recebe lookbook | Os dados foram eliminados a pedido da titular | 0055 |

### 2.2 SLA (ADR 0056 e ADR 0057)

| Regra | Enunciado | Decisão conservadora | ADR |
|---|---|---|---|
| **R2-SLA-01** | O SLA mede o tempo **sem resposta da equipe**. O relógio começa na **primeira mensagem de entrada ainda não respondida** e para quando sai uma mensagem de saída que **não é nota interna**, com `autor_tipo = 'usuario'` (inclui a enviada pelo aparelho), ou quando a conversa sai de `aberta`/`pendente`. Mensagem de campanha, de sistema e nota interna **não** contam como resposta | Não deixa a cliente que escreve várias vezes "reiniciar" o atraso, nem deixa uma mensagem automática calar o alerta | 0056 |
| **R2-SLA-02** | **Prazo efetivo (min) = o menor entre** (a) a regra de canal da loja, ou o padrão do canal se não houver regra, e (b) a regra de prioridade da loja, se houver | "Vale o menor": configurar a prioridade **nunca afrouxa** o canal. Padrões do canal: WhatsApp oficial 5, uazapi 5, Instagram 15, Facebook 30, TikTok 60. Provedor fora da lista = 5 | 0056 |
| **R2-SLA-03** | A regra é **por loja**. Campo vazio = "padrão do sistema" (canal) ou "sem prazo próprio" (prioridade). Não existe regra de rede | Loja sem configuração se comporta como o R1 | 0056 |
| **R2-SLA-04** | Faixa aceita na tela: **5 a 1.440 minutos**, inteiros. O banco aceita de 1 a 1.440 | 5 = intervalo de conferência (prazo menor seria uma promessa que o sistema não cumpre). 1.440 = 24 h | 0056 / 0057 |
| **R2-SLA-05** | Só **dono e admin** configuram (`configuracao:editar`); gerente, vendedor e viewer **não** (DN-07). **Todos** veem os prazos vigentes da sua loja em `/alertas` | SLA é configuração (decisão 7 do cliente, `levantamento/05` §5.22) | 0056 |
| **R2-SLA-06** | Mudar a regra, ou a prioridade da conversa, vale a partir da **próxima conferência**, e só para abrir alerta novo. Alerta `sla_estourado` aberto e carimbo `sla_estourado_em` continuam **enquanto a conversa seguir sem resposta no mesmo turno**, mesmo que o prazo tenha subido. Resolve-se quando a equipe responde ou quando a conversa sai de `aberta`/`pendente` | Afrouxar o prazo não pode esconder atraso que já aconteceu | 0056 |
| **R2-SLA-07** | O prazo conta **24 horas por dia, 7 dias por semana** | Igual ao antigo. Horário comercial exige colunas novas e fica como pergunta no ADR | 0056 |
| **R2-SLA-08** | O sistema confere a cada **5 minutos**, e o alerta aparece em até 5 min depois do vencimento. **Não** há aviso "X minutos antes", e-mail nem push: o canal é o sino mais `/alertas` | Os toggles antigos nunca funcionaram | 0057 |
| **R2-SLA-09** | Salvar prazos passa por **block de 3 s** com o diff ("WhatsApp (oficial): de 5 min (padrão) para 10 min") e grava `sla_alterado` com antes e depois, por linha | A mudança afeta o alerta de todas as conversas da loja (`04` §9) | 0056 |
| **R2-SLA-10** | A prioridade da conversa continua sendo escolhida por pessoa (M1, `conversas:gerir`). A IA não muda prioridade | — | 0056 |
| **R2-SLA-11** | O relatório "Tempo de primeira resposta" (`/relatorios`) continua sendo `primeira_resposta_em − created_at`. É outra métrica, e a tela de SLA não fala dele | Alerta e relatório medem coisas diferentes, e cada um diz qual mede | 0056 |

---

## 3. Modelo de dados

### 3.1 Tabelas existentes que o R2-E usa (conferidas no schema da fundação)

| Tabela (arquivo) | Colunas usadas | Como |
|---|---|---|
| `lookbooks` (`schema/conteudo/lookbooks.ts`) | `id`, `loja_id`, `nome text NOT NULL`, `descricao text`, `capa_midia_id uuid → lojas_midias`, `created_at`, `updated_at`, `deleted_at`, `is_deleted`, `modified_by` | **Com trava de colisão**. Índice `ix_lookbooks_loja (loja_id, is_deleted)` |
| `lookbooks_midias` | `id`, `loja_id`, `lookbook_id`, `midia_id`, `ordem integer NOT NULL DEFAULT 0` + auditoria | Ligação pura. Único parcial `uq_lookbooks_midias (lookbook_id, midia_id) WHERE is_deleted = false`. Índice `ix_lookbooks_midias_ordem (lookbook_id, ordem)` |
| `lookbooks_produtos` | `id`, `loja_id`, `lookbook_id`, `produto_id`, `ordem` + auditoria | Ligação pura. Único parcial `uq_lookbooks_produtos (lookbook_id, produto_id) WHERE is_deleted = false` |
| `lojas_midias` (`schema/midias.ts`) | `id`, `loja_id`, `nome_original`, `tipo_arquivo`, `mime_type`, `tamanho_bytes`, `largura`, `altura`, `origem`, `pasta`, `is_deleted`, `created_at` | **Só leitura** (dona: M3). Elegível = R2-LB-03. Cursor pelo índice `ix_lojas_midias_origem (loja_id, origem, created_at DESC)` |
| `produtos` (`schema/catalogo/produtos.ts`) | `id`, `loja_id`, `nome`, `sku`, `is_deleted`, `created_at` | **Só leitura** (dono: M4). `preco` e `preco_custo` **nunca** são lidos |
| `conversas` (`schema/conversas/conversas.ts`) | `id`, `loja_id`, `contato_id`, `integracao_id`, `status`, `prioridade` (NOT NULL, padrão `media`), `ultima_entrada_em`, `sla_estourado_em` | Leitura. **O R2-E não escreve em `conversas`**. `sla_estourado_em` é contador de M8 |
| `conversas_mensagens` | `conversa_id`, `direcao`, `autor_tipo`, `nota_interna`, `ocorrida_em`, `is_deleted`, `metadados` | Leitura (regra de SLA, D16). A linha do envio é escrita **por M1** em `registrarEnvio` |
| `conversas_mensagens_midias` | `mensagem_id`, `midia_id`, `tipo_arquivo`, `mime_type`, `tamanho_bytes`, `baixada`, **`ordem` (nova, D4)** | Escrita **por M1** em `registrarEnvio` |
| `lojas_integracoes` | `id`, `provedor`, `rotulo`, `status` | Leitura (prévia do envio e join do prazo) |
| `contatos` | `id`, `nome`, `anonimizado_em` | Leitura (prévia). O opt-out vem de `optOutVigente` (R2-LB-12) |
| `lojas` | `id`, `nome`, `sigla`, `is_deleted` | Leitura (prazos vigentes) |
| `alertas` | — | O R2-E **não escreve**. `sla_estourado` continua de M8 |
| `auditoria_eventos` | via `inserirAuditado`/`atualizarComTrava`/`excluirLogico` | Quatro ações novas na lista fechada (D1) |

### 3.2 Tabela nova (delta D3): `lojas_sla`

`01-dados.md` §6.6 dizia "sem tabela de configuração de SLA nesta entrega". O R2 é a entrega que liga essa configuração, e sem tabela a tela seria de fachada (U8). O nome segue a hierarquia sob `lojas`. `lojas_canais_sla` continua **não existindo**.

| Coluna | Tipo | Nulo | Default | Nota |
|---|---|---|---|---|
| id | uuid PK | não | `defaultRandom()` | |
| loja_id | uuid → `lojas.id` RESTRICT/RESTRICT | não | | |
| provedor | text | sim | | CHECK `lojas_sla_provedor_lista` = `PROVEDORES_DE_CONVERSA` |
| prioridade | text | sim | | CHECK `lojas_sla_prioridade_lista` = `PRIORIDADES` |
| minutos | integer | não | | CHECK `lojas_sla_minutos_faixa`: `between 1 and 1440` |
| ...colunasAuditoria | | | | **Com trava de colisão**. FK `fk_lojas_sla_modified_by` (em `0019_r2_integridade`) |

- CHECK `lojas_sla_um_alvo`: `num_nonnulls(provedor, prioridade) = 1`. Uma linha é regra de canal **ou** de prioridade.
- Únicos parciais: `uq_lojas_sla_provedor (loja_id, provedor) WHERE provedor IS NOT NULL AND is_deleted = false` e `uq_lojas_sla_prioridade (loja_id, prioridade) WHERE prioridade IS NOT NULL AND is_deleted = false`. São eles que tornam escalares as subconsultas de `minutosDeSlaSql`.
- Índice `ix_lojas_sla_loja (loja_id, is_deleted)`.
- "Voltar ao padrão" = **exclusão lógica** da linha. O único parcial libera recriar a regra.

### 3.3 Coluna nova (delta D4): `conversas_mensagens_midias.ordem`

`integer NOT NULL DEFAULT 0`, CHECK `conversas_mensagens_midias_ordem_positiva` (`ordem >= 0`).

**Motivo**: uma mensagem com N fotos precisa sair na ordem do lookbook. A tabela não tinha como guardar essa ordem: `created_at` empata dentro da mesma transação e o `id` é aleatório. M1 grava `ordem = índice`, e o envio e o DTO leem `ORDER BY ordem, id`. Na entrada com vários anexos, M1 grava a posição no array `midias[]`. A migração é aditiva, e linhas existentes ficam com 0.

### 3.4 Estados e transições

**Lookbook** — não tem coluna de estado. `vivo` → (`excluirLookbook`) → `excluído` (`is_deleted = true`, terminal, sem restaurar).

**Ligação** (`lookbooks_midias` / `lookbooks_produtos`) — `viva` → `excluída` (terminal). Mudar a ordem = excluir a ligação e criar outra.

**Regra de SLA** (`lojas_sla`, por `(loja, alvo)`):

```
ausente --salvar com valor--> viva --salvar com outro valor--> viva (updated_at novo)
viva --salvar vazio--> excluída  (o alvo volta a "ausente" e pode ser recriado)
```

**Conversa × SLA** — quem escreve é M8, pelas regras deste documento (D16). O R2-E fornece o prazo.

```
aberta|pendente e sem resposta da equipe (turno T começa na 1ª entrada não respondida: inicio_T)
   │  inicio_T + prazo_efetivo < now()          (conferido a cada 5 min)
   ▼
sla_estourado_em = now()  +  alerta 'sla_estourado' aberto
   │  continua enquanto: conversa sem resposta E inicio_T <= sla_estourado_em (mesmo turno)
   │  (subir o prazo NÃO interrompe; nova mensagem da cliente no mesmo turno NÃO interrompe)
   ▼  equipe respondeu (autor 'usuario', não nota)  OU  status fora de (aberta, pendente)
alerta.resolvido_em = now()  e  sla_estourado_em = NULL
```

Mudar `lojas_sla` ou a prioridade só altera a **primeira** seta.

---

## 4. Permissões

**Nenhuma chave nova.** As quatro `conteudo:*` saem de `FASE_R2` e entram em `COMERCIAL` (D9), porque passam a ter tela (INV-27).

| Chave | Arquivo (depois do delta) | dono | admin | gerente | vendedor | viewer | Uso no R2-E |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| `conteudo:ler` | `comercial.ts` | sim | sim | sim | sim | sim | `/lookbooks`, `/lookbooks/[id]`, lista no seletor do composer |
| `conteudo:criar` | `comercial.ts` | sim | sim | sim | sim | — | `criarLookbook` |
| `conteudo:editar` | `comercial.ts` | sim | sim | sim | sim | — | `salvarLookbook`, `listarFotosElegiveis`, `listarProdutosElegiveis` |
| `conteudo:excluir` | `comercial.ts` | sim | sim | sim | — | — | `excluirLookbook` |
| `conversas:escrever` | `atendimento.ts` | sim | sim | sim | sim | — | `previaEnvioLookbook`, `enviarLookbook` |
| `configuracao:ler` | `plataforma.ts` | sim | sim | — | — | — | `/configuracoes/sla`, `lerPrazosSla` |
| `configuracao:editar` | `plataforma.ts` | sim | sim | — | — | — | `salvarPrazosSla`; link "Alterar prazos" em `/alertas` |
| `alertas:ler` | `atendimento.ts` | sim | sim | sim | sim | sim | texto dos prazos em `/alertas` (action de M8) |

- O envio usa **uma** chave (`conversas:escrever`). Um teste de unidade prova que todo papel com `conversas:escrever` também tem `conteudo:ler` e `midia:enviar`. Assim, uma mudança futura na matriz não abre envio para quem não lê lookbook.
- A UI decide o que mostrar com `pode()` (puro). Só a action chama `exigirPermissao()`, que grava `recusa_403`.

---

## 5. Server Actions, domínio, costuras e jobs

Todas as actions ficam em arquivo `"use server"`, com `export async function` chamando `executarAcao` (`03` §4.3). A entrada é sempre `z.strictObject`. **Toda entrada aceita `loja` opcional (uuid)**: a tela manda o `loja_id` do próprio registro (lookbook ou conversa), `resolverLojaPedida` confere e o escopo vira `uma`. Com isso a trilha nasce com o `loja_id` certo mesmo para gestão em "Todas as lojas". Para vendedor e viewer, `loja` é ignorada. **Toda gravação usa `loja: "grava"`** (INV-05). Ids do corpo são conferidos contra a loja **do registro**. Leitura de tabela de outro domínio só passa pelo `_consultas.ts` do próprio módulo. O mapeamento de campos é explícito (nunca `...dados` sobre a linha).

### 5.1 Validadores

`src/lib/validadores/lookbooks.ts` (puro):

```ts
import { z } from "zod";
import { uuidSchema } from "@/lib/validadores/comum";

export const MAX_FOTOS_LOOKBOOK = 10;
export const MAX_PRODUTOS_LOOKBOOK = 20;
export const MAX_TEXTO_ENVIO = 1000;

/** Controle, zero-width e bidi: golpe de exibição no texto que vai à cliente. */
const INVISIVEIS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/;
const semInvisiveis = (s: string) => !INVISIVEIS.test(s);

const idsUnicos = (max: number, excesso: string, repetido: string) =>
  z.array(uuidSchema).max(max, excesso).refine((a) => new Set(a).size === a.length, repetido);

const lojaSchema = uuidSchema.optional();
const buscaSchema = z.string().trim().max(80, "Use no máximo 80 caracteres.").optional();
const cursorSchema = z.strictObject({ criadoEm: z.coerce.date(), id: uuidSchema });

export const nomeLookbookSchema = z.string().trim()
  .min(2, "Dê um nome com ao menos 2 letras.")
  .max(80, "Use no máximo 80 caracteres.")
  .refine(semInvisiveis, "Remova caracteres invisíveis do nome.");

export const descricaoLookbookSchema = z.string().trim()
  .max(500, "Use no máximo 500 caracteres.")
  .refine(semInvisiveis, "Remova caracteres invisíveis da descrição.")
  .transform((s) => (s === "" ? null : s))
  .nullable()
  .default(null);

export const listarLookbooksSchema = z.strictObject({
  loja: lojaSchema, busca: buscaSchema, cursor: cursorSchema.optional(),
});
export const obterLookbookSchema = z.strictObject({ loja: lojaSchema, id: uuidSchema });
export const criarLookbookSchema = z.strictObject({
  loja: lojaSchema, nome: nomeLookbookSchema, descricao: descricaoLookbookSchema,
});
export const salvarLookbookSchema = z.strictObject({
  loja: lojaSchema,
  id: uuidSchema,
  updatedAt: z.coerce.date(),
  nome: nomeLookbookSchema,
  descricao: descricaoLookbookSchema,
  capaMidiaId: uuidSchema.nullable(),
  midiaIds: idsUnicos(MAX_FOTOS_LOOKBOOK, "Um lookbook tem no máximo 10 fotos.", "Há fotos repetidas."),
  produtoIds: idsUnicos(MAX_PRODUTOS_LOOKBOOK, "Um lookbook tem no máximo 20 produtos.", "Há produtos repetidos."),
}).refine((d) => d.capaMidiaId === null || d.midiaIds.includes(d.capaMidiaId), {
  path: ["capaMidiaId"], message: "A capa precisa ser uma das fotos do lookbook.",
});
export const excluirLookbookSchema = z.strictObject({
  loja: lojaSchema, id: uuidSchema, updatedAt: z.coerce.date(),
});
export const listarElegiveisSchema = z.strictObject({
  loja: lojaSchema, lookbookId: uuidSchema, busca: buscaSchema, cursor: cursorSchema.optional(),
});
export const previaEnvioSchema = z.strictObject({
  loja: lojaSchema, lookbookId: uuidSchema, conversaId: uuidSchema,
});
export const enviarLookbookSchema = z.strictObject({
  loja: lojaSchema,
  lookbookId: uuidSchema,
  conversaId: uuidSchema,
  /** O que a prévia mostrou, na ordem. O servidor recalcula e compara. */
  midiaIds: z.array(uuidSchema).min(1, "Este lookbook não tem fotos para enviar.").max(MAX_FOTOS_LOOKBOOK),
  texto: z.string().max(MAX_TEXTO_ENVIO),
  chaveIdempotencia: uuidSchema,
});
```

O editor e o diálogo de envio chamam as actions com **objeto** (não `FormData`). Só o diálogo "Novo lookbook" usa `FormData` (`nome`, `descricao`, `loja`), e nele `descricao` vazia vira `null`.

`src/lib/validadores/sla.ts` (puro):

```ts
import { z } from "zod";
import { PRIORIDADES } from "@/lib/db/schema/_enums/conversas";
import { PROVEDORES_DE_CONVERSA } from "@/lib/db/schema/_enums/plataforma";
import { INTERVALO_CONFERENCIA_SLA_MIN, MAXIMO_SLA_MIN } from "@/lib/sla/prazo";
import { uuidSchema } from "@/lib/validadores/comum";

export const minutosSlaSchema = z.number()
  .int("Use minutos inteiros.")
  .min(INTERVALO_CONFERENCIA_SLA_MIN,
    `Use ao menos ${INTERVALO_CONFERENCIA_SLA_MIN} minutos: o sistema confere os prazos a cada ${INTERVALO_CONFERENCIA_SLA_MIN} minutos.`)
  .max(MAXIMO_SLA_MIN, "Use no máximo 1.440 minutos (24 horas).");

/** `minutos` nulo = voltar ao padrão; `updatedAt` nulo = não havia regra quando a tela abriu. */
const linha = <C extends z.ZodType>(chave: C) =>
  z.strictObject({ chave, minutos: minutosSlaSchema.nullable(), updatedAt: z.coerce.date().nullable() });

const semRepetir = (itens: readonly { chave: string }[]) =>
  new Set(itens.map((i) => i.chave)).size === itens.length;

export const salvarPrazosSlaSchema = z.strictObject({
  loja: uuidSchema.optional(),
  canais: z.array(linha(z.enum(PROVEDORES_DE_CONVERSA)))
    .max(PROVEDORES_DE_CONVERSA.length).refine(semRepetir, "Há canais repetidos."),
  prioridades: z.array(linha(z.enum(PRIORIDADES)))
    .max(PRIORIDADES.length).refine(semRepetir, "Há prioridades repetidas."),
}).refine((d) => d.canais.length + d.prioridades.length > 0, { message: "Nada mudou." });

export const lerPrazosSlaSchema = z.strictObject({ loja: uuidSchema.optional() });
```

O formulário manda **só as linhas alteradas**.

### 5.2 Actions de lookbook — `src/lib/actions/lookbooks.ts`

| Action | Entrada | Permissão | `loja` | Efeito | Trilha |
|---|---|---|---|---|---|
| `listarLookbooks` | `listarLookbooksSchema` | `conteudo:ler` | `le` | Lookbooks vivos do escopo, `nome ILIKE` (com `%`, `_` e `\` escapados), ordem `(created_at DESC, id DESC)`, 30 por página. DTO `LookbookNaLista` = `{ id, lojaId, lojaSigla, nome, capaMidiaId, totalFotos, totalProdutos, updatedAt }`. `capaMidiaId` é a capa se ela estiver disponível; senão, a 1ª foto disponível; senão, `null`. Os totais contam só ligações vivas. Devolve `{ itens, cursorProximo }` | — |
| `obterLookbook` | `obterLookbookSchema` | `conteudo:ler` | `le` | Lookbook do escopo + ligações vivas em `ordem`. DTO `LookbookDetalhe` = `{ id, lojaId, lojaSigla, nome, descricao, capaMidiaId, updatedAt, fotos: [{ midiaId, nome, largura, altura, disponivel }], produtos: [{ produtoId, nome, sku, disponivel }], pode: { editar, excluir } }`. `disponivel` = alvo vivo e elegível (R2-LB-03). `pode` vem de `pode()`. Fora do escopo = `NAO_ENCONTRADO` | — |
| `criarLookbook` | `criarLookbookSchema` | `conteudo:criar` | `grava` | `inserirAuditado(lookbooks, { loja_id: escopo.lojaId, nome, descricao })`. Devolve `{ id }`, e a tela navega para o editor | `lookbook_criado` |
| `salvarLookbook` | `salvarLookbookSchema` | `conteudo:editar` | `grava` | Ordem fixa dentro da transação. **(0)** lê o lookbook vivo no escopo (não achou = `NAO_ENCONTRADO`) e confere que **todo** `midiaId` é foto elegível da loja e **todo** `produtoId` é produto vivo da loja (senão `VALIDACAO` no campo `midiaIds`/`produtoIds`). **(1)** `atualizarComTrava(lookbooks, { nome, descricao, capa_midia_id })`: zero linhas = `COLISAO`, e a linha fica travada até o commit. **(2)** lê as ligações vivas. **(3)** com `diffComposicao()`, mantém a ligação cujo alvo **e** ordem batem, faz primeiro todas as `excluirLogico` (com o `updated_at` lido em 2) e depois todas as `inserirAuditado` (`ordem = índice`). `23505` em `uq_lookbooks_midias`/`uq_lookbooks_produtos` vira `COLISAO` (`ehViolacaoDeUnico`, D6). Devolve o `LookbookDetalhe` com `updatedAt` novo | `lookbook_alterado` (na mãe e em cada ligação) |
| `excluirLookbook` | `excluirLookbookSchema` | `conteudo:excluir` | `grava` | `excluirLogico(lookbooks)`. As ligações ficam (as leituras filtram a mãe viva) | `lookbook_excluido` |
| `listarFotosElegiveis` | `listarElegiveisSchema` | `conteudo:editar` | `le` | Fotos elegíveis (R2-LB-03) **da loja do lookbook** (lookbook fora do escopo = `NAO_ENCONTRADO`), busca em `nome_original`, cursor `(created_at DESC, id DESC)`, 30 por página. DTO `{ id, nome, largura, altura, criadoEm }`. A miniatura sai de `/api/midias/{id}?miniatura=1`, **nunca** de `chave_objeto` | — |
| `listarProdutosElegiveis` | `listarElegiveisSchema` | `conteudo:editar` | `le` | Produtos vivos da loja do lookbook, busca em `nome` e `sku`, cursor `(created_at DESC, id DESC)`, 30 por página. DTO `{ id, nome, sku, criadoEm }` (sem preço nenhum) | — |
| `previaEnvioLookbook` | `previaEnvioSchema` | `conversas:escrever` | `le` | Lê conversa (escopo) + contato + conta. Lê o lookbook vivo **da loja da conversa** (outra loja = `NAO_ENCONTRADO`). Calcula `optOutVigente` e monta com `montarEnvio()` (§5.3). DTO `PreviaEnvio` = `{ lookbook: { id, nome }, destino: { contatoNome, contaRotulo, provedor }, midiaIds, texto, foraDoEnvio: { fotos, produtos }, bloqueio }`, com `bloqueio` ∈ `null \| "opt_out" \| "anonimizado" \| "sem_fotos" \| "canal"` | — |
| `enviarLookbook` | `enviarLookbookSchema` | `conversas:escrever` | `grava` | Faz na transação as mesmas leituras da prévia. `bloqueio ≠ null` → `VALIDACAO` com o texto da §7.4. `midiaIds` recebidos ≠ `montarEnvio().midiaIds` (mesma ordem) **ou** `texto` ≠ `montarEnvio().texto` → `COLISAO`. Se tudo bate: `registrarEnvio(tx, { lojaId, contatoId, integracaoId: conversa.integracao_id, conversaId: conversa.id, conteudo: texto, midiaIds, card: { tipo: "lookbook", id }, chaveIdempotencia }, ctx)`. Devolve `{ mensagemId, conversaId }`. Repetir a mesma chave não cria segunda mensagem (único `(conversa_id, chave_idempotencia)`) | a da mensagem (M1) |

Revalidação: `criarLookbook`, `salvarLookbook` e `excluirLookbook` revalidam `/lookbooks` (e `salvar`/`excluir` também `/lookbooks/[id]`). O envio não revalida: a bolha chega por SSE.

### 5.3 Domínio de lookbook — `src/lib/lookbooks/`

| Arquivo | Conteúdo |
|---|---|
| `index.ts` (`server-only`) | API pública, só reexporta: `listarLookbooks`, `obterLookbook`, `listarFotosElegiveis`, `listarProdutosElegiveis` (de `leitura.ts`); `criarLookbook`, `salvarLookbook`, `excluirLookbook` (de `edicao.ts`); `previaEnvio`, `enviarLookbook` (de `envio.ts`); e os tipos de DTO |
| `leitura.ts` (`server-only`) | As quatro leituras |
| `edicao.ts` (`server-only`) | Criar, salvar (ordem fixa da §5.2) e excluir |
| `envio.ts` (`server-only`) | Prévia e envio. Importa `optOutVigente` de `@/lib/lgpd` e `registrarEnvio` de `@/lib/conversas/saida` (as duas são costuras, D18 e D15) |
| `_consultas.ts` | Leituras: lookbook, ligações com alvo, fotos e produtos elegíveis, conversa + contato + conta. Sempre com `vivosE(...)` e `condicaoDeLoja(...)` |
| `_composicao.ts` (puro) | `diffComposicao(vivas, desejadas)` → `{ manter, excluir, inserir }`. Testado sem banco |
| `_montagem.ts` (puro) | `montarEnvio({ lookbook, fotos, produtos, contato: { anonimizado, optOut }, provedor })` → `{ midiaIds, texto, foraDoEnvio, bloqueio }`. Constante `PROVEDORES_COM_LOOKBOOK = ["whatsapp_oficial", "uazapi", "instagram"] as const`. Usa `MAX_FOTOS_LOOKBOOK` e `MAX_TEXTO_ENVIO` do validador. **Não cita `preco`** |

Precedência de `bloqueio` em `montarEnvio`: `anonimizado` → `opt_out` → `canal` → `sem_fotos`.

Texto do envio (`montarEnvio`), exatamente:

```
{nome}
{descricao — linha omitida se nula}

Peças deste look:
• {produto 1}
• {produto 2}
… e mais {N} produtos        ← só quando o texto completo passaria de 1.000 caracteres
```

- Sem produtos disponíveis, o bloco "Peças deste look" (e a linha em branco antes dele) some.
- O corte remove produtos inteiros a partir do fim, até o texto com a linha "… e mais N produtos" caber em 1.000.
- `N = 1` vira "… e mais 1 produto".

### 5.4 Costura de prazo — `src/lib/sla/prazo.ts`

Criada **completa** pelo delta (D7). Depois passa a ser do R2-E2, que só acrescenta testes. Mudar corpo ou assinatura exige ADR. API:

| Export | O que é |
|---|---|
| `type ProvedorDeConversa` | reexport de `_enums/plataforma` |
| `PRAZO_SLA_PADRAO_MIN` | `Record<ProvedorDeConversa, number>` = 5/5/15/30/60. **Única** declaração no repositório |
| `PRAZO_SLA_DESCONHECIDO_MIN = 5`, `INTERVALO_CONFERENCIA_SLA_MIN = 5`, `MAXIMO_SLA_MIN = 1440` | constantes |
| `type RefsSla = { lojaId; provedor; prioridade }` | cada uma é `AnyPgColumn \| SQL` (com alias cru, `sql\`c.loja_id\``) |
| `padraoDoCanalSql(provedor)` | `case` com literais de constante |
| `minutosDeSlaSql(refs)` | `least(coalesce(regra do canal, padrão), regra da prioridade)`. `least` do Postgres ignora nulo |
| `venceEmSql(inicio, refs)` | `inicio + make_interval(mins => minutosDeSlaSql(refs))` |
| `lerPrazosVigentes(tx, escopo)` | `PrazosDaLoja[]` das lojas vivas do escopo, em ordem de sigla (a forma está em D7) |
| `textoDosPrazos(prazos)` | a frase de `/alertas` (§7.3) |

### 5.5 Actions de SLA — `src/lib/actions/sla.ts` e domínio `src/lib/sla/`

| Action | Entrada | Permissão | `loja` | Efeito | Trilha |
|---|---|---|---|---|---|
| `lerPrazosSla` | `lerPrazosSlaSchema` | `configuracao:ler` | `grava` (exige **uma** loja; em "Todas as lojas" → `FALTA_LOJA`) | `lerPrazosVigentes(tx, ctx.escopo)[0]` → DTO `PrazosSla` = `{ loja: { id, nome, sigla }, limites: { min: 5, max: 1440 }, intervaloMin: 5, canais: [{ chave, padrao, minutos: number \| null, updatedAt: Date \| null }], prioridades: [{ chave, minutos: number \| null, updatedAt: Date \| null }] }`. No canal, `minutos` e `updatedAt` são nulos quando `origem = "padrao"` | — |
| `salvarPrazosSla` | `salvarPrazosSlaSchema` | `configuracao:editar` | `grava` | Numa transação, para cada linha, lê a regra viva `(loja, alvo)` por `regraViva()`. Tabela de decisão logo abaixo. Devolve o `PrazosSla` atualizado. Revalida `/configuracoes/sla` e `/alertas` | `sla_alterado` por linha gravada |

| `updatedAt` recebido | `minutos` recebido | Regra viva no banco | Resultado |
|---|---|---|---|
| nulo | presente | não existe | `inserirAuditado(lojas_sla, { loja_id, provedor \| prioridade, minutos })`; `23505` em `uq_lojas_sla_*` → `COLISAO` |
| nulo | presente | existe | `COLISAO` |
| presente | presente | não existe | `COLISAO` |
| presente | presente, igual ao do banco | existe | nada (sem trilha) |
| presente | presente, diferente | existe | `atualizarComTrava(lojas_sla, { id, updatedAtOriginal: updatedAt, dados: { minutos } })` |
| presente | nulo | não existe | `COLISAO` |
| presente | nulo | existe | `excluirLogico(lojas_sla, { id, updatedAtOriginal: updatedAt })` |
| nulo | nulo | — | nada |

Arquivos do domínio:

- `src/lib/sla/index.ts` (`server-only`): `lerPrazosSla(tx, ctx)` e `salvarPrazosSla(tx, dados, ctx)`.
- `src/lib/sla/_consultas.ts`: `regraViva(tx, lojaId, { provedor } | { prioridade })` → `{ id, minutos, updatedAt } | null`.
- `src/lib/sla/prazo.ts`: a costura da §5.4.

`fresca` não é exigida: não é ação sobre conta (`02` §11). O block de 3 s cobre a leitura do diff.

### 5.6 Route Handlers e jobs

- **Route Handler: nenhum.** Tudo é navegador logado → Server Action (`03` §5). Não nasce rota pública (R2-LB-11).
- **Job novo: nenhum.**
  - O envio usa o `mensagens-saida/enviar-mensagem` que `registrarEnvio` enfileira. Idempotência e retentativa são de M1: `jobId` determinístico, tentativas de `FILA_TENTATIVAS`, backoff exponencial, DLQ.
  - A conferência de SLA continua no `manutencao/gerar-alertas` de M8. O que muda é o **agendador**, de 15 para 5 min (D8), com remoção explícita do agendador antigo.
  - O job continua idempotente pelo único parcial `uq_alertas_deduplicacao`: rodar 3× mais vezes não duplica alerta.

---

## 6. Integrações externas

**Nenhuma.** O R2-E não fala com provedor.

- O binário das fotos chega ao WhatsApp ou ao Instagram pelo adaptador de M1, dentro de `mensagens-saida` (`03` §13.3), pela conta de entrada da conversa.
- Não há interface de provedor, provedor simulado nem variável de ambiente nova. Não há entrada nova na allowlist de `buscarExterno`, e o R2-E não chama `buscarExterno`.
- O teste de integração do envio usa um dublê de `@/lib/fila/filas` (confere o job enfileirado) e o `registrarEnvio` real de M1. Nenhum provedor é chamado.

---

## 7. Telas

### 7.1 Inventário

| Rota / ponto | Papel mínimo | Server busca | Client faz | Crítica (block 3 s) |
|---|---|---|---|---|
| `/lookbooks` | viewer (`conteudo:ler`) | `listarLookbooks` com `busca` e `cursor` da URL | Busca (`router.replace`), "Carregar mais", **Novo lookbook** (diálogo com nome e descrição, só com `conteudo:criar`; manda `loja` = loja ativa) | — |
| `/lookbooks/[id]` | viewer para ler; vendedor para editar | `obterLookbook` | Editar nome e descrição. **Adicionar fotos**: diálogo com `listarFotosElegiveis`, multisseleção até completar 10. **Adicionar produtos**: diálogo com `listarProdutosElegiveis`, até 20. Reordenar com **Subir/Descer** (teclado, sem arrastar). **Usar como capa**. **Remover**. **Salvar** (manda `loja` = `lojaId` do lookbook) | **Excluir** (`ConfirmarExclusao`, item "excluir registro"; só gerente para cima) |
| Composer de `/conversas/[id]`: botão **Lookbook** (costura `seletor-lookbook.tsx`) | vendedor (`conversas:escrever`) | — | Escolher lookbook (lista com busca, `listarLookbooks({ loja: lojaId })`) → `previaEnvioLookbook` → confirmar | **Enviar lookbook** |
| `/configuracoes/sla` | admin (`configuracao:ler`) | `lerPrazosSla` da loja ativa | Dois cartões (Canal, Prioridade), campo `<input type="number" min={5} max={1440} step={1}>` por linha (vazio = padrão), **Salvar** só com mudança | **Salvar prazos de SLA** |
| `/alertas` (de M8) | viewer (`alertas:ler`) | `centralDeAlertas` (M8) já devolvendo o texto de `textoDosPrazos` | Link **Alterar prazos** só com `configuracao:editar` | — |
| `/configuracoes` (de M5) | admin | — | Cartão "Prazos de atendimento (SLA)" | — |

**Server × client**: os `page.tsx` e `loading.tsx` são server components. As páginas chamam a action de leitura e passam DTO com datas em ISO. `grade-lookbooks.tsx` é server. São `"use client"`: `dialogo-novo-lookbook.tsx`, `editor-lookbook.tsx`, `lista-composicao.tsx`, `seletor-fotos.tsx`, `seletor-produtos.tsx`, `excluir-lookbook.tsx`, `formulario-sla.tsx`, `seletor-lookbook.tsx` e `seletor-lookbook-envio.tsx`. A miniatura é sempre `<img src="/api/midias/{id}?miniatura=1" loading="lazy" alt="…">` com `aspect-ratio` reservado (sem `next/image`). Os rótulos vêm de `ROTULO_PROVEDOR_CONVERSA` e `ROTULO_PRIORIDADE` (`src/lib/ui/tons.ts`, D11).

**Colocação dos arquivos**:
- `src/app/(app)/lookbooks/{page,loading}.tsx`;
- `src/app/(app)/lookbooks/[id]/{page,loading}.tsx`;
- `src/app/(app)/lookbooks/_components/{grade-lookbooks,dialogo-novo-lookbook,editor-lookbook,lista-composicao,seletor-fotos,seletor-produtos,excluir-lookbook}.tsx`;
- `src/app/(app)/configuracoes/sla/{page,loading}.tsx` e `src/app/(app)/configuracoes/sla/_components/formulario-sla.tsx`;
- `src/app/(app)/conversas/_components/seletor-lookbook.tsx` (costura) e `seletor-lookbook-envio.tsx` (lista, prévia e block). Os dois são de R2-E1 e ficam dentro da pasta de M1 (exceção nominal, D19).

### 7.2 Os estados

| Tela | Carregando | Vazio | Erro | Sucesso |
|---|---|---|---|---|
| `/lookbooks` | `loading.tsx` com grade de esqueleto | Vendedor para cima: "Nenhum lookbook nesta loja." [Criar lookbook]. Viewer: "Nenhum lookbook nesta loja. Quem vende pode montar um." Com busca: "Nenhum lookbook com esse nome." [Limpar busca] | `EstadoErro` + "Tentar de novo" | O cartão novo aparece; sem toast |
| `/lookbooks/[id]` | Esqueleto do editor | "Este lookbook ainda não tem fotos." [Adicionar fotos] (só com `conteudo:editar`) | `COLISAO` → faixa `perigo` de `04` §7.4 + [Ver versão atual], e o que foi digitado fica. `VALIDACAO` → campo marcado | Toast "Lookbook salvo." (a página não muda de forma visível) |
| Diálogo de fotos | Esqueleto de grade | "Nenhuma foto enviada à Galeria desta loja." [Ir para a Galeria] (link, só com `midia:enviar`) | Inline no diálogo | As fotos entram na lista do editor, ainda não salvas, com a faixa "Alterações não salvas" |
| Diálogo de produtos | Esqueleto de lista | "Nenhum produto no catálogo desta loja." | Inline | Idem |
| Seletor no composer | Esqueleto de lista | "Nenhum lookbook nesta loja." [Ver lookbooks] | Inline + [Tentar de novo]. `bloqueio` → o texto da §7.4 no lugar do botão "Enviar" | O modal fecha e a bolha aparece como "Enviando", por SSE. Sem toast |
| `/configuracoes/sla` | Esqueleto de dois cartões | — (sempre há canais e prioridades) | Inline. `COLISAO` → faixa `perigo` + [Recarregar prazos] | "Prazos salvos. Valem a partir da próxima conferência." |
| Gestão em "Todas as lojas" | — | `/configuracoes/sla` e "Novo lookbook": "Escolha uma loja no topo da tela para continuar." + abre o seletor de loja (`FALTA_LOJA`) | — | — |
| Sem permissão | — | Página 403 padrão (`04` §10). O botão ou cartão nem aparece (`pode()`) | — | — |
| Composer bloqueado (os 4 casos de M1) | — | O botão "Lookbook" fica `aria-disabled`, com o mesmo texto do bloqueio de M1 | — | — |

### 7.3 Microcopia fixa

- `/lookbooks`, subtítulo: "Coleções de fotos e peças para mandar às clientes pela conversa."
- Editor, aviso fixo (tom `info`): "Só entram fotos enviadas à Galeria (JPEG ou PNG). Fotos recebidas de clientes não podem ser usadas." · "O envio não inclui preço nem estoque: combine isso na conversa."
- Ligação indisponível: "Foto excluída da Galeria — sai ao salvar." / "Produto fora do catálogo — sai ao salvar."
- Limite: "Um lookbook tem no máximo 10 fotos e 20 produtos."
- Editor, rodapé para quem pode editar: "Para enviar, abra a conversa e use **Lookbook** no campo de mensagem."
- Botão reordenar: `aria-label` "Subir foto {n}" / "Descer foto {n}" (idem para produto).
- Composer: botão "Lookbook" com o ícone `BookImage`.
- Block de envio:
  - título: "Enviar lookbook";
  - resumo: "Enviar {n} fotos e a lista de {m} produtos do lookbook “{nome}” para {contato ou "a cliente"} pelo número {rótulo da conta}." Sem produtos: "Enviar {n} fotos do lookbook “{nome}” para …";
  - descrição: "A cliente recebe as fotos em sequência. Não dá para desfazer.";
  - se `foraDoEnvio`: "{x} fotos e {y} produtos excluídos ficam de fora.";
  - botão: "Enviar".
- Block de SLA:
  - título: "Salvar prazos de SLA";
  - resumo: uma linha por mudança, por exemplo "WhatsApp (oficial): de 5 min (padrão) para 10 min" · "Urgente: de sem prazo próprio para 5 min" · "Instagram: de 20 min para o padrão (15 min)";
  - descrição: "Vale o menor prazo entre o canal e a prioridade da conversa. Conversas que já passaram do prazo continuam marcadas até alguém responder.";
  - botão: "Salvar".
- `/configuracoes/sla`:
  - título: "Prazos de atendimento (SLA)";
  - subtítulo: "Tempo máximo, em minutos, para a equipe responder a uma mensagem da cliente.";
  - cartão Canal: "Vazio = padrão do sistema ({n} min).";
  - cartão Prioridade: "Vazio = sem prazo próprio; vale o do canal.";
  - rodapé: "O sistema confere os prazos a cada 5 minutos, 24 horas por dia. O alerta aparece em até 5 minutos depois do vencimento, na central de alertas. Não há aviso antes do vencimento.";
  - "Salvar" desabilitado sem mudança, com `title` "Nada mudou.".
- Rótulos de canal (`ROTULO_PROVEDOR_CONVERSA`): "WhatsApp (oficial)", "WhatsApp (não oficial)", "Instagram", "Facebook", "TikTok". Prioridade (`ROTULO_PRIORIDADE`): "Baixa", "Média", "Alta", "Urgente".
- `/alertas` (`textoDosPrazos`, montado no servidor): "{SIGLA} — WhatsApp (oficial) 5 min · WhatsApp (não oficial) 5 min · Instagram 15 min · Facebook 30 min · TikTok 60 min · prioridade Urgente 5 min". Com várias lojas, as partes vêm separadas por "; ". O texto termina com ". Vale o menor entre canal e prioridade; o sistema confere a cada 5 min". Prioridade sem regra não aparece. A faixa de M8 passa a dizer "Prazos de resposta: {texto}." e ganha o link [Alterar prazos] (`/configuracoes/sla`) só com `configuracao:editar`.
- `/configuracoes`, cartão: título "Prazos de atendimento (SLA)", texto "Tempo máximo para responder à cliente, por canal e por prioridade.", ícone `Timer` (`04` §2.9).

### 7.4 Recusas do envio (código × texto)

| Situação | Código (contrato fechado de `04` §7.2) | Texto |
|---|---|---|
| Contato com opt-out vigente | `VALIDACAO` (campo `_`) | "Esta cliente pediu para não receber divulgação. O lookbook não pode ser enviado; se ela pedir fotos, envie pela Galeria." |
| Contato anonimizado | `VALIDACAO` (`_`) | "Os dados desta cliente foram eliminados a pedido dela. O lookbook não pode ser enviado." |
| Sem foto disponível | `VALIDACAO` (`midiaIds`) | "Este lookbook não tem fotos disponíveis para enviar. Abra o lookbook e adicione fotos." |
| Canal fora da lista | `VALIDACAO` (`_`) | "Este canal ainda não recebe lookbook. Envie as fotos pela Galeria." |
| Fotos ou texto mudaram desde a prévia | `COLISAO` | O diálogo mostra (em vez da frase padrão de `COLISAO`): "O lookbook mudou desde a prévia. Confira de novo antes de enviar." [Ver prévia de novo] |
| Janela de resposta fechada / conta desconectada | `VALIDACAO` lançado por `registrarEnvio` (M1, D15) | O mesmo texto do composer (`04` §5.2) |
| Lookbook de outra loja, excluído ou conversa fora do escopo | `NAO_ENCONTRADO` | Tela padrão de "não encontrado" |
| Viewer | `SEM_PERMISSAO` | O botão nem aparece. Se a action for chamada assim mesmo, texto padrão de 403 e `recusa_403` gravado |

---

## 8. Segurança

| Ameaça | Resposta do desenho | Requisito |
|---|---|---|
| Lookbook da loja A com foto ou produto da loja B (IDOR por id no corpo, defeito A10 do antigo) | `salvarLookbook` confere todo id contra a loja do lookbook. As FKs compostas `(capa_midia_id, loja_id)`, `(lookbook_id, loja_id)`, `(midia_id, loja_id)` e `(produto_id, loja_id)` recusam no banco (D4) | INV-10, REQ-H12 |
| Enviar lookbook de outra loja numa conversa | O lookbook é lido com `loja_id = conversa.loja_id`. Outro = `NAO_ENCONTRADO` (nunca 403) | INV-10, `03` §7 item 3 |
| Ler ou alterar lookbook de outra loja pelo id | `condicaoDeLoja(escopo)` em toda leitura e mutação → 404 | REQ-H12 |
| Gestão em "Todas as lojas" gravando sem loja resolvida | Toda gravação usa `loja: "grava"`, e a tela manda o `loja_id` do registro. Sem ele → `FALTA_LOJA`. A trilha sempre tem `loja_id` | INV-05 |
| Foto de cliente (dado pessoal) virando material de divulgação | Só entra `origem = 'upload'`. Teste de integração com mídia `recebida` → `VALIDACAO` | LGPD (finalidade) |
| Link público vazando o acervo | Nenhuma rota pública nova; `ROTAS_PUBLICAS` inalterado; nenhum presigned persistido; trava `lookbook-sem-url-publica` | U8, `03` §13 |
| Divulgação para quem pediu opt-out | Bloqueio no servidor (prévia e envio) lendo **a verdade** (`consentimentos`, por `optOutVigente`) dentro da transação. Teste com espelho e verdade divergentes → vale a verdade | R2-LB-12, `01-dados-dominio` §7.2 |
| Envio duplo (duplo clique, retentativa de rede) | `chave_idempotencia` (uuid do diálogo) + único `(conversa_id, chave_idempotencia)` | `03` §8.2 |
| Envio diferente do que a pessoa viu | Fotos (em ordem) e texto da prévia são conferidos na transação → `COLISAO` | R2-LB-13 |
| Viewer ou papel sem escrita enviando | `exigirPermissao("conversas:escrever")` grava `recusa_403` | REQ-H5 |
| Envio fora da janela ou por conta desconectada | Composer desabilita. `registrarEnvio` recusa no servidor (D15). O job ainda marca `falhou` com motivo, nunca em silêncio | 01/R-09 |
| Gerente ou vendedor alterando SLA para calar alerta | `configuracao:editar` só para dono e admin (DN-07). A tentativa grava `recusa_403` | INV-21/22, REQ-H5 |
| Admin afrouxando prazo para esconder atraso | Trilha `sla_alterado` com antes e depois. Prazos vigentes visíveis a todos em `/alertas`. Subir o prazo **não** resolve alerta nem apaga `sla_estourado_em` no mesmo turno (D16) | R2-SLA-06, `02` §17 |
| Mensagem automática calando o SLA | Só `autor_tipo = 'usuario'` (não nota) conta como resposta (D16) | R2-SLA-01 |
| Injeção de SQL pelo prazo | Minutos validados como inteiro de 5 a 1.440 e gravados por parâmetro. A costura só usa `sql.raw` de **constante** | — |
| Texto com caractere invisível ou bidi no nome (golpe de exibição) | Zod recusa controle, zero-width e bidi; o React escapa; o texto vai ao provedor como texto puro | — |
| Custo ou abuso (lookbook enorme, rajada de mídia) | Teto de 10 fotos e 20 produtos; ritmo por conta de M1 (1 msg/s no uazapi) | `03` §8.4 |
| Vazamento de custo ou preço | DTO de produto elegível sem `preco` nem `preco_custo`; texto sem preço; trava de fonte | `02` §2.2 (`produtos:ver_custo`) |
| Automação enviando sozinha | Nenhum processador, job ou módulo de IA importa `@/lib/lookbooks` (trava) | Pessoa no meio |
| Colisão entre dois administradores no SLA | Trava por linha. Inserção concorrente cai no único parcial → `COLISAO` | `01` §4.7 |

---

## 9. Pacotes de construção (formato da §6 do plano)

**Pré-requisitos dos dois pacotes**:
- delta da §10 aplicado e verde (`npm run verificar`, `npm run db:verificar`, `npm run build`, rodados pelo orquestrador);
- M1, M2, M3, M4, M5 e M8 fechados.

Proibido nos dois (igual à onda 2): `npm install`, `next build`, `drizzle-kit generate`, editar `src/lib/db/**`, `src/lib/auth/**`, `src/lib/seguranca/**`, `scripts/**`, `docs/adr/**` e `docs/seguranca/**`. **Faltou algo compartilhado? O pacote para e reporta.**

### R2-E1 — Lookbooks

- **Objetivo**: lookbook de verdade. Montar com fotos e produtos da loja, editar com trava, excluir, e enviar pela conversa com prévia e block.
- **Entradas**: este documento, §1 a §8; `01-dados-dominio.md` §2.3, §2.4, §5.1, §7.2; `03-arquitetura.md` §4.3, §13; `04-ui.md` §5.2, §5.4, §7, §9, §10.
- **Cria e é dono**:
  - `src/lib/lookbooks/{index,leitura,edicao,envio,_consultas,_composicao,_montagem}.ts`
  - `src/lib/actions/lookbooks.ts`
  - `src/lib/validadores/lookbooks.ts`
  - `src/app/(app)/lookbooks/**`: `page.tsx`, `loading.tsx`, `[id]/page.tsx`, `[id]/loading.tsx`, `_components/*` (§7.1)
  - `src/app/(app)/conversas/_components/seletor-lookbook.tsx` (preenche a costura do D14) e `src/app/(app)/conversas/_components/seletor-lookbook-envio.tsx`
  - `tests/unidade/lookbooks-{montagem,composicao,permissoes}.test.ts`
  - `tests/integracao/lookbooks-{crud,envio}.test.ts`
  - `tests/componentes/lookbooks-{editor,envio}.test.tsx`
  - `tests/travas/lookbook-sem-url-publica.test.ts`
  - `docs/modulos/lookbooks.md`
- **Só lê**:
  - `src/lib/db/**` (schema, `mutacoes.ts`, `consultas.ts`, `erros.ts`) e `src/lib/auth/**`;
  - `src/lib/conversas/saida.ts` (costura) e `src/lib/lgpd` (`optOutVigente`, costura);
  - `src/lib/actions/_base.ts`, `src/lib/validadores/comum.ts`, `src/components/**`, `src/lib/ui/tons.ts`, `src/lib/navegacao.ts`, `src/lib/erros.ts`;
  - `src/app/api/midias/[id]`, só como URL.
- **Não negociável**:
  - a loja de todo id é conferida contra a loja do lookbook (e da conversa, no envio);
  - toda gravação usa `loja: "grava"`;
  - só entra foto `upload` + imagem + JPEG/PNG;
  - a ligação nunca é editada (exclui e recria), e as exclusões vêm antes das inserções;
  - `salvarLookbook` trava a linha-mãe **antes** de mexer nas ligações;
  - o envio passa **só** por `registrarEnvio`: **uma** mensagem, `midiaIds` na ordem, `card.tipo = "lookbook"`, com a conversa informada;
  - **sem preço, sem estoque, sem link**;
  - opt-out (lido pela verdade) e contato anonimizado bloqueiam o envio;
  - fotos e texto da prévia são conferidos no envio;
  - block de 3 s no envio e `ConfirmarExclusao` na exclusão;
  - nenhuma rota pública;
  - nenhum `.insert(`/`.update(` fora de `mutacoes.ts`;
  - arquivo com menos de 500 linhas;
  - `export async function` em `"use server"`.
- **Aceite verificável**:
  1. `npm run lint && npm run typecheck && npm run compliance && npm run test:travas` verdes.
  2. `node scripts/db-teste.mjs --sufixo r2e1` e depois `DATABASE_URL_TESTE=postgres://…:5437/merlostore_test_r2e1 REDIS_URL=redis://localhost:6382/13 npm run test:integracao -- lookbooks-` verde.
  3. Salvar lookbook da loja A com `midiaId` da loja B → `VALIDACAO`. O mesmo `INSERT` direto no banco pelo papel `merlo_app` → violação de `fkc_lookbooks_midias_midia`.
  4. Mídia `origem='recebida'` ou `image/webp` em `salvarLookbook` → `VALIDACAO`.
  5. Duas gravações com o mesmo `updatedAt` → a segunda devolve `COLISAO` e nenhuma ligação muda. Trocar a ordem de duas fotos → 2 ligações excluídas e 2 inseridas, sem `23505`.
  6. Gestão com escopo "todas" chamando `excluirLookbook` e `enviarLookbook` sem `loja` → `FALTA_LOJA`. Com `loja` = a do registro → sucesso, e a trilha tem `loja_id` preenchido.
  7. Envio para contato cuja **última linha de `consentimentos`** é `opt_out` concedido, **com o espelho `contatos.opt_out = false`** → `VALIDACAO` e nenhuma linha nova em `conversas_mensagens`. O inverso (espelho `true`, verdade `opt_in`) → envia.
  8. Excluir uma foto na Galeria entre a prévia e o envio → `COLISAO`. Renomear o lookbook entre a prévia e o envio → `COLISAO`.
  9. O mesmo `chaveIdempotencia` duas vezes → **uma** mensagem e **um** job `enviar-mensagem`.
  10. Envio feliz → uma linha em `conversas_mensagens` com `metadados.card = { tipo: "lookbook", id }` e `conteudo` igual ao texto da prévia, sem "R$"; N linhas em `conversas_mensagens_midias` com `ordem` 0..N−1 na ordem da prévia.
  11. WhatsApp oficial com `ultima_entrada_em` há 25 h → `VALIDACAO` (vindo de `registrarEnvio`) e nenhuma mensagem.
  12. Fluxo manual: criar → adicionar 3 fotos e 2 produtos → reordenar → capa → salvar → abrir conversa → Lookbook → prévia → aguardar 3 s → enviar → a bolha aparece por SSE com o chip "Lookbook".
- **Testes obrigatórios** (com o ID da regra no título):
  - `tests/unidade/lookbooks-montagem.test.ts`: `montarEnvio` com texto exato, sem descrição, sem produtos, corte em 1.000 com "e mais N" e "e mais 1 produto", canal fora da lista, opt-out, anonimizado, sem fotos, precedência de `bloqueio`, fotos indisponíveis fora de `midiaIds`.
  - `tests/unidade/lookbooks-composicao.test.ts`: diff manter/excluir/inserir; troca de ordem; lista vazia.
  - `tests/unidade/lookbooks-permissoes.test.ts`: quem tem `conversas:escrever` tem `conteudo:ler` e `midia:enviar`; viewer não tem `conteudo:criar`; vendedor não tem `conteudo:excluir`.
  - `tests/integracao/lookbooks-crud.test.ts`: itens 3 a 6; `23505` → `COLISAO`; capa zerada ao remover a foto; lista paginada com cursor.
  - `tests/integracao/lookbooks-envio.test.ts`: itens 7 a 11; lookbook de outra loja → `NAO_ENCONTRADO`; viewer → `SEM_PERMISSAO` com `recusa_403` em `auth_eventos`; o fluxo usa dublê só de `@/lib/fila/filas`.
  - `tests/componentes/lookbooks-editor.test.tsx`: os estados da §7.2; reordenar por teclado; conflito mantém o digitado; viewer não vê botões.
  - `tests/componentes/lookbooks-envio.test.tsx`: block de 3 s com resumo; Esc inerte; foco inicial em "Cancelar"; erro mantém o modal; `COLISAO` mostra "O lookbook mudou desde a prévia"; composer bloqueado deixa o botão `aria-disabled`.
  - `tests/travas/lookbook-sem-url-publica.test.ts`:
    - nenhum arquivo em `src/app/(publico)/**` ou `src/app/api/**` cita `lookbook`;
    - nenhum item de `ROTAS_PUBLICAS` cita `lookbook`;
    - `src/server/**` e `src/lib/ia/**` não importam `@/lib/lookbooks`;
    - `_montagem.ts` e `leitura.ts` não contêm `preco`;
    - `src/lib/lookbooks/**` não contém `contatos.opt_out` nem `opt_out:`;
    - piso: ≥ 7 arquivos varridos em `src/lib/lookbooks/`.
- **Riscos**:
  - `registrarEnvio` de M1 sem `midiaIds`, `ordem` ou recusa de janela, por falha do delta D15: o teste 10 ou 11 falha, e o pacote **para** e reporta (não contorna);
  - tentação de mandar a "1ª foto do produto" junto: fora do escopo, só vão as fotos do lookbook;
  - `optOutVigente` com outro nome em M2: o delta D18 fixa o nome; se não existir, o pacote para.
- **Commits** (Conventional Commits em PT-BR, **sem rodapé de coautoria**):
  - `feat(lookbooks): composição de fotos e produtos com trava de colisão`
  - `feat(lookbooks): envio pela conversa com prévia e bloqueio de 3 s`
  - `test(lookbooks): cobrir escopo de loja, opt-out e idempotência do envio`
  - `docs(lookbooks): documentar o módulo lookbooks`

### R2-E2 — SLA configurável

- **Objetivo**: prazos de resposta por loja, por canal e por prioridade, configurados pelo administrador e lidos pelo gerador de alertas.
- **Entradas**: este documento, §2.2, §3.2, §3.4, §5.4, §5.5, §7; `04-ui.md` §5.5, §5.6, §7, §9; `01-dados.md` §4.7, §6.6.
- **Cria e é dono**:
  - `src/lib/sla/index.ts` e `src/lib/sla/_consultas.ts`
  - `src/lib/sla/prazo.ts` (criado completo pelo delta; o E2 **não muda** o arquivo, só o testa)
  - `src/lib/actions/sla.ts` e `src/lib/validadores/sla.ts`
  - `src/app/(app)/configuracoes/sla/**`: `page.tsx`, `loading.tsx`, `_components/formulario-sla.tsx`
  - `tests/unidade/sla-validador.test.ts`
  - `tests/integracao/sla-{prazo,acoes,alertas}.test.ts`
  - `tests/componentes/sla-formulario.test.tsx`
  - `tests/travas/sla-fonte-unica.test.ts`
  - `docs/modulos/sla.md`
- **Só lê**: `src/lib/db/**`, `src/lib/auth/**`, `src/lib/fila/agendamentos.ts`, `src/lib/actions/_base.ts`, `src/components/**`, `src/lib/ui/tons.ts`, `src/lib/alertas/**` (para a trava e para chamar `gerarAlertas` no teste).
- **Não negociável**:
  - "vale o menor" (`least`), com o padrão do canal quando não há regra de canal;
  - faixa de 5 a 1.440 na tela e no Zod;
  - só dono e admin gravam, com `loja: "grava"`;
  - `sla_alterado` por linha gravada; block de 3 s com diff;
  - salvar regra não escreve em `conversas` nem em `alertas`;
  - `PRAZO_SLA_PADRAO_MIN` só existe em `prazo.ts`;
  - nenhuma tela promete notificação.
- **Aceite verificável**:
  1. `npm run lint && npm run typecheck && npm run compliance && npm run test:travas` verdes.
  2. `node scripts/db-teste.mjs --sufixo r2e2` e depois `DATABASE_URL_TESTE=postgres://…:5437/merlostore_test_r2e2 REDIS_URL=redis://localhost:6382/14 npm run test:integracao -- sla-` verde.
  3. Matriz de `minutosDeSlaSql` executada no Postgres de teste: 5 provedores × 4 prioridades × {sem regra, regra de canal, regra de prioridade, as duas}, mais um provedor fora da lista (`tiktok_shop`) → 5. O resultado bate com a tabela esperada do teste.
  4. Loja com `urgente = 5` e conversa urgente no Instagram (padrão 15): primeira entrada não respondida há 4 min → não vence; há 6 min → vence. Loja sem regra: vence só depois de 15 min.
  5. Gerente chama `salvarPrazosSla` → `SEM_PERMISSAO` e `recusa_403` em `auth_eventos`.
  6. Dois `salvarPrazosSla` com o mesmo `updatedAt` → o segundo dá `COLISAO`. Dois inserts da mesma chave → um `COLISAO`. Todas as linhas da tabela de decisão da §5.5 cobertas.
  7. Com `gerarAlertas({ lojaId })` de `@/lib/alertas`:
     - (a) alerta `sla_estourado` aberto; subir o prazo do canal para 1.440 e rodar de novo → o alerta **continua** aberto e `sla_estourado_em` **continua** preenchido;
     - (b) a cliente manda mais uma mensagem sem resposta → continua um alerta só;
     - (c) a equipe responde (`autor_tipo = 'usuario'`) e o gerador roda → `resolvido_em` e `sla_estourado_em = NULL`;
     - (d) mensagem de saída com `autor_tipo = 'campanha'` **não** resolve;
     - (e) cliente com três entradas, a 2 min uma da outra e sem resposta, com prazo de 5: o alerta abre quando a **primeira** passa de 5 min.
  8. `/configuracoes/sla` em "Todas as lojas" → mensagem de `FALTA_LOJA`. Com loja → salva e mostra "Prazos salvos…". `/alertas` mostra o prazo novo da loja na conferência seguinte.
- **Testes obrigatórios** (com o ID da regra no título):
  - `tests/unidade/sla-validador.test.ts`: 4, 5, 1.440, 1.441, decimal, nulo, chaves repetidas, lista vazia = "Nada mudou.".
  - `tests/integracao/sla-prazo.test.ts`: itens 3 e 4; `lerPrazosVigentes` com escopo `uma`, `todas` e `nenhuma`; `textoDosPrazos` exato para uma loja com regra de prioridade.
  - `tests/integracao/sla-acoes.test.ts`: itens 5 e 6; trilha com antes e depois; "voltar ao padrão" = exclusão lógica, e recriar funciona.
  - `tests/integracao/sla-alertas.test.ts`: item 7, com o gerador de M8 como caixa-preta. Cada teste nasce numa loja nova, sem apagar nada. Exige a escrita de alertas de M8 disponível (D16, item 6).
  - `tests/componentes/sla-formulario.test.tsx`: os estados; diff no resumo do block; "Salvar" desabilitado sem mudança; campo vazio vira `null`; `COLISAO` mantém o digitado.
  - `tests/travas/sla-fonte-unica.test.ts`:
    - (a) `export const PRAZO_SLA_PADRAO_MIN` aparece em `src/**` só em `src/lib/sla/prazo.ts`;
    - (b) nenhum arquivo em `src/lib/alertas/**`, `src/server/processadores/manutencao.ts` ou `src/app/(app)/alertas/**` casa `/\b(whatsapp_oficial|uazapi|instagram|facebook|tiktok|tiktok_shop)\s*:\s*\d+/`, nem contém `SLA_MINUTOS` ou `PRAZOS_SLA_TEXTO`;
    - (c) algum arquivo de `src/lib/alertas/**` importa `venceEmSql` de `@/lib/sla/prazo`;
    - (d) o texto de `src/lib/fila/agendamentos.ts` tem o bloco com `job: "gerar-alertas"` e `padrao: "*/5 * * * *"`, e `INTERVALO_CONFERENCIA_SLA_MIN === 5`;
    - (e) `PROVEDORES_DE_CONVERSA` é exatamente `["whatsapp_oficial","uazapi","instagram","facebook","tiktok"]` e todo item está em `PROVEDORES`.
- **Riscos**:
  - M8 ter sido entregue com outra forma de consulta: o delta D16 preserva o **contrato** (item 7), e o E2 só **prova**; se o item 7 falhar, o pacote para e reporta;
  - subconsulta por linha pesando com muitas conversas abertas (com duas lojas é irrelevante; se medir lento, CTE com `lojas_sla` agregada, mesma assinatura, por ADR);
  - `gerar-alertas` a cada 5 min demorando mais que o intervalo: o log de M8 já registra a duração; se o p95 passar de 60 s, separar a regra de SLA num job próprio, por ADR.
- **Commits** (sem rodapé de coautoria):
  - `feat(sla): prazos por canal e prioridade configuráveis pelo administrador`
  - `test(sla): provar a regra do menor prazo e que afrouxar não resolve alerta`
  - `docs(sla): documentar o módulo sla`

**Tamanho estimado**: E1 ≈ 24 arquivos / 2.700 linhas (≈ 1 dia de agente); E2 ≈ 12 arquivos / 1.000 linhas (≈ meio dia).

---

## 10. DELTA DA FUNDAÇÃO (o orquestrador aplica ANTES da onda 3)

**Ordem**: aplicar depois que M1 a M8 fecharem, junto com os deltas dos outros clusters. Onde um arquivo é tocado por mais de um cluster (enums, migração, contagens, navegação, permissões, tons, block, `saida.ts`, composer, balão, gerador de M8, página de M5), **este documento dá só a parte do R2-E**, e o orquestrador aplica **um** patch por arquivo. Os valores finais globais que este cluster depende estão escritos aqui mesmo (D5, D10, D12), para não haver duas versões.

### D1 — Enums

**`src/lib/db/schema/_enums/plataforma.ts`**. Depois de `PROVEDORES` (que o delta do R2-D amplia com `tiktok` e o do R2-PG com os de pagamento), acrescentar:

```ts
/**
 * Provedores que ABREM CONVERSA (têm adaptador de canal). Lista explícita, e
 * não "PROVEDORES menos X": pagamento, Bling e `tiktok_shop` não conversam.
 * Fonte do CHECK de `lojas_sla` e do prazo padrão (`src/lib/sla/prazo.ts`).
 */
export const PROVEDORES_DE_CONVERSA = [
  "whatsapp_oficial",
  "uazapi",
  "instagram",
  "facebook",
  "tiktok",
] as const;
export type ProvedorDeConversa = (typeof PROVEDORES_DE_CONVERSA)[number];
```

**`src/lib/db/schema/_enums/auditoria.ts`**. Em `ACOES_AUDITADAS`, depois de `"template_rejeitado",`:

```ts
  "lookbook_criado",
  "lookbook_alterado",
  "lookbook_excluido",
  "sla_alterado",
```

A lista final soma as ações dos cinco clusters: `negocio_alterado`, `pesquisa_enviada`, `pagamento_cancelado`, `pagamento_status_alterado`, `artigo_criado`, `artigo_alterado`, `artigo_excluido`, `artigo_etiqueta_alterada` e estas quatro. São **12 novas**, mais `alerta_reconhecido` se o bloqueio de M8 (D16, item 6) for resolvido no mesmo pacote.

### D2 — Tipo `MetadadosMensagem` (`src/lib/db/schema/conversas/mensagens.ts`, sem migração)

Texto final único (junta o R2-D e o R2-E):

```ts
export type MetadadosMensagem = {
  tipo_original?: string;
  story_url?: string;
  encaminhada?: boolean;
  citacao_externa_id?: string;
  /** TikTok: `conversation_id` do provedor, exigido para responder (R2-D). */
  conversa_externa_id?: string;
  erro_provedor?: { codigo: string; mensagem: string };
  /** Cartão derivado; `lookbook` = envio de lookbook pela conversa (R2-E1). */
  card?: { tipo: "produto" | "pedido" | "pagamento" | "lookbook"; id: string };
};
```

Mais a linha de `01-dados.md` §10 e o schema Zod de metadados onde M1 o declarou (aceitando `"lookbook"`).

### D3 — Schema novo `src/lib/db/schema/lojas-sla.ts`

```ts
import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { colunasAuditoria } from "./_compartilhado";
import { checkLista } from "./_enums";
import { PRIORIDADES } from "./_enums/conversas";
import { PROVEDORES_DE_CONVERSA } from "./_enums/plataforma";
import { lojas } from "./lojas";

/**
 * `lojas_sla` — prazo de resposta por loja (ADR 0056).
 *
 * Uma linha = UMA regra: por canal (`provedor`) OU por prioridade. Sem linha =
 * padrão do código (canal) / sem prazo próprio (prioridade). "Voltar ao
 * padrão" é exclusão lógica. COM trava de colisão (dois administradores).
 * Quem lê é `src/lib/sla/prazo.ts` — a única fonte do prazo.
 */
export const lojas_sla = pgTable(
  "lojas_sla",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loja_id: uuid("loja_id")
      .notNull()
      .references(() => lojas.id, { onDelete: "restrict", onUpdate: "restrict" }),
    provedor: text("provedor"),
    prioridade: text("prioridade"),
    minutos: integer("minutos").notNull(),
    ...colunasAuditoria,
  },
  (t) => [
    checkLista("lojas_sla_provedor_lista", t.provedor, PROVEDORES_DE_CONVERSA),
    checkLista("lojas_sla_prioridade_lista", t.prioridade, PRIORIDADES),
    check("lojas_sla_um_alvo", sql`num_nonnulls(${t.provedor}, ${t.prioridade}) = 1`),
    check("lojas_sla_minutos_faixa", sql`${t.minutos} between 1 and 1440`),
    uniqueIndex("uq_lojas_sla_provedor")
      .on(t.loja_id, t.provedor)
      .where(sql`provedor is not null and is_deleted = false`),
    uniqueIndex("uq_lojas_sla_prioridade")
      .on(t.loja_id, t.prioridade)
      .where(sql`prioridade is not null and is_deleted = false`),
    index("ix_lojas_sla_loja").on(t.loja_id, t.is_deleted),
  ],
);
```

`src/lib/db/schema/index.ts`: linha nova, em ordem alfabética, logo depois de `export * from "./lojas";`:

```ts
export * from "./lojas-sla";
```

Comentário de `src/lib/db/schema/alertas.ts`: trocar o parágrafo "Sem tabela de configuração de SLA nesta entrega…" por "Prazo de SLA: `src/lib/sla/prazo.ts` (lê `lojas_sla`, ADR 0056)."

### D4 — Coluna `ordem` e migrações

**`src/lib/db/schema/conversas/mensagens-midias.ts`**: nas colunas, depois de `legenda`:

```ts
    /** Posição na mensagem (0..N-1). Envio e bolha leem `ORDER BY ordem, id` (ADR 0055). */
    ordem: integer("ordem").notNull().default(0),
```

Nas restrições:

```ts
    check("conversas_mensagens_midias_ordem_positiva", sql`${t.ordem} >= 0`),
```

**`0018_r2`** (gerada **uma vez** para os cinco clusters, `npx drizzle-kit generate --name r2`). A parte do R2-E que precisa sair no SQL, conferida à mão:
- `CREATE TABLE "lojas_sla"` com as 10 colunas, as 4 CHECKs nomeadas (`lojas_sla_provedor_lista` com `('whatsapp_oficial', 'uazapi', 'instagram', 'facebook', 'tiktok')`, `lojas_sla_prioridade_lista`, `lojas_sla_um_alvo`, `lojas_sla_minutos_faixa`), FK para `lojas` RESTRICT/RESTRICT, os 2 únicos parciais com predicado **literal** e o índice `ix_lojas_sla_loja`;
- `ALTER TABLE "conversas_mensagens_midias" ADD COLUMN "ordem" integer DEFAULT 0 NOT NULL;` e a CHECK `conversas_mensagens_midias_ordem_positiva`;
- o `DROP`/`ADD` de `auditoria_eventos_acao_lista` **uma única vez**, com a lista final somada (D1).

Conferir `grep -n "= \$"` vazio e nenhum `DROP TABLE`.

**`0019_r2_integridade`** (custom, **única**, `npx drizzle-kit generate --custom --name r2_integridade`). Ela também recebe o append-only de `lojas_ia_usos` (R2-C) e a semente do ator de sistema. A parte do R2-E:

```sql
-- R2-E: FK compostas dos lookbooks e FK de modified_by de lojas_sla (ADR 0054, 0056).
-- As tabelas de lookbook nasceram vazias no R1 (sem modulo): as constraints entram sem backfill.
ALTER TABLE lookbooks ADD CONSTRAINT uq_lookbooks_id_loja UNIQUE (id, loja_id);
--> statement-breakpoint
ALTER TABLE lookbooks ADD CONSTRAINT fkc_lookbooks_capa FOREIGN KEY (capa_midia_id, loja_id)
  REFERENCES lojas_midias (id, loja_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
--> statement-breakpoint
ALTER TABLE lookbooks_midias ADD CONSTRAINT fkc_lookbooks_midias_lookbook FOREIGN KEY (lookbook_id, loja_id)
  REFERENCES lookbooks (id, loja_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
--> statement-breakpoint
ALTER TABLE lookbooks_midias ADD CONSTRAINT fkc_lookbooks_midias_midia FOREIGN KEY (midia_id, loja_id)
  REFERENCES lojas_midias (id, loja_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
--> statement-breakpoint
ALTER TABLE lookbooks_produtos ADD CONSTRAINT fkc_lookbooks_produtos_lookbook FOREIGN KEY (lookbook_id, loja_id)
  REFERENCES lookbooks (id, loja_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
--> statement-breakpoint
ALTER TABLE lookbooks_produtos ADD CONSTRAINT fkc_lookbooks_produtos_produto FOREIGN KEY (produto_id, loja_id)
  REFERENCES produtos (id, loja_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
--> statement-breakpoint
-- O laco de 0016 so pegou as tabelas que existiam: tabela nova com modified_by ganha a FK aqui.
ALTER TABLE lojas_sla ADD CONSTRAINT fk_lojas_sla_modified_by FOREIGN KEY (modified_by)
  REFERENCES usuarios (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
--> statement-breakpoint
-- Explicito (idempotente): nunca DELETE nem TRUNCATE para a aplicacao.
GRANT SELECT, INSERT, UPDATE ON lojas_sla TO merlo_app;
```

### D5 — Contagens (valores finais globais, num commit só)

- `scripts/verificar-schema.mjs`: `TOTAL_TABELAS = 50` (48 + `lojas_ia_usos` + `lojas_sla`); `TOTAL_MODIFIED_BY = 41` (só `lojas_sla` tem `modified_by`); `TOTAL_FK_COMPOSTA = 21` (16 + as 5 `fkc_lookbooks_*`); `APPEND_ONLY` com 5 itens (+ `lojas_ia_usos`), o que dá 5 gatilhos `trg_*_imutavel`. Cabeçalho: "50 tabelas", "as 21 FKs compostas (id, loja_id) e as 41 FKs de modified_by", "os 5 gatilhos de trilha".
- `tests/travas/migracoes.test.ts`:
  - `TAGS` ganha `"0018_r2"` e `"0019_r2_integridade"`, com o comentário `/** 0018 e 0019: delta único do R2 (os cinco clusters), gerado de uma vez; ADRs 0031–0057. */`;
  - o título do primeiro teste vira "são as de 01-dados.md §9 mais as da fundação e do R2, na ordem";
  - "criam as 48 tabelas" vira "criam as 50 tabelas", com `toBe(50)` e `toHaveLength(50)`.
- `tests/travas/mutacoes.test.ts`: `expect(colunasPorTabela.size).toBe(50);`.
- `tests/integracao/enums-check.test.ts`: comentário "as 50 configurações".
- **O R2-E não acrescenta nada a `src/lib/db/mutacoes.ts`** (usa só `inserirAuditado`, `atualizarComTrava` e `excluirLogico`). A divisão de `mutacoes.ts` em pasta, pedida pela crítica, é do pacote consolidado e não muda nenhuma importação deste cluster (o reexportador `src/lib/db/mutacoes.ts` continua).

### D6 — `src/lib/db/erros.ts`: violação de único

Acrescentar ao fim:

```ts
/**
 * Violação de único (23505) numa das constraints dadas. Lê o erro do `pg`
 * direto ou embrulhado pelo Drizzle (`cause`). Quem chama traduz para
 * `ErroDeColisao` — a transação já está abortada e vai sofrer rollback.
 */
export function ehViolacaoDeUnico(erro: unknown, ...constraints: readonly string[]): boolean {
  type ErroPg = { code?: unknown; constraint?: unknown };
  const bruto = erro as (ErroPg & { cause?: ErroPg }) | null;
  const pg = bruto && bruto.code !== undefined ? bruto : bruto?.cause;
  return pg?.code === "23505" && typeof pg.constraint === "string" && constraints.includes(pg.constraint);
}
```

Teste novo `tests/unidade/db-erros.test.ts`, com erro direto, embrulhado, constraint diferente e código diferente.

### D7 — Costura `src/lib/sla/prazo.ts` (arquivo novo, texto completo)

```ts
import { asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { EscopoLoja } from "@/lib/auth/loja";
import { vivosE } from "@/lib/db/consultas";
import type { Transacao } from "@/lib/db/mutacoes";
import { PRIORIDADES, type Prioridade } from "@/lib/db/schema/_enums/conversas";
import { PROVEDORES_DE_CONVERSA, type ProvedorDeConversa } from "@/lib/db/schema/_enums/plataforma";
import { lojas } from "@/lib/db/schema/lojas";
import { lojas_sla } from "@/lib/db/schema/lojas-sla";
import { ROTULO_PRIORIDADE, ROTULO_PROVEDOR_CONVERSA } from "@/lib/ui/tons";

/**
 * COSTURA — dono: R2-E2 (SLA configurável). Consumida por M8 (`gerar-alertas`
 * e `/alertas`). ADR 0056.
 *
 * Fonte ÚNICA do prazo de resposta. Nenhum outro arquivo declara 5/15/30/60 —
 * a trava `tests/travas/sla-fonte-unica.test.ts` reprova. Sem `server-only` e
 * sem `db`: recebe `tx`, monta SQL e lê por quem chama.
 */

export type { ProvedorDeConversa };

export const PRAZO_SLA_PADRAO_MIN: Readonly<Record<ProvedorDeConversa, number>> = {
  whatsapp_oficial: 5,
  uazapi: 5,
  instagram: 15,
  facebook: 30,
  tiktok: 60,
};

/** Provedor fora da lista: o prazo mais curto — erra para o lado de avisar. */
export const PRAZO_SLA_DESCONHECIDO_MIN = 5;
/** Igual ao agendador de `gerar-alertas` (a trava confere). ADR 0057. */
export const INTERVALO_CONFERENCIA_SLA_MIN = 5;
export const MAXIMO_SLA_MIN = 1440;

type Ref = AnyPgColumn | SQL;
export type RefsSla = { lojaId: Ref; provedor: Ref; prioridade: Ref };

// Literais de constante, nunca parâmetro: `case ... else $1` tipa mal no Postgres.
const QUANDO = Object.entries(PRAZO_SLA_PADRAO_MIN)
  .map(([provedor, minutos]) => `when '${provedor}' then ${minutos}`)
  .join(" ");

export function padraoDoCanalSql(provedor: Ref): SQL<number> {
  return sql<number>`(case ${provedor} ${sql.raw(QUANDO)} else ${sql.raw(String(PRAZO_SLA_DESCONHECIDO_MIN))} end)`;
}

/** Vale o MENOR entre a regra do canal (ou o padrão) e a regra da prioridade. `least` ignora nulo. */
export function minutosDeSlaSql({ lojaId, provedor, prioridade }: RefsSla): SQL<number> {
  return sql<number>`least(
    coalesce(
      (select s.minutos from ${lojas_sla} s
        where s.loja_id = ${lojaId} and s.provedor = ${provedor} and s.is_deleted = false),
      ${padraoDoCanalSql(provedor)}),
    (select s.minutos from ${lojas_sla} s
      where s.loja_id = ${lojaId} and s.prioridade = ${prioridade} and s.is_deleted = false))`;
}

/** Instante em que o prazo vence. O gerador compara com `now()`. */
export function venceEmSql(inicio: Ref, refs: RefsSla): SQL<Date> {
  return sql<Date>`(${inicio} + make_interval(mins => ${minutosDeSlaSql(refs)}))`;
}

export type PrazoDeCanal = {
  chave: ProvedorDeConversa;
  minutos: number;
  padrao: number;
  origem: "padrao" | "loja";
  updatedAt: Date | null;
};
export type PrazoDePrioridade = { chave: Prioridade; minutos: number | null; updatedAt: Date | null };
export type PrazosDaLoja = {
  lojaId: string;
  lojaNome: string;
  lojaSigla: string;
  canais: PrazoDeCanal[];
  prioridades: PrazoDePrioridade[];
};

/** Prazos vigentes das lojas vivas do escopo, em ordem de sigla. */
export async function lerPrazosVigentes(tx: Transacao, escopo: EscopoLoja): Promise<PrazosDaLoja[]> {
  if (escopo.tipo === "nenhuma") return [];
  const doEscopo = await tx
    .select({ id: lojas.id, nome: lojas.nome, sigla: lojas.sigla })
    .from(lojas)
    .where(vivosE(lojas, escopo.tipo === "uma" ? eq(lojas.id, escopo.lojaId) : undefined))
    .orderBy(asc(lojas.sigla));
  if (doEscopo.length === 0) return [];
  const regras = await tx
    .select({
      lojaId: lojas_sla.loja_id,
      provedor: lojas_sla.provedor,
      prioridade: lojas_sla.prioridade,
      minutos: lojas_sla.minutos,
      updatedAt: lojas_sla.updated_at,
    })
    .from(lojas_sla)
    .where(vivosE(lojas_sla, inArray(lojas_sla.loja_id, doEscopo.map((l) => l.id))));

  return doEscopo.map((l) => {
    const daLoja = regras.filter((r) => r.lojaId === l.id);
    return {
      lojaId: l.id,
      lojaNome: l.nome,
      lojaSigla: l.sigla,
      canais: PROVEDORES_DE_CONVERSA.map((chave): PrazoDeCanal => {
        const padrao = PRAZO_SLA_PADRAO_MIN[chave];
        const r = daLoja.find((x) => x.provedor === chave);
        return r
          ? { chave, minutos: r.minutos, padrao, origem: "loja", updatedAt: r.updatedAt }
          : { chave, minutos: padrao, padrao, origem: "padrao", updatedAt: null };
      }),
      prioridades: PRIORIDADES.map((chave): PrazoDePrioridade => {
        const r = daLoja.find((x) => x.prioridade === chave);
        return { chave, minutos: r?.minutos ?? null, updatedAt: r?.updatedAt ?? null };
      }),
    };
  });
}

/** A frase de `/alertas` (spec R2-E §7.3). */
export function textoDosPrazos(prazos: readonly PrazosDaLoja[]): string {
  const partes = prazos.map((l) => {
    const canais = l.canais.map((c) => `${ROTULO_PROVEDOR_CONVERSA[c.chave]} ${c.minutos} min`);
    const prioridades = l.prioridades
      .filter((p) => p.minutos !== null)
      .map((p) => `prioridade ${ROTULO_PRIORIDADE[p.chave]} ${p.minutos} min`);
    return `${l.lojaSigla} — ${[...canais, ...prioridades].join(" · ")}`;
  });
  return `${partes.join("; ")}. Vale o menor entre canal e prioridade; o sistema confere a cada ${INTERVALO_CONFERENCIA_SLA_MIN} min`;
}
```

Tabela de costuras (`05-plano` §5), linha nova: `src/lib/sla/prazo.ts` | `minutosDeSlaSql(refs)`, `venceEmSql(inicio, refs)`, `lerPrazosVigentes(tx, escopo)`, `textoDosPrazos(prazos)`, `PRAZO_SLA_PADRAO_MIN`, `INTERVALO_CONFERENCIA_SLA_MIN` | **R2-E2** — consumida por M8.

### D8 — Agendador de 5 minutos (`src/lib/fila/agendamentos.ts`)

- Trocar o item `gerar-alertas-15min` por:

  ```ts
  {
    nome: "gerar-alertas-5min",
    fila: "manutencao",
    job: "gerar-alertas",
    padrao: "*/5 * * * *",
    porque: "o menor prazo de SLA aceito é 5 min (INTERVALO_CONFERENCIA_SLA_MIN); conferir de 15 em 15 atrasaria o alerta em até 15 min",
  },
  ```

- Acrescentar antes de `registrarAgendamentos`:

  ```ts
  /**
   * Agendadores que deixaram de existir. O nome é a chave do upsert: trocar o
   * nome sem remover o antigo deixaria os dois rodando para sempre no Redis.
   */
  export const AGENDADORES_APOSENTADOS: readonly { nome: string; fila: NomeDeFila }[] = [
    { nome: "gerar-alertas-15min", fila: "manutencao" },
  ];
  ```

- Primeira instrução de `registrarAgendamentos()` (o BullMQ 6.3.6 instalado tem `Queue.removeJobScheduler`):

  ```ts
  for (const a of AGENDADORES_APOSENTADOS) await fila(a.fila).removeJobScheduler(a.nome);
  ```

- `03-arquitetura.md` §8.1: `gerar-alertas` a cada 5 min.

Os agendadores novos dos outros clusters (`pos-venda`, `pagamentos`, `ia`) entram no mesmo patch deste arquivo.

### D9 — Permissões

- `src/lib/auth/permissoes/fase-r2.ts`: **remover** as quatro linhas `conteudo:*`. O esvaziamento completo de `FASE_R2` é do delta global de permissões.
- `src/lib/auth/permissoes/comercial.ts`: ao fim de `COMERCIAL`:

  ```ts
    /**
     * Lookbooks (R2-E1, ADR 0054). Todos veem; quem vende monta e edita;
     * excluir é da gestão. ENVIAR não é chave daqui: é `conversas:escrever`.
     */
    "conteudo:ler": TODOS,
    "conteudo:criar": OPERACAO,
    "conteudo:editar": OPERACAO,
    "conteudo:excluir": GESTAO,
  ```

- `02-seguranca.md` §2.2: `conteudo:*` sai do bloco "fase R2" e vai para a família comercial, com a nota "lookbooks".
- `tests/seguranca/rbac.test.ts`: o caso "as chaves da fase R2 estão SEPARADAS" é reescrito pelo delta global (o mapa entregue passa a se chamar `MATRIZ_ENTREGUE`). Acrescentar ao mesmo arquivo: `conteudo:excluir` → gerente sim, vendedor não; `conteudo:criar` → viewer não.

### D10 — Navegação e ícone (decisão global de fase)

- **`src/lib/navegacao.ts`** (decisão global, aplicada uma vez):
  - `fase: "R1" | "R2"` vira `fase: "entregue" | "futura"`, com o comentário "Item `futura` não renderiza e não tem `page.tsx`";
  - todo item hoje `"R1"` vira `"entregue"`;
  - "Funil", "Trocas e devoluções" e "Base de conhecimento" viram `"entregue"` (clusters R2-A e R2-C);
  - `NAVEGACAO_R1` é renomeado para `NAVEGACAO_ENTREGUE`, filtrando `i.fase === "entregue"`. O único consumidor é `itensVisiveis`, no mesmo arquivo;
  - no grupo Comunicação, depois de "Respostas rápidas":

    ```ts
    {
      rotulo: "Lookbooks",
      rota: "/lookbooks",
      icone: "lookbooks",
      grupo: "Comunicação",
      permissao: "conteudo:ler",
      fase: "entregue",
    },
    ```

  - o comentário do campo `icone` passa a citar `src/components/layout/navegacao-lateral.tsx` (`ICONES_NAV`), que é onde o mapa vive.
- **`src/components/layout/navegacao-lateral.tsx`**: importar `BookImage` de `lucide-react` (existe na 1.46.0 instalada) e acrescentar `lookbooks: BookImage,` em `ICONES_NAV`.
- **`tests/seguranca/inventario.test.ts`**: "todo item R1 do catálogo…" vira "todo item **entregue** do catálogo tem linha no documento de caminhos", com `i.fase === "entregue"`. "item R2 NAO aparece como rota entregue" vira "item **futura** NÃO tem `page.tsx`", com `i.fase === "futura"`, **sem** o `expect(r2.length).toBeGreaterThan(0)`.
- **`03-arquitetura.md` §25 item 5** e **`docs/seguranca/caminhos-de-acesso.md` §7**: "fase R2" vira "fase `futura`".

### D11 — `src/lib/ui/tons.ts`

Import novo: `import type { ProvedorDeConversa } from "@/lib/db/schema/_enums/plataforma";`. Depois de `rotuloDePapel`:

```ts
/** Prioridade por extenso para formulário e texto (o selo omite baixa e média de propósito). */
export const ROTULO_PRIORIDADE: Readonly<Record<Prioridade, string>> = {
  baixa: "Baixa",
  media: "Média",
  alta: "Alta",
  urgente: "Urgente",
};

/** Canal por extenso, distinguindo os dois WhatsApp (tela e texto de SLA). */
export const ROTULO_PROVEDOR_CONVERSA: Readonly<Record<ProvedorDeConversa, string>> = {
  whatsapp_oficial: "WhatsApp (oficial)",
  uazapi: "WhatsApp (não oficial)",
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
};
```

### D12 — Lista fechada de block de 3 s

`tests/componentes/block-3s.test.tsx`, `ACOES_COM_BLOCK`: lista final única de **27** identificadores. São os 20 atuais mais `negar-troca`, `concluir-troca` (R2-A), `gerar-cobranca`, `cancelar-cobranca` (R2-PG), `publicar-artigo` (R2-C), `enviar-lookbook` e `salvar-prazos-de-sla` (R2-E). A ordem é a do `04-ui.md` §9.1 renumerado **uma vez** pelo orquestrador. Comentário: "§9.1, na ordem do documento. Vinte e sete itens, nem um a mais."

Posição dos dois itens do R2-E no §9.1 (e na lista):
- `enviar-lookbook`: grupo Comunicação, logo depois de "Iniciar/retomar disparo". Texto: "**Enviar lookbook** (nº de fotos e de produtos, contato, número de saída)";
- `salvar-prazos-de-sla`: grupo Plataforma, logo depois de "Criar/editar loja e desativar loja". Texto: "**Salvar prazos de SLA** (diff por canal e prioridade)".

### D13 — Documentos

- **`docs/seguranca/caminhos-de-acesso.md`**:
  - §4, linhas novas:

    ```
    | `/lookbooks` | `conteudo:ler` (criar: `conteudo:criar`) | pacote R2-E1 |
    | `/lookbooks/[id]` | `conteudo:ler` (salvar: `conteudo:editar`; excluir: `conteudo:excluir`) | pacote R2-E1 |
    ```

  - §6, linha nova: `| /configuracoes/sla | configuracao:ler (salvar: configuracao:editar) | pacote R2-E2 |`. Retirar `/configuracoes/sla` da lista "Nao existem";
  - §7: retirar `/lookbooks` da lista.
- **`04-ui.md`**:
  - §4.1: retirar `/configuracoes/sla` de "Rotas que não existem" (`/galeria/lookbooks*` **continua** não existindo) e acrescentar `/lookbooks`, `/lookbooks/[id]` e `/configuracoes/sla` à árvore;
  - §5.5 (`/alertas`): "prazos de SLA vigentes por loja, lidos de `lojas_sla` (texto somente leitura, com link para quem configura)";
  - §5.6: trocar "SLA não tem tela…" pela linha de `/configuracoes/sla` desta §7.
- **`01-dados.md`**:
  - §1: 50 tabelas;
  - §6.6: trocar "Sem tabela de configuração de SLA…" por "Prazo de SLA configurável por loja em `lojas_sla` (ADR 0056)";
  - §9: `0018_r2` e `0019_r2_integridade`;
  - §13.4: tirar "lookbooks" e "SLA configurável" de "Fora";
  - §16.1: `lojas_sla` na família Plataforma;
  - §16.3: `PROVEDORES_DE_CONVERSA`.
- **`01-dados-dominio.md`**: §2.4 ganha a coluna `ordem`; §5.1 perde "Fora do R1" e ganha as FKs compostas.
- **`03-arquitetura.md`**: §4.2 com os módulos `lookbooks` e `sla`; §22 tira lookbooks e SLA configurável de "Fora".
- **`docs/regras-negocio.md`**: seção "Lookbooks e SLA", com as regras R2-LB e R2-SLA da §2.

### D14 — Costura de UI `src/app/(app)/conversas/_components/seletor-lookbook.tsx` (a fundação cria, dono R2-E1)

```tsx
"use client";

/**
 * COSTURA — dono: R2-E1 (spec r2/final-r2e-lookbooks-sla.md §7).
 * Botão "Lookbook" do composer: lista, prévia, block de 3 s e envio.
 * Arquivo dentro da pasta de M1; M1 só o monta.
 */
export function SeletorLookbook(_props: {
  conversaId: string;
  lojaId: string;
  bloqueado: boolean;
  motivoBloqueio?: string;
}) {
  return null;
}
```

Tabela de costuras: `src/app/(app)/conversas/_components/seletor-lookbook.tsx` | `<SeletorLookbook conversaId lojaId bloqueado motivoBloqueio? />` | **R2-E1** (arquivo dentro da pasta de M1).

### D15 — Delta único de M1 (a parte do R2-E)

**`src/lib/conversas/saida.ts`**: tipo final único (junta os pedidos do R2-A, do R2-PG e do R2-E):

```ts
export type EnvioParaRegistrar = {
  lojaId: string;
  contatoId: string;
  integracaoId: string;
  conteudo: string;
  chaveIdempotencia: string;
  // + os campos que o próprio M1 acrescentou ao entregar (no código em andamento: `modelo?`)
  /** Grava nesta conversa (precisa ser do contato e da integração). Sem ela, vale a mesclagem de M1. */
  conversaId?: string;
  /** `false`: grava sem mudar status nem reabrir (R2-A). Padrão `true`. */
  reabrir?: boolean;
  /** Autor quando não é a pessoa da sessão (R2-A). */
  autorTipo?: "sistema" | "campanha";
  /** Ids de `lojas_midias` da MESMA loja, na ordem: UMA mensagem com N mídias (R2-E1). */
  midiaIds?: readonly string[];
  /** Cartão derivado (01-dados-dominio.md §2.3). */
  card?: NonNullable<MetadadosMensagem["card"]>;
};
```

**Contrato que o corpo de M1 honra para `midiaIds` e `card`** (provado por `tests/integracao/lookbooks-envio.test.ts`):

- (a) cada `midiaId` é de `lojas_midias` viva da `lojaId`; senão, `ErroDeEscopo`;
- (b) grava **uma** linha em `conversas_mensagens` (`direcao = 'saida'`, `autor_tipo = 'usuario'`, `autor_usuario_id` da sessão, `tipo_conteudo = 'imagem'` quando houver mídia, `conteudo` = texto, `metadados.card` validado pelo Zod de metadados);
- (c) grava N linhas em `conversas_mensagens_midias` com `midia_id`, `tipo_arquivo`, `mime_type` e `tamanho_bytes` copiados de `lojas_midias`, `url_externa` nulo, `baixada = true` e **`ordem = índice`**;
- (d) **no servidor, sem modelo**, recusa com `ErroDeValidacao` e o mesmo texto do composer (`04` §5.2) quando a conta não está `conectado` ou a janela do provedor não está aberta (`situacaoDaJanela` de `src/lib/canais/janela.ts`, do R2-D, com `origem = "composer"`);
- (e) o job de envio lê as mídias em `ORDER BY ordem, id` e as manda em sequência, com `conteudo` como legenda da primeira ou como texto separado, conforme o adaptador;
- (f) se uma mídia falha, a mensagem fica `falhou` com motivo e o reenvio não repete as que já saíram (`externo_id` por linha de mídia);
- (g) na **entrada** com vários anexos, M1 grava `ordem` = posição em `midias[]`.

**`src/app/(app)/conversas/_components/composer.tsx`**: no modo "Responder", na barra de ferramentas, **um** ponto de montagem para as costuras do R2, na ordem "Anexar · Produto · **Lookbook** · Resposta rápida · Sugestão (R2-C)". A linha do R2-E usa os nomes de variável com que o composer já calcula os quatro bloqueios:

```tsx
{podeEscrever && (
  <SeletorLookbook conversaId={conversa.id} lojaId={conversa.lojaId} bloqueado={bloqueado} motivoBloqueio={motivoBloqueio} />
)}
```

**`src/app/(app)/conversas/_components/balao-mensagem.tsx`**, no mesmo ponto de montagem de costuras do R2 (onde também entra a transcrição do R2-C):
- com `mensagem.card?.tipo === "lookbook"`, mostra acima das fotos um `SeloStatus`/chip de tom `neutro` com o texto "Lookbook", sem link e sem consulta extra;
- `card.tipo` desconhecido nunca quebra e nunca vira cartão de produto;
- as mídias da bolha seguem `ordem`.

**DTO da mensagem (M1)**: expõe `card` (se ainda não expõe) e ordena as mídias por `ordem, id`.

### D16 — Delta único de M8 (a parte do R2-E)

O texto abaixo foi escrito sobre o código de M8 em andamento (`e88d181`). Se a forma final for outra, o delta preserva o **contrato** provado por `tests/integracao/sla-alertas.test.ts` (item 7 do aceite do E2). A troca **não** cria "fonte nova de alerta": muda o prazo e a resolução de uma regra que já existe, então é feita na própria regra, uma vez.

1. **`src/lib/alertas/regras.ts`**: apagar `SLA_MINUTOS`, `PRAZOS_SLA_TEXTO` e o parágrafo "SLA é CONSTANTE NO CÓDIGO…". `src/lib/alertas/index.ts` deixa de reexportar `PRAZOS_SLA_TEXTO`.

2. **`src/lib/alertas/_consultas.ts`**:
   - trocar o import de `SLA_MINUTOS` e a constante `CASO_SLA` por `import { minutosDeSlaSql, venceEmSql } from "@/lib/sla/prazo";`;
   - definir:

     ```ts
     /** Resposta da EQUIPE: saída de pessoa, que não é nota (campanha e sistema não respondem). */
     const RESPOSTA_DA_EQUIPE = (alias: string) => sql.raw(
       `${alias}.direcao = 'saida' and ${alias}.nota_interna = false and ${alias}.autor_tipo = 'usuario' and ${alias}.is_deleted = false`);

     /** 1ª entrada ainda sem resposta da equipe: o relógio do SLA (ADR 0056). */
     const INICIO_SEM_RESPOSTA = sql`(
       select min(e.ocorrida_em) from conversas_mensagens e
        where e.conversa_id = c.id and e.direcao = 'entrada' and e.is_deleted = false
          and not exists (select 1 from conversas_mensagens s
                           where s.conversa_id = c.id and ${RESPOSTA_DA_EQUIPE("s")}
                             and s.ocorrida_em >= e.ocorrida_em))`;

     const REFS_SLA = { lojaId: sql`c.loja_id`, provedor: sql`i.provedor`, prioridade: sql`c.prioridade` };
     ```

   - em `SEM_RESPOSTA`, trocar `m.direcao = 'saida' and m.nota_interna = false and m.is_deleted = false` por `${RESPOSTA_DA_EQUIPE("m")}`;
   - na consulta `sla_estourado`: a coluna `minutos` vira `(${minutosDeSlaSql(REFS_SLA)})::int as minutos`, e a condição `c.ultima_entrada_em < now() - make_interval(mins => (${CASO_SLA})::int)` vira `${venceEmSql(INICIO_SEM_RESPOSTA, REFS_SLA)} < now()`. O restante continua igual (`i.provedor <> 'bling'`, filtro de loja);
   - função nova:

     ```ts
     /** Conversas cujo atraso já marcado continua valendo: sem resposta e no MESMO turno. */
     export async function atrasosVigentes(lojaId: string | null, leitor: Leitor = db): Promise<Set<string>> {
       const r = await leitor.execute<{ id: string }>(sql`
         select c.id from conversas c
          where ${SEM_RESPOSTA} and c.sla_estourado_em is not null
            and ${INICIO_SEM_RESPOSTA} <= c.sla_estourado_em
            ${daLoja("c.loja_id", lojaId)}`);
       return new Set(r.rows.map((l) => l.id));
     }
     ```

   - `atrasosVigentes` é interna do módulo (usada só por `gerador.ts`) e não entra em `index.ts`. `lerPrazosVigentes` e `textoDosPrazos` são importados direto de `@/lib/sla/prazo` pela action (item 4).

3. **`src/lib/alertas/gerador.ts`**:
   - antes do laço de tipos: `const mantidos = await atrasosVigentes(lojaId);`;
   - `sincronizarCarimboDeSla` recebe `mantidos`, e a condição de desmarcar vira `if (atrasadas.has(m.id) || mantidos.has(m.id)) continue;`;
   - no laço de resolução, logo depois de `if (vigentes.get(lida.tipo)?.has(alerta.chave)) continue;`:

     ```ts
     // Afrouxar o prazo não resolve atraso que já aconteceu (ADR 0056).
     if (lida.tipo === "sla_estourado" && lida.alvo.tipo === "conversa" && mantidos.has(lida.alvo.id)) continue;
     ```

   - comentário do topo: "a cada 5 min".

4. **`src/lib/actions/alertas.ts`** (`centralDeAlertas`):
   - `prazosSla` vira `textoDosPrazos(await lerPrazosVigentes(tx, ctx.escopo))`;
   - acrescentar `podeAlterarPrazos: pode(ctx.sessao.papel, "configuracao", "editar")` ao tipo `CentralDeAlertas` e ao retorno;
   - trocar o comentário do campo por "Texto dos prazos vigentes por loja (`lojas_sla`)".

5. **`src/app/(app)/alertas/page.tsx`**:
   - a faixa diz `Prazos de resposta: ${prazosSla}.`;
   - com `podeAlterarPrazos`, mostra o link "Alterar prazos" para `/configuracoes/sla`;
   - o comentário do topo passa a dizer "a cada 5 min" e "prazos lidos de `lojas_sla`".

6. **Pré-requisito que não é do R2-E, mas bloqueia o aceite do E2**: a escrita real de alertas de M8 (`escritaDeAlertas`), hoje pendente por pedido de M8 à fundação (`abrirAlerta` em `mutacoes.ts`, `ESTADOS_DE_SISTEMA.alertas = ["resolvido_em"]`, `alerta_reconhecido` em `ACOES_AUDITADAS`), precisa estar resolvida e com `ESCRITA_DISPONIVEL = true` antes da onda 3. Isso entra na conta de linhas de `mutacoes.ts` e na lista de ações (D1).

7. **Rótulos da trilha** (`src/lib/auditoria/apresentacao.ts`, código em andamento):
   - em `ENTIDADES`: `lookbook: "Lookbook"` e `sla: "Prazo de SLA"`;
   - em `TABELAS`: `lookbooks: "Lookbooks"`, `lookbooks_midias: "Fotos do lookbook"`, `lookbooks_produtos: "Produtos do lookbook"` e `lojas_sla: "Prazos de SLA"`;
   - se a forma final do mapa for `Record<AcaoAuditada, string>`, os rótulos são "Lookbook criado", "Lookbook alterado", "Lookbook excluído" e "Prazo de SLA alterado". Esta é a parte do R2-E no acréscimo único das 12 ações.

8. **Testes de M8**: rodar `tests/integracao/alertas-gerador.test.ts`. Caso que dependa de `SLA_MINUTOS` ou do início em `ultima_entrada_em` é ajustado ao contrato novo **no mesmo commit** do delta.

### D17 — Delta único de M5 (a parte do R2-E)

`src/app/(app)/configuracoes/page.tsx`: cartão novo, visível com `pode(papel, "configuracao", "ler")`:
- título "Prazos de atendimento (SLA)";
- texto "Tempo máximo para responder à cliente, por canal e por prioridade.";
- link `/configuracoes/sla`;
- ícone `Timer` de `lucide-react`.

Entra no mesmo patch dos cartões "Pagamentos" (R2-PG) e "Inteligência" (R2-C).

### D18 — M2: `optOutVigente` (dependência, sem texto próprio)

O R2-E consome `optOutVigente(tx: Transacao, contatoId: string): Promise<boolean>` exportado por **`@/lib/lgpd`**, com a regra do delta D13 do R2-A: opt-out vigente ⇔ a última linha de `consentimentos` do contato entre `tipo IN ('opt_out','opt_in')` é `opt_out` com `concedido = true`. Se M2 já exporta uma função equivalente com outro nome (no código em andamento: `optOutDe`), o delta a reexporta como `optOutVigente` em `src/lib/lgpd/index.ts`, e a materialização de campanha de M6 passa a usar a mesma função. Tabela de costuras: `src/lib/lgpd/index.ts` → `optOutVigente(tx, contatoId)` | M2 — consumida por R2-A e R2-E1.

### D19 — Mapa de donos (`05-plano` §8) e exceções nominais

| Caminho | Dono |
|---|---|
| `src/lib/lookbooks/**`, `src/lib/actions/lookbooks.ts`, `src/lib/validadores/lookbooks.ts`, `src/app/(app)/lookbooks/**`, `docs/modulos/lookbooks.md` | R2-E1 |
| **Exceção nominal na pasta de M1**: `src/app/(app)/conversas/_components/seletor-lookbook.tsx` e `src/app/(app)/conversas/_components/seletor-lookbook-envio.tsx` | R2-E1 |
| `src/lib/sla/**`, `src/lib/actions/sla.ts`, `src/lib/validadores/sla.ts`, `src/app/(app)/configuracoes/sla/**`, `docs/modulos/sla.md` | R2-E2 |

A nota de rodapé do §8 vira: "\* exceto `painel-venda.tsx` e `seletor-produto.tsx`, de M4, e `seletor-lookbook.tsx` e `seletor-lookbook-envio.tsx`, de R2-E1". E `src/app/(app)/configuracoes/{page,lojas,integracoes}/**` continua de M5, sem incluir `sla/**`.

### D20 — O que o delta do R2-E NÃO toca

`env.ts` e `.env.example` (nenhuma variável); `buscarExterno.ts` (nenhum host); `rotas-publicas.ts` (nenhuma rota); `FILAS` e `worker.ts` (nenhum job); `listas-fechadas.ts` (`lojas_sla` não tem contador nem estado de sistema); `logger.ts`; `src/lib/actions/_base.ts` (o R2-E usa só `executarAcao`, nunca o embrulho sem transação); `mutacoes.ts` (nenhuma função nova); o ator de sistema (o R2-E só grava com sessão de pessoa).

### Fechamento do R2 (depois de E1 e E2, pelo pacote de integração do R2)

- `tests/componentes/block-3s.test.tsx`: `telasLigadas` ganha `"enviar-lookbook"` e `"salvar-prazos-de-sla"`, e `PISO_DE_TELAS_LIGADAS` sobe 2. As provas ficam em `tests/componentes/lookbooks-envio.test.tsx` e `tests/componentes/sla-formulario.test.tsx`.
- `docs/seguranca/caminhos-de-acesso.md`: `pacote R2-E1`/`pacote R2-E2` → `entregue`.
- `docs/adr/README.md`: índice com 0054 a 0057.

---

## 11. ADRs a criar (o orquestrador cria em `docs/adr/`)

| ADR (arquivo) | Título | Decisão (3 linhas) |
|---|---|---|
| **0054** (`0054-lookbook-composicao-ordenada-da-loja.md`) | Lookbook como composição ordenada da loja | O lookbook tem nome, descrição, capa, até 10 fotos de upload e até 20 produtos da **mesma** loja, garantidos pelo app e por FK composta. As ligações são recriadas, nunca editadas. Não existe "ativo": retirar de uso é exclusão lógica, feita por gerente para cima; a vendedora cria e edita (`conteudo:*` em `comercial.ts`). Foto ou produto excluído fica na ligação, sai do envio e o editor avisa; nada em cascata. |
| **0055** (`0055-envio-de-lookbook-sem-link-e-sem-preco.md`) | Envio de lookbook pela conversa: sem link, sem preço, com opt-out lido da verdade | O lookbook sai só de dentro de uma conversa, enviado por uma pessoa, como **uma** mensagem com as fotos em ordem (coluna `conversas_mensagens_midias.ordem`) e a lista de nomes dos produtos, pela conta de entrada (WhatsApp oficial, uazapi e Instagram), depois de prévia conferida e block de 3 s. Não há URL pública, preço (CDC art. 30; catálogo pode estar velho) nem estoque. Opt-out vigente (última linha de `consentimentos`) e contato anonimizado bloqueiam, e a IA não envia. **Perguntas ao cliente**: quer preço no texto? Quer lookbook em campanha? Messenger/TikTok entram quando a política e a API forem confirmadas. |
| **0056** (`0056-sla-configuravel-por-loja.md`) | SLA de resposta configurável por loja e conservador ao afrouxar | Tabela `lojas_sla` (regra por canal **ou** por prioridade); só dono e admin gravam, com trilha e block. O prazo efetivo é o **menor** entre a regra do canal (ou o padrão 5/5/15/30/60) e a regra da prioridade, contado 24 h por dia desde a **primeira** mensagem da cliente sem resposta de pessoa; loja sem regra = R1. Alerta e carimbo de conversa já atrasada só se desfazem com resposta da equipe ou mudança de status, nunca por subir o prazo. **Perguntas ao cliente**: horário comercial (exige colunas novas) e "prioridade substitui o canal" (só muda `minutosDeSlaSql`, sem schema). |
| **0057** (`0057-conferencia-de-alertas-a-cada-5-minutos.md`) | Conferência de alertas a cada 5 minutos e SLA sem notificação própria | `gerar-alertas` passa de 15 para 5 min. O agendador antigo é removido pelo nome (`AGENDADORES_APOSENTADOS`), e a tela não aceita prazo menor que o intervalo. O alerta aparece em até 5 min depois do vencimento, no sino e em `/alertas`. Não há "avisar X minutos antes", e-mail nem push de SLA: os toggles antigos nunca funcionaram e exigiriam fila e texto próprios. Se o job passar de 60 s de p95, a regra de SLA ganha job próprio (novo ADR). |

---

## 12. Críticas recebidas e onde foram resolvidas

| Crítica (severidade) | Resolução |
|---|---|
| Lookbook gravando com `loja: "le"` (média) e sem `loja` no Zod (média) | Toda gravação usa `loja: "grava"`, e toda entrada aceita `loja` (§5.1, §5.2). Aceite E1-6 |
| Opt-out lido do espelho (baixa e média) | `optOutVigente` de `@/lib/lgpd` (R2-LB-12, D18). Aceite E1-7 com espelho e verdade divergentes |
| Cinco migrações 0018 conflitantes (bloqueante) | `0018_r2` gerada uma vez e `0019_r2_integridade` custom única. D4 dá só a parte do R2-E, e `TAGS` é ajustada uma vez (D5) |
| Contagens divergentes (alta) | 50 / 41 / 21 / 5 append-only / 5 gatilhos / `toBe(50)` (D5) |
| `mutacoes.ts` > 500 linhas (alta) | O R2-E não acrescenta nada. Registrado que o bloqueio de M8 (`abrirAlerta`) também pesa nessa conta (D5, D16-6) |
| Dois embrulhos sem transação (alta e média) | O R2-E não usa nenhum (D20) |
| `tiktok_shop` × `tiktok` no SLA (alta) | `PROVEDORES_DE_CONVERSA` com `tiktok` e sem `tiktok_shop`/`bling`; padrão `tiktok: 60`; trava com `tiktok` (D1, D7, trava E2-e) |
| Arquivos de M1 editados por vários clusters (alta) | `EnvioParaRegistrar` final único, um ponto de montagem no composer e um no balão; componente-costura criado vazio (D14, D15) |
| M4/M8/M2 editados por vários clusters (alta) | Parte do R2-E dada por arquivo para o patch único (D16, D17, D18). O SLA muda uma regra que já existe, e não "fonte nova" (ver §13) |
| `MetadadosMensagem` em duas versões (média) | Texto final único com `conversa_externa_id` e `card` com `lookbook` (D2) |
| Índice Redis colidindo (alta) | r2e1 = 13, r2e2 = 14 |
| ADRs sobrepostos (média) | 0054 a 0057 |
| Lista de block colidindo (média) | Lista final de 27 slugs (D12) |
| Estratégias de `fase` divergentes (média) | `entregue`/`futura`, `NAVEGACAO_ENTREGUE`, teste sem piso `> 0` (D10) |
| Estratégias de permissão divergentes (média) | `conteudo:*` em `comercial.ts`; `FASE_R2` esvaziado pelo delta global (D9) |
| Patch consolidado de arquivos compartilhados (média) | O R2-E contribui só com `agendamentos.ts` (D8), `tons.ts` (D11), `navegacao-lateral.tsx` (D10) e `db/erros.ts` (D6). Não toca FILAS, worker, env, rotas nem `buscarExterno` (D20) |
| Rótulos da trilha em M8 (média) | Entidades e tabelas acrescentadas a `apresentacao.ts`, com a alternativa escrita para o caso `Record` (D16-7) |
| Mapa de donos (média) | Exceções nominais de `seletor-lookbook*.tsx` (D19) |
| Referência de HEAD velha (baixa) | Base `9481ef8`, com nota sobre os commits de módulo (cabeçalho) |
| Credencial reenviada no redirect de `buscarExterno` (baixa) | Não se aplica ao R2-E, que não chama `buscarExterno`. Fica no patch consolidado de `buscarExterno` (R2-PG/R2-D) |

**Achado novo desta consolidação** (não estava na crítica): o código de M8 em andamento conta o SLA a partir da **última** entrada, aceita saída automática como resposta e resolve o alerta reavaliando o prazo. O rascunho supunha outra regra (`created_at`/`primeira_resposta_em`) e deixava a resolução para "conferir". Isso foi corrigido em R2-SLA-01/06, §3.4, D16 e no aceite E2-7.

---

## 13. Problemas rejeitados

| Crítica | Decisão | Motivo |
|---|---|---|
| "Uma costura de fontes de alerta (`src/lib/alertas/fontes-r2.ts`) para que **nenhum** cluster edite o gerador", aplicada ao SLA | **Rejeitada para o R2-E** (vale para R2-A e R2-PG) | O SLA não é uma fonte nova de alerta. Ele muda o **prazo** e a **resolução** da regra `sla_estourado`, que já existe dentro do gerador. Passar isso por um arquivo de fontes manteria a regra antiga ativa ao lado da nova. A mudança entra **uma vez**, na própria regra, pelo patch único de M8 (D16), e o contrato fica provado por teste do E2 |
| Rascunho: aplicar a costura de prazo "já, durante a onda 2", em versão v1 | **Descartado nesta consolidação** | M8 já entregou com constante local (`SLA_MINUTOS`). Uma v1 intermediária criaria duas trocas no mesmo arquivo de M8. A costura nasce completa no delta pré-onda 3 (D7), e M8 é ajustado uma vez (D16) |
| Rascunho: action `lerPrazosVigentes` em `actions/sla.ts` consumida pela página de M8 | **Substituído** | Importar action de outro pacote é import cruzado, e a action só existiria depois do E2, deixando `/alertas` com texto velho ou quebrado. A leitura virou função da costura `prazo.ts` (D7), usada dentro da action que M8 já tem (D16-4) |
