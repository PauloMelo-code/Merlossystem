# ADR 0016 — Sem conta de ambiente: conversas.integracao_id NOT NULL

Data: 16/09/2026
Status: Aceito

## Contexto

No sistema antigo, a conversa nao guardava por qual numero ela entrou. Quando a
loja passou a ter dois numeros, a resposta saia pelo numero "padrao", que era
uma variavel de ambiente. A cliente mandava mensagem para o numero do pos-venda
e recebia resposta do numero de vendas, de outra conversa.

## Decisao

`conversas.integracao_id` e **NOT NULL** e tem FK composta com `loja_id`. Nao
existe numero padrao, nao existe conta de ambiente, e nao existe caminho em que
o sistema escolha o numero sozinho.

Falha FECHADA: evento que chega sem que a conta seja resolvida vira linha em
`lojas_integracoes_eventos` com `erro` preenchido, e o webhook devolve 200 (o
provedor nao deve reentregar para sempre). O evento fica no diario de ingestao
para alguem olhar: nao some, e nao vira mensagem no numero errado.

## Consequencias

- A semente de desenvolvimento cria DOIS numeros na mesma loja, de proposito: e
  a massa que revela este defeito no primeiro teste manual.
- A tela de conversa mostra por qual numero a conversa entrou.
