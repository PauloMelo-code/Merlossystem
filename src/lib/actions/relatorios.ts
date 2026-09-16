"use server";

import { executarAcao } from "@/lib/actions/_base";
import { pode } from "@/lib/auth/guard";
import type { Resultado } from "@/lib/erros";
import { moeda } from "@/lib/formato";
import { formatarValor, gerarCsv, METRICAS, montarRelatorio } from "@/lib/relatorios";
import { filtrosRelatorioSchema } from "@/lib/validadores/relatorios";

/**
 * Actions de `/relatorios` (04-ui.md §5.5).
 *
 * Chave `relatorios:ler` (todos os papéis), a que `docs/seguranca/
 * caminhos-de-acesso.md` fixa para a rota; exportar é `relatorios:exportar`
 * (gestão). O número de uma loja só sai para quem tem escopo sobre ela.
 *
 * A action devolve o texto JÁ FORMATADO e a definição de cada métrica: a tela
 * não recalcula nada e não importa o domínio.
 */

export type CartaoDeMetrica = { id: string; rotulo: string; valor: string; definicao: string };
export type DiaDoRelatorio = {
  dia: string;
  receita: number;
  receitaTexto: string;
  conversas: number;
};

export type TelaRelatorio = {
  loja: string;
  deTexto: string;
  ateTexto: string;
  cartoes: CartaoDeMetrica[];
  serie: DiaDoRelatorio[];
  podeExportar: boolean;
};

export async function relatorioDoPeriodo(bruto: unknown): Promise<Resultado<TelaRelatorio>> {
  return executarAcao(
    {
      permissao: "relatorios:ler",
      entrada: filtrosRelatorioSchema,
      loja: "le",
      executar: async (periodo, ctx, tx) => {
        const relatorio = await montarRelatorio(ctx.escopo, periodo, tx);
        return {
          loja: relatorio.loja,
          deTexto: periodo.deTexto,
          ateTexto: periodo.ateTexto,
          cartoes: METRICAS.map((m) => ({
            id: m.id,
            rotulo: m.rotulo,
            definicao: m.definicao,
            valor: formatarValor(m.formato, relatorio.indicadores[m.id]),
          })),
          serie: relatorio.serie.map((p) => ({
            dia: p.dia,
            // Só para a ALTURA da barra; o texto exato vem de `moeda`.
            receita: Number(p.receita),
            receitaTexto: moeda(p.receita),
            conversas: p.conversas,
          })),
          podeExportar: pode(ctx.sessao.papel, "relatorios", "exportar"),
        };
      },
    },
    bruto,
  );
}

export async function exportarRelatorioCsv(
  bruto: unknown,
): Promise<Resultado<{ nomeArquivo: string; conteudo: string }>> {
  return executarAcao(
    {
      permissao: "relatorios:exportar",
      entrada: filtrosRelatorioSchema,
      loja: "le",
      executar: async (periodo, ctx, tx) => {
        const relatorio = await montarRelatorio(ctx.escopo, periodo, tx);
        return {
          nomeArquivo: `relatorio_${periodo.deTexto}_${periodo.ateTexto}.csv`,
          conteudo: gerarCsv({ ...relatorio, deTexto: periodo.deTexto, ateTexto: periodo.ateTexto }),
        };
      },
    },
    bruto,
  );
}
