import { NextResponse } from "next/server"
import { registrar } from "@/lib/auditoria"
import { prisma } from "@/lib/db/prisma"
import { gravarConexao } from "@/lib/integracoes-conexao"
import { usuarioDaSessao, semSessao } from "@/lib/sessao"
import { escopoDaLoja, lojaAtiva, lojaParaGravar, faltaLoja } from "@/lib/loja"
import { cifrarCredenciais, ehCofreError } from "@/lib/cofre"
import { integracaoSchema, ehDaRede, paraApi, chavesFaltando } from "@/lib/integracoes"
import { z } from "zod"

/**
 * Contas conectadas de cada provedor.
 *
 * Rota de configuracao: so `admin` (src/lib/rbac.ts). O segredo nunca sai
 * daqui — `paraApi` devolve so o resumo mascarado.
 */
export async function GET(req: Request) {
  const usuario = await usuarioDaSessao()
  if (!usuario) return semSessao()

  const loja = escopoDaLoja(usuario, lojaAtiva(req))
  const integracoes = await prisma.storeIntegracao.findMany({
    where: {
      isDeleted: false,
      // Integracao da rede (storeId nulo) aparece em qualquer filtro de loja:
      // o Bling e uma conta so para as duas.
      ...(loja.storeId ? { OR: [{ storeId: loja.storeId }, { storeId: null }] } : {}),
    },
    include: { store: { select: { id: true, nome: true } }, vendedor: { select: { id: true, name: true } } },
    orderBy: [{ provedor: "asc" }, { rotulo: "asc" }],
  })

  return NextResponse.json({ integracoes: integracoes.map(paraApi) })
}

export async function POST(req: Request) {
  try {
    const usuario = await usuarioDaSessao()
    if (!usuario) return semSessao()

    const body = await req.json()
    const data = integracaoSchema.parse(body)

    // Provedor da rede nao pertence a loja nenhuma; os demais exigem loja.
    let storeId: string | null = null
    if (!ehDaRede(data.provedor)) {
      storeId = lojaParaGravar(usuario, lojaAtiva(req))
      if (!storeId) return faltaLoja()
    }

    const jaExiste = await prisma.storeIntegracao.findFirst({
      where: {
        provedor: data.provedor,
        referenciaExterna: data.referenciaExterna,
        isDeleted: false,
      },
      select: { id: true, storeId: true },
    })
    if (jaExiste) {
      return NextResponse.json(
        {
          error:
            "Esta conta ja esta conectada" +
            (jaExiste.storeId === storeId ? " nesta loja" : " em outra loja"),
        },
        { status: 409 }
      )
    }

    const temCredenciais = Object.keys(data.credenciais).length > 0

    // Credencial com a chave errada e gravada cifrada e so falha no primeiro
    // envio — longe de quem digitou. Melhor recusar aqui, dizendo o que falta.
    if (temCredenciais) {
      const faltando = chavesFaltando(data.provedor, data.credenciais)
      if (faltando.length > 0) {
        return NextResponse.json(
          { error: `Faltam credenciais para ${data.provedor}: ${faltando.join(", ")}` },
          { status: 400 }
        )
      }
    }

    // Sem filtrar `isDeleted`: o indice unico (provedor, referenciaExterna)
    // nao e parcial, entao cadastrar de novo a MESMA conta depois de
    // desconectar batia na linha apagada e estourava violacao de unicidade.
    const { id: idDaConta } = await gravarConexao({
      provedor: data.provedor,
      referenciaExterna: data.referenciaExterna,
      dados: {
        storeId,
        rotulo: data.rotulo,
        // Sem chave configurada, `cifrarCredenciais` lanca — e a rota falha
        // antes de gravar. Nunca cai para texto plano.
        credenciaisCifradas: temCredenciais ? cifrarCredenciais(data.credenciais) : null,
        status: temCredenciais ? "conectado" : "desconectado",
        expiraEm: data.expiraEm ? new Date(data.expiraEm) : null,
        ultimoErro: null,
        modifiedBy: usuario.id,
      },
    })

    const criada = await prisma.storeIntegracao.findUniqueOrThrow({
      where: { id: idDaConta },
      include: { store: { select: { id: true, nome: true } }, vendedor: { select: { id: true, name: true } } },
    })

    // Conectar credencial e a acao mais sensivel do sistema: e a chave que
    // movimenta dinheiro e fala com a cliente. O log guarda QUAL conta, nunca
    // o segredo — `registrar` filtra, e aqui nem chega a receber.
    await registrar({
      storeId: criada.storeId,
      userId: usuario.id,
      acao: "integracao_conectada",
      entidade: "integracao",
      entidadeId: criada.id,
      detalhes: {
        provedor: criada.provedor,
        rotulo: criada.rotulo,
        referenciaExterna: criada.referenciaExterna,
      },
      req,
    })

    return NextResponse.json(paraApi(criada), { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 })
    }
    if (ehCofreError(error)) {
      // Problema de configuracao do servidor, nao da requisicao.
      console.error("[Integracoes] Cofre:", error.message)
      return NextResponse.json({ error: error.message }, { status: 503 })
    }
    console.error("[Integracoes] Erro ao conectar:", error)
    return NextResponse.json({ error: "Erro ao conectar integracao" }, { status: 500 })
  }
}
