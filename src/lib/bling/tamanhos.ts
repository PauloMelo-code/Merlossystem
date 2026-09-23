/**
 * Tamanho de uma peca a partir do nome da variacao do Bling.
 *
 * Na v3 o tamanho nao vem em campo proprio: a listagem devolve so `nome`, e os
 * atributos estruturados da variacao nao sao tipados em nenhuma resposta —
 * `ProdutosVariacaoDTO` lista "atributos" em `required` e nao o define em
 * `properties`. Sobra o nome.
 *
 * Por isso este arquivo nao tem Prisma nem rede: e heuristica sobre texto, que
 * e o tipo de codigo que precisa de teste com entrada e saida de verdade.
 */

/** Ordem que a vendedora espera ler, e nao a alfabetica. */
const ORDEM = ["PP", "P", "M", "G", "GG", "XG", "XGG", "G1", "G2", "G3", "G4", "U", "UNICO"]

/**
 * O que aceitamos como tamanho.
 *
 * Fechado de proposito: o resto do nome da variacao e texto livre, e aceitar
 * qualquer sobra encheria o catalogo de "LISO" e "DOURADO" como se fossem
 * tamanhos — e o seletor do chat oferece exatamente o que esta nesta lista.
 */
const TAMANHO = /^(PP|P|M|G|GG|XG|XGG|G[1-4]|U|UN|UNICO|\d{1,3}(?:[/-]\d{1,3})?)$/

/** Rotulos que o Bling costuma prefixar ao valor: "Tamanho: M", "TAM M". */
const ROTULO = /^(tamanho|tam|size)\s*[:\-.]?\s*/i

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "")

/**
 * Tamanho da variacao, ou `null` quando o nome nao permite dizer.
 *
 * `null` e diferente de "sem tamanho": significa que NAO SABEMOS. Chutar aqui
 * faria o seletor oferecer um tamanho que a peca nao tem.
 */
export function tamanhoDaVariacao(
  nomeDoPai: string | undefined,
  nomeDaVariacao: string | undefined
): string | null {
  const variacao = (nomeDaVariacao ?? "").trim()
  if (!variacao) return null

  const pai = (nomeDoPai ?? "").trim()
  let resto = ""

  if (pai && semAcento(variacao).toUpperCase().startsWith(semAcento(pai).toUpperCase())) {
    resto = variacao.slice(pai.length)
  } else if (variacao.includes(" - ")) {
    // Sem o nome do pai como prefixo, o ultimo segmento e a convencao do Bling.
    resto = variacao.slice(variacao.lastIndexOf(" - ") + 3)
  } else {
    return null
  }

  const limpo = semAcento(resto)
    .replace(/^[\s\-:/|,.]+/, "")
    .replace(ROTULO, "")
    .trim()
    .toUpperCase()

  if (!limpo || !TAMANHO.test(limpo)) return null
  return limpo === "UN" ? "U" : limpo
}

/** Da ordem de arara: PP, P, M, G, GG... e depois os numericos crescendo. */
export function ordenarTamanhos(tamanhos: string[]): string[] {
  const unicos = Array.from(new Set(tamanhos))
  return unicos.sort((a, b) => {
    const ia = ORDEM.indexOf(a)
    const ib = ORDEM.indexOf(b)
    if (ia >= 0 && ib >= 0) return ia - ib
    if (ia >= 0) return -1
    if (ib >= 0) return 1
    const na = Number(a.split(/[/-]/)[0])
    const nb = Number(b.split(/[/-]/)[0])
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb
    return a.localeCompare(b)
  })
}

/**
 * `slim` | `plussize` | `both` a partir do nome da peca.
 *
 * A loja escreve "PLUS SIZE" no nome — e o dado mais confiavel que existe aqui,
 * mais do que inferir pelo maior tamanho da grade. Sem essa marca no nome,
 * devolve `null`: nao saber tem de continuar sendo `both`, o padrao da coluna.
 */
export function tipoDeTamanho(nomeDaPeca: string | undefined): "plussize" | null {
  const nome = semAcento(nomeDaPeca ?? "").toUpperCase()
  return /\bPLUS\s*SIZE\b/.test(nome) ? "plussize" : null
}
