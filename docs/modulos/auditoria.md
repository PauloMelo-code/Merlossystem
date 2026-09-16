# Módulo de alertas, auditoria e relatórios (pacote M8)

Os painéis de gestão e a manutenção que os alimenta. Fontes: `01-dados.md §6.6
e §7`, `01-dados-dominio.md §7.2`, `03-arquitetura.md §8.1`, `04-ui.md §5.5`.

## Tabelas

| Tabela | Uso |
|---|---|
| `alertas` | um alerta por (loja, chave de dedupe) aberto; o gerador abre e RESOLVE, a pessoa só reconhece |
| `auditoria_eventos` | só leitura: trilha de negócio (a escrita é `src/lib/auditoria/gravador.ts`, da fundação) |
| `auth_eventos` | só leitura: trilha de acesso da aba "Acessos" |
| `lojas_integracoes_eventos` | retenção de 30 dias por ANONIMIZAÇÃO (`UPDATE`), nunca exclusão |
| `usuarios_convites` | `expirar-convites` fecha o vencido por exclusão lógica, pela porta `fecharConviteVencido` da fundação |
| `conversas`, `conversas_mensagens`, `contatos`, `pedidos`, `conversas_agendamentos`, `lojas_integracoes`, `consentimentos` | só leitura: fontes dos alertas, dos indicadores e da reconciliação |

## Onde mora

| Caminho | Papel |
|---|---|
| `src/lib/alertas/regras.ts` | SLA por canal (constante), tipos gerados no R1, severidade, chave de dedupe, mensagem e rota do alerta. Puro |
| `src/lib/alertas/_consultas.ts` | uma consulta por tipo (detecção = reavaliação), abertos, lista e contadores da tela |
| `src/lib/alertas/gerador.ts` | job `gerar-alertas`: abre, resolve, sincroniza `conversas.sla_estourado_em` |
| `src/lib/alertas/escrita.ts` | as três gravações de `alertas`: `abrir` (`abrirAlerta`), `resolver` (`atualizarEstado` em `resolvido_em`) e `reconhecer` (`atualizarComTrava`, trilha `alerta_reconhecido`) |
| `src/lib/alertas/reconciliacao.ts` | espelho `opt_out` × `consentimentos` e contadores × `pedidos`; abre e resolve alerta `espelho_divergente`, não corrige o dado |
| `src/lib/auditoria/consulta.ts` | trilha de negócio: lista por cursor, detalhe com diff, pessoas do filtro |
| `src/lib/auditoria/apresentacao.ts` | máscara de PII e de segredo NA SAÍDA, rótulo de ação e de entidade. Puro |
| `src/lib/auditoria/qualidade.ts` | os quatro indicadores por pessoa e a lista de ocorrências |
| `src/lib/auditoria/excluidos.ts` | registros com `is_deleted = true`, por entidade de uma lista fechada |
| `src/lib/auditoria/seguranca.ts` | trilha de acesso: listagem sem IP, detalhe com IP |
| `src/lib/auditoria/retencao.ts` | `retencao-eventos` e `expirar-convites` (`fecharConvitesVencidos`, com `contextoDeSistema`) |
| `src/lib/auditoria/cursor.ts` | cursor `(instante, id)` das listas do pacote |
| `src/lib/relatorios/definicoes.ts` | as métricas, a definição de cada uma e a formatação. Puro |
| `src/lib/relatorios/_consultas.ts` | indicadores, série diária (dia de São Paulo) e nome do escopo |
| `src/lib/relatorios/csv.ts` | CSV com `;`, BOM e proteção contra fórmula. Puro |
| `src/lib/relatorios/resumo.ts` | job `resumo-diario` (sai no log; não há provedor de e-mail ainda) |
| `src/lib/actions/{alertas,auditoria,relatorios}.ts` | actions; as páginas chamam estas funções no servidor |
| `src/lib/validadores/{alertas,auditoria,relatorios}.ts` | filtros da URL (valor fora da lista vira "sem filtro") e período |
| `src/server/processadores/manutencao.ts` | fila `manutencao`: só traduz o job para o domínio. `limpar-midia` aceita `{ lojaId, solicitacaoId?, midiaIds? }` |

## Telas

| Rota | Chave | O que faz |
|---|---|---|
| `/alertas` | `alertas:ler` (`alertas:reconhecer` para agir) | abertos por cursor, contadores, filtros; prazos de SLA como texto |
| `/relatorios` | `relatorios:ler` (`relatorios:exportar` para o CSV) | cabeçalho com loja e período, 7 métricas com "?", gráficos e tabela alternativa |
| `/auditoria` | `trilha:ler` | trilha de negócio com filtros e detalhe (`?evento=`) |
| `/auditoria/qualidade` | `trilha:ler` | erros por pessoa, ordenável, com ocorrências (`?indicador=&pessoa=`) |
| `/auditoria/excluidos` | `trilha:ler` | somente leitura; leva ao histórico na trilha |
| `/auditoria/seguranca` | `seguranca:ler_eventos` | trilha de acesso; gerente não alcança |

Os filtros são `<form method="get">` nativo: estado na URL, sem JavaScript.

## Actions

