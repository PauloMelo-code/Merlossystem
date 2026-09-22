import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { usuarioDaSessao, semSessao } from "@/lib/sessao"
import { escopoDaLoja, lojaAtiva } from "@/lib/loja"
import { PROVEDORES_DE_CANAL } from "@/lib/integracoes"

/**
 * Os numeros e perfis conectados da loja, para o filtro da caixa de entrada.
 *
 * NAO e a tela de configuracao: nao devolve credencial, nem referencia
 * externa, nem estado de token — so o que a vendedora precisa para escolher
 * "ver so o atendimento deste numero". Por isso vale para todos os papeis
 * (excecao no RBAC), no mesmo espirito de `/api/lojas` e `/api/usuarios`.
 *
 * Conta da REDE (Bling, sem loja) fica de fora: ela nao recebe conversa.
 */
export async function GET(req: Request) {
  const usuario = await usuarioDaSessao()
  if (!usuario) return semSessao()

  const loja = escopoDaLoja(usuario, lojaAtiva(req))

  const numeros = await prisma.storeIntegracao.findMany({
    where: {
      isDeleted: false,
      provedor: { in: [...PROVEDORES_DE_CANAL] },
      // Canal sempre pertence a uma loja; a da sessao, quando ha uma escolhida.
      ...(loja.storeId ? { storeId: loja.storeId } : { storeId: { not: null } }),
    },
    select: {
      id: true,
      rotulo: true,
      provedor: true,
      status: true,
      store: { select: { id: true, nome: true } },
      vendedor: { select: { id: true, name: true } },
    },
    orderBy: [{ rotulo: "asc" }],
  })

  return NextResponse.json(
    numeros.map((n) => ({
      id: n.id,
      rotulo: n.rotulo,
      provedor: n.provedor,
      status: n.status,
      loja: n.store ? { id: n.store.id, nome: n.store.nome } : null,
      vendedor: n.vendedor ? { id: n.vendedor.id, nome: n.vendedor.name } : null,
    }))
  )
}
