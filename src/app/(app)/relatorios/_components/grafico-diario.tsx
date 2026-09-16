"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

export type PontoNaTela = { dia: string; valor: number; rotulo: string };

/**
 * Barras por dia com `--chart-*` (04-ui.md §3). O gráfico é DECORATIVO para o
 * leitor de tela e some no celular: a informação completa está na tabela
 * alternativa que acompanha cada gráfico (`TabelaDiaria`).
 */
export function GraficoDiario({
  pontos,
  nome,
  variavel,
}: {
  pontos: readonly PontoNaTela[];
  nome: string;
  variavel: `--chart-${1 | 2 | 3 | 4 | 5}`;
}) {
  const config: ChartConfig = { valor: { label: nome, color: `var(${variavel})` } };
  return (
    <div aria-hidden="true" className="hidden md:block">
      <ChartContainer config={config} className="h-56 w-full">
        <BarChart data={[...pontos]} accessibilityLayer={false}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="dia" tickLine={false} axisLine={false} tickFormatter={(d: string) => d.slice(8, 10)} />
          <YAxis tickLine={false} axisLine={false} width={48} />
          <ChartTooltip
            content={<ChartTooltipContent formatter={(_valor, _nome, item) => (item.payload as PontoNaTela).rotulo} />}
          />
          <Bar dataKey="valor" fill="var(--color-valor)" radius={3} />
        </BarChart>
      </ChartContainer>
    </div>
  );
}
