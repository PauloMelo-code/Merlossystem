import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { subirArquivo, urlInterna, urlInternaThumb } from "@/lib/media/upload"
import { buscarProduto, type ProdutoDetalhado, type VariacaoDetalhada } from "./cliente"
import { numeroDoBling } from "./preco"
import { tamanhoDoAtributo, tamanhoDaVariacao, ordenarTamanhos } from "./tamanhos"

/**
 * Segunda passada do catalogo: foto e grade de tamanhos, pelo DETALHE.
 *
 * Por que uma passada separada da sincronizacao: a listagem de produtos nao
 * tem foto nem tamanho. `imagemURL` veio vazio em 522 das 569 pecas, e o
 * tamanho so existe dentro de `variacoes[].variacao.nome`, que a listagem nao
 * devolve. Cada peca custa UMA requisicao, a 3 por segundo — uma rodada unica
 * levaria uns tres minutos e morreria no tempo limite do proxy. Por isso vai
 * em lote, com `bling_detalhe_em` guardando por onde parou.
 *
 * E por que a foto e BAIXADA, e nao apontada: a imagem interna do Bling vem
 * numa URL do S3 ASSINADA, com prazo (`Expires=...`). Guardar o link daria um
 * catalogo que funciona hoje e amanhece quebrado.
 */

/** Pausa entre pecas: o Bling limita a 3 requisicoes por segundo. */
const PAUSA_MS = 350
/** Pecas por rodada. Acima disso a requisicao bate no tempo limite do proxy. */
export const PECAS_POR_RODADA = 40

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

export type ResultadoDoEnriquecimento = {
  processadas: number
  comFoto: number
  comGrade: number
  /** Pecas cujo detalhe o Bling nao devolveu. */
  semDetalhe: number
  /** Quantas ainda faltam depois desta rodada. */
  restantes: number
  /**
   * Pecas sem o id do Bling gravado — elas NAO entram na fila.
   *
   * E o estado de quem sincronizou o catalogo antes de a segunda passada
   * existir: sem o id nao ha como pedir o detalhe. Sem este numero, a rodada
   * terminaria dizendo "0 pecas ganharam foto", que se le como se o Bling nao
   * tivesse foto nenhuma — quando o que falta e rodar a sincronizacao.
   */
  semBlingId: number
  falhas: { sku: string; erro: string }[]
}

/**
 * Grade e estoque a partir das variacoes do DETALHE.
 *
 * O atributo vem primeiro (`"Tamanho:G;Cor:Verde"`): e o unico lugar onde o
 * tamanho aparece separado da cor. O nome da variacao fica de reserva, para a
 * peca cujo atributo nao veio preenchido.
 */
export function gradeDoDetalhe(detalhe: ProdutoDetalhado) {
  const tamanhos: string[] = []
  const estoque: Record<string, number> = {}

  for (const v of detalhe.variacoes ?? []) {
    const tamanho =
      tamanhoDoAtributo(v.variacao?.nome) ?? tamanhoDaVariacao(detalhe.nome, v.nome)
    if (!tamanho) continue
    tamanhos.push(tamanho)
    // Cor x tamanho: duas variacoes caem no mesmo tamanho e os saldos somam.
    const saldo = Math.max(0, Math.trunc(v.estoque?.saldoVirtualTotal ?? 0))
    estoque[tamanho] = (estoque[tamanho] ?? 0) + saldo
  }

  return { tamanhos: ordenarTamanhos(tamanhos), estoque }
}

/** O melhor preco que o detalhe conhece, quando a listagem deu zero. */
export function precoDoDetalhe(detalhe: ProdutoDetalhado): number[] {
  return (detalhe.variacoes ?? [])
    .map((v: VariacaoDetalhada) => numeroDoBling(v.preco))
    .filter((p) => p > 0)
}

/**
 * Primeira foto utilizavel do detalhe.
 *
 * Ordem de preferencia: interna (hospedada pelo Bling, que e a que a loja
 * cadastrou), externa, depois o que sobrar. Todas podem ser assinadas.
 */
export function primeiraFoto(detalhe: ProdutoDetalhado): string | null {
  const imagens = detalhe.midia?.imagens
  const candidatas = [
    ...(imagens?.internas ?? []),
    ...(imagens?.externas ?? []),
    ...(imagens?.imagensURL ?? []),
  ]
  for (const img of candidatas) {
    const link = img?.link?.trim()
    if (link) return link
  }
  return detalhe.imagemURL?.trim() || null
}

/**
 * Baixa a foto UMA vez e guarda uma copia por loja.
 *
 * Uma copia por loja, e nao uma linha compartilhada: `media_files` pertence a
 * loja e excluir a midia apaga o objeto do bucket — com a linha compartilhada,
 * a loja que apagasse levaria junto a foto da outra.
 */
