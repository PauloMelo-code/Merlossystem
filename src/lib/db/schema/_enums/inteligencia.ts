/** Listas fechadas da IA (R2, ADR 0047 e 0050). Os ids de modelo existem SÓ aqui. */
export const MODELO_TEXTO = "claude-sonnet-5" as const;
export const MODELO_CLASSIFICACAO = "claude-haiku-4-5-20251001" as const;
export const MODELO_TRANSCRICAO = "whisper-1" as const;
export const MODELO_SIMULADO = "simulado" as const;

export const MODELOS_IA = [MODELO_TEXTO, MODELO_CLASSIFICACAO, MODELO_TRANSCRICAO, MODELO_SIMULADO] as const;
export type ModeloIa = (typeof MODELOS_IA)[number];

export const INTENCOES_IA = [
  "interesse_compra", "pergunta_preco", "pergunta_tamanho", "pergunta_disponibilidade",
  "pergunta_frete", "pedido_troca", "reclamacao", "elogio", "duvida_geral", "saudacao", "outro",
] as const;
export type IntencaoIa = (typeof INTENCOES_IA)[number];

export const SENTIMENTOS_IA = ["positivo", "neutro", "negativo"] as const;
export type SentimentoIa = (typeof SENTIMENTOS_IA)[number];

export const FUNCOES_IA = ["sugestao", "resumo", "classificacao", "transcricao"] as const;
export type FuncaoIa = (typeof FUNCOES_IA)[number];

export const PROVEDORES_IA = ["anthropic", "openai", "simulado"] as const;
export type ProvedorIa = (typeof PROVEDORES_IA)[number];

export const RESULTADOS_IA = ["sucesso", "falha", "descartada", "recusada_limite"] as const;
export type ResultadoIa = (typeof RESULTADOS_IA)[number];
