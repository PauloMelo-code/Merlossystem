# 00 — Plano do R2 (onda 3 do MerlostoreChat reconstruído)

- **Alvo**: `C:\Users\Paulo\Documents\MerlostoreChat`, branch `refactor/reconstrucao-estrutura-base`.
- **Base lida em 16/09/2026**: `HEAD = 5169c39`. M1 a M8 já commitaram (conversas, contatos/LGPD, mídias, catálogo/pedidos, lojas/integrações/webhooks, campanhas, usuários, alertas/auditoria/relatórios). **Há trabalho da fundação NÃO commitado** na árvore (consolidação "DF1": `0018_consolidacao.sql`, `src/lib/db/sistema.ts`, `src/lib/db/mutacoes-sistema.ts`, listas fechadas ampliadas). Este plano parte do princípio de que a DF1 é commitada **antes** do F-R2 e trata cada colisão dela com os finais do R2 na §2.1.
- **Entradas** (o construtor lê o final do seu pacote **mais** este plano; onde os dois divergem, **vence este plano**):
  - `r2/final-r2a-posvenda.md` (R2-A), `r2/final-r2b-pagamentos.md` (R2-B, chamado "R2-PG" no final), `r2/final-r2c-inteligencia.md` (R2-C), `r2/final-r2d-canais-extras.md` (R2-D), `r2/final-r2e-lookbooks-sla.md` (R2-E);
  - `final/05-plano-construcao.md` §2 (contrato de paralelismo, que vale aqui igual), §3.4 (comandos), §6 (formato).
- **Os rascunhos não são entrada.**

---

## 1. Visão do R2 e o que fica de fora

### 1.1 O que o R2 entrega

| Pacote | Entrega | Liga sozinho? |
|---|---|---|
| **R2-A Pós-venda** | Funil kanban por loja (um negócio aberto por cliente, ganho só pela venda); trocas e devoluções com teto de estorno calculado no servidor e efeitos no pedido; CSAT automático pela conta de entrada, com SAIR virando opt-out | Funil e trocas: sim. CSAT: **desligado** (`CSAT_ATIVO=false`) até o cliente aprovar o texto |
| **R2-B Pagamentos** | Conta Mercado Pago por loja (cofre, identidade fixa); cobrança Pix/link com block; envio pela conversa por pessoa; confirmação só pelo provedor (webhook assinado + consulta de volta); cancelamento, expiração confirmada, conciliação noturna, alertas | **Desligado** (`PAGAMENTOS_MERCADOPAGO=desligado`). Em dev e teste roda com o provedor simulado |
| **R2-C Inteligência** | Sugestão de resposta e resumo sob demanda (Anthropic `claude-sonnet-5`), classificação por varredura (`claude-haiku-4-5-20251001`), transcrição sob demanda (OpenAI `whisper-1`), orçamento por loja/dia, registro de uso append-only, painel honesto; base de conhecimento por loja que alimenta a sugestão | Base de conhecimento: sim. IA e transcrição: **desligadas** (`IA_PROVEDOR_*=desligado`) até existir chave **e** aval do cliente (DPA) |
| **R2-D Canais extras** | Facebook Messenger (receber, responder, mídia, `HUMAN_AGENT` só por pessoa) e TikTok mensagem direta (OAuth, 48 h, texto + 1 imagem) | Messenger: liga com `FACEBOOK_VERIFY_TOKEN` + app Meta já existente. TikTok: **desligado** até o app ser aprovado |
| **R2-E Lookbooks e SLA** | Lookbook (fotos de upload + produtos da loja, ordem, envio como uma mensagem com prévia e block, sem preço e sem link); SLA por canal e por prioridade configurável por dono/admin, com resolução conservadora e conferência a cada 5 min | Sim |

Regras que valem para os cinco: **sem tela de fachada** (sem chave = recurso some ou mostra "indisponível" com o motivo, nunca 500 e nunca dado inventado); IA **nunca** envia sozinha; pagamento confirmado **não** escreve em ERP (ADR 0004); Drizzle, soft delete, trilha, trava de colisão, block de 3 s, arquivo < 500 linhas, PT-BR.

### 1.2 O que fica de fora (decidido, com ADR)

| Fica de fora | Por quê | ADR |
|---|---|---|
| **TikTok Shop** (catálogo, pedidos, atendimento) | Catálogo e pedidos já chegam ao Bling pela integração nativa; não há tabela para pedido de marketplace; a Customer Service API exige 1.000 lojistas ou aprovação especial. Construir seria fachada | 0051 |
| Comentário de vídeo do TikTok | Não existe webhook público de comentário orgânico | 0051 |
| TikTok DM **em produção sem app aprovado** | Depende de aprovação da TikTok para um lojista só. O pacote fecha com o canal **desligado e testado**; a conferência em HML fica pendente com data | 0051 |
| Estorno iniciado pelo sistema; baixa manual ("marcar pago") | Dinheiro só se move fora; só o provedor confirma | 0033, 0038 |
| Asaas e PagBank com adaptador; boleto, parcelamento, split, recorrência | Só Mercado Pago tem adaptador; os outros ficam no CHECK | 0037, 0039 |
| Mensagem automática "recebemos seu pagamento"; QR como imagem | Envio só por pessoa; QR gerado sob demanda e não persistido | 0041 |
| IA enviando mensagem, criando nota, mudando etiqueta, prioridade ou status | Humano no meio | 0042 |
| Transcrição automática de todo áudio; MP3, AAC solto, AMR | Base legal pendente; sem medição segura de duração | 0045 |
| Busca semântica, cache de prompt, respostas rápidas como fonte da IA, opção "não usar IA com meus dados" | Custo/benefício e schema fechado (a última exige coluna nova) | 0048 |
| Portal público da base de conhecimento; Markdown renderizado | Texto puro, só autenticado | 0047 |
| Lookbook público, em campanha, por Messenger ou TikTok | Sem URL pública; `HUMAN_AGENT` proíbe promoção; TikTok aceita uma imagem | 0055 |
| SLA com horário comercial, "avisar X min antes", e-mail ou push | Exige colunas e fila próprias; os toggles antigos nunca funcionaram | 0056, 0057 |
| CSAT por Facebook/TikTok, por modelo da Meta, manual, com lembrete ou com alerta de nota baixa | Conservador | 0034 |
| Campanha por Messenger/TikTok; eco de página; recibos de leitura desses canais | Política dos provedores | 0050, 0051 |
| Restaurar registro excluído | Não existe no R1 nem no R2 | — |

### 1.3 O que depende de credencial (e como fica sem ela)

