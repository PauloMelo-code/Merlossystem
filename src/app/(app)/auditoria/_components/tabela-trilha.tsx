"use client";

import Link from "next/link";
import { EstadoVazio } from "@/components/comum/estado-vazio";
import { TabelaDados, type Coluna } from "@/components/comum/tabela-dados";
import { Tempo } from "@/components/comum/tempo";

export type EventoNaTela = {
  id: string;
  criadoEm: string;
  pessoa: string;
  acao: string;
  entidade: string;
  entidadeId: string | null;
  /** URL desta mesma tela com `?evento=<id>` e os filtros preservados. */
  hrefDetalhe: string;
};

/**
 * Lista da trilha de negócio (04-ui.md §5.5). Somente leitura: a única ação de
 * linha é ABRIR o detalhe. Não existe excluir em lugar nenhum.
 */
export function TabelaTrilha({
  eventos,
  comFiltro,
  vazio = "Nenhum evento registrado ainda.",
}: {
  eventos: readonly EventoNaTela[];
  comFiltro: boolean;
  vazio?: string;
}) {
  const detalhe = (e: EventoNaTela) => (
    <Link href={e.hrefDetalhe} scroll={false} className="text-denso font-medium underline-offset-4 hover:underline">
      Ver detalhe<span className="sr-only"> de {e.acao}</span>
    </Link>
  );

  const colunas: Coluna<EventoNaTela>[] = [
    { chave: "quando", rotulo: "Quando", render: (e) => <Tempo valor={e.criadoEm} /> },
    { chave: "pessoa", rotulo: "Pessoa", render: (e) => e.pessoa },
    { chave: "acao", rotulo: "Ação", render: (e) => <span className="font-medium">{e.acao}</span> },
    {
      chave: "entidade",
      rotulo: "Registro",
      render: (e) => (
        <span>
          {e.entidade}
          {e.entidadeId ? (
            <code className="ml-1 font-mono text-legenda text-muted-foreground">{e.entidadeId.slice(0, 8)}</code>
          ) : null}
        </span>
      ),
    },
    { chave: "detalhe", rotulo: "Detalhe", render: detalhe },
  ];

  return (
    <TabelaDados
      colunas={colunas}
      itens={eventos}
      chave={(e) => e.id}
      vazio={
        <EstadoVazio
          titulo={comFiltro ? "Nenhum evento com esses filtros." : vazio}
          {...(comFiltro ? { descricao: "Limpe os filtros ou amplie o período." } : {})}
        />
      }
      cartaoMobile={(e) => (
        <div className="flex flex-col gap-1">
          <span className="font-medium">{e.acao}</span>
          <span className="text-legenda text-muted-foreground">
            {e.pessoa} · <Tempo valor={e.criadoEm} /> · {e.entidade}
          </span>
          {detalhe(e)}
        </div>
      )}
    />
  );
}
