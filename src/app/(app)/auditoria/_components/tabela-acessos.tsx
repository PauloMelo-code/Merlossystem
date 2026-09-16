"use client";

import Link from "next/link";
import { EstadoVazio } from "@/components/comum/estado-vazio";
import { TabelaDados, type Coluna } from "@/components/comum/tabela-dados";
import { Tempo } from "@/components/comum/tempo";

export type AcessoNaTela = {
  id: string;
  criadoEm: string;
  tipo: string;
  resultado: string;
  /** Nome, ou o hash do e-mail quando não há conta — nunca o e-mail. */
  pessoa: string;
  hrefDetalhe: string;
};

const RESULTADO: Readonly<Record<string, string>> = {
  sucesso: "Concluído",
  falha: "Falhou",
  recusado: "Recusado",
};

/** Listagem resumida da trilha de acesso: SEM IP e sem navegador (só no detalhe). */
export function TabelaAcessos({ eventos, comFiltro }: { eventos: readonly AcessoNaTela[]; comFiltro: boolean }) {
  const detalhe = (e: AcessoNaTela) => (
    <Link href={e.hrefDetalhe} scroll={false} className="text-denso font-medium underline-offset-4 hover:underline">
      Ver detalhe<span className="sr-only"> de {e.tipo}</span>
    </Link>
  );

  const colunas: Coluna<AcessoNaTela>[] = [
    { chave: "quando", rotulo: "Quando", render: (e) => <Tempo valor={e.criadoEm} /> },
    { chave: "tipo", rotulo: "Evento", render: (e) => <span className="font-medium">{e.tipo}</span> },
    { chave: "resultado", rotulo: "Resultado", render: (e) => RESULTADO[e.resultado] ?? e.resultado },
    { chave: "pessoa", rotulo: "Pessoa", render: (e) => <span className="break-all">{e.pessoa}</span> },
    { chave: "detalhe", rotulo: "Detalhe", render: detalhe },
  ];

  return (
    <TabelaDados
      colunas={colunas}
      itens={eventos}
      chave={(e) => e.id}
      vazio={<EstadoVazio titulo={comFiltro ? "Nenhum evento com esses filtros." : "Nenhum evento de acesso registrado."} />}
      cartaoMobile={(e) => (
        <div className="flex flex-col gap-1">
          <span className="font-medium">{e.tipo}</span>
          <span className="text-legenda text-muted-foreground">
            {RESULTADO[e.resultado] ?? e.resultado} · {e.pessoa} · <Tempo valor={e.criadoEm} />
          </span>
          {detalhe(e)}
        </div>
      )}
    />
  );
}
