import { NextResponse } from "next/server"
import { z } from "zod"
import { registrar } from "@/lib/auditoria"
import { prisma } from "@/lib/db/prisma"
import { gravarConexao } from "@/lib/integracoes-conexao"
import { usuarioDaSessao, semSessao } from "@/lib/sessao"
import { lojaAtiva, lojaParaGravar, faltaLoja } from "@/lib/loja"
import { cifrarCredenciais, ehCofreError } from "@/lib/cofre"
import { paraApi } from "@/lib/integracoes"
import { ehUazapiConfigError } from "@/lib/uazapi/config"
import { configurarWebhook, criarInstancia } from "@/lib/uazapi/instancia"

/**
 * Criar um numero de WhatsApp (uazapi) inteiro por aqui.
 *
 * Antes era preciso ir ao painel do uazapi, criar a instancia, copiar o token,
 * voltar, colar no formulario e ainda configurar o webhook la na mao — e quem
 * esquecia do webhook ficava com um numero mudo, sem erro nenhum na tela.
 *
 * Aqui a rota faz os tres passos: cria a instancia (admintoken do ambiente),
 * guarda o token cifrado e aponta o webhook para este sistema. O QR continua
 * sendo o passo seguinte, na propria tela de integracoes.
 *
 * A instancia nasce com nome derivado do apelido mais um sufixo aleatorio: o
 * nome e unico no servidor uazapi, e dois "WhatsApp Centro" colidiriam.
 */

const entrada = z.object({
  rotulo: z.string().trim().min(1, "Informe um apelido para reconhecer o numero"),
  /** Vendedora dona do numero; a conversa que entrar por ele ja nasce dela. */
  vendedorId: z.string().uuid().nullable().optional(),
})

/** Nome aceito pelo uazapi: sem acento, sem espaco, com sufixo unico. */
function nomeDaInstancia(rotulo: string): string {
  const base = rotulo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
  return `${base || "numero"}-${crypto.randomUUID().slice(0, 6)}`
}

export async function POST(req: Request) {
  try {
    const usuario = await usuarioDaSessao()
    if (!usuario) return semSessao()

    const data = entrada.parse(await req.json())

    const storeId = lojaParaGravar(usuario, lojaAtiva(req))
    if (!storeId) return faltaLoja()

    if (data.vendedorId) {
      const pessoa = await prisma.user.findFirst({
        where: { id: data.vendedorId, isActive: true },
        select: { storeId: true },
      })
      if (!pessoa) {
        return NextResponse.json({ error: "Pessoa nao encontrada ou inativa." }, { status: 400 })
      }
      if (pessoa.storeId && pessoa.storeId !== storeId) {
        return NextResponse.json({ error: "Esta pessoa e de outra loja." }, { status: 400 })
      }
    }

    const nome = nomeDaInstancia(data.rotulo)
    const instancia = await criarInstancia(nome)

    // Webhook antes de gravar: se ele falhar, nao fica conta pela metade no
    // banco apontando para uma instancia que nunca vai entregar mensagem.
    await configurarWebhook(instancia.token)

    // O nome da instancia sai do rotulo, entao recriar um numero com o mesmo
    // nome depois de desconectar bate na linha APAGADA — o indice unico
    // (provedor, referenciaExterna) nao e parcial. `gravarConexao` revive em
    // vez de estourar, e as conversas daquele numero voltam a rotear.
    const { id: idDaConta } = await gravarConexao({
      provedor: "uazapi",
      // E por este nome que o webhook encontra a conta (src/lib/roteamento.ts).
      referenciaExterna: instancia.nome,
      dados: {
        storeId,
        rotulo: data.rotulo,
        credenciaisCifradas: cifrarCredenciais({ token: instancia.token }),
        // So vira "conectado" depois do QR.
        status: "desconectado",
        vendedorId: data.vendedorId ?? null,
        ultimoErro: null,
        modifiedBy: usuario.id,
      },
    })

    const criada = await prisma.storeIntegracao.findUniqueOrThrow({
      where: { id: idDaConta },
      include: {
        store: { select: { id: true, nome: true } },
        vendedor: { select: { id: true, name: true } },
      },
    })

    await registrar({
      storeId: criada.storeId,
      userId: usuario.id,
      acao: "integracao_conectada",
      entidade: "integracao",
      entidadeId: criada.id,
      detalhes: { provedor: "uazapi", rotulo: criada.rotulo, referenciaExterna: criada.referenciaExterna },
      req,
    })

    return NextResponse.json(paraApi(criada), { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 })
    }
    if (ehUazapiConfigError(error) || ehCofreError(error)) {
      // Configuracao do servidor (token de admin, webhook, cofre), nao da
      // requisicao: quem digitou nao tem como corrigir.
      console.error("[uazapi] Configuracao:", (error as Error).message)
      return NextResponse.json({ error: (error as Error).message }, { status: 503 })
    }
    console.error("[uazapi] Erro ao criar numero:", error)
    return NextResponse.json({ error: "Erro ao criar o numero" }, { status: 500 })
  }
}
