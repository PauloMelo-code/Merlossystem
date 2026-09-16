import type { Metadata } from "next";
import { CabecalhoPagina } from "@/components/comum/cabecalho-pagina";
import { EstadoErro } from "@/components/comum/estado-erro";
import { relatorioDoPeriodo } from "@/lib/actions/relatorios";
import { FormularioFiltros } from "../auditoria/_components/formulario-filtros";
import { um, type Parametros } from "../auditoria/_components/url";
import { BotaoExportar } from "./_components/botao-exportar";
import { GraficoDiario } from "./_components/grafico-diario";
import { TabelaDiaria } from "./_components/tabela-diaria";

export const metadata: Metadata = { title: "Relatórios" };

const dataBr = (iso: string) => iso.split("-").reverse().join("/");

/**
 * `/relatorios` — indicadores de atendimento e venda (04-ui.md §5.5). O
 * cabeçalho diz QUAL LOJA e QUAL PERÍODO; toda métrica tem a definição no "?".
 * A loja é a do seletor do cabeçalho; o período vem da URL.
 */
export default async function PaginaRelatorios({ searchParams }: { searchParams: Promise<Parametros> }) {
  const p = await searchParams;
  const resultado = await relatorioDoPeriodo({ de: um(p.de), ate: um(p.ate) });

  if (!resultado.ok) {
    return (
      <div className="p-4 md:p-6">
        <EstadoErro titulo="Não foi possível montar o relatório." descricao={resultado.mensagem} />
      </div>
    );
  }
  const r = resultado.dados;
  const vazio = r.serie.every((d) => d.receita === 0 && d.conversas === 0);

  return (
    <div className="flex w-full flex-col gap-6 p-4 md:p-6">
      <CabecalhoPagina
        titulo="Relatórios"
        descricao={`${r.loja} · de ${dataBr(r.deTexto)} a ${dataBr(r.ateTexto)}`}
        {...(r.podeExportar ? { acoes: <BotaoExportar de={r.deTexto} ate={r.ateTexto} /> } : {})}
      />

      <FormularioFiltros
        destino="/relatorios"
        rotuloBotao="Ver período"
        campos={[
          { tipo: "data", nome: "de", rotulo: "De", valor: r.deTexto },
          { tipo: "data", nome: "ate", rotulo: "Até", valor: r.ateTexto },
        ]}
      />

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {r.cartoes.map((c) => (
          <li key={c.id} className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-2">
              <span className="text-denso text-muted-foreground">{c.rotulo}</span>
              <details className="relative">
                <summary
                  aria-label={`O que é ${c.rotulo}`}
                  className="flex size-6 cursor-pointer list-none items-center justify-center rounded-full border border-border text-legenda"
                >
                  ?
                </summary>
                <p className="absolute right-0 z-10 mt-1 w-64 rounded-md border border-border bg-popover p-3 text-legenda text-popover-foreground shadow-md">
                  {c.definicao}
                </p>
              </details>
            </div>
            <span className="text-2xl font-semibold tabular-nums">{c.valor}</span>
          </li>
        ))}
      </ul>

      {vazio ? (
        <p className="text-corpo text-muted-foreground">Nenhuma venda lançada nem conversa iniciada no período.</p>
      ) : (
        <section aria-label="Evolução diária" className="grid gap-6 lg:grid-cols-2">
          <div className="flex flex-col gap-2">
            <h2 className="hidden text-titulo-secao font-medium md:block" aria-hidden="true">Receita por dia</h2>
            <GraficoDiario
              nome="Receita"
              variavel="--chart-1"
              pontos={r.serie.map((d) => ({ dia: d.dia, valor: d.receita, rotulo: d.receitaTexto }))}
            />
          </div>
          <div className="flex flex-col gap-2">
            <h2 className="hidden text-titulo-secao font-medium md:block" aria-hidden="true">Conversas iniciadas por dia</h2>
            <GraficoDiario
              nome="Conversas"
              variavel="--chart-2"
              pontos={r.serie.map((d) => ({ dia: d.dia, valor: d.conversas, rotulo: String(d.conversas) }))}
            />
          </div>
          <div className="lg:col-span-2">
            <TabelaDiaria
              legenda="Receita e conversas por dia"
              linhas={r.serie.map((d) => ({
                dia: dataBr(d.dia),
                receita: d.receitaTexto,
                conversas: String(d.conversas),
              }))}
            />
          </div>
        </section>
      )}
    </div>
  );
}
