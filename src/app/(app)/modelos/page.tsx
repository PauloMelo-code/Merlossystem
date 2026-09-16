import type { Metadata } from "next";
import { CabecalhoPagina } from "@/components/comum/cabecalho-pagina";
import { FaixaAviso } from "@/components/comum/faixa-aviso";
import { abrirPagina } from "@/lib/campanhas/pagina";
import { contasOficiais, listarModelos } from "@/lib/conteudo/_consultas";
import { ListaModelos } from "./_components/lista-modelos";

export const metadata: Metadata = { title: "Modelos do WhatsApp" };

/**
 * `/modelos` — modelos do WhatsApp oficial (04-ui.md §5.4). O `status` vem da
 * Meta; a tela NÃO oferece "aprovar" manualmente.
 *
 * "Enviar para aprovação" não aparece: o cliente da API da Meta é do pacote de
 * integrações e ainda não tem costura para cá (bloqueio registrado pelo M6).
 * Botão que não faz nada seria fachada (U8).
 */
export default async function PaginaModelos() {
  const { escopo, lojaId, permite } = await abrirPagina("modelos:ler");
  const [modelos, contas] = await Promise.all([
    listarModelos(escopo),
    lojaId ? contasOficiais(lojaId) : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
      <CabecalhoPagina
        titulo="Modelos do WhatsApp"
        descricao="Mensagens pré-aprovadas pela Meta, usadas em campanha e fora da janela de 24 horas."
      />
      <FaixaAviso tom="info" titulo="Modelos valem só para números oficiais. O uazapi não usa modelo." />
      {lojaId === null ? (
        <FaixaAviso tom="info" titulo="Escolha uma loja no topo da tela para criar ou editar modelos." />
      ) : null}
      <ListaModelos
        modelos={modelos.map((m) => ({ ...m, atualizadoEm: m.atualizadoEm.toISOString() }))}
        contas={contas}
        podeCriar={lojaId !== null && permite("modelos:criar") && contas.length > 0}
        podeEditar={lojaId !== null && permite("modelos:editar")}
        podeExcluir={lojaId !== null && permite("modelos:excluir")}
      />
    </div>
  );
}
