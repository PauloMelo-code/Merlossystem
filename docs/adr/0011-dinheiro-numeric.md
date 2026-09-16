# ADR 0011 — Dinheiro em numeric(12,2), string na fronteira e centavos em formato.ts

Data: 16/09/2026
Status: Aceito

## Contexto

O sistema antigo somava preco em ponto flutuante. `0.1 + 0.2` continua sendo
`0.30000000000000004`, e o total do pedido fechava um centavo diferente do
somatorio dos itens, com a cliente na frente da vendedora.

## Decisao

1. A coluna e `numeric(12,2)` pelo helper `dinheiro()`, em modo STRING. O
   driver devolve `"1234.56"`, e e essa string que atravessa a fronteira
   banco, aplicacao e tela.
2. **Toda aritmetica acontece em centavos inteiros**, em `src/lib/formato.ts`:
   `paraCentavos`, `deCentavos`, `somar`, `multiplicar`. Nao existe um segundo
   modulo de dinheiro, e `REGEX_DINHEIRO` e exportada de la para os validadores.
3. `12,2` comporta quase dez bilhoes: folga de sobra para uma rede de duas
   lojas de moda, e ainda cabe em `Number.MAX_SAFE_INTEGER` depois de
   convertido para centavos.

## Consequencias

- Quem precisar de moeda importa de `formato.ts`. Um segundo `lib/dinheiro.ts`
  e justamente o que a secao 13.3 de `01-dados.md` proibe pelo nome.
- A tela nunca formata a mao: o componente de dinheiro usa o mesmo modulo.
