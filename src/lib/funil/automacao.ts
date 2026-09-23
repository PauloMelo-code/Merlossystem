import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import {
  classificarConversa,
  CONFIANCA_MINIMA,
  type MensagemParaLer,
} from "./classificar"
import { ordemDaEtapa } from "./etapas"

/**
 * Classificacao automatica do funil — a rodada em lote.
 *
 * O que ela faz, e os limites que sao a razao de existir:
 *
 * 1. SO AVANCA. A IA nunca puxa um cartao para tras: quem o moveu para frente
 *    foi uma pessoa lendo a mesma conversa, e desfazer isso por leitura de
 *    maquina apaga trabalho de quem estava atendendo.
 * 2. NUNCA marca "Perdeu" — `ETAPAS_DA_IA` nao oferece a opcao. Perda e
 *    decisao de gente, e a tela pede o motivo porque a loja quer saber por que
 *    perdeu.
 * 3. SO PREENCHE campo vazio do contato. Nome e tamanho que a equipe digitou
 *    ficam; tags sao acrescentadas, nunca substituidas.
 * 4. NAO REATRIBUI. O dono do cartao sai de `conversation.assignedTo` na
 *    criacao e nunca mais e tocado.
 * 5. Falha de uma conversa nao derruba a rodada — mas tambem nao some: volta
 *    no resultado, que a rota registra.
 */

/** Quantas mensagens do fim da conversa vao para o modelo. */
const MENSAGENS_LIDAS = 20
/** Teto de cartoes por rodada. O Bling nao entra aqui, mas a Anthropic cobra. */
export const CARTOES_POR_RODADA = 25

export type ResultadoDaRodada = {
  /** Cartoes abertos porque a conversa ainda nao tinha um. */
  abertos: number
  /** Cartoes lidos pelo modelo nesta rodada. */
  lidos: number
  /** Cartoes que mudaram de etapa. */
  movidos: number
  /** Contatos que ganharam nome, tamanho ou tag. */
  contatosPreenchidos: number
  /** Leitura abaixo do corte de confianca — cartao fica onde esta. */
  incertos: number
  /** Conversas que falharam (modelo fora do ar, resposta invalida). */
  falhas: { dealId: string; erro: string }[]
}

/**
 * Abre cartao para conversa que ainda nao tem um.
 *
 * O cartao nasce em `lead` com o dono da conversa. Sem isto, o funil so tem o
 * que alguem cadastrou a mao colando o id do contato — que e como a tela pede
 * hoje, e por isso o funil esta praticamente vazio.
 */
export async function abrirCartoesQueFaltam(limite: number): Promise<number> {
  const semCartao = await prisma.conversation.findMany({
    where: {
      lastMessageAt: { not: null },
      status: { in: ["open", "pending"] },
      deals: { none: { isDeleted: false } },
    },
    select: { id: true, storeId: true, contactId: true, assignedTo: true },
    orderBy: { lastMessageAt: "desc" },
    take: limite,
  })
  if (semCartao.length === 0) return 0

  await prisma.deal.createMany({
    data: semCartao.map((c) => ({
      storeId: c.storeId,
      contactId: c.contactId,
      conversationId: c.id,
      // Herda a dona da conversa — a automacao nunca escolhe vendedora.
      assignedTo: c.assignedTo,
      stage: "lead",
    })),
    skipDuplicates: true,
  })
  return semCartao.length
}

/**
 * Reserva os cartoes desta rodada, marcando-os no MESMO comando.
 *
 * `for update ... skip locked` e o padrao que o disparo de campanha ja usa
 * (`reservarLote`, src/lib/broadcasts/disparo.ts): sem ele, duas execucoes do
 * cron que se sobreponham mandam a mesma conversa duas vezes para a Anthropic
 * — custo dobrado e o cartao movido duas vezes, com duas linhas de trilha.
 *
 * Ganho e Perdido ficam de fora: cartao fechado nao volta a ser classificado.
 */
export async function reservarCartoes(limite: number): Promise<string[]> {
  const linhas = await prisma.$queryRaw<{ id: string }[]>`
    update deals d
       set ai_etapa_em = now()
     where d.id in (
       select alvo.id
         from deals alvo
         join conversations c on c.id = alvo.conversation_id
        where alvo.is_deleted = false
          and alvo.stage not in ('won', 'lost')
          and c.last_message_at is not null
          and (alvo.ai_etapa_em is null or c.last_message_at > alvo.ai_etapa_em)
        order by c.last_message_at asc
        limit ${limite}
        for update of alvo skip locked
     )
    returning d.id
  `
  return linhas.map((l) => l.id)
}

