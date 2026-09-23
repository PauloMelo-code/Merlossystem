import { prisma } from "@/lib/db/prisma"
import { listarProdutos, type ProdutoBling } from "./cliente"

/**
 * Espelho do catalogo do Bling no banco local — SOMENTE LEITURA do lado do
 * Bling (ADR 0004: o Bling e a autoridade de produto e estoque).
 *
 * Por que espelhar, se a rota de saldo ja le ao vivo: a tela de Produtos, o
 * seletor de produto do chat e a reserva de estoque leem a tabela `products`.
 * Sem o espelho, o catalogo aparece vazio para quem atende.
 *
 * As cinco regras que este arquivo cumpre, e o que cada uma evita:
 *
 * 1. CASA por `(storeId, sku)` e NUNCA recria linha. `orders.items[].productId`
 *    e `media_files.product_id` apontam para o id local; recriar orfanaria o
 *    pedido, quebraria a FK da midia e zeraria a reserva — oversell silencioso.
 * 2. UMA LINHA POR LOJA para cada codigo. A conta do Bling e da rede, mas o
 *    produto e por loja (`escopoDaLoja`): uma linha so esconderia o catalogo
 *    de uma das lojas.
 * 3. NAO escreve `stock`. O Bling da saldo por SKU; `products.stock` e por
 *    TAMANHO e e o que o seletor do chat usa para oferecer tamanho. Escrever
 *    ali faria a tela dizer "sem estoque" no catalogo inteiro.
 * 4. NAO apaga o que o Bling nao tem. Categoria, tamanhos, fotos, destaque e
 *    precos auxiliares sao preenchidos AQUI pela equipe; um upsert cego
 *    zeraria o trabalho delas a cada rodada.
 * 5. NAO mexe em `active`. Excluir um produto na tela grava `active:false`;
 *    sincronizar esse campo ressuscitaria o que a loja tirou de proposito.
 *    Produto que some do Bling tambem nao e desativado: sumir da listagem nao
 *    prova que deixou de existir, e o pedido antigo ainda aponta para ele.
 */

/** Teto para o laco nunca virar infinito se a API repetir pagina. */
const PAGINAS_MAXIMAS = 200
const POR_PAGINA = 100
/** Respiro entre paginas: o Bling limita a 3 requisicoes por segundo. */
const PAUSA_MS = 350

export type ResultadoSincronizacao = {
  criados: number
  atualizados: number
  semMudanca: number
  /** Produto do Bling sem `codigo`: sem SKU nao ha como casar sem duplicar. */
  ignorados: number
  paginas: number
  lojas: number
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Preco do Bling (numero) para o Decimal(10,2) do banco, sem passar por float. */
function preco(valor: number | undefined): string {
  const n = typeof valor === "number" && Number.isFinite(valor) && valor > 0 ? valor : 0
  return (Math.round(n * 100) / 100).toFixed(2)
}

/**
 * Traz o catalogo para as lojas informadas.
 *
 * A leitura do Bling acontece UMA vez por pagina e e gravada em cada loja: a
 * conta e da rede, entao ler por loja so multiplicaria requisicao no mesmo
 * balde de 3 req/s.
 */
export async function sincronizarCatalogo(
  integracaoId: string,
  lojaIds: string[]
): Promise<ResultadoSincronizacao> {
  const total: ResultadoSincronizacao = {
    criados: 0,
    atualizados: 0,
    semMudanca: 0,
    ignorados: 0,
    paginas: 0,
    lojas: lojaIds.length,
  }
  if (lojaIds.length === 0) return total

  for (let pagina = 1; pagina <= PAGINAS_MAXIMAS; pagina++) {
    const lista: ProdutoBling[] = await listarProdutos(integracaoId, pagina, POR_PAGINA)
    if (lista.length === 0) break
    total.paginas = pagina

    for (const item of lista) {
      const sku = item.codigo?.trim()
      const nome = item.nome?.trim()
      if (!sku || !nome) {
        total.ignorados += 1
        continue
      }

      for (const storeId of lojaIds) {
        const atual = await prisma.product.findFirst({
          where: { storeId, sku },
          select: { id: true, name: true, price: true },
        })

        if (!atual) {
          await prisma.product.create({
            data: {
              storeId,
              sku,
              name: nome,
              price: preco(item.preco),
              // O resto fica no padrao: categoria, tamanhos e fotos sao
              // preenchidos aqui pela equipe, e o Bling nao tem esses campos.
            },
          })
          total.criados += 1
          continue
        }

        // So escreve o que mudou: gravar igual enche a trilha de ruido e
        // mexe em `updated_at` sem motivo.
        const mudou = atual.name !== nome || String(atual.price) !== preco(item.preco)
        if (!mudou) {
          total.semMudanca += 1
          continue
        }
        await prisma.product.update({
          where: { id: atual.id },
          data: { name: nome, price: preco(item.preco) },
        })
        total.atualizados += 1
      }
    }

    if (lista.length < POR_PAGINA) break
    await dormir(PAUSA_MS)
  }

  return total
}
