import { getAnthropicClient } from "@/lib/ai/client"
import { ETAPAS_DA_IA, ehEtapaDaIA, type Etapa } from "./etapas"

/**
 * Le a conversa e diz em que etapa do funil ela esta, e o que da para
 * preencher da ficha da cliente.
 *
 * Duas decisoes que valem explicar, porque o resto do sistema faz diferente:
 *
 * 1. RESPOSTA INVALIDA E ERRO, nao valor padrao. `src/lib/ai/classify.ts`
 *    degrada em silencio para `intent: "outro"` quando o JSON nao casa — e
 *    aceitavel para uma etiqueta, e seria desastre aqui: empurraria todo
 *    atendimento para a etapa padrao sem ninguem perceber que o modelo nunca
 *    respondeu direito.
 *
 * 2. `lost` NAO esta entre as escolhas possiveis (`ETAPAS_DA_IA`). Marcar
 *    perda e decisao de pessoa, e a tela pede motivo justamente porque a loja
 *    quer saber por que perdeu.
 */

export type LeituraDaConversa = {
  etapa: Etapa
  /** 0 a 1. Abaixo do corte, quem chama ignora em vez de mover o cartao. */
  confianca: number
  /** Uma frase, em PT-BR, para a trilha do cartao. */
  motivo: string
  /** So o que a conversa disser. Campo ausente = nao sabemos, nao "vazio". */
  contato: {
    nome?: string
    tamanho?: "slim" | "plussize" | "both"
    tags?: string[]
  }
}

export class ClassificacaoInvalida extends Error {
  constructor(motivo: string) {
    super(motivo)
    this.name = "ClassificacaoInvalida"
  }
}

/** Corte de confianca. Abaixo disso o cartao fica onde esta. */
export const CONFIANCA_MINIMA = 0.6

/** Ultimas mensagens da conversa, em ordem cronologica. */
export type MensagemParaLer = {
  de: "cliente" | "loja"
  texto: string
}

const MODELO = "claude-sonnet-4-20250514"
/** Teto por chamada: e classificacao curta, nao redacao. */
const MAXIMO_DE_TOKENS = 400
/** O SDK usa 10 minutos por padrao — inaceitavel numa rodada de lote. */
const TIMEOUT_MS = 20_000

function prompt(mensagens: MensagemParaLer[], etapaAtual: string, tamanhosConhecidos: string[]) {
  const esteira = ETAPAS_DA_IA.map((e) => `- ${e.valor}: ${e.criterio}`).join("\n")
  const conversa = mensagens
    .map((m) => `${m.de === "cliente" ? "Cliente" : "Loja"}: ${m.texto}`)
    .join("\n")

  return `Voce lê um atendimento de uma loja de roupa feminina e diz em que etapa do funil ele esta.

ETAPAS POSSIVEIS:
${esteira}

Etapa atual do cartao: ${etapaAtual}

REGRAS:
- Responda SOMENTE com um objeto JSON, sem texto antes ou depois, sem markdown.
- Formato: {"etapa":"...","confianca":0.0,"motivo":"...","contato":{"nome":"...","tamanho":"...","tags":["..."]}}
- "confianca" e de 0 a 1: quanto a conversa sustenta a etapa escolhida.
- "motivo" e UMA frase curta em portugues dizendo o que na conversa levou a essa etapa.
- Em "contato", inclua SO o que a conversa disser de forma explicita. Se a
  cliente nao disse o nome, NAO inclua "nome". Nao deduza, nao invente.
- "tamanho" so pode ser: ${tamanhosConhecidos.join(", ")}.
- "tags" sao no maximo 3 etiquetas curtas em portugues, minusculas, sobre o
  interesse dela (ex.: "vestido", "plus size", "troca"). Sem tag de etapa.
- Na duvida entre duas etapas, escolha a MENOS avancada e baixe a confianca.

CONVERSA:
${conversa}`
}

export async function classificarConversa(opts: {
  mensagens: MensagemParaLer[]
  etapaAtual: string
}): Promise<LeituraDaConversa> {
  const cliente = getAnthropicClient()

  const resposta = await cliente.messages.create(
    {
      model: MODELO,
      max_tokens: MAXIMO_DE_TOKENS,
      messages: [
        {
          role: "user",
          content: prompt(opts.mensagens, opts.etapaAtual, ["slim", "plussize", "both"]),
        },
      ],
    },
    { timeout: TIMEOUT_MS, maxRetries: 1 }
  )

  const bloco = resposta.content.find((b) => b.type === "text")
  const texto = bloco && bloco.type === "text" ? bloco.text : ""
  return interpretar(texto)
}

/**
 * Transforma a resposta do modelo em algo gravavel — ou falha alto.
 *
 * Separado da chamada de rede de proposito: e a parte que decide o que entra
 * no banco, e precisa de teste com entrada e saida de verdade.
 */
export function interpretar(texto: string): LeituraDaConversa {
  const recorte = texto.match(/\{[\s\S]*\}/)
  if (!recorte) throw new ClassificacaoInvalida("resposta sem JSON")

  let cru: unknown
  try {
    cru = JSON.parse(recorte[0])
  } catch {
    throw new ClassificacaoInvalida("JSON malformado")
  }

  const obj = cru as Record<string, unknown>
  if (!ehEtapaDaIA(obj.etapa)) {
    throw new ClassificacaoInvalida(`etapa fora da lista: ${String(obj.etapa)}`)
  }

  const confianca = typeof obj.confianca === "number" ? obj.confianca : 0
  const motivo = typeof obj.motivo === "string" ? obj.motivo.trim().slice(0, 300) : ""

  const contatoCru = (obj.contato ?? {}) as Record<string, unknown>
  const contato: LeituraDaConversa["contato"] = {}

  const nome = typeof contatoCru.nome === "string" ? contatoCru.nome.trim() : ""
  if (nome && nome.length <= 80) contato.nome = nome

  const tamanho = contatoCru.tamanho
  if (tamanho === "slim" || tamanho === "plussize" || tamanho === "both") {
    contato.tamanho = tamanho
  }

  if (Array.isArray(contatoCru.tags)) {
    const tags = contatoCru.tags
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0 && t.length <= 24)
      .slice(0, 3)
    if (tags.length > 0) contato.tags = tags
  }

  return {
    etapa: obj.etapa,
    confianca: Math.min(1, Math.max(0, confianca)),
    motivo,
    contato,
  }
}
