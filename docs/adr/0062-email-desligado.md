# ADR 0062 — E-mail desligado como modo de operação

Data: 16/09/2026
Status: Aceito

## Contexto

O provedor de e-mail transacional ainda não foi escolhido. `src/lib/env.ts`
exigia `EMAIL_PROVEDOR`, `EMAIL_REMETENTE` e `EMAIL_API_KEY` em produção, e
com qualquer valor o transporte recusava o provedor desconhecido: o sistema não
subia sem as três chaves e, subindo, todo e-mail de segurança ia para a DLQ com
alerta. Na prática, o deploy não tinha como ficar de pé.

## Decisão

`EMAIL_PROVEDOR=desligado` é aceito em qualquer ambiente, e dispensa
`EMAIL_REMETENTE` e `EMAIL_API_KEY`. Em produção `EMAIL_PROVEDOR` continua
obrigatória: ou o nome do provedor, ou `desligado`, escrito de propósito. Fora
de produção, a variável ausente vale como `desligado`.

Com o e-mail desligado:

1. **Convite**: a tela mostra o link UMA vez a quem convidou (action com
   sessão fresca), com o aviso de entregar por canal seguro. O link não é
   guardado em lugar nenhum: o banco tem só o hash, e o link não entra na fila.
   Reenviar gera link novo e invalida o anterior na mesma transação.
2. **Esqueci a senha**: o servidor responde igual para toda conta, como
   sempre. A tela não promete link: orienta procurar o administrador da loja,
   que faz a recuperação assistida.
3. **Avisos de conta** (senha alterada, fator ou chave de acesso adicionados ou
   removidos, e-mail trocado, conta bloqueada, recuperação assistida): viram
   alerta `aviso_seguranca` no sino. Só dono e admin o veem, em qualquer loja
   escolhida; gerente, vendedor e somente leitura não o veem nem o reconhecem.
   O alerta fica ancorado na loja da pessoa ou, para quem não tem loja, na
   primeira loja viva, porque `alertas.loja_id` é obrigatório.
4. **Token**: nunca vai para log, fila, DLQ nem alerta. Um job com link que
   estava na fila antes de desligar é descartado pelo worker sem ler o link.

Onde mora:

- `emailDesligado()` e o retorno antecipado da fila: `src/lib/auth/emails.ts`;
- o aviso no sino: `src/lib/auth/avisos-no-sino.ts`, chamado pelo processador
  `src/server/processadores/emails.ts`;
- quem vê o aviso: `src/lib/alertas/visibilidade.ts`, usado pelo sino
  (`src/app/(app)/layout.tsx`) e pela central `/alertas`;
- o tipo novo: `TIPOS_ALERTA` e a migração `0021_aviso_seguranca`.

## Alternativas consideradas

- **Exigir um provedor antes do deploy**: trava a entrega por uma decisão
  comercial que ainda não foi tomada.
- **Mandar o link para o log**: proibido pela régua de segurança (token em log).
- **Mostrar o aviso a toda a equipe da loja**: o aviso fala da conta de outra
  pessoa, inclusive de dono e admin. Fica com quem administra contas.
- **Coluna `loja_id` opcional em `alertas`**: mexe na consulta de todas as
  telas de alerta para resolver um caso só. A loja-âncora resolve sem migração
  de estrutura.

## Consequências

- O deploy sobe sem provedor de e-mail.
- A troca de e-mail feita pela própria pessoa depende do código enviado ao
  endereço novo. Com o e-mail desligado esse código não chega: o pedido vence
  sozinho. A recusa explícita na tela é do módulo de usuários (M7), no delta
  FR13.7.
- Ligar um provedor depois: preencher as três variáveis, escrever o `case` em
  `entregar()` e liberar o host em `src/lib/rede/buscarExterno.ts` (README).
  Nada deste ADR precisa ser desfeito.
