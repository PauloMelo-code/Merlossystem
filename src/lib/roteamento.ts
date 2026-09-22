import { prisma } from "@/lib/db/prisma"
import { decifrarCredenciais, type Credenciais } from "@/lib/cofre"

/**
 * De qual conta veio o evento — e, por consequencia, de qual loja.
 *
 * Antes da etapa 3 a loja vinha de `?loja=<slug>` na URL do webhook. Isso
 * resolvia com um numero por loja; com varios, saber a loja nao basta: e
 * preciso saber por QUAL numero a mensagem entrou, para responder pelo mesmo.
 *
 * A chave e `(provedor, referencia_externa)` — o `phone_number_id` do WhatsApp,
 * o id do perfil no Instagram, o shop id no TikTok Shop.
 */

export type ContaResolvida = {
  id: string
  storeId: string
  rotulo: string
  provedor: string
  /** Vendedora dona do numero: a conversa que entra por ele ja nasce dela. */
  vendedorId: string | null
}

/**
 * Acha a conta conectada que corresponde ao identificador que veio no payload.
 *
 * Devolve `null` quando: nao veio identificador, a conta nao esta cadastrada,
 * foi desconectada, ou e uma integracao da rede (sem loja) — mensagem de canal
 * sempre pertence a uma loja.
 */
export async function contaDoEvento(
  provedor: string,
  contaExterna: string | undefined | null
): Promise<ContaResolvida | null> {
  if (!contaExterna) return null

  const conta = await prisma.storeIntegracao.findFirst({
    where: { provedor, referenciaExterna: contaExterna, isDeleted: false },
    select: { id: true, storeId: true, rotulo: true, provedor: true, vendedorId: true },
  })

  if (!conta?.storeId) return null
  return {
    id: conta.id,
    storeId: conta.storeId,
    rotulo: conta.rotulo,
    provedor: conta.provedor,
    vendedorId: conta.vendedorId,
  }
}

/**
 * O uazapi manda dois identificadores da instancia: `instanceName` (o nome) e
 * `owner` (o numero conectado). Qual deles foi digitado em
 * `referencia_externa` depende de quem cadastrou, entao tenta os dois, na
 * ordem em que o payload os traz.
 */
export async function contaPorIdentificadores(
  provedor: string,
  candidatos: (string | undefined | null)[]
): Promise<ContaResolvida | null> {
  for (const candidato of candidatos) {
    const conta = await contaDoEvento(provedor, candidato)
    if (conta) return conta
  }
  return null
}

/**
 * Conta identificada na URL do webhook: `?conta=<referencia externa>`.
 *
 * Usado quando o payload do provedor nao traz um identificador de conta que a
 * gente saiba ler — hoje, o TikTok. Cada conta configura a propria URL, que e
 * a opcao 1 de roteamento descrita em docs/integracoes.md.
 */
export async function contaDaUrl(provedor: string, url: string): Promise<ContaResolvida | null> {
  return contaDoEvento(provedor, new URL(url).searchParams.get("conta"))
}

/**
 * Credenciais de uma conta, para enviar por ela.
 *
 * Decifradas so aqui, no servidor, no momento do uso — nunca ficam em memoria
 * global nem passam pela API.
 */
export async function credenciaisDaConta(integracaoId: string): Promise<Credenciais | null> {
  const conta = await prisma.storeIntegracao.findFirst({
    where: { id: integracaoId, isDeleted: false },
    select: { credenciaisCifradas: true },
  })
  if (!conta?.credenciaisCifradas) return null

  try {
    return decifrarCredenciais(conta.credenciaisCifradas)
  } catch {
    // Chave trocada ou registro adulterado. Quem chama decide o que fazer;
    // aqui so nao devolvemos lixo como se fosse credencial.
    return null
  }
}

/**
 * Conta pela qual uma conversa deve responder.
 *
 * Regra: **responde pelo numero em que a mensagem entrou**. A cliente que
 * escreve para o SAC nao pode receber resposta pelo numero de vendas.
 *
 * Conversa antiga (criada antes da etapa 3) nao tem conta gravada: devolve
 * `null` e o envio cai no adapter configurado por ambiente.
 */
export async function contaDaConversa(conversationId: string): Promise<ContaResolvida | null> {
  const conversa = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      integracao: {
        select: {
          id: true,
          storeId: true,
          rotulo: true,
          provedor: true,
          isDeleted: true,
          vendedorId: true,
        },
      },
    },
  })

  const i = conversa?.integracao
  if (!i || i.isDeleted || !i.storeId) return null
  return {
    id: i.id,
    storeId: i.storeId,
    rotulo: i.rotulo,
    provedor: i.provedor,
    vendedorId: i.vendedorId,
  }
}