async function guardarFoto(
  urlDaFoto: string,
  produtos: { id: string; storeId: string }[]
): Promise<Map<string, string>> {
  const res = await fetch(urlDaFoto)
  if (!res.ok) throw new Error(`foto respondeu HTTP ${res.status}`)

  const bytes = Buffer.from(await res.arrayBuffer())
  const mimeType = res.headers.get("content-type") || "image/jpeg"
  const porLoja = new Map<string, string>()

  for (const produto of produtos) {
    const enviado = await subirArquivo(bytes, {
      storeId: produto.storeId,
      pasta: "produtos",
      mimeType,
    })
    const id = crypto.randomUUID()
    await prisma.mediaFile.create({
      data: {
        id,
        storeId: produto.storeId,
        originalName: null,
        fileKey: enviado.chave,
        fileUrl: urlInterna(id),
        thumbnailKey: enviado.chaveThumb || null,
        thumbnailUrl: enviado.chaveThumb ? urlInternaThumb(id) : null,
        fileType: "image",
        mimeType,
        fileSize: enviado.bytes,
        width: enviado.width || null,
        height: enviado.height || null,
        productId: produto.id,
        folder: "produtos",
      },
    })
    porLoja.set(produto.id, urlInterna(id))
  }

  return porLoja
}

/** Uma rodada: pega as proximas pecas sem detalhe e preenche o que der. */
export async function enriquecerLote(
  integracaoId: string,
  limite = PECAS_POR_RODADA
): Promise<ResultadoDoEnriquecimento> {
  const resultado: ResultadoDoEnriquecimento = {
    processadas: 0,
    comFoto: 0,
    comGrade: 0,
    semDetalhe: 0,
    restantes: 0,
    semBlingId: 0,
    falhas: [],
  }

  // Uma peca por CODIGO, nao por linha: a mesma peca existe nas duas lojas e o
  // detalhe dela no Bling e o mesmo — buscar duas vezes seria dobrar o custo.
  const pendentes = await prisma.product.findMany({
    where: { blingId: { not: null }, blingDetalheEm: null },
    distinct: ["blingId"],
    select: { blingId: true, sku: true },
    orderBy: { createdAt: "asc" },
    take: limite,
  })

  for (const pendente of pendentes) {
    const sku = pendente.sku ?? ""
    try {
      const linhas = await prisma.product.findMany({
        where: { blingId: pendente.blingId },
        select: { id: true, storeId: true, sizes: true, imageUrls: true, price: true },
      })
      if (linhas.length === 0) continue

      const detalhe = await buscarProduto(integracaoId, pendente.blingId!)
      if (!detalhe) {
        resultado.semDetalhe += 1
      } else {
        const grade = gradeDoDetalhe(detalhe)
        const foto = primeiraFoto(detalhe)

        // Baixa a foto so para quem ainda nao tem: a equipe pode ter subido
        // uma melhor pela Galeria, e a rodada nao pode desfazer isso.
        const semFoto = linhas.filter((l) => l.imageUrls.length === 0)
        let urlPorProduto = new Map<string, string>()
        if (foto && semFoto.length > 0) {
          urlPorProduto = await guardarFoto(foto, semFoto)
          if (urlPorProduto.size > 0) resultado.comFoto += 1
        }
        if (grade.tamanhos.length > 0) resultado.comGrade += 1

        for (const linha of linhas) {
          const dados: Prisma.ProductUpdateInput = { blingDetalheEm: new Date() }
          const url = urlPorProduto.get(linha.id)
          if (url) dados.imageUrls = [url]
          if (grade.tamanhos.length > 0) {
            dados.sizes = grade.tamanhos
            dados.stock = grade.estoque as Prisma.InputJsonValue
          }
          await prisma.product.update({ where: { id: linha.id }, data: dados })
        }
        resultado.processadas += 1
        await dormir(PAUSA_MS)
        continue
      }

      // Sem detalhe: carimba assim mesmo, senao a peca volta a fila para sempre.
      await prisma.product.updateMany({
        where: { blingId: pendente.blingId },
        data: { blingDetalheEm: new Date() },
      })
      resultado.processadas += 1
      await dormir(PAUSA_MS)
    } catch (e) {
      // Uma peca que falha nao derruba a rodada — mas tem de aparecer.
      resultado.falhas.push({ sku, erro: e instanceof Error ? e.message : String(e) })
      // Carimba para nao travar a fila na mesma peca a cada rodada.
      await prisma.product
        .updateMany({
          where: { blingId: pendente.blingId },
          data: { blingDetalheEm: new Date() },
        })
        .catch(() => {})
      await dormir(PAUSA_MS)
    }
  }

  resultado.restantes = await prisma.product.count({
    where: { blingId: { not: null }, blingDetalheEm: null },
  })
  resultado.semBlingId = await prisma.product.count({ where: { blingId: null } })

  return resultado
}
