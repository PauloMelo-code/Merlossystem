/**
 * As etapas do funil — fonte unica.
 *
 * Antes disto a lista vivia em seis lugares, com recortes diferentes: a rota
 * de deals, a tela do pipeline (com rotulo e cor), a tela de analytics, a rota
 * de analytics (so quatro), o motor de alertas e o seed. O banco nao ajuda:
 * `deals.stage` e `text` sem CHECK e a validacao de entrada e `z.string()`,
 * entao QUALQUER texto entra. Uma etapa escrita errada nao da erro — o cartao
 * some da tela, porque o agrupamento so monta as colunas conhecidas.
 *
 * Isso era tolerado enquanto so gente escrevia ali. Com a classificacao
 * automatica, uma etapa alucinada pelo modelo enterraria o atendimento sem
 * nenhum sinal, e por isso `ehEtapa` existe e e obrigatoria antes de gravar.
 */

export const ETAPAS = [
  {
    valor: "lead",
    rotulo: "Lead",
    /** O criterio vai no prompt: sem ele o modelo inventa a propria regua. */
    criterio: "Mandou a primeira mensagem, ainda sem dizer o que quer.",
  },
  {
    valor: "interested",
    rotulo: "Interessada",
    criterio: "Perguntou por peca, preco, tamanho ou foto. Demonstrou interesse.",
  },
  {
    valor: "negotiating",
    rotulo: "Negociando",
    criterio: "Discute valor, frete, desconto, forma de pagamento ou troca de peca.",
  },
  {
    valor: "closing",
    rotulo: "Fechando",
    criterio: "Decidiu comprar e trata do fechamento: dados, endereco, link, comprovante.",
  },
  {
    valor: "won",
    rotulo: "Ganhou",
    criterio: "Pagou ou confirmou o pedido.",
  },
  {
    valor: "lost",
    rotulo: "Perdeu",
    criterio: "Desistiu. So pessoa marca esta etapa.",
  },
] as const

export type Etapa = (typeof ETAPAS)[number]["valor"]

export const VALORES_DE_ETAPA: readonly string[] = ETAPAS.map((e) => e.valor)

export function ehEtapa(valor: unknown): valor is Etapa {
  return typeof valor === "string" && VALORES_DE_ETAPA.includes(valor)
}

export function rotuloDaEtapa(valor: string): string {
  return ETAPAS.find((e) => e.valor === valor)?.rotulo ?? valor
}

/** Posicao na esteira. `-1` para etapa que nao conhecemos. */
export function ordemDaEtapa(valor: string): number {
  return ETAPAS.findIndex((e) => e.valor === valor)
}

/**
 * O que a classificacao automatica pode escolher.
 *
 * `lost` fica de fora, e nao por cautela: marcar perda e decisao de pessoa. A
 * tela pede motivo (`lossReason`) ao arrastar para "Perdeu" justamente porque
 * a loja quer saber POR QUE perdeu — preco, tamanho em falta, concorrente. Uma
 * IA movendo para la por silencio de dois dias enterraria cliente viva e ainda
 * estragaria o unico relatorio que explica a perda.
 */
export const ETAPAS_DA_IA = ETAPAS.filter((e) => e.valor !== "lost")

export function ehEtapaDaIA(valor: unknown): valor is Etapa {
  return typeof valor === "string" && ETAPAS_DA_IA.some((e) => e.valor === valor)
}
