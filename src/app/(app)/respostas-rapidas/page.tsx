import type { Metadata } from "next";
import { CabecalhoPagina } from "@/components/comum/cabecalho-pagina";
import { FaixaAviso } from "@/components/comum/faixa-aviso";
import { abrirPagina } from "@/lib/campanhas/pagina";
import { listarRespostas } from "@/lib/conteudo/_consultas";
import { ListaRespostas } from "./_components/lista-respostas";

export const metadata: Metadata = { title: "Respostas rápidas" };

/**
 * `/respostas-rapidas` — atalhos do chat (04-ui.md §5.4). Ler: `respostas:ler`;
 * criar/editar/excluir pelas chaves próprias da matriz.
 */
export default async function PaginaRespostasRapidas() {
  const { escopo, lojaId, permite } = await abrirPagina("respostas:ler");
  const respostas = await listarRespostas(escopo);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
      <CabecalhoPagina
        titulo="Respostas rápidas"
        descricao='Textos prontos para o chat. Digite o atalho (ex.: "/frete") na conversa para usar.'
      />
      {lojaId === null ? (
        <FaixaAviso tom="info" titulo="Escolha uma loja no topo da tela para criar ou editar respostas." />
      ) : null}
      <ListaRespostas
        respostas={respostas.map((r) => ({ ...r, atualizadoEm: r.atualizadoEm.toISOString() }))}
        podeCriar={lojaId !== null && permite("respostas:criar")}
        podeEditar={lojaId !== null && permite("respostas:editar")}
        podeExcluir={lojaId !== null && permite("respostas:excluir")}
      />
    </div>
  );
}
