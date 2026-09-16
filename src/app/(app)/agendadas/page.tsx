import type { Metadata } from "next";
import { CabecalhoPagina } from "@/components/comum/cabecalho-pagina";
import { FaixaAviso } from "@/components/comum/faixa-aviso";
import { PaginacaoCursor } from "@/components/comum/paginacao-cursor";
import { contatosParaAgendar, listarAgendamentos } from "@/lib/agendamentos/_consultas";
import { contasDeCampanha, modelosAprovados } from "@/lib/campanhas/_consultas";
import { decodificarCursor, lerDirecao, lerPorPagina } from "@/lib/campanhas/cursor";
import { abrirPagina, parametro } from "@/lib/campanhas/pagina";
import { STATUS_AGENDAMENTO, type StatusAgendamento } from "@/lib/db/schema/_enums/conversas";
import { FormularioAgendamento } from "./_components/formulario-agendamento";
import { ListaAgendadas } from "./_components/lista-agendadas";

export const metadata: Metadata = { title: "Mensagens agendadas" };

type Busca = Promise<Record<string, string | string[] | undefined>>;

/**
 * `/agendadas` — mensagens programadas (04-ui.md §5.4). A tela diz quais
 * motivos respeitam o pedido de não receber promoções e quais não.
 */
export default async function PaginaAgendadas({ searchParams }: { searchParams: Busca }) {
  const { escopo, lojaId, permite } = await abrirPagina("agendamentos:ler");
  const busca = await searchParams;
  const pedido = parametro(busca.status);
  const status = (STATUS_AGENDAMENTO as readonly string[]).includes(pedido ?? "")
    ? (pedido as StatusAgendamento)
    : undefined;
  const porPagina = lerPorPagina(parametro(busca.porPagina));
  const podeCriar = lojaId !== null && permite("agendamentos:criar");

  const [pagina, contatos, contas, modelos] = await Promise.all([
    listarAgendamentos(escopo, { status }, {
      cursor: decodificarCursor(parametro(busca.cursor)),
      direcao: lerDirecao(parametro(busca.direcao)),
      limite: porPagina,
    }),
    podeCriar && lojaId ? contatosParaAgendar(lojaId) : Promise.resolve([]),
    podeCriar && lojaId ? contasDeCampanha(lojaId) : Promise.resolve([]),
    podeCriar && lojaId ? modelosAprovados(lojaId) : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-6">
      <CabecalhoPagina
        titulo="Mensagens agendadas"
        descricao="Mensagens que saem sozinhas no horário escolhido, pelo número escolhido."
      />
      <FaixaAviso
        tom="info"
        titulo="Promoção, reativação e carrinho abandonado não saem para quem pediu para não receber promoções."
        descricao="Envio manual, retorno combinado, pós-venda e aniversário saem normalmente."
      />
      {lojaId === null ? (
        <FaixaAviso tom="info" titulo="Escolha uma loja no topo da tela para agendar mensagens." />
      ) : null}
      {podeCriar ? <FormularioAgendamento contatos={contatos} contas={contas} modelos={modelos} /> : null}
      <ListaAgendadas
        status={status ?? null}
        podeReagendar={lojaId !== null && permite("agendamentos:editar")}
        podeCancelar={lojaId !== null && permite("agendamentos:cancelar")}
        itens={pagina.itens.map((a) => ({
          ...a,
          atualizadoEm: a.atualizadoEm.toISOString(),
          criadoEm: a.criadoEm.toISOString(),
          agendadaPara: a.agendadaPara.toISOString(),
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
