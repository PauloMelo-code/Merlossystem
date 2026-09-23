/**
 * Funil automatico — o que precisa ser verdade antes de deixar um modelo
 * escrever na coluna que organiza o atendimento.
 *
 * `deals.stage` e `text` sem CHECK: qualquer string entra, e etapa
 * desconhecida some da tela sem erro nenhum. Entao a barreira toda esta aqui.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  ETAPAS,
  ETAPAS_DA_IA,
  ehEtapa,
  ehEtapaDaIA,
  ordemDaEtapa,
  rotuloDaEtapa,
} from "@/lib/funil/etapas"
import { interpretar, ClassificacaoInvalida, CONFIANCA_MINIMA } from "@/lib/funil/classificar"

const raiz = resolve(__dirname, "..")
const ler = (...p: string[]) => readFileSync(resolve(raiz, ...p), "utf8")

const json = (o: unknown) => JSON.stringify(o)
const valida = {
  etapa: "interested",
  confianca: 0.9,
  motivo: "Perguntou o preco do vestido.",
  contato: {},
}

describe("as etapas", () => {
  it("sao as seis que a tela do pipeline monta, nessa ordem", () => {
    expect(ETAPAS.map((e) => e.valor)).toEqual([
      "lead",
      "interested",
      "negotiating",
      "closing",
      "won",
      "lost",
    ])
  })

  it("a IA escolhe entre cinco: Perdeu nao esta na lista", () => {
    // Marcar perda e decisao de pessoa — a tela pede o MOTIVO ao arrastar para
    // "Perdeu" porque a loja quer saber por que perdeu. Uma IA movendo para la
    // por silencio enterraria cliente viva e estragaria esse relatorio.
    expect(ETAPAS_DA_IA.map((e) => e.valor)).not.toContain("lost")
    expect(ehEtapaDaIA("lost")).toBe(false)
    expect(ehEtapa("lost")).toBe(true)
  })

  it("toda etapa tem criterio escrito — sem ele o modelo inventa a regua", () => {
    for (const e of ETAPAS) {
      expect(e.criterio.length, e.valor).toBeGreaterThan(20)
    }
  })

  it("recusa o que nao e etapa", () => {
    expect(ehEtapa("negociando")).toBe(false)
    expect(ehEtapa("Interested")).toBe(false)
    expect(ehEtapa(null)).toBe(false)
    expect(ordemDaEtapa("inventada")).toBe(-1)
    expect(rotuloDaEtapa("interested")).toBe("Interessada")
  })
})

describe("interpretar a resposta do modelo", () => {
  it("le o JSON e devolve o que da para gravar", () => {
    const r = interpretar(json(valida))
    expect(r.etapa).toBe("interested")
    expect(r.confianca).toBe(0.9)
    expect(r.motivo).toBe("Perguntou o preco do vestido.")
  })

  it("aceita o JSON embrulhado em texto, que e como o modelo costuma responder", () => {
    expect(interpretar(`Claro!\n\`\`\`json\n${json(valida)}\n\`\`\``).etapa).toBe("interested")
  })

  it("etapa fora da lista e ERRO, nao valor padrao", () => {
    // `src/lib/ai/classify.ts` degrada em silencio para "outro" quando o JSON
    // nao casa. Aqui isso empurraria todo atendimento para a etapa padrao sem
    // ninguem perceber que o modelo nunca respondeu direito.
    expect(() => interpretar(json({ ...valida, etapa: "negociando" }))).toThrow(
      ClassificacaoInvalida
    )
    expect(() => interpretar(json({ ...valida, etapa: "lost" }))).toThrow(ClassificacaoInvalida)
    expect(() => interpretar(json({ ...valida, etapa: 3 }))).toThrow(ClassificacaoInvalida)
  })

  it("resposta sem JSON ou com JSON quebrado e erro", () => {
    expect(() => interpretar("nao consegui classificar")).toThrow(ClassificacaoInvalida)
    expect(() => interpretar("{ etapa: sem aspas }")).toThrow(ClassificacaoInvalida)
    expect(() => interpretar("")).toThrow(ClassificacaoInvalida)
  })

  it("nao inventa dado de contato que a conversa nao deu", () => {
    // Campo ausente tem de continuar ausente: `nome: ""` gravaria vazio por
    // cima do que a equipe digitou.
    const r = interpretar(json(valida))
    expect(r.contato.nome).toBeUndefined()
    expect(r.contato.tamanho).toBeUndefined()
    expect(r.contato.tags).toBeUndefined()

    const vazio = interpretar(json({ ...valida, contato: { nome: "   ", tags: [] } }))
    expect(vazio.contato.nome).toBeUndefined()
    expect(vazio.contato.tags).toBeUndefined()
  })

  it("so aceita tamanho que a coluna entende", () => {
    expect(interpretar(json({ ...valida, contato: { tamanho: "plussize" } })).contato.tamanho).toBe(
      "plussize"
    )
    expect(interpretar(json({ ...valida, contato: { tamanho: "GG" } })).contato.tamanho).toBeUndefined()
  })

  it("corta as tags em tres, minusculas", () => {
    const r = interpretar(
      json({ ...valida, contato: { tags: ["Vestido", "PLUS SIZE", "troca", "quarta", "quinta"] } })
    )
    expect(r.contato.tags).toEqual(["vestido", "plus size", "troca"])
  })

  it("confianca fica entre 0 e 1, venha o que vier", () => {
    expect(interpretar(json({ ...valida, confianca: 7 })).confianca).toBe(1)
    expect(interpretar(json({ ...valida, confianca: -2 })).confianca).toBe(0)
    expect(interpretar(json({ ...valida, confianca: "alta" })).confianca).toBe(0)
  })

  it("o corte de confianca existe e nao e zero", () => {
    expect(CONFIANCA_MINIMA).toBeGreaterThan(0)
    expect(CONFIANCA_MINIMA).toBeLessThanOrEqual(1)
  })
})

describe("o que a rodada automatica nao faz", () => {
  const lib = ler("src", "lib", "funil", "automacao.ts")

  it("so AVANCA o cartao, nunca puxa para tras", () => {
    // Quem moveu o cartao para frente foi uma pessoa lendo a mesma conversa.
    // Desfazer isso por leitura de maquina apaga trabalho de quem atendia.
    expect(lib).toMatch(/ordemDaEtapa\(leitura\.etapa\) > ordemDaEtapa\(deal\.stage\)/)
  })

  it("nao reatribui vendedora", () => {
    // `assignedTo` so aparece na CRIACAO do cartao, herdado da conversa.
    const depoisDaCriacao = lib.slice(lib.indexOf("export async function rodarClassificacao"))
    expect(depoisDaCriacao).not.toMatch(/assignedTo/)
  })

  it("reserva o lote com skip locked, como o disparo de campanha", () => {
    // Sem isso, duas execucoes sobrepostas do cron mandam a mesma conversa
    // duas vezes para a Anthropic e movem o cartao duas vezes.
    expect(lib).toMatch(/for update of alvo skip locked/)
  })

  it("nao classifica cartao ja fechado", () => {
    expect(lib).toMatch(/stage not in \('won', 'lost'\)/)
  })

  it("a trilha nao atribui a mudanca a uma pessoa", () => {
    expect(lib).toMatch(/changedBy: null/)
    expect(lib).toMatch(/notes: `IA: \$\{leitura\.motivo\}`/)
  })

  it("o carimbo da fila nao mexe no relogio do alerta de deal parado", () => {
    // `last_activity_at` alimenta o alerta que procura cartao esquecido;
    // carimbar la a cada leitura esconderia justamente o que ele procura.
    expect(lib).toMatch(/ai_etapa_em = now\(\)/)
    expect(lib).not.toMatch(/set last_activity_at/)
  })
})

describe("a etapa nao entra no banco sem passar pela lista", () => {
  it("as duas rotas de deal validam contra a lista fechada", () => {
    for (const rota of [
      ["src", "app", "api", "deals", "route.ts"],
      ["src", "app", "api", "deals", "[id]", "route.ts"],
    ]) {
      const src = ler(...rota)
      expect(src, rota.join("/")).toMatch(/z\.enum\(VALORES_DE_ETAPA/)
      expect(src, rota.join("/")).not.toMatch(/stage: z\.string\(\)/)
    }
  })
})
