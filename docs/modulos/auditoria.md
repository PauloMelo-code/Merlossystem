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
| `conversas`, `conversas_mensagens`, `contatos`, `pedidos`, `conversas_agendamentos`, `lojas_integracoes`, `consentimentos`, `usuarios_convites` | só leitura: fontes dos alertas, dos indicadores e da reconciliação |

## Onde mora

| Caminho | Papel |
|---|---|
| `src/lib/alertas/regras.ts` | SLA por canal (constante), tipos gerados no R1, severidade, chave de dedupe, mensagem e rota do alerta. Puro |
| `src/lib/alertas/_consultas.ts` | uma consulta por tipo (detecção = reavaliação), abertos, lista e contadores da tela |
| `src/lib/alertas/gerador.ts` | job `gerar-alertas`: abre, resolve, sincroniza `conversas.sla_estourado_em` |
| `src/lib/alertas/escrita.ts` | a PORTA das três gravações de `alertas` (ver Bloqueios) |
| `src/lib/alertas/reconciliacao.ts` | espelho `opt_out` × `consentimentos` e contadores × `pedidos`; acha, registra, não corrige |
| `src/lib/auditoria/consulta.ts` | trilha de negócio: lista por cursor, detalhe com diff, pessoas do filtro |
| `src/lib/auditoria/apresentacao.ts` | máscara de PII e de segredo NA SAÍDA, rótulo de ação e de entidade. Puro |
| `src/lib/auditoria/qualidade.ts` | os quatro indicadores por pessoa e a lista de ocorrências |
| `src/lib/auditoria/excluidos.ts` | registros com `is_deleted = true`, por entidade de uma lista fechada |
| `src/lib/auditoria/seguranca.ts` | trilha de acesso: listagem sem IP, detalhe com IP |
| `src/lib/auditoria/retencao.ts` | `retencao-eventos` e a contagem de convites vencidos |
| `src/lib/auditoria/cursor.ts` | cursor `(instante, id)` das listas do pacote |
| `src/lib/relatorios/definicoes.ts` | as métricas, a definição de cada uma e a formatação. Puro |
| `src/lib/relatorios/_consultas.ts` | indicadores, série diária (dia de São Paulo) e nome do escopo |
| `src/lib/relatorios/csv.ts` | CSV com `;`, BOM e proteção contra fórmula. Puro |
| `src/lib/relatorios/resumo.ts` | job `resumo-diario` (sai no log; não há provedor de e-mail ainda) |
| `src/lib/actions/{alertas,auditoria,relatorios}.ts` | actions; as páginas chamam estas funções no servidor |
| `src/lib/validadores/{alertas,auditoria,relatorios}.ts` | filtros da URL (valor fora da lista vira "sem filtro") e período |
| `src/server/processadores/manutencao.ts` | fila `manutencao`: só traduz o job para o domínio |

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

## Regras que não mudam

- **Quem resolve alerta é o gerador.** Reconhecer só marca ciência. Alerta
  reconhecido cuja condição continua valendo não duplica; quando a condição some,
  o gerador carimba `resolvido_em`; se ela voltar, nasce um alerta novo.
- **Dedupe no banco**: único parcial `(loja_id, chave_deduplicacao) WHERE
  resolvido_em IS NULL AND is_deleted = false`. Chave = `tipo|objeto|id`.
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
- **Retenção**: `corpo = {"anonimizado":true}`, `cabecalhos = {}`, por lote,
  nenhuma linha some. Idempotente.
- **Reconciliação não corrige**: correção silenciosa esconde o defeito.
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

## Bloqueios (dependem da fundação)

1. **Gravação de `alertas`** — `src/lib/db/mutacoes.ts` não tem (a) `abrirAlerta`
   (`INSERT ... ON CONFLICT ... WHERE resolvido_em IS NULL AND is_deleted =
   false DO NOTHING`, sem trilha), (b) `alertas.resolvido_em` em
   `ESTADOS_DE_SISTEMA` para `atualizarEstado`, (c) ação `alerta_reconhecido` em
   `ACOES_AUDITADAS` (migração do CHECK) para `atualizarComTrava`. Até lá
   `escritaDeAlertas` falha alto (`NAO_IMPLEMENTADO`), o job `gerar-alertas` vai
   para a DLQ depois de sincronizar o carimbo de SLA, e o botão "Reconhecer" não
   aparece (`ESCRITA_DISPONIVEL = false`). A troca é em `escrita.ts`, só lá; o
   teste `tests/integracao/alertas-gerador.test.ts` já prova as regras com uma
   gravação equivalente.
2. **Reconciliação gera alerta** — `TIPOS_ALERTA` não tem tipo para divergência
   de espelho. Hoje sai log `error` com os ids.
3. **Retenção do `ip`** — `ESTADOS_DE_SISTEMA.lojas_integracoes_eventos` não
   inclui `ip`; o `ip` fica até a lista crescer.
4. **`expirar-convites`** — o convite vencido já não é aceito, mas continua
   segurando o único parcial do e-mail. Fechá-lo é gravação em tabela de auth,
   sem ação auditada; o job só conta e avisa.
5. **`limpar-midia` da LGPD** — `objetos_removidos` de `lgpd_solicitacoes` não
   tem gravação exposta pelo módulo LGPD; sai no log.
6. **`--chart-1..5`** não existem em `globals.css`; o gráfico cai na cor primária.

## Testes

- `tests/unidade/auditoria-apresentacao.test.ts`, `tests/unidade/relatorios-regras.test.ts`
- `tests/integracao/alertas-gerador.test.ts`, `tests/integracao/auditoria-leituras.test.ts`,
  `tests/integracao/relatorios-indicadores.test.ts` (apoio: `tests/integracao/auditoria-apoio.ts`)
- `tests/componentes/auditoria-telas.test.tsx`, `tests/componentes/alertas-telas.test.tsx`

```
node scripts/db-teste.mjs --sufixo m8
DATABASE_URL=…/merlostore_test_m8 DATABASE_URL_TESTE=…/merlostore_test_m8 REDIS_URL=redis://localhost:6382/8 npm run test:integracao
```
