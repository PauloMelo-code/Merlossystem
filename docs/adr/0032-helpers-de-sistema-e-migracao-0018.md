# ADR 0032 — Helpers de sistema em `mutacoes-sistema.ts` e listas fechadas da 0018

Data: 16/09/2026
Status: Aceito

## Contexto

A onda 2 provou lacunas na camada de gravacao e nas listas fechadas:

- sem helper para os INSERTs com `ON CONFLICT` sobre indice unico parcial
  (diario de ingestao, alerta com dedupe, destinatarios de campanha), os
  pacotes usaram `execute(sql)` ou uma linha de trilha por destinatario;
- `registrarProcessamentoEvento` (01-dados 6.4) nao existia; M1 e M5 criaram
  copias divergentes;
- `atualizarComTrava` gravava a trilha sempre DEPOIS do UPDATE e sem motivo,
  mas 01-dados 7.4 exige trilha ANTES em cancelamento, dispensa do Masc e
  acoes administrativas destrutivas;
- `violacaoDeTelefone` olhava so `e.code`; o Drizzle 0.45 embrulha o erro do
  `pg` em `e.cause`, e o passo 2 de `upsertContatoPorCanal` nunca rodava;
- o CHECK `lojas_integracoes_templates_nome` usava `{1,512}`, que o Postgres
  recusa (limite de repeticao 255): nenhum INSERT de modelo funcionava;
- faltavam acoes de trilha, um tipo de alerta e colunas de estado de sistema.

## Decisao

1. `src/lib/db/mutacoes-sistema.ts` e a extensao de `mutacoes.ts`, liberada pela
   trava `tests/travas/mutacoes.test.ts` e reexportada por `mutacoes.ts` (quem
   chama importa de `@/lib/db/mutacoes`). Ela nao importa valor de
   `mutacoes.ts`, para nao haver ciclo. Contem `registrarEventoDeIngestao`,
   `abrirAlerta`, `inserirDestinatariosEmLote` (uma linha de trilha pelo lote)
   e `anonimizarTitular` (ADR 0033).
2. Em `mutacoes.ts`: `registrarProcessamentoEvento` (sem projecao, o corpo vira
   `{ mascarado: true }`; em `falhou` o cru fica), `registrarConsentimentoBase`
   (INSERT em `consentimentos` + espelho `contatos.opt_out` na mesma transacao;
   a regra do que `concedido` significa fica no modulo de contatos),
   `atualizarComTrava(..., { trilhaAntes, motivo })` e `violacaoDeTelefone`
   olhando `e` e `e.cause`.
3. Migracao 0018: o CHECK do nome de modelo vira
   `nome ~ '^[a-z0-9_]+$' AND char_length(nome) <= 512`; `ACOES_AUDITADAS`
   ganha `conversa_criada`, `conversa_arquivada`, `mensagem_recebida`,
   `midia_recebida`, `midia_alterada`, `pedido_rastreio_informado`,
   `campanha_alterada`, `template_criado|alterado|excluido|pausado`,
   `resposta_rapida_criada|alterada|excluida`,
   `agendamento_criado|reagendado|cancelado`, `alerta_reconhecido` e
   `convite_expirado`; `TIPOS_ALERTA` ganha `espelho_divergente`.
4. `ESTADOS_DE_SISTEMA` ganha `conversas_mensagens.externo_id`,
   `conversas_mensagens_midias.(midia_id, baixada, url_externa)`,
   `alertas.resolvido_em` e `lojas_integracoes_eventos.ip`. A tabela de anexos
   continua "ligacao pura" para pessoas; so o job `baixar-de-url` a completa.
5. Tipos sem migracao: `MetadadosMensagem` ganha `modelo` e
   `enviada_pelo_aparelho`; `DetalhesAuthEvento` ganha `ciencia_versao` e
   `motivo` (codigo curto, nunca texto livre); `CAMPOS_PII` ganha
   `lgpd_solicitacoes.motivo`.
6. A recusa de alvo administrativo continua respondendo `SEM_PERMISSAO`. Nao
   existe `ALVO_NAO_PERMITIDO`: um codigo proprio diria a quem sonda que o alvo
   existe (oraculo).

## Consequencias

- `mutacoes.ts` fica abaixo de 500 linhas; a extensao tem nome e trava.
- Cada helper tem teste de efeito real em `tests/integracao/mutacoes-*.test.ts`
  (conflito do indice parcial, ordem da trilha por espiao de chamadas,
  `e.cause` do erro real do Drizzle).
- Ampliar lista fechada continua exigindo migracao do CHECK.
