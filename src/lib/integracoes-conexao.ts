import { prisma } from "@/lib/db/prisma"

/**
 * Grava a conexao de um provedor — revivendo a linha apagada, se houver.
 *
 * O DEFEITO que isto conserta, e que custou a conta do Bling em producao
 * (23/09/2026): `StoreIntegracao` tem `@@unique([provedor, referenciaExterna])`,
 * e esse indice NAO e parcial — a linha excluida continua ocupando a chave.
 * Desconectar grava `is_deleted = true`; reconectar procurava por
 * `isDeleted: false`, nao achava nada, caia no `create` com a MESMA
 * `referenciaExterna` e estourava violacao de unicidade. O erro virava
 * `?erro=erro-inesperado` na tela e a integracao ficava **impossivel de
 * reconectar** sem alguem mexer no banco.
 *
 * Reviver e o comportamento certo, nao um remendo: e a mesma conta do mesmo
 * provedor voltando. As conversas que apontavam para aquela integracao voltam
 * a rotear, o historico continua ligado, e o id nao muda — recriar com id novo
 * deixaria as conversas antigas orfas de canal.
 *
 * A credencial nao e preservada: quem desconecta apaga a credencial de
 * verdade, e reconectar passa pelo provedor de novo.
 */
export async function gravarConexao(opts: {
  provedor: string
  referenciaExterna: string
  /** Campos a gravar. `isDeleted`/`deletedAt` sao cuidados aqui. */
  dados: Record<string, unknown>
  /** Campos usados so na criacao (loja, rotulo inicial). */
  aoCriar?: Record<string, unknown>
}): Promise<{ id: string; revivida: boolean }> {
  // SEM `isDeleted` no filtro: e justamente a linha apagada que precisa ser
  // encontrada. Filtrar aqui e o bug.
  const existente = await prisma.storeIntegracao.findFirst({
    where: { provedor: opts.provedor, referenciaExterna: opts.referenciaExterna },
    select: { id: true, isDeleted: true },
  })

  if (existente) {
    await prisma.storeIntegracao.update({
      where: { id: existente.id },
      data: { ...opts.dados, isDeleted: false, deletedAt: null },
    })
    return { id: existente.id, revivida: existente.isDeleted }
  }

  const criada = await prisma.storeIntegracao.create({
    data: {
      ...opts.aoCriar,
      ...opts.dados,
      provedor: opts.provedor,
      referenciaExterna: opts.referenciaExterna,
    } as never,
  })
  return { id: criada.id, revivida: false }
}
