import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BarraFerramentas } from "@/components/comum/barra-ferramentas";
import { CabecalhoPagina } from "@/components/comum/cabecalho-pagina";
import { EstadoErro } from "@/components/comum/estado-erro";
import { FaixaAviso } from "@/components/comum/faixa-aviso";
import { PaginacaoCursor } from "@/components/comum/paginacao-cursor";
import { listarProdutos } from "@/lib/actions/catalogo";
import { hora, data } from "@/lib/formato";
import { TabelaProdutos } from "./_components/tabela-produtos";

export const metadata: Metadata = { title: "Produtos" };

type Parametros = Promise<Record<string, string | string[] | undefined>>;

const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * `/produtos` — catálogo SOMENTE LEITURA, espelho do Bling (04-ui.md §5.3).
 * Nenhuma ação de escrita existe aqui, e a matriz nem tem a chave.
 */
export default async function PaginaProdutos({ searchParams }: { searchParams: Parametros }) {
  const p = await searchParams;
  const resultado = await listarProdutos({
    q: um(p.q),
    cursor: um(p.cursor),
    direcao: um(p.direcao) as "anterior" | "proxima" | undefined,
    porPagina: um(p.porPagina) ?? "50",
  });

  if (!resultado.ok) {
    if (resultado.codigo === "NAO_ENCONTRADO") notFound();
    return <EstadoErro titulo="Não foi possível abrir o catálogo." descricao={resultado.mensagem} />;
  }
  const lista = resultado.dados;
  const leitura = lista.ultimaLeitura ? new Date(lista.ultimaLeitura) : null;

  return (
    <div className="flex w-full flex-col gap-6 p-4 md:p-6">
      <CabecalhoPagina titulo="Produtos" descricao="Catálogo da rede, lido do Bling." />

      <FaixaAviso
        tom="info"
        titulo={
          leitura
            ? `Produtos e estoque vêm do Bling (somente leitura). Leitura de ${data(leitura)} às ${hora(leitura)}.`
            : "Produtos e estoque vêm do Bling (somente leitura). Ainda não houve leitura."
        }
      />
      {!lista.lojaEscolhida ? (
        <FaixaAviso
          tom="neutro"
          titulo="Escolha uma loja no topo da tela para ver o saldo disponível."
          descricao="O saldo é do depósito de cada loja; somar as duas daria um número que nenhuma loja tem."
        />
      ) : null}

      <BarraFerramentas
        busca={{ parametro: "q", placeholder: "Buscar nome ou SKU" }}
        contagem={`${lista.itens.length}${lista.cursorProximo ? " de muitos" : ""}`}
      />

      <TabelaProdutos
        itens={lista.itens}
        mostrarLoja={!lista.lojaEscolhida}
        mostrarSaldo={lista.lojaEscolhida}
        comBusca={Boolean(um(p.q))}
      />

      <PaginacaoCursor
        cursorAnterior={lista.cursorAnterior}
        cursorProximo={lista.cursorProximo}
        porPagina={Number(um(p.porPagina) ?? 50)}
      />
    </div>
  );
}