| Action | Chave | Faz |
|---|---|---|
| `centralDeAlertas` | `alertas:ler` | página, contadores, prazos de SLA e `podeReconhecer` |
| `reconhecerAlerta` | `alertas:reconhecer` | marca ciência com trava de colisão e trilha `alerta_reconhecido` |
| `trilhaDeNegocio` | `trilha:ler` | trilha paginada, pessoas e ações do filtro |
| `eventoDaTrilha` | `trilha:ler` | detalhe com diff mascarado |
| `qualidadePorPessoa` | `trilha:ler` | os quatro indicadores por pessoa |
| `ocorrenciasDaPessoa` | `trilha:ler` | até 100 ocorrências de um indicador |
| `registrosExcluidos` | `trilha:ler` | excluídos por entidade e período |
| `trilhaDeAcesso` | `seguranca:ler_eventos` | trilha de acesso paginada |
| `eventoDeAcesso` | `seguranca:ler_eventos` | detalhe com IP e navegador |
| `relatorioDoPeriodo` | `relatorios:ler` | cartões formatados, série e `podeExportar` |
| `exportarRelatorioCsv` | `relatorios:exportar` | o mesmo relatório em CSV |

## Regras que não mudam

- **Quem resolve alerta é o gerador.** Reconhecer só marca ciência. Alerta
  reconhecido cuja condição continua valendo não duplica; quando a condição some,
  o gerador carimba `resolvido_em`; se ela voltar, nasce um alerta novo.
- **Dedupe no banco**: único parcial `(loja_id, chave_deduplicacao) WHERE
  resolvido_em IS NULL AND is_deleted = false`. Chave = `tipo|objeto|id`.
- **Autor**: abrir e resolver gravam como `ATOR_SISTEMA`, sem trilha (estado
  de sistema). Reconhecer grava a pessoa em `reconhecido_por` e na trilha.
- **"Sem resposta"** = nenhuma mensagem de saída (nota interna não conta) desde
  `ultima_entrada_em`. Ler não é responder.
- **SLA** (constante): WhatsApp 5 min, Instagram 15, Facebook 30, TikTok 60.
  Risco de avaliação: Instagram/Facebook sem resposta há 2 h.
- **Tipos gerados no R1**: `sla_estourado`, `risco_avaliacao`, `primeiro_contato`,
  `cliente_retornando`, `follow_up_atrasado`, `sessao_uazapi_caiu` (só número
  que já sincronizou), `integracao_com_erro`. `negocio_parado` e
  `pagamento_pendente` ficam no CHECK, fora do gerador: funil e pagamentos estão
  fora do R1. A conta Bling da rede (sem loja) não gera alerta: `alertas.loja_id`
  é obrigatório.
- **Mensagem do alerta sem PII** (aparece no sino da loja inteira).
- **Retenção**: `corpo = {"anonimizado":true}`, `cabecalhos = {}`, `ip = null`,
  por lote, nenhuma linha some. Idempotente (linha antiga com `ip` também entra).
- **Reconciliação não corrige**: correção silenciosa esconde o defeito. Cada
  divergência vira um alerta `espelho_divergente` (chave
  `espelho_divergente|opt_out|<contato>` ou `...|contadores|<contato>`;
  severidade crítica para opt-out, média para contadores). A reconciliação é o
  gerador desse tipo: resolve o alerta quando a divergência some.
- **Convite vencido**: `expirar-convites` fecha por exclusão lógica, com trilha
  `convite_expirado` do `ATOR_SISTEMA`, e libera o e-mail para um convite novo.
- **`limpar-midia` da LGPD**: remove os objetos na hora (sem esperar os 90 dias)
  e grava a contagem por `registrarObjetosRemovidos` (M2). Ids e solicitação
  fora do formato uuid são ignorados.
- **Gráficos**: `var(--chart-1..5)` de `globals.css`, sem fallback.
- **Trilha**: sem ação de exclusão, edição ou restauração em lugar nenhum. Campo
  de `CAMPOS_PII` aparece como `(alterado)`; chave de segredo não aparece. A
  máscara é repetida na saída (defesa em profundidade).
- **Acessos**: e-mail só como `email_hash`; IP e navegador só no detalhe.
- **Qualidade**: exatamente quatro indicadores, com fonte real. A recusa 403 não
  tem loja: com uma loja escolhida, conta para quem é daquela loja.
- **Relatórios**: Receita = soma de `pedidos.total` com `masc_status =
  'lancado'`, pelo `masc_lancado_em` do período. Tempo de primeira resposta =
  mediana de `primeira_resposta_em − created_at` das conversas abertas no
  período e já respondidas. Dia = dia de São Paulo (deslocamento fixo -03:00).

## Testes

- `tests/unidade/auditoria-apresentacao.test.ts`, `tests/unidade/relatorios-regras.test.ts`,
  `tests/unidade/auditoria-manutencao.test.ts` (carga da fila `manutencao`)
- `tests/integracao/alertas-gerador.test.ts`, `tests/integracao/auditoria-leituras.test.ts`,
  `tests/integracao/relatorios-indicadores.test.ts` (apoio: `tests/integracao/auditoria-apoio.ts`)
- `tests/componentes/auditoria-telas.test.tsx`, `tests/componentes/alertas-telas.test.tsx`

```
node scripts/db-teste.mjs --sufixo m8
DATABASE_URL=postgres://dev:dev@localhost:5437/merlostore_test_m8 DATABASE_URL_TESTE=postgres://dev:dev@localhost:5437/merlostore_test_m8 REDIS_URL=redis://localhost:6382/8 npm run test:integracao
```
