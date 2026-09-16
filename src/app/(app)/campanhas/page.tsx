import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CabecalhoPagina } from "@/components/comum/cabecalho-pagina";
import { PaginacaoCursor } from "@/components/comum/paginacao-cursor";
import { listarCampanhas } from "@/lib/campanhas/_consultas";
import { decodificarCursor, lerDirecao, lerPorPagina } from "@/lib/campanhas/cursor";
import { abrirPagina, parametro } from "@/lib/campanhas/pagina";
import { TabelaCampanhas } from "./_components/tabela-campanhas";

export const metadata: Metadata = { title: "Campanhas" };

type Busca = Promise<Record<string, string | string[] | undefined>>;

/**
 * `/campanhas` — lista com progresso (04-ui.md §5.4). O progresso é
 * `count(*)` no servidor, nunca contador de aba.
 */
export default async function PaginaCampanhas({ searchParams }: { searchParams: Busca }) {
  const { escopo, lojaId, permite } = await abrirPagina("campanhas:ler");
  const busca = await searchParams;
  const porPagina = lerPorPagina(parametro(busca.porPagina));
  const pagina = await listarCampanhas(escopo, {
    cursor: decodificarCursor(parametro(busca.cursor)),
    direcao: lerDirecao(parametro(busca.direcao)),
    limite: porPagina,
  });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-6">
      <CabecalhoPagina
        titulo="Campanhas"
        descricao="Disparos em lote pelo número escolhido, no ritmo que a conta aguenta."
        acoes={
          lojaId !== null && permite("campanhas:criar") ? (
            <Button asChild>
              <Link href="/campanhas/nova">
                <Plus aria-hidden="true" strokeWidth={2} />
                Nova campanha
              </Link>
            </Button>
          ) : null
        }
      />
      <TabelaCampanhas
        itens={pagina.itens.map((i) => ({
          ...i,
          criadoEm: i.criadoEm.toISOString(),
          iniciadaEm: i.iniciadaEm?.toISOString() ?? null,
        }))}
      />
      <PaginacaoCursor
        cursorAnterior={pagina.cursorAnterior}
        cursorProximo={pagina.cursorProximo}
        porPagina={porPagina}
      />
    </div>
  );
}
