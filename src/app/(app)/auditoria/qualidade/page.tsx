import type { Metadata } from "next";
import Link from "next/link";
import { EstadoErro } from "@/components/comum/estado-erro";
import { EstadoVazio } from "@/components/comum/estado-vazio";
import { Tempo } from "@/components/comum/tempo";
import { ocorrenciasDaPessoa, qualidadePorPessoa } from "@/lib/actions/auditoria";
import { FormularioFiltros } from "../_components/formulario-filtros";
import { TabelaQualidade, type Indicador } from "../_components/tabela-qualidade";
import { um, urlCom, type Parametros } from "../_components/url";

export const metadata: Metadata = { title: "Qualidade · Auditoria" };

const INDICADORES: Readonly<Record<Indicador, { rotulo: string; fonte: string }>> = {
  falhas_envio: {
    rotulo: "Falhas de envio",
    fonte: "Mensagens que a pessoa enviou e o canal recusou (com o motivo).",
  },
  dispensas_masc: {
    rotulo: "Dispensas do Masc",
    fonte: "Pedidos que a pessoa dispensou do lançamento no Masc.",
  },
  voltou_fila_masc: {
    rotulo: "Voltaram à fila do Masc",
    fonte: "Pedidos que a pessoa devolveu para a fila de lançamento.",
  },
  recusas_403: {
    rotulo: "Acessos negados",
    fonte: "Vezes em que a pessoa tentou uma ação que o papel dela não permite.",
  },
};

/**
 * `/auditoria/qualidade` — o painel do dono: erros por pessoa (04-ui.md §5.5).
 * Quatro indicadores, todos com fonte real e escrita na tela. Conflito de
 * edição não entra: não há fonte na lista fechada (R-04).
 */
export default async function PaginaQualidade({ searchParams }: { searchParams: Promise<Parametros> }) {
  const p = await searchParams;
  const de = um(p.de);
  const ate = um(p.ate);
  const indicador = um(p.indicador) as Indicador | undefined;
  const pessoa = um(p.pessoa);

  const [resultado, ocorrencias] = await Promise.all([
    qualidadePorPessoa({ de, ate }),
    indicador && pessoa ? ocorrenciasDaPessoa({ indicador, pessoa, de, ate }) : Promise.resolve(null),
  ]);

  if (!resultado.ok) {
    return <EstadoErro titulo="Não foi possível montar o painel." descricao={resultado.mensagem} />;
  }
  const { linhas, periodo } = resultado.dados;
  const nomeDaPessoa = linhas.find((l) => l.pessoaId === pessoa)?.nome ?? "Pessoa";

  return (
    <>
      <FormularioFiltros
        destino="/auditoria/qualidade"
        campos={[
          { tipo: "data", nome: "de", rotulo: "De", valor: periodo.deTexto },
          { tipo: "data", nome: "ate", rotulo: "Até", valor: periodo.ateTexto },
        ]}
      />

      <dl className="grid gap-2 text-denso sm:grid-cols-2">
        {Object.entries(INDICADORES).map(([chave, i]) => (
          <div key={chave}>
            <dt className="font-medium">{i.rotulo}</dt>
            <dd className="text-muted-foreground">{i.fonte}</dd>
          </div>
        ))}
      </dl>

      {ocorrencias ? (
        <section aria-labelledby="ocorrencias-titulo" className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <h2 id="ocorrencias-titulo" className="text-titulo-secao font-medium">
              {indicador ? INDICADORES[indicador]?.rotulo : ""} · {nomeDaPessoa}
            </h2>
            <Link
              href={urlCom("/auditoria/qualidade", p, { indicador: undefined, pessoa: undefined })}
              scroll={false}
              className="text-denso underline-offset-4 hover:underline"
            >
              Fechar
            </Link>
          </div>
          {!ocorrencias.ok ? (
            <EstadoErro titulo="Não foi possível abrir as ocorrências." descricao={ocorrencias.mensagem} />
          ) : ocorrencias.dados.length === 0 ? (
            <EstadoVazio titulo="Nenhuma ocorrência no período." />
          ) : (
            <ul className="flex flex-col gap-1">
              {ocorrencias.dados.map((o) => (
                <li key={o.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-2">
                  <span className="text-corpo">
                    {o.rota ? (
                      <Link href={o.rota} className="underline-offset-4 hover:underline">
                        {o.descricao ?? "Sem descrição"}
                      </Link>
                    ) : (
                      (o.descricao ?? "Sem descrição")
                    )}
                  </span>
                  <span className="text-legenda text-muted-foreground">
                    <Tempo valor={o.quando.toISOString()} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <TabelaQualidade
        rotulos={Object.fromEntries(Object.entries(INDICADORES).map(([k, v]) => [k, v.rotulo])) as Record<Indicador, string>}
        linhas={linhas.map((l) => ({
          ...l,
          hrefs: {
            falhas_envio: urlCom("/auditoria/qualidade", p, { indicador: "falhas_envio", pessoa: l.pessoaId }),
            dispensas_masc: urlCom("/auditoria/qualidade", p, { indicador: "dispensas_masc", pessoa: l.pessoaId }),
            voltou_fila_masc: urlCom("/auditoria/qualidade", p, { indicador: "voltou_fila_masc", pessoa: l.pessoaId }),
            recusas_403: urlCom("/auditoria/qualidade", p, { indicador: "recusas_403", pessoa: l.pessoaId }),
          },
        }))}
      />
    </>
  );
}