/** Uma rodada completa: abre o que falta, le, e grava o que for seguro gravar. */
export async function rodarClassificacao(
  limite = CARTOES_POR_RODADA
): Promise<ResultadoDaRodada> {
  const resultado: ResultadoDaRodada = {
    abertos: 0,
    lidos: 0,
    movidos: 0,
    contatosPreenchidos: 0,
    incertos: 0,
    falhas: [],
  }

  resultado.abertos = await abrirCartoesQueFaltam(limite)

  for (const dealId of await reservarCartoes(limite)) {
    try {
      const mudou = await classificarCartao(dealId)
      resultado.lidos += 1
      if (mudou.moveu) resultado.movidos += 1
      if (mudou.preencheuContato) resultado.contatosPreenchidos += 1
      if (mudou.incerto) resultado.incertos += 1
    } catch (e) {
      // Uma conversa que falha nao derruba a rodada. Mas tambem nao some: o
      // cartao ja esta marcado, entao so volta a fila na proxima mensagem —
      // e a falha precisa aparecer em algum lugar para alguem olhar.
      resultado.falhas.push({
        dealId,
        erro: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return resultado
}

async function classificarCartao(dealId: string) {
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, isDeleted: false },
    select: {
      id: true,
      stage: true,
      conversationId: true,
      contact: { select: { id: true, name: true, preferredSize: true, tags: true } },
    },
  })
  if (!deal?.conversationId) return { moveu: false, preencheuContato: false, incerto: false }

  const mensagens = await prisma.message.findMany({
    where: { conversationId: deal.conversationId },
    orderBy: { createdAt: "desc" },
    take: MENSAGENS_LIDAS,
    select: { senderType: true, content: true, contentType: true },
  })

  const paraLer: MensagemParaLer[] = mensagens
    .reverse()
    .map((m) => ({
      de: m.senderType === "customer" ? ("cliente" as const) : ("loja" as const),
      // Midia sem legenda vira o tipo dela: "[image]" diz mais do que nada.
      texto: (m.content || `[${m.contentType}]`).slice(0, 600),
    }))
    .filter((m) => m.texto.trim().length > 0)

  if (paraLer.length === 0) return { moveu: false, preencheuContato: false, incerto: false }

  const leitura = await classificarConversa({ mensagens: paraLer, etapaAtual: deal.stage })

  if (leitura.confianca < CONFIANCA_MINIMA) {
    return { moveu: false, preencheuContato: false, incerto: true }
  }

  const preencheuContato = await preencherContato(deal.contact, leitura.contato)

  // So avanca — ver a regra 1 no cabecalho.
  const moveu = ordemDaEtapa(leitura.etapa) > ordemDaEtapa(deal.stage)
  if (moveu) {
    await prisma.$transaction([
      prisma.deal.update({
        where: { id: deal.id },
        data: { stage: leitura.etapa, lastActivityAt: new Date() },
      }),
      prisma.dealEvent.create({
        data: {
          dealId: deal.id,
          fromStage: deal.stage,
          toStage: leitura.etapa,
          // `changedBy` fica nulo: a IA nao se passa por pessoa na trilha.
          changedBy: null,
          notes: `IA: ${leitura.motivo}`,
        },
      }),
    ])
  }

  return { moveu, preencheuContato, incerto: false }
}

/** Preenche SO o que esta vazio; tags sao acrescentadas, nunca substituidas. */
async function preencherContato(
  atual: { id: string; name: string | null; preferredSize: string | null; tags: string[] },
  lido: { nome?: string; tamanho?: string; tags?: string[] }
): Promise<boolean> {
  const dados: Prisma.ContactUpdateInput = {}

  if (lido.nome && !atual.name) dados.name = lido.nome
  if (lido.tamanho && !atual.preferredSize) dados.preferredSize = lido.tamanho

  const novas = (lido.tags ?? []).filter((t) => !atual.tags.includes(t))
  if (novas.length > 0) dados.tags = [...atual.tags, ...novas]

  if (Object.keys(dados).length === 0) return false

  await prisma.contact.update({ where: { id: atual.id }, data: dados })
  return true
}
