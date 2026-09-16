"use client";

import Link from "next/link";
import { EstadoVazio } from "@/components/comum/estado-vazio";
import { TabelaDados, type Coluna } from "@/components/comum/tabela-dados";
import { Tempo } from "@/components/comum/tempo";

export type ExcluidoNaTela = {
  id: string;
  rotulo: string;
  excluidoEm: string;
  excluidoPor: string;
  hrefTrilha: string;
};

/**
 * Registros excluídos (somente leitura). A única ação de linha é abrir o
 * histórico do registro na trilha — não existe "restaurar".
 */
export function TabelaExcluidos({
  registros,
  rotuloDaEntidade,
  comPeriodo,
}: {
  registros: readonly ExcluidoNaTela[];
  rotuloDaEntidade: string;
  comPeriodo: boolean;
}) {
  const historico = (r: ExcluidoNaTela) => (
    <Link href={r.hrefTrilha} className="text-denso font-medium underline-offset-4 hover:underline">
      Ver na trilha<span className="sr-only"> — {r.rotulo}</span>
    </Link>
  );

  const colunas: Coluna<ExcluidoNaTela>[] = [
    { chave: "rotulo", rotulo: "O que era", render: (r) => <span className="font-medium">{r.rotulo}</span> },
    { chave: "por", rotulo: "Excluído por", render: (r) => r.excluidoPor },
    { chave: "quando", rotulo: "Quando", render: (r) => <Tempo valor={r.excluidoEm} /> },
    { chave: "trilha", rotulo: "Histórico", render: historico },
  ];

  return (
    <TabelaDados
      colunas={colunas}
      itens={registros}
      chave={(r) => r.id}
      vazio={
        <EstadoVazio
          titulo={`Nenhum registro excluído em ${rotuloDaEntidade}${comPeriodo ? " nesse período" : ""}.`}
        />
      }
      cartaoMobile={(r) => (
        <div className="flex flex-col gap-1">
          <span className="font-medium">{r.rotulo}</span>
          <span className="text-legenda text-muted-foreground">
            {r.excluidoPor} · <Tempo valor={r.excluidoEm} />
          </span>
          {historico(r)}
        </div>
      )}
    />
  );
}
