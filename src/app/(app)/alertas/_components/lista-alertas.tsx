"use client";

import Link from "next/link";
import { EstadoVazio } from "@/components/comum/estado-vazio";
import { SeloStatus } from "@/components/comum/selo-status";
import { TabelaDados, type Coluna } from "@/components/comum/tabela-dados";
import { Tempo } from "@/components/comum/tempo";
import { tomDe } from "@/lib/ui/tons";
import { BotaoReconhecer } from "./botao-reconhecer";

export type AlertaNaTela = {
  id: string;
  tipo: string;
  severidade: string;
  mensagem: string;
  rota: string | null;
  criadoEm: string;
  updatedAt: string;
  reconhecidoEm: string | null;
  reconhecidoPor: string | null;
};

/**
 * Central de alertas (04-ui.md §5.5). Cada alerta ABRE O OBJETO pelo link da
 * mensagem. "Reconhecer" só marca ciência — quem resolve é o sistema.
 */
export function ListaAlertas({
  alertas,
  podeReconhecer,
  comFiltro,
}: {
  alertas: readonly AlertaNaTela[];
  podeReconhecer: boolean;
  comFiltro: boolean;
}) {
  const mensagem = (a: AlertaNaTela) =>
    a.rota ? (
      <Link href={a.rota} className="font-medium text-foreground underline-offset-4 hover:underline">
        {a.mensagem}
      </Link>
    ) : (
      <span className="font-medium">{a.mensagem}</span>
    );

  const ciencia = (a: AlertaNaTela) =>
    a.reconhecidoEm ? (
      <span className="text-denso text-muted-foreground">
        Reconhecido{a.reconhecidoPor ? ` por ${a.reconhecidoPor}` : ""} em <Tempo valor={a.reconhecidoEm} />
      </span>
    ) : podeReconhecer ? (
      <BotaoReconhecer id={a.id} updatedAt={a.updatedAt} />
    ) : (
      <span className="text-denso text-muted-foreground">Aguardando</span>
    );

  const colunas: Coluna<AlertaNaTela>[] = [
    { chave: "severidade", rotulo: "Severidade", render: (a) => <SeloStatus dominio="severidade" valor={a.severidade} /> },
    { chave: "tipo", rotulo: "Tipo", render: (a) => tomDe("tipo_alerta", a.tipo)?.rotulo ?? "Alerta" },
    { chave: "mensagem", rotulo: "O que aconteceu", render: mensagem },
    { chave: "criado", rotulo: "Desde", render: (a) => <Tempo valor={a.criadoEm} /> },
    { chave: "ciencia", rotulo: "Ciência", render: ciencia },
  ];

  return (
    <TabelaDados
      colunas={colunas}
      itens={alertas}
      chave={(a) => a.id}
      vazio={
        <EstadoVazio
          titulo={comFiltro ? "Nenhum alerta com esses filtros." : "Nenhum alerta aberto."}
          descricao={
            comFiltro
              ? "Limpe os filtros para ver todos os alertas abertos."
              : "Quando algo precisar de atenção, aparece aqui."
          }
        />
      }
      cartaoMobile={(a) => (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <SeloStatus dominio="severidade" valor={a.severidade} />
            <span className="text-legenda text-muted-foreground">
              {tomDe("tipo_alerta", a.tipo)?.rotulo ?? "Alerta"} · <Tempo valor={a.criadoEm} />
            </span>
          </div>
          {mensagem(a)}
          {ciencia(a)}
        </div>
      )}
    />
  );
}
