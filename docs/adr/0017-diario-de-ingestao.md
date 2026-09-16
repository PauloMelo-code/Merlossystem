# ADR 0017 — lojas_integracoes_eventos como diario de ingestao, com corpo mascarado ao processar

Data: 16/09/2026
Status: Aceito

## Contexto

Guardar o corpo cru do webhook e o que permite reprocessar e investigar. Guardar
o corpo cru PARA SEMPRE e um segundo banco de conversas, sem portao, sem escopo
de loja e sem retencao: o pior dos dois mundos.

## Decisao

1. A tabela e NORMAL (cinco colunas de auditoria, nenhum marcador), porque a
   aplicacao precisa marcar `processado_em` e mascarar o corpo. Nem REVOKE nem
   gatilho de trilha entram aqui.
2. Ao terminar com sucesso, `registrarProcessamentoEvento()` grava
   `processado_em` e SUBSTITUI `corpo` pela projecao mascarada, no MESMO
   `UPDATE`. Dois comandos deixariam uma janela em que o corpo cru sobrevive ao
   processamento.
3. Retencao de 30 dias por ANONIMIZACAO de `corpo`, `cabecalhos` e `ip`, pelo
   job diario `manutencao/retencao-eventos`. Nenhuma linha e apagada, e nenhum
   papel de banco extra e necessario.
4. `integracao_id` e `loja_id` ficam SEM FK: o evento e gravado antes de a conta
   ser resolvida, e o diario tem de aceitar ate o webhook que chegou no endereco
   errado, que e justamente o que serve de prova.
5. `cabecalhos` e lista branca. `authorization` nunca entra.

## Consequencias

- A idempotencia de webhook fica no unico `(provedor, evento_externo_id)`, e e
  ele que impede o evento repetido de virar duas mensagens.
