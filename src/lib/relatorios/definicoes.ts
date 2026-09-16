/**
 * As métricas de `/relatorios` e a DEFINIÇÃO de cada uma (04-ui.md §5.5: "toda
 * métrica tem definição no `?`"). Módulo PURO — a tela e o CSV leem daqui.
 *
 * As duas definições que o documento FIXOU estão escritas como ele manda:
 *   - Receita = soma de `pedidos.total` dos pedidos com `masc_status =
 *     'lancado'` no período (lançar no Masc é o único fato que o sistema
 *     confirma; pagamento está fora do R1). O período é o de `masc_lancado_em`.
 *   - Tempo de primeira resposta = `primeira_resposta_em − created_at` da
 *     conversa.
 * As demais são contagens diretas, com a fonte dita na própria definição.
 */

import { moeda } from "@/lib/formato";

export type Formato = "numero" | "moeda" | "minutos" | "percentual";

export type MetricaId = keyof Indicadores;

export type Metrica = {
  id: MetricaId;
  rotulo: string;
  formato: Formato;
  definicao: string;
};

export const METRICAS: readonly Metrica[] = [
  {
    id: "receita",
    rotulo: "Receita",
    formato: "moeda",
    definicao:
      "Soma do total dos pedidos lançados no Masc no período (data do lançamento). Pagamento não entra: o sistema ainda não confirma pagamento.",
  },
  {
    id: "pedidosLancados",
    rotulo: "Pedidos lançados",
    formato: "numero",
    definicao: "Quantidade de pedidos marcados como lançados no Masc no período (data do lançamento).",
  },
  {
    id: "ticketMedio",
    rotulo: "Ticket médio",
    formato: "moeda",
    definicao: "Receita dividida pela quantidade de pedidos lançados no período.",
  },
  {
    id: "pedidosCriados",
    rotulo: "Pedidos criados",
    formato: "numero",
    definicao: "Pedidos criados no período, exceto os cancelados. Inclui os que ainda não foram lançados.",
  },
  {
    id: "conversasIniciadas",
    rotulo: "Conversas iniciadas",
    formato: "numero",
    definicao: "Conversas abertas no período (data de criação da conversa), em todos os canais.",
  },
  {
    id: "taxaResposta",
    rotulo: "Conversas respondidas",
    formato: "percentual",
    definicao:
      "Parte das conversas iniciadas no período que já recebeu a primeira resposta da equipe.",
  },
  {
    id: "tempoPrimeiraResposta",
    rotulo: "Tempo de primeira resposta",
    formato: "minutos",
    definicao:
      "Mediana, entre as conversas iniciadas no período e já respondidas, do intervalo entre a abertura da conversa e a primeira resposta da equipe.",
  },
];

export type Indicadores = {
  receita: string;
  pedidosLancados: number;
  ticketMedio: string | null;
  pedidosCriados: number;
  conversasIniciadas: number;
  /** 0 a 1; nulo quando não houve conversa no período. */
  taxaResposta: number | null;
  /** Em minutos; nulo quando nenhuma conversa foi respondida. */
  tempoPrimeiraResposta: number | null;
};

export type PontoDaSerie = { dia: string; receita: string; conversas: number };

/** Texto pronto para tela e CSV. Nulo vira travessão: "sem dado" não é zero. */
export function formatarValor(formato: Formato, valor: string | number | null): string {
  if (valor === null) return "—";
  switch (formato) {
    case "moeda":
      return moeda(String(valor));
    case "percentual":
      return `${(Number(valor) * 100).toFixed(1).replace(".", ",")}%`;
    case "minutos": {
      const minutos = Math.round(Number(valor));
      if (minutos < 60) return `${minutos} min`;
      const horas = Math.floor(minutos / 60);
      const resto = minutos % 60;
      return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`;
    }
    case "numero":
      return String(valor).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }
}
