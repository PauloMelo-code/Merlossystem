import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CabecalhoPagina } from "@/components/comum/cabecalho-pagina";
import { PaginacaoCursor } from "@/components/comum/paginacao-cursor";
import { SeloStatus } from "@/components/comum/selo-status";
import { detalheCampanha, listarDestinatarios } from "@/lib/campanhas/_consultas";
import { decodificarCursor, lerDirecao, lerPorPagina } from "@/lib/campanhas/cursor";
import { abrirPagina, parametro } from "@/lib/campanhas/pagina";
import { previaDoSegmento } from "@/lib/campanhas/segmento";
import { STATUS_DESTINATARIO, type StatusDestinatario } from "@/lib/db/schema/_enums/catalogo";
import { ErroDeEscopo } from "@/lib/erros";
import { uuidSchema } from "@/lib/validadores/comum";
import { ListaDestinatarios } from "../_components/lista-destinatarios";
import { ProgressoDisparo } from "../_components/progresso-disparo";

export const metadata: Metadata = { title: "Campanha" };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** `/campanhas/[id]` — acompanhamento (04-ui.md §5.4). Outra loja = 404. */
export default async function PaginaCampanha({ params, searchParams }: Props) {
  const { escopo, lojaId, permite } = await abrirPagina("campanhas:ler");
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();

  let campanha;
  try {
    campanha = await detalheCampanha(escopo, id);
  } catch (erro) {
    if (erro instanceof ErroDeEscopo) notFound();
    throw erro;
  }

  const busca = await searchParams;
  const statusPedido = parametro(busca.status);
  const status = (STATUS_DESTINATARIO as readonly string[]).includes(statusPedido ?? "")
    ? (statusPedido as StatusDestinatario)
    : undefined;
  const porPagina = lerPorPagina(parametro(busca.porPagina));
  const [pagina, previa] = await Promise.all([
    listarDestinatarios(escopo, id, { status }, {
      cursor: decodificarCursor(parametro(busca.cursor)),
      direcao: lerDirecao(parametro(busca.direcao)),
      limite: porPagina,
    }),
    campanha.status === "rascunho" ? previaDoSegmento(campanha.lojaId, campanha.segmento) : null,
  ]);

  // Gravar exige a loja da campanha escolhida no topo (gestão em "Todas").
  const naLoja = lojaId === campanha.lojaId;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-6">
      <CabecalhoPagina
        titulo={campanha.nome}
        descricao={`Sai pelo número ${campanha.conta}${campanha.modelo ? ` · modelo ${campanha.modelo}` : ""}`}
        breadcrumb={[{ rotulo: "Campanhas", rota: "/campanhas" }, { rotulo: campanha.nome }]}
        acoes={<SeloStatus dominio="status_campanha" valor={campanha.status} />}
      />
      <ProgressoDisparo
        campanha={{
          id: campanha.id,
          nome: campanha.nome,
          status: campanha.status,
          atualizadoEm: campanha.atualizadoEm.toISOString(),
          conta: campanha.conta,
          provedor: campanha.provedor,
          iniciadaEm: campanha.iniciadaEm?.toISOString() ?? null,
          concluidaEm: campanha.concluidaEm?.toISOString() ?? null,
          conteudoTexto: campanha.conteudoTexto,
        }}
        metricas={campanha.metricas}
        pessoasNoRascunho={previa?.total ?? null}
        pode={{
          disparar: naLoja && permite("campanhas:disparar"),
          pausar: naLoja && permite("campanhas:editar"),
          excluir: naLoja && permite("campanhas:excluir"),
        }}
      />
      {campanha.status !== "rascunho" ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-titulo-secao font-medium">Destinatários</h2>
          <ListaDestinatarios
            status={status ?? null}
            itens={pagina.itens.map((d) => ({
              ...d,
              criadoEm: d.criadoEm.toISOString(),
              enviadoEm: d.enviadoEm?.toISOString() ?? null,
            }))}
          />
          <PaginacaoCursor
            cursorAnterior={pagina.cursorAnterior}
            cursorProximo={pagina.cursorProximo}
            porPagina={porPagina}
          />
        </section>
      ) : null}
    </div>
  );
}
