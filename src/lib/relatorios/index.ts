import "server-only";
import type { EscopoLoja } from "@/lib/auth/loja";
import { calcularIndicadores, nomeDoEscopo, serieDiaria, type Leitor, type Periodo } from "./_consultas";
import type { Indicadores, PontoDaSerie } from "./definicoes";

/**
 * API pública do módulo `relatorios` (03-arquitetura.md §4.2): indicadores
 * por loja e período, com definição explícita.
 */

export { gerarCsv } from "./csv";
export { formatarValor, METRICAS, type Indicadores, type PontoDaSerie } from "./definicoes";

export type Relatorio = {
  loja: string;
  indicadores: Indicadores;
  serie: PontoDaSerie[];
};

export async function montarRelatorio(
  escopo: EscopoLoja,
  periodo: Periodo,
  leitor?: Leitor,
): Promise<Relatorio> {
  const [loja, indicadores, serie] = await Promise.all([
    nomeDoEscopo(escopo, leitor),
    calcularIndicadores(escopo, periodo, leitor),
    serieDiaria(escopo, periodo, leitor),
  ]);
  return { loja, indicadores, serie };
}

export { resumirDiaAnterior } from "./resumo";
