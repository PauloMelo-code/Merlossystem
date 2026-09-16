import type { Prioridade, StatusTranscricao } from "@/lib/db/schema/_enums/conversas";
import type { IntencaoIa, SentimentoIa } from "@/lib/db/schema/_enums/inteligencia";

/**
 * Tipos que as telas e M1 importam (só tipo) — dono: R2-C. Arquivo PURO,
 * sem `server-only` (spec r2/final-r2c-inteligencia.md §5.2 e §7.1).
 */

export type SituacaoDoProvedorIa = "ligado" | "desligado" | "simulado";

/** Nenhum segredo, nenhum nome de variável. */
export type EstadoDaIa = {
  sugestao: SituacaoDoProvedorIa;
  resumo: SituacaoDoProvedorIa;
  transcricao: SituacaoDoProvedorIa;
  classificacao: SituacaoDoProvedorIa;
};

/** Todos desligados: o estado sem o pacote e o de `ok: false` da action. */
export const IA_DESLIGADA: EstadoDaIa = {
  sugestao: "desligado",
  resumo: "desligado",
  transcricao: "desligado",
  classificacao: "desligado",
};

/** Lido de `ia_intencao`, `ia_urgencia`, `ia_sentimento`, `ia_classificada_ate`. Nulo quando os quatro são nulos. */
export type IaDaConversa = {
  intencao: IntencaoIa | null;
  urgencia: Prioridade | null;
  sentimento: SentimentoIa | null;
  classificadaAte: string | null;
};

/** O que o balão de áudio precisa para o slot de transcrição. */
export type MidiaDeAudio = {
  id: string;
  transcricao: string | null;
  transcricaoStatus: StatusTranscricao | null;
  transcrevivel: boolean;
  baixada: boolean;
};

export type SugestaoPronta = {
  texto: string;
  fontes: { artigos: { id: string; titulo: string }[]; produtos: { id: string; nome: string }[] };
  avisos: string[];
  /** ISO. */
  geradaEm: string;
  simulado: boolean;
  /** 0–100, arredondado. */
  usoDoDiaPct: number;
};

export type ResumoPronto = {
  pontos: { quem: "cliente" | "equipe"; texto: string }[];
  pendencias: string[];
  mensagensConsideradas: number;
  geradoEm: string;
  simulado: boolean;
};

export type PedidoDeTranscricao = { status: "pendente" | "processando" | "concluida" };
