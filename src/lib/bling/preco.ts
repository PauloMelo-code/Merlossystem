/**
 * Preco do Bling -> preco do catalogo.
 *
 * Separado de `sincronizar.ts` de proposito: aqui nao entra Prisma nem rede,
 * entao o caminho do DINHEIRO pode ter teste de verdade, com numero na entrada
 * e string na saida, em vez de leitura do proprio codigo-fonte.
 */

/**
 * Numero do Bling, tolerante ao que a API realmente manda.
 *
 * A especificacao promete `number`, mas JSON nao garante o que a spec promete:
 * um `"89.90"` lido como nao-numero viraria R$ 0,00 no catalogo inteiro — uma
 * falha cara e silenciosa. Aceita tambem o formato brasileiro `"1.234,56"`.
 *
 * Preco negativo ou zero vira 0: nao existe peca a preco negativo, e deixar o
 * sinal passar produziria desconto do nada na conversa.
 */
export function numeroDoBling(valor: unknown): number {
  if (typeof valor === "number") return Number.isFinite(valor) && valor > 0 ? valor : 0
  if (typeof valor !== "string") return 0
  const limpo = valor.trim().replace(/\s/g, "")
  if (limpo === "") return 0
  const n = Number(limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Para o `Decimal(10,2)` do banco, sem passar por aritmetica de float. */
export function centavos(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2)
}

/**
 * Preco da peca no catalogo.
 *
 * Usa o preco do proprio produto. Se ele vier zerado — o que acontece em toda
 * peca com variacoes, porque na v3 o preco vive em cada tamanho — usa o preco
 * mais REPETIDO entre os tamanhos.
 *
 * Empate fica com o MAIOR de proposito: subcotar tira margem da loja sem
 * ninguem perceber, enquanto desconto a vendedora ainda pode dar na conversa.
 */
export function precoDeCatalogo(precoDoProduto: unknown, precosDosTamanhos?: number[]): string {
  const proprio = numeroDoBling(precoDoProduto)
  if (proprio > 0) return centavos(proprio)

  const vezesPorPreco = new Map<number, number>()
  for (const p of precosDosTamanhos ?? []) {
    if (p > 0) vezesPorPreco.set(p, (vezesPorPreco.get(p) ?? 0) + 1)
  }

  let escolhido = 0
  let vezes = 0
  vezesPorPreco.forEach((n, preco) => {
    if (n > vezes || (n === vezes && preco > escolhido)) {
      escolhido = preco
      vezes = n
    }
  })
  return centavos(escolhido)
}
