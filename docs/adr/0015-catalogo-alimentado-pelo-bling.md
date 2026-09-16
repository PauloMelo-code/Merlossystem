# ADR 0015 — Catalogo local alimentado pelo Bling, somente leitura

Data: 16/09/2026
Status: Aceito

## Contexto

O estoque de verdade mora no Bling. A tela de atendimento precisa responder
"tem esse vestido no P?" em menos de um segundo, e a API do Bling tem limite de
tres requisicoes por segundo por conta. Consultar o Bling a cada pergunta
derruba a integracao da rede em horario de pico.

## Decisao

1. O catalogo e uma copia LOCAL (`produtos`, `produtos_variacoes`,
   `produtos_categorias`), sincronizada pelo job `integracoes/sincronizar-bling`.
2. **A integracao e somente leitura.** O cliente Bling nao tem `PUT`, `PATCH`
   nem `DELETE`, e no maximo dois `POST` (autenticacao). Trava de fonte em
   `tests/travas/bling-somente-leitura.test.ts`.
3. A disponibilidade tem UMA implementacao, `calcularDisponivel()`: saldo do
   espelho menos o reservado em pedido aberto. Duas contas diferentes fariam a
   tela de venda prometer o que a tela de produto nega.
4. A tela mostra a IDADE do dado. Espelho sem idade visivel e espelho em que
   ninguem confia na segunda vez que erra.

## Consequencias

- O limitador de tres requisicoes por segundo por conta Bling e o MESMO objeto
  no caminho sincrono da tela e no job. Dois baldes dariam o dobro.
- Variacao e por TAMANHO, com grade `slim`, `plussize` ou `ambos`, e `ambos`
  ordena slim antes de plus, nesta ordem.