| Recurso | Credencial | Sem ela |
|---|---|---|
| Mercado Pago | token `TEST-` (HML) e `APP_USR-` (PRD) por loja, na tela; `PAGAMENTOS_MERCADOPAGO` na instalação | Seção de pagamento diz "Pagamentos desligados nesta instalação"; simulado só fora de produção |
| Anthropic / OpenAI | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` + DPA aceito pelo cliente | Nenhum botão de IA; painel diz qual variável falta |
| Messenger | `META_APP_SECRET` (já existe), `FACEBOOK_VERIFY_TOKEN`, token de página colado | Cartão "indisponível"; webhook responde 401 |
| TikTok DM | `TIKTOK_APP_ID`, `TIKTOK_APP_SECRET`, `TIKTOK_API_VERSAO` (app aprovado) | Cartão "indisponível"; action `CONFIGURACAO`; webhook 401 |

---

## 2. PACOTE F-R2 (sequencial, antes da onda 3)

Um agente (o orquestrador ou um construtor da fundação). **Só ele** pode gravar em arquivo de fundação e de módulo do R1 nesta fase. Cada commit fecha com `npm run lint && npm run typecheck && npm run compliance && npm run test:travas` verdes; FR3 e FR4 fecham juntos (o schema só verifica depois da migração).

### 2.0 Pré-condições (conferir antes do primeiro commit; qualquer "não" = para)

| # | Condição | Como conferir |
|---|---|---|
| P1 | M1..M8 fechados, `npm run verificar` verde na base | `git log --oneline` com o `docs(<dominio>)` e o `test(<dominio>)` dos oito |
| P2 | DF1 commitada: `0018_consolidacao`, `ATOR_SISTEMA` em `_enums/auth.ts`, `src/lib/db/sistema.ts` (`contextoDeSistema({ origem, lojaId })`, `ContextoDeGravacao`), `src/lib/db/mutacoes-sistema.ts` (`registrarEventoDeIngestao`, `abrirAlerta`) | `git ls-files src/lib/db/sistema.ts src/lib/db/mutacoes-sistema.ts src/lib/db/migrations/0018_consolidacao.sql` |
| P3 | Os quatro `contextoDeSistema`/`contextoDoSistema` locais (`catalogo/sincronizacao.ts`, `conversas/_sistema.ts`, `integracoes/_sistema.ts`, `midias/ingestao.ts`) delegam a `@/lib/db/sistema` | `git grep -n "function contexto\(De\|Do\)Sistema" -- src` → só `src/lib/db/sistema.ts` |
| P4 | Escrita de alertas de M8 ligada (`ESCRITA_DISPONIVEL = true`) | `git grep -n "ESCRITA_DISPONIVEL = " -- src/lib/alertas` |
| P5 | `emTransacao`, `inserirAuditado`, `atualizarComTrava`, `registrarAuditoria` e `registrarEnvio` aceitam `ContextoDeGravacao` (não exigem `sessao`) | `npm run typecheck` com um arquivo de prova descartável |
| P6 | Pacote INTEGRAÇÃO do R1 (`05-plano §7`) fechado | commit `chore(release): fechar o R1 da reconstrução` |
| P7 | Os ADRs da DF1 **não** usam 0031–0057 (§2.1 C1) | `ls docs/adr` |

> P6 é recomendação forte, não bloqueio: sem ela, o F-R2 aplica deltas sobre módulos que o P-INT do R1 ainda pode corrigir. Se o Paulo quiser o R2 antes, o F-R2 roda sobre P1+P2..P5 e o P-INT do R1 vira parte do P-INT do R2 (§5).

### 2.1 Conflitos resolvidos (entre os cinco finais e com a DF1)

Onde o final do pacote disser o contrário, **vale a coluna "decisão"**.

| # | Conflito | Decisão |
|---|---|---|
| C1 | Numeração de ADR: os finais usam **0031–0057**; a DF1 (não commitada) cita "ADR 0031" (ator de sistema) e "ADR 0032" (motivo LGPD) em comentários | O R2 **mantém 0031–0057** (citados mais de cem vezes nos cinco finais). A DF1 renumera os seus ADRs para **0058+** e troca os dois comentários antes de commitar. Plano B, se a DF1 já tiver commitado 0031..0031+k−1: o R2 inteiro desloca **+k** (tabela "número do final → número no repo" gravada no `docs/adr/README.md` no FR14; construtores usam o número do repo em comentário) |
| C2 | Migrações: finais pedem `0018_r2` + `0019_r2_integridade`; a DF1 ocupa a 0018 | **`0019_r2`** (gerada, única) + **`0020_r2_integridade`** (custom, única). Em todo final, leia 0018_r2 → 0019_r2 e 0019_r2_integridade → 0020_r2_integridade |
| C3 | Ator de sistema: finais pedem `src/lib/auth/sistema.ts`, `contextoDeSistema(lojaId, origem)` com sessão `viewer`, CHECK `usuarios_sistema_inativo` e semente na 0019 | Vale a DF1: `@/lib/db/sistema` → `ATOR_SISTEMA`, `contextoDeSistema({ origem: "webhook" \| "worker", lojaId })`, tipo `ContextoDeGravacao` (sem sessão). **Não** existe `src/lib/auth/sistema.ts`, **não** existe `usuarios_sistema_inativo` (a DF1 tem `usuarios_ator_sistema_inerte`, papel `viewer`), **nenhuma** semente no R2. Toda mutação nova do R2 tipa `ctx: ContextoDeGravacao` |
| C4 | Pasta de mutações: finais pedem `mutacoes/{base,canais,pedidos,integracoes,pagamentos,pos-venda,transcricao}.ts`; a DF1 criou `mutacoes-sistema.ts` como "segundo e último" arquivo; `mutacoes.ts` está com 492 linhas | Pasta adotada (FR2). `mutacoes-sistema.ts` vira **`mutacoes/sistema.ts`**. **Não** existe `mutacoes/integracoes.ts` (C5) |
| C5 | Diário de ingestão: R2-PG pede `registrarEventoRecebido`/`cabecalhosDoDiario` novos em `mutacoes/integracoes.ts`; M5 já exporta `registrarEventoRecebido`, `registrarProcessamentoEvento` e `cabecalhosDoDiario` (`src/lib/integracoes/diario.ts`), e a DF1 levou o INSERT para `registrarEventoDeIngestao` | R2-B e R2-D consomem **a API pública de `@/lib/integracoes`** (costura de M5, §3.7). O F-R2 só: (a) aceita `eventoExternoId: string \| null` nos dois tipos (nulo não consome a chave de dedupe, R2-PG-09); (b) acrescenta `tiktok-signature` como presença em `cabecalhosDoDiario` |
| C6 | Lista fechada de `executarAcaoExterna`: R2-C tem 2 arquivos, R2-PG e R2-D têm 3 | **3**: `actions/pagamentos.ts`, `actions/inteligencia.ts`, `actions/canais-extras.ts` (+ `_base.ts`). O ADR 0049 cita os três |
| C7 | `CABECALHOS_DE_CREDENCIAL` de `buscarExterno`: R2-C inclui `cookie`, R2-PG/R2-D não | União: `authorization`, `access-token`, `x-api-key`, `cookie` |
| C8 | `logger.ts`: R2-PG pede `"x-api-key"` e `"access-token"`; R2-C mostra que nome com hífen quebra o `redact` do pino no boot | **Nenhum nome com hífen**. Lista final no FR8 |
| C9 | Janela de resposta: R2-PG e R2-E citam `src/lib/canais/janela.ts` e `origem = "composer"` | Arquivo único **`src/lib/canais/regras-de-envio.ts`** (R2-D F9), `origem: "pessoa" \| "automatica"` |
| C10 | `MetadadosMensagem`: R2-D (com `origem_envio`), R2-E (sem), DF1 (com `modelo` e `enviada_pelo_aparelho`) | União (texto no FR3) |
| C11 | `ACOES_AUDITADAS`: R2-C e R2-E contam 12, R2-PG conta 13 | **13** (inclui `pesquisa_respondida`), sobre a lista da DF1 |
| C12 | `TIPOS_ALERTA`: R2-PG põe `pagamento_conferir` depois de `integracao_com_erro`; a DF1 pôs `espelho_divergente` ali | `pagamento_conferir` **por último**, depois de `espelho_divergente` |
| C13 | `ESTADOS_DE_SISTEMA.conversas_mensagens_midias`: DF1 = `midia_id, baixada, url_externa`; R2-C = `transcricao_status, transcricao` | União dos cinco |
| C14 | Costura de job agendado: R2-PG faz `expirar/conciliar` lançarem (DLQ a cada 5 min até o pacote); R2-C faz `varrerIa` no-op pelo mesmo motivo | Job **agendado** nasce no-op (`expirarCobrancas`, `conciliarCobrancas`, `varrerIa`); job **sob demanda** nasce com `throw naoImplementado` (inalcançável antes do pacote) |
| C15 | Banco/Redis: finais usam 9..14 e seis sufixos | **Um agente por pacote**, sufixos `r2a..r2e`, Redis 13..17, app 3021..3025 (§4). Subpacotes (A1–A3, C-IA/C-KB, E1–E2) rodam **em série** dentro do agente |
| C16 | R2-E cria `AGENDADORES_APOSENTADOS` | Já existe em HEAD; o F-R2 só acrescenta a linha |
| C17 | `fontes-r2.ts` importa `@/lib/negocios` e `@/lib/pagamentos/costuras`, que não existem antes da onda 3 | O F-R2 cria as duas costuras (`src/lib/negocios/alertas.ts` e `src/lib/pagamentos/costuras.ts`) e `fontes-r2.ts` importa **`@/lib/negocios/alertas`**. Prefixo da fonte de negócio: `negocio-parado-` |
| C18 | Deltas de módulo do R1 que importam action ou domínio do R2 (`negocioAbertoDoContato`, `lerEstadoDaIa`, `ehTranscrevivel`) quebram o typecheck antes da onda 3 | Viram costuras criadas no FR12 (§2.3) |
| C19 | R2-C `lerBytesDaMidia` usa `lerObjeto/abrirCorpo/juntar`, que M3 não tem | Implementar sobre o que M3 entregou: `midiaParaLeitura` + `lerBytes(chave)`; recusar antes de ler se `tamanho_bytes > maxBytes` |
| C20 | `SLA_MINUTOS` de M8 é `Record<Exclude<Provedor,"bling">, number>`: ampliar `PROVEDORES` quebra o typecheck | A troca de SLA de M8 (R2-E D16 itens 1–3 + `src/lib/sla/prazo.ts`) entra **no mesmo commit** das listas (FR3) |
| C21 | Nome do embrulho, `fase` da navegação, permissões por arquivo, lista de block com 27 | Adotados como nos finais (sem conflito real) |

### 2.2 Commits do F-R2 (nesta ordem)

Legenda da coluna "texto": **exato aqui** = o texto está neste plano; **final §x** = copiar do final citado, aplicando a §2.1.

#### FR1 — dependência

- **Arquivos**: `package.json`, `package-lock.json`, `tests/seguranca/versoes.test.ts`.
- **Texto**: `npm install --save-exact @anthropic-ai/sdk@<estável do dia>`; conferir que exporta `@anthropic-ai/sdk/helpers/zod` e `client.messages.parse` compilando um arquivo mínimo descartável (não commitado); linha `["@anthropic-ai/sdk", "<versão>"]` no `it.each` de pisos (final R2-C G19). Nenhum SDK da OpenAI, nenhum parser de áudio, nenhuma lib de QR nova (`src/lib/qr.ts` já existe).
- **Commit**: `build(deps): instalar o SDK da Anthropic fixado para o R2`

#### FR2 — mutações em pasta (refatoração pura, zero mudança de lógica)

- **Cria**: `src/lib/db/mutacoes/base.ts` (`Transacao`, `TabelaDominio`, `emTransacao`, `inserirAuditado`, `lerAtual`, `colisaoOuEscopo`, `atualizarComTrava`, `excluirLogico`, `exigirPares`, `atualizarContador`, `atualizarEstado`, `registrarProcessamentoEvento` e o que mais a DF1 deixou "de base", reexports de `CONTADORES`, `ESTADOS_DE_SISTEMA`, `diffAuditado`, `registrarAuditoria`), `mutacoes/canais.ts` (`CanalDeContato`, `upsertContatoPorCanal`, `violacaoDeTelefone`, `avancarStatusDeEntrega`, `reivindicarReenvio`, `reservarDestinatarios`), `mutacoes/pedidos.ts` (`proximoNumeroDePedido`), `mutacoes/sistema.ts` (`git mv src/lib/db/mutacoes-sistema.ts`). Função que a DF1 acrescentou e não está nesta lista vai para o arquivo do seu domínio (consentimento → `canais.ts`).
- **`src/lib/db/mutacoes.ts`** (texto exato; ganha as três linhas do R2 no FR5):
  ```ts
  /**
   * Porta ÚNICA de escrita (03-arquitetura.md §6.4). A implementação mora em
   * `src/lib/db/mutacoes/`; `.insert(` e `.update(` só existem lá (trava
   * `tests/travas/mutacoes.test.ts`). Nenhum DELETE em lugar nenhum.
   * Importe sempre de `@/lib/db/mutacoes`; a pasta NÃO tem `index.ts`.
   */
  export * from "./mutacoes/base";
  export * from "./mutacoes/canais";
  export * from "./mutacoes/pedidos";
  export * from "./mutacoes/sistema";
  ```
- Arquivos da pasta importam de `./base`, nunca de `../mutacoes` (sem ciclo).
- **Travas**: `tests/travas/mutacoes.test.ts` — `MUTACOES_DIR = "src/lib/db/mutacoes/"`; `ISENTOS` = `mutacoes.ts`, o próprio teste e todo caminho sob `MUTACOES_DIR`; piso "existe `mutacoes/base.ts`"; "exporta os helpers" concatena todos os `.ts` da pasta; os testes de `travaDeColisao`/`condicaoDeLoja`/`atualizarContador` leem `mutacoes/base.ts`; o caso "mutacoes-sistema.ts…" passa a ler `mutacoes/sistema.ts` e continua proibindo import de valor de `../mutacoes`. `tests/travas/soft-delete.test.ts` e `tests/seguranca/escopo-loja.test.ts` leem `mutacoes/base.ts`. Mensagem de `.claude/hooks/pre-write-guard.mjs` e `.claude/skills/{criar-crud,criar-tabela}/SKILL.md` (e o espelho em `.agents/`): "`src/lib/db/mutacoes.ts` (implementação em `src/lib/db/mutacoes/`)".
- **Aceite**: `git diff --stat` só mostra movimentação; `npm run verificar` verde; nenhum arquivo da pasta passa de 499 linhas.
- **Commit**: `refactor(db): mover as mutações para pasta com reexportador único`

#### FR3 — listas fechadas, schema do R2 e troca da fonte de SLA

- **`_enums/inteligencia.ts`** (novo) — final R2-C §3.3 (texto exato de lá). `_enums/index.ts`: `export * from "./inteligencia";` depois de `./conversas`.
- **`_enums/plataforma.ts`** — `PROVEDORES_DE_PAGAMENTO` e `PROVEDORES` (final R2-PG D-01, comentário do R2-D F1), `PROVEDORES_DE_CONVERSA` (final R2-E D1). `TIPOS_ALERTA`: **último** item `"pagamento_conferir",` (C12).
- **`_enums/pedidos.ts`** — `ESTAGIOS_NEGOCIO_ABERTOS` (final R2-A D1) e `PROVEDORES_PAGAMENTO` sem `manual` (final R2-PG D-01).
- **`_enums/auditoria.ts`** — 13 ações, sobre a lista da DF1 (texto exato das posições):
  - depois de `"negocio_criado",` → `"negocio_alterado",`
  - depois de `"pagamento_estornado",` → `"pagamento_cancelado",` `"pagamento_status_alterado",`
  - depois de `"devolucao_concluida",` → `"pesquisa_enviada",` `"pesquisa_respondida",`
  - depois de `"template_rejeitado",` → `"lookbook_criado",` `"lookbook_alterado",` `"lookbook_excluido",` `"sla_alterado",`
  - depois de `"consentimento_registrado",` (antes do bloco da DF1) → `"artigo_criado",` `"artigo_alterado",` `"artigo_excluido",` `"artigo_etiqueta_alterada",`
  - `CAMPOS_PII` ganha `negocios: ["observacao_perda"],` e `pedidos_devolucoes: ["motivo_detalhe"],`.
- **Schema**: `negocios.ts` e `lgpd.ts` (final R2-A D2); `pedidos/pagamentos.ts` e `integracoes.ts` (final R2-PG D-02, **sem** o CHECK de `usuarios`, C3); `conversas/conversas.ts` e `conversas/mensagens-midias.ts` índice (final R2-C G1.3–4); `mensagens-midias.ts` coluna `ordem` + CHECK (final R2-E D4); `lojas-ia-usos.ts` (final R2-C G1.5); `lojas-sla.ts` (final R2-E D3); `schema/index.ts` com `./lojas-ia-usos` e `./lojas-sla` logo depois de `./lojas`; comentário de `alertas.ts` (final R2-E D3).
- **`conversas/mensagens.ts`** (texto exato, C10):
  ```ts
  export type MetadadosMensagem = {
    tipo_original?: string;
    story_url?: string;
    encaminhada?: boolean;
    citacao_externa_id?: string;
    erro_provedor?: { codigo: string; mensagem: string };
    /** Cartão derivado; `pagamento` (R2-B) e `lookbook` (R2-E1). */
    card?: { tipo: "produto" | "pedido" | "pagamento" | "lookbook"; id: string };
    /** Mensagem de modelo: o worker envia o template com estas variáveis. */
    modelo?: { template_id: string; variaveis: string[] };
    /** Saída feita no próprio aparelho (`fromMe` do provedor), não pelo sistema. */
    enviada_pelo_aparelho?: boolean;
    /** TikTok: `conversation_id` do provedor, exigido para responder (ADR 0052). */
    conversa_externa_id?: string;
    /** Quem originou a saída. Só `pessoa` pode usar HUMAN_AGENT no Messenger (ADR 0052). */
    origem_envio?: "pessoa" | "automatica";
  };
  ```
- **`listas-fechadas.ts`**: `CONTADORES.conversas` ganha `ia_intencao`, `ia_urgencia`, `ia_sentimento`, `ia_classificada_ate` (final R2-C G10); `ESTADOS_DE_SISTEMA.conversas_mensagens_midias` = `["midia_id", "baixada", "url_externa", "transcricao_status", "transcricao"]` (C13).
- **Fonte de SLA (C20)**: `src/lib/sla/prazo.ts` completo (final R2-E D7); `ROTULO_PRIORIDADE` e `ROTULO_PROVEDOR_CONVERSA` em `src/lib/ui/tons.ts` (final R2-E D11); M8 itens 1, 2 e 3 do final R2-E D16 (`regras.ts`, `_consultas.ts`, `gerador.ts`) + ajuste de `tests/integracao/alertas-gerador.test.ts` ao contrato novo (D16 item 8).
- Qualquer outro `Record<Provedor, …>` que o `typecheck` acusar é corrigido aqui (M5 `catalogo-provedores.ts`: `mercadopago`/`pagamento_simulado` com `gerenciadoEm: "/configuracoes/pagamentos"`; `facebook`/`tiktok` como conexão própria; `tiktok_shop` fora dos conectáveis — finais R2-PG D-17 e R2-D M5-1).
- **Commit**: `feat(schema): listas fechadas, tabelas lojas_ia_usos e lojas_sla e prazo de SLA por loja`

#### FR4 — migrações

- `npm run db:generate -- --name r2` → **`0019_r2.sql`**. Tem de conter, conferido à mão: os trechos do final R2-A D2, R2-PG D-03 item 1 (com `alertas_tipo_lista` **incluindo** `'espelho_divergente'` antes de `'pagamento_conferir'` e **sem** `usuarios_sistema_inativo`), R2-C G1.7, R2-D F1, R2-E D4; **um** `DROP/ADD` por constraint de lista; `grep -n "= \$"` vazio; nenhum `DROP TABLE`.
- `npm run db:generate -- --custom --name r2_integridade` → **`0020_r2_integridade.sql`** = final R2-E D4 (FKs compostas dos lookbooks, `fk_lojas_sla_modified_by`, `GRANT` de `lojas_sla`) + final R2-C G1.8 (`lojas_ia_usos` append-only). **Sem** semente de ator (C3).
- `tests/travas/migracoes.test.ts` (texto exato do acréscimo em `TAGS`, depois de `"0018_consolidacao"`):
  ```ts
    /** R2 (onda 3): uma migração gerada para os cinco pacotes e uma custom. ADRs 0031–0057. */
    "0019_r2",
    "0020_r2_integridade",
  ```
  título: "são as de 01-dados.md §9, a 0017 e a 0018 da fundação e as duas do R2, na ordem"; `toBe(48)`/`toHaveLength(48)` → `50`.
- `scripts/verificar-schema.mjs`: `TOTAL_TABELAS = 50`, `TOTAL_MODIFIED_BY = 41`, `TOTAL_FK_COMPOSTA = 21`, `APPEND_ONLY` + `"lojas_ia_usos"` (5 itens, 5 gatilhos); cabeçalho com os números. Conferir que `uq_lookbooks_id_loja` casa `UNICO_ID_LOJA`; se não casar, entra em `UNICO_TOTAL_PERMITIDO` com o motivo "alvo de FK composta".
- `tests/travas/mutacoes.test.ts`: `colunasPorTabela.size` → `50`. `tests/integracao/integridade-trilha.test.ts` e `tests/travas/soft-delete.test.ts`: `"lojas_ia_usos"` nas trilhas (final R2-C G2). `tests/integracao/enums-check.test.ts`: comentário "as 50 configurações".
- **Aceite**: `node scripts/db-teste.mjs && npm run db:migrate && npm run db:verificar` verde; 50 tabelas; `npm run test:integracao -- enums-check integridade-trilha` verde.
- **Commit**: `feat(schema): gerar as migrações 0019 e 0020 do R2 com integridade e trilha de uso`

#### FR5 — escritas do R2 na porta única

- `mutacoes/pos-venda.ts` (final R2-A D3b), `mutacoes/pagamentos.ts` (final R2-PG D-04, só `transicionarPagamento`), `mutacoes/transcricao.ts` (final R2-C G3). **Em todos, `ctx: ContextoDeGravacao`** (import de `@/lib/db/sistema`) e `Transacao` de `./base`.
- `mutacoes/base.ts`: `atualizarComTrava` ganha o 6º parâmetro `motivo?: string`, repassado a `registrarAuditoria` (final R2-A D3a).
- `mutacoes/sistema.ts`: `EventoDeIngestao.eventoExternoId: string | null`; com nulo, o `INSERT` não tem conflito possível e devolve `novo: true` (C5a). `src/lib/integracoes/diario.ts` (M5): `EventoRecebido.eventoExternoId: string | null` e `cabecalhosDoDiario` grava `tiktok-signature: "presente"` como já faz com `x-hub-signature-256` (C5b).
- `mutacoes.ts`: `export * from "./mutacoes/pagamentos";`, `export * from "./mutacoes/pos-venda";`, `export * from "./mutacoes/transcricao";`.
- `src/lib/db/erros.ts`: `ehViolacaoDeUnico` + `tests/unidade/db-erros.test.ts` (final R2-E D6).
- `tests/travas/mutacoes.test.ts`: nomes obrigatórios `registrarRespostaDePesquisa`, `registrarComentarioDePesquisa`, `transicionarPagamento`, `transicionarTranscricao`, `registrarUsoDeIa`; `lojas_ia_usos` sem `.update(`.
- **Commit**: `feat(db): escritas de pagamento, pesquisa, transcrição e uso de IA na porta única`

#### FR6 — permissões

- **Remove** `src/lib/auth/permissoes/fase-r2.ts`.
- **Cria** `permissoes/pos-venda.ts` (final R2-A D4), `permissoes/pagamentos.ts` (final R2-PG D-06 item 2), `permissoes/inteligencia.ts` (final R2-C G5). `comercial.ts`: as quatro `conteudo:*` ao fim de `COMERCIAL` (final R2-E D9).
- **`permissoes/index.ts`**: texto do final R2-PG D-06 item 4 (`MATRIZ_ENTREGUE` com `...POS_VENDA`, `...PAGAMENTOS`, `...INTELIGENCIA`; `MATRIZ = MATRIZ_ENTREGUE`; sem `FASE_R2` nem `MATRIZ_R1`). `git grep -n "MATRIZ_R1\|FASE_R2"` → só em `docs/` histórico.
- **Matriz final das chaves novas**:

| Chave | dono | admin | gerente | vendedor | viewer |
|---|:-:|:-:|:-:|:-:|:-:|
| `negocios:ler` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `negocios:criar`, `negocios:editar` | ✓ | ✓ | ✓ | ✓ | |
| `negocios:excluir` | ✓ | ✓ | ✓ | | |
| `devolucoes:ler`, `devolucoes:criar`, `devolucoes:editar` | ✓ | ✓ | ✓ | ✓ | |
| `devolucoes:aprovar`, `devolucoes:negar`, `devolucoes:concluir_estorno` | ✓ | ✓ | ✓ | | |
| `pesquisas:ler` | ✓ | ✓ | ✓ | | |
| `pagamentos:ler`, `pagamentos:gerar_cobranca`, `pagamentos:cancelar_cobranca` | ✓ | ✓ | ✓ | ✓ | |
| `ia:sugerir`, `ia:resumir`, `ia:transcrever` | ✓ | ✓ | ✓ | ✓ | |
| `conhecimento:ler` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `conhecimento:criar`, `conhecimento:editar`, `conhecimento:excluir` | ✓ | ✓ | ✓ | | |
| `conteudo:ler` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `conteudo:criar`, `conteudo:editar` | ✓ | ✓ | ✓ | ✓ | |
| `conteudo:excluir` | ✓ | ✓ | ✓ | | |

  Removida: `pagamentos:marcar_pago` (não existe). Reusadas sem mudança: `conversas:ler|escrever`, `integracoes:ler|conectar|desconectar`, `configuracao:ler|editar`, `alertas:ler`.
- **`tests/seguranca/rbac.test.ts`**: caso do final R2-PG D-06 item 5; prefixos `"pagamentos:"`, `"devolucoes:"`, `"negocios:"`, `"pesquisas:"`, `"ia:"`, `"conhecimento:"`, `"conteudo:"`; casos do final R2-A D4 e R2-E D9.
- **Commit**: `feat(auth): famílias de permissão do R2 e fim da matriz de fase futura`

#### FR7 — embrulho sem transação

- `src/lib/actions/_base.ts`: final R2-PG D-05 itens 1–3 (`prepararAcao` privada, `executarAcaoExterna`, regex de `valoresDoFormulario` com `cpf|cnpj|segredo|secret|assinatura`), comentário "Os TRÊS embrulhos".
- `tests/seguranca/guarda.test.ts`: final R2-PG D-05 item 4, com `PERMITIDOS` = `_base.ts`, `actions/pagamentos.ts`, `actions/inteligencia.ts`, `actions/canais-extras.ts` (C6). `tests/unidade/valores-formulario.test.ts` (D-05 item 5).
- **Commit**: `feat(acoes): embrulho sem transação para chamada a provedor externo`

#### FR8 — borda: saída de rede, balde de máquina, log e rotas públicas

- **`src/lib/rede/buscarExterno.ts`**: texto do final R2-D F4, com uma troca (C7):
  ```ts
  /** Cabecalhos com credencial: nunca atravessam para outro host num salto. */
  const CABECALHOS_DE_CREDENCIAL = new Set(["authorization", "access-token", "x-api-key", "cookie"]);
  ```
  `tests/seguranca/ssrf.test.ts`: casos do final R2-D F4 + "timeout acima de 60 s é cortado" + "`cookie` não atravessa para outro host".
- **`src/lib/seguranca/maquina.ts`** + **`tests/seguranca/maquina-balde.test.ts`** (novo): final R2-D F5 (inclui o caso T-PG-24 do final R2-PG D-13). `docs/seguranca/matriz-req-teste.md` linha I1–I15.
- **`src/lib/logger.ts`** (texto exato, C8), `CAMPOS_SENSIVEIS` ganha ao fim:
  ```ts
    // R2 (pagamentos, IA, canais extras). Nunca nome com hífen: quebra o redact no boot.
    "accessToken",
    "segredoWebhook",
    "pagadorCpf",
    "pagadorEmail",
    "cpf",
    "apiKey",
    "api_key",
    "access_token",
    "refresh_token",
    "page_access_token",
    "client_secret",
    "auth_code",
  ```
- **`src/lib/seguranca/rotas-publicas.ts`**: `dono: "fundacao" | "M5" | "R2-B" | "R2-D";` e, ao fim, a entrada de pagamentos do final R2-PG D-19 (com `dono: "R2-B"`) e as três do final R2-D F3. `docs/seguranca/caminhos-de-acesso.md`: linhas do R2-PG D-19 e R2-D F3, com estado `pacote R2-B` / `pacote R2-D`.
- **Commit**: `fix(seguranca): saída para os provedores do R2, salto sem credencial e balde de máquina só após a assinatura`

#### FR9 — ambiente

- **`src/lib/env.ts`** — 12 variáveis novas, todas desligadas por padrão:
  - bloco `// -- Canais`, depois de `INSTAGRAM_VERIFY_TOKEN`: `FACEBOOK_VERIFY_TOKEN`, `TIKTOK_APP_ID`, `TIKTOK_APP_SECRET`, `TIKTOK_API_VERSAO` (final R2-D F2);
  - bloco novo `// -- Pagamentos (R2-B, ADR 0037)`: `PAGAMENTOS_MERCADOPAGO` (final R2-PG D-12);
  - bloco `// -- Operação`, depois de `DISCORD_WEBHOOK_ALERTAS`: `CSAT_ATIVO` (final R2-A D8);
  - bloco novo `// -- Inteligência (R2-C, ADRs 0042–0046)` depois de Operação: `IA_PROVEDOR_TEXTO`, `ANTHROPIC_API_KEY`, `IA_PROVEDOR_TRANSCRICAO`, `OPENAI_API_KEY`, `IA_CLASSIFICACAO_AUTOMATICA`, `IA_LIMITE_DIARIO_USD` (final R2-C G9);
  - `superRefine`: os blocos do final R2-D F2 e do final R2-C G9.
- **`.env.example`**: os blocos dos mesmos finais (R2-A D8, R2-PG D-12, R2-C G9, R2-D F2), comentários em linha própria, ASCII.
- **Teste**: T17 (paridade `env.ts` × `.env.example`) verde; `NODE_ENV=production IA_PROVEDOR_TEXTO=simulado` recusa no boot.
- **Commit**: `feat(nucleo): variáveis do R2 desligadas por padrão e validadas no boot`

#### FR10 — filas, agendador e worker

- **`src/lib/fila/filas.ts`** (texto exato das entradas de `FILAS`):
  ```ts
    midia: { jobs: ["baixar-de-url", "gerar-miniatura", "transcrever-audio"], concorrencia: 4 },
    // … (as demais do R1, sem mudança) …
    /** Pós-venda (R2-A): pesquisa de satisfação. */
    "pos-venda": { jobs: ["disparar-pesquisas"], concorrencia: 1 },
    /** Cobrança (R2-B): notificação, cancelamento no provedor, expiração e conciliação. */
    pagamentos: {
      jobs: ["processar-notificacao", "cancelar-no-provedor", "expirar-cobrancas", "conciliar-cobrancas"],
      concorrencia: 2,
    },
    /** IA (R2-C): varredura de 1 min e classificação. Concorrência baixa: cada job é custo. */
    ia: { jobs: ["varrer-ia", "classificar-conversa"], concorrencia: 2 },
  ```
  (as três novas antes de `emails`).
- **`src/lib/fila/agendamentos.ts`**: trocar `gerar-alertas-15min` por `gerar-alertas-5min` (final R2-E D8); acrescentar `disparar-pesquisas-15min` (final R2-A D7), `expirar-cobrancas-5min` e `conciliar-cobrancas-diario` (final R2-PG D-10), `varrer-ia-minuto` (final R2-C G8); `AGENDADORES_APOSENTADOS` ganha `{ nome: "gerar-alertas-15min", fila: "manutencao" },`.
- **Processadores-costura** (novos): `src/server/processadores/pos-venda.ts` (final R2-A D7), `src/server/processadores/pagamentos.ts` (final R2-PG D-10, **com `expirarCobrancas` e `conciliarCobrancas` no-op**, C14), `src/server/processadores/inteligencia.ts` (final R2-C G8).
- **`src/server/worker.ts`**: imports e entradas `midia["transcrever-audio"]`, `"pos-venda"`, `pagamentos`, `ia` em `PROCESSADORES` — **no mesmo commit** de `FILAS` (`conferirCobertura()` derruba o boot se divergirem).
- **Aceite**: `npm run worker` sobe, registra 11 filas, remove o agendador aposentado e desliga limpo no `SIGTERM`.
- **Commit**: `feat(fila): filas pos-venda, pagamentos e ia e alertas a cada 5 minutos`

#### FR11 — navegação, tons, ícones e lista de block

- **`src/lib/navegacao.ts`** (decisão única): `fase: "entregue" | "futura";` com o comentário "Item `futura` não renderiza e não tem `page.tsx` (U8)"; todo `"R1"` → `"entregue"`; `NAVEGACAO_R1` → `NAVEGACAO_ENTREGUE`; "Funil", "Trocas e devoluções" e "Base de conhecimento" → `"entregue"`; itens novos "Satisfação" (final R2-A D5, entre Auditoria e Base de conhecimento) e "Lookbooks" (final R2-E D10, depois de Respostas rápidas). Nenhum item fica `futura` hoje.
- **`src/components/layout/navegacao-lateral.tsx`**: `satisfacao: Smile`, `lookbooks: BookImage` em `ICONES_NAV` (conferir `conhecimento` já mapeado).
- **`src/components/comum/icone-canal.tsx`**: final R2-D F6.
- **`src/lib/ui/tons.ts`**: final R2-A D6, final R2-PG D-18, final R2-C G11 (os `ROTULO_*` do R2-E já entraram no FR3); comentário "Enums fora do R1" some. Arquivo < 400 linhas.
- **`tests/componentes/block-3s.test.tsx`**: lista exata do final R2-C G13 (27 itens); `toHaveLength(27)`; `telasLigadas` e `PISO_DE_TELAS_LIGADAS` **não mudam** agora (cada pacote prova no próprio teste; o P-INT-R2 liga).
- **`tests/seguranca/inventario.test.ts`**: final R2-E D10.
- **Commit**: `feat(ui): navegação, selos, ícones e lista de block do R2`

#### FR12 — arquivos-costura (assinatura final)

Todos os arquivos da §2.3. Os marcados "completo" nascem com a lógica final e seus testes:
- `src/lib/canais/regras-de-envio.ts` + `tests/unidade/regras-de-envio.test.ts` (final R2-D F9);
- `src/lib/pagamentos/situacao.ts` + `tests/unidade/pagamentos-situacao.test.ts` (final R2-PG D-08; imports de `Transacao` por `@/lib/db/mutacoes`);
- `src/lib/alertas/fontes-r2.ts` (final R2-PG D-15, com o import de `@/lib/negocios/alertas`, C17).

`tests/seguranca/escopo-loja.test.ts`: `"src/lib/canais-extras/"` em `PASTAS_DE_DOMINIO` (final R2-D F11).
- **Commit**: `feat(costuras): arquivos-costura do R2 com assinatura final`

#### FR13 — deltas de módulo do R1 (um commit por módulo)

Aplicados sobre o código **commitado** de cada módulo. Cada commit roda os testes do módulo (`npm run test:integracao -- <prefixo>`) e os ajusta ao contrato novo no mesmo commit.

| Commit | Módulo | O que entra (fonte) |
|---|---|---|
| FR13.1 `refactor(conversas): costuras do R2 no envio, na ingestão e no composer` | M1 | `EnvioParaRegistrar` final (tabela abaixo) e o contrato de `conversaId`/`reabrir`/`autorTipo`/`midiaIds`/`card` (final R2-A §10.3-M1, R2-PG D-16, R2-E D15); `registrarSaida/registrarEnvio` com `ctx: ContextoDeGravacao`; `autor_tipo` = `usuario` se `ctx.origem === "ui"`, senão `envio.autorTipo ?? "campanha"`; `origem_envio` e bloqueio de janela/mídia/texto por `regras-de-envio.ts` (R2-D M1-1..M1-5, C9); ingestão com `classificarEntradaDePesquisa`/`aplicarEntradaDePesquisa` (R2-A §10.3); `canais/tipos.ts`, `registro.ts` (R2-D M1-1, M1-2); ingestão TikTok/Messenger (R2-D M1-3); DTOs com `ia`, transcrição, `janela`, `card` e mídias por `ordem, id`; slots do composer (Anexar · Produto · Lookbook · Resposta rápida · Sugestão), cabeçalho, linha e balão (R2-C G17, R2-E D15); ritmo `facebook: 5`, `tiktok: 1` |
| FR13.2 `refactor(lgpd): opt-out vigente e anonimização dos campos do R2` | M2 | `optOutVigente(tx, contatoId)` exportado de `@/lib/lgpd` (R2-A §10.3-M2, R2-E D18); anonimização zera `negocios.observacao_perda`, `pedidos_devolucoes.motivo_detalhe`, `ia_*`, fecha transcrição pendente, remove `metadados.conversa_externa_id` (R2-A, R2-C G17, R2-D M2-1); dossiê com `negocios`, `pedidos_devolucoes`, `pesquisas_satisfacao`, `ia_*` |
| FR13.3 `refactor(midias): leitura de bytes para transcrição e busca do Messenger` | M3 | `src/lib/midias/leitura.ts` com `lerBytesDaMidia` sobre `midiaParaLeitura` + `lerBytes` (C19), exportado no `index.ts`; `provedorDeBusca("facebook") === "meta"` (R2-D M3-1) |
| FR13.4 `refactor(pedidos): negócio ganho, cobrança e troca no pedido` | M4 | criação com `negocioId` só aberto (R2-A §10.3-M4); `cancelarPedido` chama `cancelarCobrancasDoPedido` (R2-PG D-17); `pedidos/[id]/page.tsx` com `SecaoPagamento` e link "Solicitar troca ou devolução"; `painel-venda.tsx` com `negocioAbertoDoContato` e `BotaoCobrar`; rótulos da linha do tempo e selo de pagamento |
| FR13.5 `refactor(integracoes): cartões do R2 e conferência dos canais extras` | M5 | `configuracoes/page.tsx` com os cartões Pagamentos, Inteligência e SLA (R2-PG D-17, R2-C G17, R2-E D17); `integracoes/page.tsx` com `ConectarCanaisExtras`; `[id]/page.tsx` sem reautenticação genérica para `facebook`/`tiktok`; listagem sem provedores de pagamento; `renovarToken` chama `conferirContasCanaisExtras` (R2-D M5-2..M5-5) |
| FR13.6 `refactor(campanhas): materialização pelo opt-out vigente` | M6 | a materialização usa `optOutVigente` (se tiver SQL próprio); teste "`facebook`/`tiktok` não são provedor de campanha" |
| FR13.7 `refactor(usuarios): ator de sistema fora da administração` | M7 | listagem, `listar_colegas` e ações sobre conta alheia recusam `ATOR_SISTEMA` (R2-PG D-07), com teste |
| FR13.8 `refactor(alertas): fontes do R2, rótulos e prazos vigentes` | M8 | gerador percorre `FONTES_R2` com `tipos` + `prefixo` (R2-PG D-15); `negocio_parado` severidade alta; `rotaDoAlerta` com `negocioId` → `/funil/<id>` e `base_conhecimento_artigos` → `/base-de-conhecimento/<id>`; 13 rótulos de ação e entidades/tabelas novas em `auditoria/apresentacao.ts`; `actions/alertas.ts` e `alertas/page.tsx` com prazos vigentes e "Alterar prazos" (R2-E D16 itens 4, 5, 7) |

`EnvioParaRegistrar` final (texto exato):
```ts
export type EnvioParaRegistrar = {
  lojaId: string;
  contatoId: string;
  integracaoId: string;
  conteudo: string;
  chaveIdempotencia: string;
  /** Modelo aprovado (WhatsApp oficial). `conteudo` é o corpo já resolvido. */
  modelo?: { templateId: string; variaveis: string[] };
  /** Grava NESTA conversa (viva, do contato, da loja e da integração); senão `ErroDeEscopo`. Sem ela, vale a mesclagem. */
  conversaId?: string;
  /** `false`: grava sem mudar status, sem somar não lidas e sem `conversa_reaberta` (ADR 0035). Padrão `true`. */
  reabrir?: boolean;
  /** Autor quando não é pessoa da sessão. `sistema` não conta como primeira resposta nem para o SLA. */
  autorTipo?: "sistema" | "campanha";
  /** Ids de `lojas_midias` da MESMA loja, na ordem: UMA mensagem com N mídias (ADR 0055). */
  midiaIds?: readonly string[];
  /** Cartão derivado (01-dados-dominio.md §2.3). */
  card?: NonNullable<MetadadosMensagem["card"]>;
};
```

#### FR14 — ADRs

`docs/adr/0031-*.md` a `0057-*.md` (textos da §11 de cada final; 0033 e 0049 **uma vez**, com os textos de fusão do final R2-PG §11 e a lista de três arquivos do C6) e as 27 linhas em `docs/adr/README.md`.
- **Commit**: `docs(adr): registrar as decisões 0031 a 0057 do R2`

#### FR15 — documentação versionada

`docs/regras-negocio.md` (seções Pós-venda, Pagamentos, Inteligência e base, Canais extras, Lookbooks e SLA, com as regras numeradas dos finais); `docs/seguranca/runbook.md` (R2-D F13); `docs/integracoes.md` (nota do TikTok Shop); `docs/seguranca/caminhos-de-acesso.md` com as rotas de tela dos cinco pacotes (estado `pacote R2-x`), "fase `futura`" e as retiradas da lista "não existem". Atualizações de `spec/final/*` (fora do repo) são do orquestrador, pelas listas de cada final (R2-A D11, R2-PG D-23, R2-C G18, R2-D F13, R2-E D13); a tabela de costuras e o mapa de donos do `05-plano` recebem as §2.3 e §3.7 deste plano.
- **Commit**: `docs(repo): regras, caminhos de acesso e runbook do R2`

**Portão de saída do F-R2** (a onda 3 só começa com tudo verde): `npm run verificar` · `npm run db:verificar` (50 tabelas) · `npm run build` · `npm run worker` sobe com 11 filas · `node scripts/db-teste.mjs && npm run test:integracao` (banco sem sufixo) · `GET /api/auth/get-session` = 200 · `git grep -n "src/lib/auth/sistema\|MATRIZ_R1\|NAVEGACAO_R1\|FASE_R2\|pagamentos:marcar_pago" -- src tests` vazio.

### 2.3 Arquivos-costura novos (criados no FR12 com a assinatura final)

| Arquivo | Assinatura | Corpo no F-R2 | Dono (preenche) | Consumido por |
|---|---|---|---|---|
| `src/lib/negocios/alertas.ts` | `candidatosDeAlertaDeNegocio(tx, lojaId, agora): Promise<CandidatoDeAlertaDeNegocio[]>` (tipo estrutural igual a `CandidatoDeAlerta`, sem importar `@/lib/alertas`) | `return []` | R2-A | `fontes-r2.ts` (M8) |
| `src/lib/actions/negocios.ts` | `"use server"`; `negocioAbertoDoContato({ contatoId, loja? })` por `executarAcao` (`negocios:ler`, `loja: "le"`) | devolve `null` | R2-A | `painel-venda.tsx` (M4) |
| `src/lib/pesquisas/entrada.ts` | `classificarEntradaDePesquisa(tx, entrada)`, `aplicarEntradaDePesquisa(tx, classificacao, mensagem, ctx: ContextoDeGravacao)` + tipos do final R2-A §5.5 | final R2-A D9 | R2-A | ingestão (M1) |
| `src/server/processadores/pos-venda.ts` | `dispararPesquisas(job)` | final R2-A D7 | R2-A | worker |
| `src/lib/pagamentos/situacao.ts` | `origemDoPagamento`, `baseDeEstorno`, `tetoDeEstorno`, `statusPagamentoDoPedido`, `lerFatosDePagamento` | **completo** | R2-B **só lê** (mudar = ADR 0033) | R2-B, R2-A (`devolucoes/_teto.ts`) |
| `src/lib/pagamentos/costuras.ts` | `cancelarCobrancasDoPedido(tx, pedidoId, ctx)`, `candidatosDeAlertaDePagamento(tx, lojaId, agora)` | final R2-PG D-09 | R2-B | M4, `fontes-r2.ts` |
| `src/components/comum/pagamentos/secao-pagamento.tsx` | `SecaoPagamento({ pedidoId })`, `EsqueletoSecaoPagamento()` | `null` | R2-B | `pedidos/[id]` (M4) |
| `src/components/comum/pagamentos/botao-cobrar.tsx` | `BotaoCobrar({ pedidoId })` | `null` | R2-B | `painel-venda.tsx` (M4) |
| `src/server/processadores/pagamentos.ts` | `processarNotificacao`, `cancelarNoProvedor`, `expirarCobrancas`, `conciliarCobrancas` | 2 lançam, 2 no-op (C14) | R2-B | worker |
| `src/lib/inteligencia/index.ts` | `ehTranscrevivel(mime)`, `limparInvisiveis(texto)` (+ o resto que o R2-C exporta depois) | **as duas completas** (puras: `mime` em `audio/ogg`/`audio/mp4`; remoção dos invisíveis de R2-IA-05) | R2-C (acrescenta) | M1 (DTO), R2-C-KB |
| `src/lib/inteligencia/tipos.ts` | tipos de §7.1 do final R2-C (`EstadoDaIa`, `IaDaConversa`, `MidiaDeAudio`…) | só tipos | R2-C | M1, componentes `ia/` |
| `src/lib/actions/inteligencia.ts` | `"use server"`; `lerEstadoDaIa()` por `executarAcao` (`conversas:ler`, `loja: "le"`) | devolve os três estados `"desligado"` | R2-C | páginas de conversa (M1) |
| `src/app/(app)/conversas/_components/ia/{botao-sugestao,cartao-sugestao,resumo-conversa,selo-classificacao,transcricao-audio}.tsx` | props do final R2-C G17 | `null` | R2-C | composer, cabeçalho, linha, balão (M1) |
| `src/server/processadores/inteligencia.ts` | `varrerIa`, `classificarConversa`, `transcreverAudio` | 1 no-op, 2 lançam | R2-C | worker |
| `src/lib/canais/regras-de-envio.ts` | `situacaoDaJanela`, `mensagemDaJanela`, `recusaDeMidia`, `recusaDeTexto` | **completo** | FUNDAÇÃO | M1, R2-D |
| `src/lib/canais/facebook/adaptador.ts` | `criarAdaptadorFacebook(conta): AdaptadorDeCanal` | lança | R2-D | `canais/registro.ts` (M1) |
| `src/lib/canais/tiktok/adaptador.ts` | `criarAdaptadorTiktok(conta): AdaptadorDeCanal` | lança | R2-D | idem |
| `src/lib/canais-extras/index.ts` | `garantirTokenTiktok`, `destinoTiktok`, `conferirContasCanaisExtras` | final R2-D F10 | R2-D | M1, M5 |
| `src/app/(app)/configuracoes/integracoes/_components/conectar-canais-extras.tsx` | `ConectarCanaisExtras({ lojas })` | `null` | R2-D | `integracoes/page.tsx` (M5) |
| `src/lib/sla/prazo.ts` | `PRAZO_SLA_PADRAO_MIN`, `INTERVALO_CONFERENCIA_SLA_MIN`, `minutosDeSlaSql`, `venceEmSql`, `lerPrazosVigentes`, `textoDosPrazos` | **completo** (FR3) | R2-E (só testa) | M8 |
| `src/app/(app)/conversas/_components/seletor-lookbook.tsx` | `SeletorLookbook({ conversaId, lojaId, bloqueado, motivoBloqueio? })` | `null` | R2-E | composer (M1) |
| `src/lib/alertas/fontes-r2.ts` | `CandidatoDeAlerta`, `FonteDeAlerta`, `FONTES_R2` | **completo** | FUNDAÇÃO | gerador (M8) |

**Tamanho do delta F-R2**: 22 commits (FR1–FR15, com FR13 dividido em 8), ≈ 125 arquivos: ≈ 40 novos de código (13 costuras, 3 processadores, 3 permissões, 3 schemas, 7 mutações/pasta, 3 completos…), 7 testes novos, 28 de ADR, ≈ 45 da fundação alterados (inclui ≈ 15 travas), ≈ 30 de módulos do R1; 2 migrações; 1 dependência; 12 variáveis; 3 filas; 4 agendadores novos e 1 aposentado; 22 chaves de permissão (−1); 4 rotas públicas; 27 ações com block.

---

## 3. Os 5 pacotes da onda 3 (paralelos)

Contrato de paralelismo: `05-plano §2`, sem exceção. **Proibido na onda 3**: `npm install`, `next build`, `drizzle-kit generate`, gravar em `src/lib/db/**`, `src/lib/auth/**`, `src/lib/seguranca/**`, `src/lib/rede/**`, `src/lib/fila/**`, `src/server/worker.ts`, `src/lib/{env,logger,navegacao}.ts`, `src/lib/ui/tons.ts`, `src/components/{ui,layout}/**`, `src/components/comum/**` (fora de `comum/pagamentos/`, do R2-B), `scripts/**`, `.claude/**`, `.github/**`, `docs/adr/**`, `docs/seguranca/**`, e em **qualquer arquivo de M1..M8** fora das exceções nominais da §3.7. Faltou algo compartilhado → **para e reporta**. Cada pacote roda só os **seus** testes de integração (`npm run test:integracao -- <prefixo>`).

**Leitura obrigatória com o final**: a §2.1 deste plano (substituições). As mais frequentes:

| No final está | Leia |
|---|---|
| `0018_r2`, `0019_r2_integridade` | `0019_r2`, `0020_r2_integridade` |
| `src/lib/auth/sistema.ts`, `contextoDeSistema(lojaId, "worker")` | `@/lib/db/sistema`, `contextoDeSistema({ origem: "worker", lojaId })` |
| `ctx: Contexto` em mutação ou costura chamada por job | `ctx: ContextoDeGravacao` |
| `registrarEventoRecebido` de `mutacoes/integracoes` | `registrarEventoRecebido`, `registrarProcessamentoEvento`, `cabecalhosDoDiario` de `@/lib/integracoes` |
| `src/lib/canais/janela.ts`, `origem = "composer"` | `src/lib/canais/regras-de-envio.ts`, `origem = "pessoa"` |
| `MATRIZ_R1`, `NAVEGACAO_R1`, `FASE_R2` | `MATRIZ_ENTREGUE`, `NAVEGACAO_ENTREGUE`, (não existe) |
| `mutacoes-sistema.ts` | `mutacoes/sistema.ts` (importe sempre de `@/lib/db/mutacoes`) |
| Banco `r2a1/r2a2/r2a3/r2pg/r2c/r2d/r2e1/r2e2`, Redis 9–14 | §4 deste plano |
| "R2-PG" | "R2-B" (mesmo pacote) |

### R2-A — Pós-venda

- **Objetivo**: funil, trocas/devoluções e CSAT com backend de verdade, sem tela de fachada, sem escrita em ERP e sem mensagem automática além da pesquisa e das duas respostas dela.
- **Entradas**: `r2/final-r2a-posvenda.md` inteiro (menos §10, já aplicado); `01-dados-dominio.md §6.1, §6.6, §7`; `03-arquitetura.md §4, §6, §8`; `04-ui.md §4–§10`; `02-seguranca.md §2.2, §2.4`.
- **Pré-requisitos**: portão do F-R2 verde.
- **Ordem interna** (um agente): A1 Funil → A2 Trocas → A3 CSAT.
- **CRIA E É DONO**: lista do final R2-A §9 "Cria e é dono" (A1, A2, A3), **mais os corpos** de `src/lib/negocios/alertas.ts`, `src/lib/actions/negocios.ts` (acrescenta as demais actions ao arquivo-costura), `src/lib/pesquisas/entrada.ts`, `src/server/processadores/pos-venda.ts`. Caminhos: `src/lib/{negocios,devolucoes,pesquisas}/**`, `src/lib/actions/{negocios,devolucoes,pesquisas}.ts`, `src/lib/validadores/{negocios,devolucoes,pesquisas}.ts`, `src/app/(app)/{funil,trocas,satisfacao}/**`, `src/server/processadores/pos-venda.ts`, `tests/*/{negocios,devolucoes,pesquisas}-*`, `docs/modulos/{negocios,devolucoes,pesquisas}.md`.
- **SÓ LÊ**: final R2-A §9 "Só lê", mais `src/lib/pagamentos/situacao.ts` (o `_teto.ts` **delega** a ele e só monta a microcopia, final R2-PG D-21) e `@/lib/db/sistema`.
- **Não negociável**: final R2-A §9 (10 itens). Acréscimos: o teto e o `pagamento_status` vêm **só** de `situacao.ts`; toda gravação de job e de ingestão usa `contextoDeSistema({ origem: "worker", lojaId })`.
- **Aceite verificável**: final R2-A §9, com `node scripts/db-teste.mjs --sufixo r2a` e `REDIS_URL=redis://localhost:6382/13`. O fluxo "troca de gateway" usa pagamento criado **direto no banco de teste** com `provedor = 'pagamento_simulado'` e `status = 'aprovado'` (o R2-B corre em paralelo); o fluxo ponta a ponta com a tela de cobrança fica para o P-INT-R2.
- **Testes obrigatórios**: final R2-A §9 inteiro, mais "teto de estorno usa `tetoDeEstorno` de `situacao.ts`" (trava de fonte: `_teto.ts` não contém `Math.min(`).
- **Riscos**: final R2-A §9. Mais: contrato da ingestão de M1 (FR13.1) divergente do esperado → o teste `pesquisas-ingestao` falha; o pacote para e reporta (a correção é do F-R2/P-INT, nunca contorno).
- **Commits**: os 12 do final R2-A §9, na ordem A1 → A2 → A3.
- **Porte**: ~60 arquivos, ~5.900 linhas. O maior dos cinco; se o orquestrador tiver folga, A3 pode ser um sexto agente (banco `r2a3`, Redis 18, porta 3026), sem arquivo comum com A1/A2.

### R2-B — Pagamentos (Pix e link)

- **Objetivo**: cobrança por Pix e link com confirmação exclusiva do provedor, conta por loja com identidade fixa, envio pela conversa por pessoa, cancelamento, expiração confirmada, conciliação e alertas — simulado determinístico e Mercado Pago real por `PAGAMENTOS_MERCADOPAGO`.
- **Entradas**: `r2/final-r2b-pagamentos.md` §1–§9 e §11; `01-dados-dominio.md §6.3–6.6`; `01-dados.md §4.7, §6.3, §6.4, §7.4`; `02-seguranca.md §2.2, §12, §13, §17`; `03-arquitetura.md §4.3, §6.4, §8, §11, §12`; `04-ui.md §2.4, §5.3, §7, §9, §10`.
- **Pré-requisitos**: portão do F-R2 verde.
- **CRIA E É DONO**: lista do final R2-PG §9 "CRIA E É DONO", **menos** `src/lib/pagamentos/situacao.ts` (só lê). Caminhos: `src/lib/pagamentos/**` (exceto `situacao.ts`), `src/components/comum/pagamentos/**`, `src/app/api/webhooks/pagamentos/**`, `src/app/(app)/configuracoes/pagamentos/**`, `src/lib/actions/pagamentos.ts`, `src/lib/validadores/pagamentos.ts`, `src/server/processadores/pagamentos.ts` (corpo), `tests/*/pagamentos-*`, `tests/fixtures/mercadopago/**`, `docs/modulos/pagamentos.md`.
- **SÓ LÊ**: final R2-PG §9 "SÓ LÊ", trocando `registrarEventoRecebido`/`registrarProcessamentoEvento` "de `mutacoes`" pelos de `@/lib/integracoes` (C5) e `sistema` por `@/lib/db/sistema`.
- **Não negociável**: os 15 itens do final R2-PG §9. Acréscimo: a rota de webhook usa `cabecalhosDoDiario` e `registrarEventoRecebido` de `@/lib/integracoes`; notificação sem `data.id` grava `eventoExternoId: null`.
- **Aceite verificável**: final R2-PG §9, com `--sufixo r2b` e `REDIS_URL=redis://localhost:6382/14`. Fluxo manual com conta simulada na porta 3022 (§4). HML: conferência de cada `CONFERIR` do `mercadopago/config.ts` com token `TEST-`, datada em `docs/modulos/pagamentos.md`, **antes** de `producao`.
- **Testes obrigatórios**: T-PG-01..T-PG-22, T-PG-25, T-PG-26 do final (T-PG-23 e T-PG-24 já entraram no F-R2). O agendamento de `expirar`/`conciliar` passa a chamar o corpo real: teste "com zero cobranças, os dois jobs terminam sem erro".
- **Riscos**: final R2-PG §9. Mais: `registrarEnvio` de M1 sem a recusa por conta/janela (FR13.1) → T-PG-15 falha → para e reporta.
- **Commits**: os 10 do final R2-PG §9, com escopo `pagamentos`.
- **Porte**: ~38 arquivos de produção (~2.700 linhas) + ~22 de teste.

### R2-C — Inteligência e base de conhecimento

- **Objetivo**: sugestão, resumo, classificação e transcrição que funcionam de verdade com provedor simulado e real; base de conhecimento com CRUD auditado que alimenta a IA; painel honesto de estado e custo.
- **Entradas**: `r2/final-r2c-inteligencia.md` §1–§9, §11, §12; skill `claude-api` (a versão do SDK é a do FR1); `01-dados.md §3, §4, §7`; `01-dados-dominio.md §2, §4, §5.3, §8`; `02-seguranca.md §2, §3, §16, §17`; `03-arquitetura.md §4, §6, §8, §9, §12.4, §14`; `04-ui.md §5.2, §6, §7, §9, §10, §11`.
- **Pré-requisitos**: portão do F-R2 verde.
- **Ordem interna**: C-KB (menor, destrava a ancoragem com dado real) → C-IA.
- **CRIA E É DONO**: tabela do final R2-C §9 "CRIA E É DONO", incluindo os corpos das costuras `src/lib/inteligencia/{index,tipos}.ts` (acrescenta; **não** muda a lógica de `ehTranscrevivel`/`limparInvisiveis` sem ajustar o teste), `src/lib/actions/inteligencia.ts`, `src/app/(app)/conversas/_components/ia/**`, `src/server/processadores/inteligencia.ts`. Caminhos: `src/lib/{inteligencia,conhecimento}/**`, `src/lib/actions/{inteligencia,conhecimento}.ts`, `src/lib/validadores/{inteligencia,conhecimento}.ts`, `src/app/(app)/base-de-conhecimento/**`, `src/app/(app)/configuracoes/inteligencia/**`, `src/app/(app)/conversas/_components/ia/**`, `src/server/processadores/inteligencia.ts`, `tests/*/{ia,conhecimento}-*`, `tests/unidade/_audio-sintetico.ts`, `docs/modulos/{inteligencia,conhecimento}.md`.
- **SÓ LÊ**: final R2-C §9 "SÓ LÊ", mais `src/lib/midias` (`lerBytesDaMidia`, FR13.3) e `@/lib/db/sistema`.
- **Não negociável**: os 11 itens do final R2-C §9. Reforços: modelos **só** `claude-sonnet-5` e `claude-haiku-4-5-20251001` (e `whisper-1`), pelas constantes de `_enums/inteligencia.ts`; nenhum componente de `ia/` importa `@/lib/actions/conversas`; nenhuma chamada a provedor dentro de transação.
- **Aceite verificável**: final R2-C §9, com `--sufixo r2c`, `REDIS_URL=redis://localhost:6382/15`, `IA_PROVEDOR_TEXTO=simulado IA_PROVEDOR_TRANSCRICAO=simulado`. Manual na porta 3023.
- **Testes obrigatórios**: tabela do final R2-C §9 inteira.
- **Riscos**: final R2-C §9 (`zodOutputFormat` × Zod 4.6 → plano B do §6.2; latência do Sonnet 5 → `thinking: { type: "disabled" }` só na sugestão).
- **Commits**: os 8 do final R2-C §9 (o de `conhecimento` primeiro).
- **Porte**: ~50 arquivos (~3.800 linhas) + 24 de teste.

### R2-D — Canais extras (Messenger e TikTok DM)

- **Objetivo**: Messenger e TikTok DM ponta a ponta sobre a ingestão e o envio genéricos do R1 — sem tela de fachada e sem TikTok Shop.
- **Entradas**: `r2/final-r2d-canais-extras.md` §0–§9, §11; `03-arquitetura.md §4.1, §8, §10, §11, §12.3, §12.4, §13`; `02-seguranca.md §12, §13`; `04-ui.md §5.2, §5.6, §7.2, §10`; `01-dados.md §6.3, §6.4, §10`.
- **Pré-requisitos**: portão do F-R2 verde (inclui FR13.1, FR13.3, FR13.5).
- **CRIA E É DONO**: lista do final R2-D §9 "CRIA E É DONO" (inclui os corpos das 4 costuras do F-R2). Caminhos: `src/lib/canais/{facebook,tiktok}/**`, `src/lib/canais-extras/**`, `src/lib/actions/canais-extras.ts`, `src/lib/validadores/canais-extras.ts`, `src/app/api/webhooks/{facebook,tiktok}/**`, `src/app/api/integracoes/tiktok/**`, `src/app/(app)/configuracoes/integracoes/_components/{conectar-canais-extras,dialogo-conectar-facebook,dialogo-conectar-tiktok}.tsx`, `tests/*/canais-extras-*`, `tests/travas/canais-extras.test.ts`, `tests/fixtures/canais-extras/**`, `docs/modulos/canais-extras.md`.
- **SÓ LÊ**: final R2-D §9 "SÓ LÊ" (a função de diário e a lista branca são as de `@/lib/integracoes`, C5).
- **Não negociável**: os 11 itens do final R2-D §9. `actions/canais-extras.ts` usa `executarAcaoExterna` para `conectarPaginaFacebook` e o início/retorno do OAuth que chama o provedor.
- **Aceite verificável**: final R2-D §9 itens 1–14, com `--sufixo r2d` e `REDIS_URL=redis://localhost:6382/16` (variáveis de app só por `vi.stubEnv` no teste). Item 15 (HML) fica pendente e datado se o app TikTok não estiver aprovado.
- **Testes obrigatórios**: lista do final R2-D §9, com a trava `canais-extras.test.ts` (a)–(g) e mais (h): nenhum arquivo de `src/` contém `exigeJanela24h`.
- **Riscos**: tabela do final R2-D §9.
- **Commits**: os 10 do final R2-D §9.
- **Porte**: ~20 arquivos de código (~2.400 linhas) + ~9 de teste.

### R2-E — Lookbooks e SLA configurável

- **Objetivo**: lookbook de verdade (montar, editar com trava, excluir, enviar pela conversa com prévia e block) e prazos de SLA por loja/canal/prioridade lidos pelo gerador de M8.
- **Entradas**: `r2/final-r2e-lookbooks-sla.md` §1–§9, §11; `01-dados-dominio.md §2.3, §2.4, §5.1, §7.2`; `03-arquitetura.md §4.3, §13`; `04-ui.md §5.2, §5.4, §5.5, §5.6, §7, §9, §10`; `01-dados.md §4.7, §6.6`.
- **Pré-requisitos**: portão do F-R2 verde (inclui FR3 com a troca de SLA de M8 e FR13.1/FR13.2).
- **Ordem interna**: E2 SLA (meio dia, prova o contrato de M8 cedo) → E1 Lookbooks.
- **CRIA E É DONO**: listas do final R2-E §9 (E1 e E2). Caminhos: `src/lib/lookbooks/**`, `src/lib/actions/lookbooks.ts`, `src/lib/validadores/lookbooks.ts`, `src/app/(app)/lookbooks/**`, `src/app/(app)/conversas/_components/{seletor-lookbook,seletor-lookbook-envio}.tsx`, `src/lib/sla/{index,_consultas}.ts`, `src/lib/actions/sla.ts`, `src/lib/validadores/sla.ts`, `src/app/(app)/configuracoes/sla/**`, `tests/*/{lookbooks,sla}-*`, `tests/travas/{lookbook-sem-url-publica,sla-fonte-unica}.test.ts`, `docs/modulos/{lookbooks,sla}.md`. **`src/lib/sla/prazo.ts` é só leitura** (nasceu completo no FR3; mudar = para e reporta).
- **SÓ LÊ**: final R2-E §9 "Só lê", mais `src/lib/canais/regras-de-envio.ts`.
- **Não negociável**: listas do final R2-E §9 (E1 e E2).
- **Aceite verificável**: final R2-E §9 (E1 itens 1–12, E2 itens 1–8), com `--sufixo r2e`, `REDIS_URL=redis://localhost:6382/17`. O item E2-7 roda o gerador de M8 como caixa-preta. Manual na porta 3025.
- **Testes obrigatórios**: listas do final R2-E §9. Trava `sla-fonte-unica` (b) passa a aceitar `src/lib/canais/regras-de-envio.ts` fora do escopo (não é `alertas/**`).
- **Riscos**: final R2-E §9.
- **Commits**: os 7 do final R2-E §9, E2 primeiro.
- **Porte**: E1 ≈ 24 arquivos / 2.700 linhas; E2 ≈ 12 / 1.000.

### 3.7 Mapa de donos do R2 e costuras entre pacotes

| Caminho | Dono |
|---|---|
| `src/lib/{negocios,devolucoes,pesquisas}/**`, `src/lib/actions/{negocios,devolucoes,pesquisas}.ts`, `src/lib/validadores/{negocios,devolucoes,pesquisas}.ts`, `src/app/(app)/{funil,trocas,satisfacao}/**`, `src/server/processadores/pos-venda.ts`, `docs/modulos/{negocios,devolucoes,pesquisas}.md` | R2-A |
| `src/lib/pagamentos/**` (exceto `situacao.ts`), `src/components/comum/pagamentos/**`, `src/app/api/webhooks/pagamentos/**`, `src/app/(app)/configuracoes/pagamentos/**`, `src/lib/actions/pagamentos.ts`, `src/lib/validadores/pagamentos.ts`, `src/server/processadores/pagamentos.ts`, `docs/modulos/pagamentos.md` | R2-B |
| `src/lib/{inteligencia,conhecimento}/**`, `src/lib/actions/{inteligencia,conhecimento}.ts`, `src/lib/validadores/{inteligencia,conhecimento}.ts`, `src/app/(app)/base-de-conhecimento/**`, `src/app/(app)/configuracoes/inteligencia/**`, `src/app/(app)/conversas/_components/ia/**`, `src/server/processadores/inteligencia.ts`, `docs/modulos/{inteligencia,conhecimento}.md` | R2-C |
| `src/lib/canais/{facebook,tiktok}/**`, `src/lib/canais-extras/**`, `src/lib/actions/canais-extras.ts`, `src/lib/validadores/canais-extras.ts`, `src/app/api/webhooks/{facebook,tiktok}/**`, `src/app/api/integracoes/tiktok/**`, `src/app/(app)/configuracoes/integracoes/_components/{conectar-canais-extras,dialogo-conectar-facebook,dialogo-conectar-tiktok}.tsx`, `docs/modulos/canais-extras.md` | R2-D |
| `src/lib/lookbooks/**`, `src/lib/sla/{index,_consultas}.ts`, `src/lib/actions/{lookbooks,sla}.ts`, `src/lib/validadores/{lookbooks,sla}.ts`, `src/app/(app)/lookbooks/**`, `src/app/(app)/configuracoes/sla/**`, `src/app/(app)/conversas/_components/{seletor-lookbook,seletor-lookbook-envio}.tsx`, `docs/modulos/{lookbooks,sla}.md` | R2-E |
| `src/lib/db/mutacoes/**`, `src/lib/db/schema/{lojas-ia-usos,lojas-sla,_enums/inteligencia}.ts`, `src/lib/auth/permissoes/{pos-venda,pagamentos,inteligencia}.ts`, `src/lib/pagamentos/situacao.ts`, `src/lib/sla/prazo.ts`, `src/lib/canais/regras-de-envio.ts`, `src/lib/alertas/fontes-r2.ts`, `tests/unidade/{regras-de-envio,pagamentos-situacao,valores-formulario,db-erros}.test.ts`, `tests/seguranca/maquina-balde.test.ts` | FUNDAÇÃO (F-R2) |

Exceções nominais em árvore de módulo do R1 (nota de rodapé do `05-plano §8`): em `conversas/_components/` (M1) — `ia/**` (R2-C), `seletor-lookbook*.tsx` (R2-E); em `src/lib/canais/` (M1) — `facebook/**`, `tiktok/**` (R2-D), `regras-de-envio.ts` (fundação); em `src/app/api/webhooks/` e `src/app/api/integracoes/` (M5) — `pagamentos/**` (R2-B), `facebook/**`, `tiktok/**` (R2-D); em `configuracoes/` (M5) — `pagamentos/**` (R2-B), `inteligencia/**` (R2-C), `sla/**` (R2-E), os 3 componentes do R2-D em `integracoes/_components/`; em `src/lib/alertas/` (M8) — `fontes-r2.ts` (fundação).

**Costuras entre pacotes da onda 3** (as únicas importações cruzadas permitidas):

| Quem importa | O quê | De quem |
|---|---|---|
| R2-A (`devolucoes/_teto.ts`, `_conclusao.ts`) | `lerFatosDePagamento`, `origemDoPagamento`, `tetoDeEstorno`, `statusPagamentoDoPedido` | fundação (`pagamentos/situacao.ts`) — **não** de `@/lib/pagamentos` |
| R2-A, R2-B, R2-E | `registrarEnvio` com o tipo final | M1 (`conversas/saida.ts`) |
| R2-A, R2-E | `optOutVigente`; R2-A também `registrarConsentimento` | M2 (`@/lib/lgpd`) |
| R2-B, R2-D | `registrarEventoRecebido`, `registrarProcessamentoEvento`, `cabecalhosDoDiario` | M5 (`@/lib/integracoes`) |
| R2-C | `calcularDisponivel` | M4 (`catalogo/disponibilidade.ts`) |
| R2-C | `lerBytesDaMidia` | M3 (`@/lib/midias`) |
| R2-D | `guardarMidiaRecebida` | M3 (`midias/ingestao.ts`) |
| R2-D, M1 | regras de janela e de mídia | fundação (`canais/regras-de-envio.ts`) |
| M1, M4, M5, M8 | costuras da §2.3 | R2-A..R2-E |

**Nenhum pacote do R2 importa outro pacote do R2.** R2-C lê a tabela `base_conhecimento_artigos` pelo próprio `_consultas.ts`; R2-A lê `pagamentos` pelo módulo da fundação; R2-E não lê nada do R2-D (o prazo do TikTok mora em `prazo.ts`).

---

## 4. Banco de teste, índice Redis e porta por pacote

| Pacote | Banco de teste (`node scripts/db-teste.mjs --sufixo …`) | Redis | Porta do app (fluxo manual) |
|---|---|---|---|
| FUNDAÇÃO (F-R2) / P-INT-R2 | `merlostore_test` | 0 | 3005 |
| R2-A Pós-venda | `merlostore_test_r2a` | 13 | 3021 |
| R2-B Pagamentos | `merlostore_test_r2b` | 14 | 3022 |
| R2-C Inteligência | `merlostore_test_r2c` | 15 | 3023 |
| R2-D Canais extras | `merlostore_test_r2d` | 16 | 3024 |
| R2-E Lookbooks e SLA | `merlostore_test_r2e` | 17 | 3025 |

- Comando: `DATABASE_URL_TESTE=postgres://…:5437/merlostore_test_r2x REDIS_URL=redis://localhost:6382/<n> npm run test:integracao -- <prefixo>`.
- Subpacotes do mesmo pacote dividem banco e Redis e rodam **em série** (um agente).
- **Porta**: `npx next dev -p 302x` só para o fluxo manual. O Next 16 guarda o build de dev em `.next/` do diretório; se ele recusar um segundo `next dev` no mesmo diretório (ou os dois corromperem `.next`), o fluxo manual **não** roda no pacote: vai para a lista do P-INT-R2, executado em série na 3005. O aceite do pacote continua sendo os testes de integração e de componente.
- O Redis de dev (índice 0) e o banco de dev nunca são usados por teste.

---

## 5. Ordem de commits

**Antes do R2** (fora deste plano, registrado para a ordem): DF1 (consolidação `0018`, com os ADRs dela em 0058+) → P-INT do R1 (`chore(release): fechar o R1 da reconstrução`).

**F-R2 — sequencial, nesta ordem**
```
 1  build(deps): instalar o SDK da Anthropic fixado para o R2
 2  refactor(db): mover as mutações para pasta com reexportador único
 3  feat(schema): listas fechadas, tabelas lojas_ia_usos e lojas_sla e prazo de SLA por loja
 4  feat(schema): gerar as migrações 0019 e 0020 do R2 com integridade e trilha de uso
 5  feat(db): escritas de pagamento, pesquisa, transcrição e uso de IA na porta única
 6  feat(auth): famílias de permissão do R2 e fim da matriz de fase futura
 7  feat(acoes): embrulho sem transação para chamada a provedor externo
 8  fix(seguranca): saída para os provedores do R2, salto sem credencial e balde de máquina só após a assinatura
 9  feat(nucleo): variáveis do R2 desligadas por padrão e validadas no boot
10  feat(fila): filas pos-venda, pagamentos e ia e alertas a cada 5 minutos
11  feat(ui): navegação, selos, ícones e lista de block do R2
12  feat(costuras): arquivos-costura do R2 com assinatura final
13  refactor(conversas): costuras do R2 no envio, na ingestão e no composer
14  refactor(lgpd): opt-out vigente e anonimização dos campos do R2
15  refactor(midias): leitura de bytes para transcrição e busca do Messenger
16  refactor(pedidos): negócio ganho, cobrança e troca no pedido
17  refactor(integracoes): cartões do R2 e conferência dos canais extras
18  refactor(campanhas): materialização pelo opt-out vigente
19  refactor(usuarios): ator de sistema fora da administração
20  refactor(alertas): fontes do R2, rótulos e prazos vigentes
21  docs(adr): registrar as decisões 0031 a 0057 do R2
22  docs(repo): regras, caminhos de acesso e runbook do R2
```

**Onda 3 — em paralelo; dentro de cada pacote, na ordem da §3** (R2-A 12, R2-B 10, R2-C 8, R2-D 10, R2-E 7 commits). Escopos: `negocios`, `funil`, `devolucoes`, `trocas`, `pesquisas`, `satisfacao`, `pagamentos`, `conhecimento`, `inteligencia`, `canais`, `webhooks`, `integracoes`, `configuracoes`, `canais-extras`, `lookbooks`, `sla`. Um pacote nunca commita arquivo de outro; `git status` com arquivo alheio = não commita e avisa.

**P-INT-R2 — fechamento (um agente, pode tocar qualquer arquivo só para corrigir)**
```
 1  test(travas): ligar as telas do R2 no block e subir os pisos
      - block-3s: telasLigadas + negar-troca, concluir-troca, gerar-cobranca,
        cancelar-cobranca, publicar-artigo, enviar-lookbook, salvar-prazos-de-sla
        (e excluir-registro, se faltar); PISO_DE_TELAS_LIGADAS sobe junto
      - tests/travas/piso.json: actions, handlers e módulos com os números novos
      - caminhos-de-acesso.md: todo "pacote R2-x" → "entregue"; T2 estrito
 2  fix(integracao): correções cruzadas do R2 apontadas pela verificação completa
      - npm run verificar; db-teste sem sufixo + test:integracao completo
      - fluxos manuais que não rodaram nos pacotes (§4), em série na 3005:
        venda → cobrança simulada → pago → troca → estorno registrado → devolvido;
        CSAT com CSAT_ATIVO=true; IA simulada; Messenger/TikTok por webhook simulado
      - npm run build + npm run worker juntos; npm audit; gitleaks
      - skill /audit-auth-security (webhooks novos, OAuth do TikTok, conta de pagamento)
      - scripts/fumaca-seguranca.mjs com as 4 rotas públicas novas
 3  docs(repo): sincronizar documentação do R2 e gerar o mapa do projeto
 4  chore(release): fechar o R2 da reconstrução
```

Depois do P-INT-R2 e do deploy em HML (com backup antes de PRD): conferências datadas do Mercado Pago (token `TEST-`), do Messenger (página real) e do TikTok (se aprovado); só então `PAGAMENTOS_MERCADOPAGO=producao` em PRD. `CSAT_ATIVO`, `IA_*` e `IA_CLASSIFICACAO_AUTOMATICA` só mudam com resposta escrita do cliente (§7).

---

## 6. Riscos e planos B

| Risco | Sinal | Plano B |
|---|---|---|
| DF1 commitada com ADRs 0031+ | `ls docs/adr` mostra 0031 que não é do R2 | deslocamento +k no FR14 com a tabela de equivalência no `README.md` (C1); construtores usam o número do repo |
| DF1 muda de forma (nome de `contextoDeSistema`, tipo de contexto, diário) | P2/P3/P5 falham | o F-R2 **para**; a §2.1 é reescrita pelo orquestrador contra o código real; nenhum construtor adapta sozinho |
| Contrato de M1 diferente do FR13.1 (ordem de reabertura, `registrarEnvio` enfileirando antes do commit, recusa de janela ausente) | `pesquisas-ingestao`, `pagamentos-envio` ou `lookbooks-envio` vermelhos | o pacote para e reporta; a correção vai para M1 via orquestrador (commit `fix(conversas)`), nunca contorno no pacote |
| Três pacotes dependem do composer/DTO de M1 ao mesmo tempo | componentes do R2 não aparecem na tela | os slots nascem no FR13.1 com as costuras vazias; cada pacote só preenche o seu arquivo |
| `tons.ts`, `navegacao.ts` ou `block-3s` precisam de ajuste durante a onda | pacote pede mudança em arquivo de fundação | orquestrador aplica, commita `fix(ui)` e avisa os cinco; ninguém edita |
| `mutacoes.ts` passa de 499 linhas de novo | compliance vermelho | a pasta existe: função nova vai para o arquivo do domínio dentro dela (F-R2 ou P-INT) |
| Migração `0019_r2` gerada com predicado parametrizado | `grep "= \$"` acha linha | refazer com `sql.raw`/literal no schema e gerar de novo (a migração ainda não saiu da branch) |
| Mercado Pago com contrato diferente do `config.ts` | conferência em HML falha | `producao` não liga; ajuste só no `config.ts` e nas fixtures, com trava T-PG-12 garantindo o isolamento |
| App TikTok nunca aprovado para um lojista | sem `TIKTOK_APP_ID` | canal fica desligado e testado; ADR 0051 já prevê; nenhuma tela promete |
| Meta exigir revisão para `HUMAN_AGENT` | recusa em HML | uma linha em `regras-de-envio.ts` (sem `horasAgenteHumano`); composer bloqueia depois de 24 h |
| Cliente não autoriza enviar conversa a terceiro | sem resposta à pergunta 1 da §7 | IA e transcrição continuam desligadas; base de conhecimento funciona sozinha |
| `zodOutputFormat` incompatível com Zod 4.6 | typecheck do FR1 ou do R2-C | plano B do final R2-C §6.2, sem trocar versão |
| Dois `next dev` no mesmo diretório | erro de lock ou `.next` corrompido | fluxo manual vai para o P-INT-R2 (§4) |
| Gerador de alertas a cada 5 min mais lento que o intervalo | log de duração de `gerar-alertas` com p95 > 60 s | regra de SLA em job próprio, com ADR novo (ADR 0057 já prevê) |
| R2-A grande demais para um agente | atraso relativo aos outros quatro | A3 vira sexto agente (banco `r2a3`, Redis 18, porta 3026); não há arquivo comum |
| Teste de integração de um pacote pegando tabela que outro pacote ainda não preencheu | falha intermitente | cada pacote roda só o seu prefixo e cria os próprios dados; o teste completo é do P-INT-R2 |

---

## 7. Perguntas ao cliente (as decisões conservadoras que os ADRs registraram)

O sistema entra no ar com a resposta padrão da coluna "vale hoje". Mudar qualquer uma **não** exige schema, salvo onde está escrito.

| # | Pergunta | Vale hoje | ADR |
|---|---|---|---|
| **Pós-venda** | | | |
| 1 | Aprovam o texto da pesquisa de satisfação (e das respostas "obrigada" e "você saiu da lista")? | CSAT desligado | 0034 |
| 2 | O "SAIR" da pesquisa vale para as outras lojas da marca? | só para a loja da pesquisa | 0034 |
| 3 | Querem uma palavra-chave de opt-out fora da pesquisa (qualquer conversa)? | não | 0034 |
| 4 | A "Receita" dos relatórios deve descontar pedido devolvido? | não desconta | 0032 |
| 5 | O prazo de troca de 7 dias é aviso (como hoje) ou deve bloquear? | aviso (arrependimento e vício são direito de lei) | 0032 |
| **Pagamentos** | | | |
| 6 | Pedir e-mail (e CPF, se o Mercado Pago exigir) em todo Pix atrapalha o balcão? | pede quando o provedor exige | 0041 |
| 7 | Cada loja terá a própria conta e a própria aplicação no Mercado Pago? | uma conta e uma aplicação por loja (duas lojas na mesma aplicação é desaconselhado) | 0036 |
| 8 | Querem mensagem automática "recebemos seu pagamento"? | não | 0041 |
| 9 | Precisam de Asaas ou PagBank? | não (só Mercado Pago) | 0037 |
| **Inteligência** | | | |
| 10 | Podemos enviar trechos de conversa (sem telefone, e-mail ou documento) à Anthropic e áudios pedidos à OpenAI? O aviso de privacidade da Merlo cita esses suboperadores? | **tudo desligado** | 0042 |
| 11 | Transcrição automática de todo áudio, ou só quando a vendedora pede? | só quando pede | 0045 |
| 12 | O limite de US$ 2,00 por loja por dia serve? | 2,00 | 0044 |
| 13 | Ligamos a classificação automática das conversas? | desligada | 0046 |
| 14 | Só gerente para cima escreve na base de conhecimento? | gerente+ | 0047 |
| 15 | Alguma cliente pode pedir "não usar IA com meus dados"? | não há como marcar (**exige coluna nova** + ADR) | 0048 |
| 16 | As respostas rápidas devem servir de fonte para a IA? | não | 0048 |
| 17 | Áudio em MP3 chega com frequência? | não transcreve | 0045 |
| **Canais extras** | | | |
| 18 | Usam Messenger hoje? Quantas páginas, em quais lojas? Respondem pelo Meta Business Suite (essas respostas não aparecem no sistema)? | Messenger pronto para ligar; responder só pelo sistema | 0050 |
| 19 | Vendem no TikTok Shop? (se sim: ligar a extensão do Bling, não este sistema) | TikTok Shop fora | 0051 |
| 20 | A conta comercial do TikTok é registrada no Brasil? Há app aprovado? | TikTok DM desligado | 0051 |
| **Lookbooks e SLA** | | | |
| 21 | Querem preço no texto do lookbook? | sem preço (CDC art. 30; catálogo pode estar velho) | 0055 |
| 22 | Querem lookbook em campanha, ou por Messenger/TikTok? | só pela conversa, WhatsApp e Instagram | 0055 |
| 23 | O SLA deve contar só em horário comercial? | 24 h por dia (**horário comercial exige colunas novas**) | 0056 |
| 24 | A regra de prioridade deve substituir a do canal, em vez de "vale o menor"? | vale o menor | 0056 |
| 25 | Querem aviso antes de estourar o SLA, ou por e-mail/push? | não; sino e `/alertas`, conferência a cada 5 min | 0057 |
