import type { Metadata } from "next";
import { BarraFerramentas } from "@/components/comum/barra-ferramentas";
import { CabecalhoPagina } from "@/components/comum/cabecalho-pagina";
import { EstadoErro } from "@/components/comum/estado-erro";
import { FaixaAviso } from "@/components/comum/faixa-aviso";
import { PaginacaoCursor } from "@/components/comum/paginacao-cursor";
import { listarPedidos } from "@/lib/actions/pedidos";
import { FiltrosPedidos } from "./_components/filtros-pedidos";
import { TabelaPedidos } from "./_components/tabela-pedidos";

export const metadata: Metadata = { title: "Pedidos" };

type Parametros = Promise<Record<string, string | string[] | undefined>>;

const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * `/pedidos` — operação e fila "falta lançar no Masc" (04-ui.md §5.3).
 * Enquanto houver pendente, o filtro padrão é a fila.
 */
export default async function PaginaPedidos({ searchParams }: { searchParams: Parametros }) {
  const p = await searchParams;
  const resultado = await listarPedidos({
    status: um(p.status),
    masc: um(p.masc),
    de: um(p.de),
    ate: um(p.ate),
    q: um(p.q),
    cursor: um(p.cursor),
    direcao: um(p.direcao),
    porPagina: um(p.porPagina) ?? "50",
  } as Parameters<typeof listarPedidos>[0]);

  if (!resultado.ok) {
    return <EstadoErro titulo="Não foi possível abrir os pedidos." descricao={resultado.mensagem} />;
  }
  const lista = resultado.dados;
  const masc = lista.filaPadrao ? "fila" : (um(p.masc) ?? "todos");
  const comFiltro = ["status", "de", "ate", "q"].some((c) => um(p[c]) !== undefined);

  return (
    <div className="flex w-full flex-col gap-6 p-4 md:p-6">
      <CabecalhoPagina titulo="Pedidos" descricao="Pedidos das conversas e a ponte manual com o Masc." />

      {lista.pendentesNoMasc > 0 ? (
        <FaixaAviso
          tom="aviso"
          titulo={
            lista.pendentesNoMasc === 1
              ? "1 pedido falta lançar no Masc."
              : `${lista.pendentesNoMasc} pedidos faltam lançar no Masc.`
          }
          descricao="Lance a venda no Masc e anote o número aqui. Enquanto não for lançado, o pedido reserva estoque."
        />
      ) : null}

      <BarraFerramentas
        busca={{ parametro: "q", placeholder: "Buscar nº do pedido ou do Masc" }}
        filtros={<FiltrosPedidos mascAtual={masc} />}
        contagem={`${lista.itens.length}${lista.cursorProximo ? " de muitos" : ""}`}
      />

      <TabelaPedidos
        itens={lista.itens}
        mostrarLoja={new Set(lista.itens.map((i) => i.lojaNome)).size > 1}
        naFila={masc === "fila" && !comFiltro}
        comFiltro={comFiltro}
      />

      <PaginacaoCursor
        cursorAnterior={lista.cursorAnterior}
        cursorProximo={lista.cursorProximo}
        porPagina={Number(um(p.porPagina) ?? 50)}
      />
    </div>
  );
}
