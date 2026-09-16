# ADR 0013 — LGPD por anonimizacao, nao por exclusao fisica

Data: 16/09/2026
Status: Aceito

## Contexto

O artigo 18 da a titular o direito de pedir a eliminacao dos dados. A leitura
ingenua e apagar a linha do contato, e ela quebra tres coisas ao mesmo tempo: o
pedido fiscal deixa de ter cliente, a trilha de auditoria fica apontando para
um id que nao existe, e a regra da casa "nenhum delete fisico" cai.

## Decisao

Anonimizacao, em ordem fixa (`01-dados-dominio.md` secao 8):

1. trilha `lgpd_anonimizado` em `auditoria_eventos` ANTES do efeito, porque o
   efeito destroi o estado anterior e trilha depois seria trilha nenhuma;
2. os `UPDATE`s: nome vira "Titular anonimizado", telefone e e-mail viram
   nulos, identificadores de canal viram nulos, `anonimizado_em` e carimbado;
3. conteudo de mensagem de texto da titular vira o marcador
   "[removido a pedido do titular]";
4. o binario no MinIO sai FORA da transacao, pelo job idempotente
   `manutencao/limpar-midia`. Objeto ausente e sucesso.

O pedido, o valor e a data ficam: sao obrigacao fiscal, e o vinculo passa a
apontar para um contato sem identidade.

## Consequencias

- E a UNICA exclusao fisica do sistema, e ela e de arquivo, nao de linha.
  Nenhum papel de banco extra, nenhuma string de conexao a mais, e o hook de
  pre-write e a trava T25 seguem em enforcement total.
- O marcador de conteudo deixa a tela honesta: a atendente ve que houve
  mensagem e que ela foi removida a pedido, em vez de um vazio inexplicavel.
