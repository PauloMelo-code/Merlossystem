"use client";

import { useState } from "react";
import Link from "next/link";
import { EstadoVazio } from "@/components/comum/estado-vazio";
import { TabelaDados, type Coluna, type Ordenacao } from "@/components/comum/tabela-dados";

export type Indicador = "falhas_envio" | "dispensas_masc" | "voltou_fila_masc" | "recusas_403";

export type LinhaQualidadeNaTela = {
  pessoaId: string;
  nome: string;
  falhasEnvio: number;
  dispensasMasc: number;
  voltouFilaMasc: number;
  recusas403: number;
  hrefs: Record<Indicador, string>;
};

const CAMPO: Record<Indicador, keyof LinhaQualidadeNaTela> = {
  falhas_envio: "falhasEnvio",
  dispensas_masc: "dispensasMasc",
  voltou_fila_masc: "voltouFilaMasc",
  recusas_403: "recusas403",
};

const total = (l: LinhaQualidadeNaTela) => l.falhasEnvio + l.dispensasMasc + l.voltouFilaMasc + l.recusas403;

/**
 * Erros por pessoa (04-ui.md §5.5). Ordenável no cliente — são poucas linhas,
 * uma por pessoa da equipe. Cada número abre a lista de ocorrências.
 */
export function TabelaQualidade({
  linhas,
  rotulos,
}: {
  linhas: readonly LinhaQualidadeNaTela[];
  rotulos: Record<Indicador, string>;
}) {
  const [ordem, setOrdem] = useState<Ordenacao>({ coluna: "total", direcao: "desc" });

  const valor = (l: LinhaQualidadeNaTela, coluna: string): number | string =>
    coluna === "nome" ? l.nome : coluna === "total" ? total(l) : (l[CAMPO[coluna as Indicador]] as number);

  const ordenadas = [...linhas].sort((a, b) => {
    const [x, y] = [valor(a, ordem.coluna), valor(b, ordem.coluna)];
    const cmp = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "pt-BR");
    return ordem.direcao === "asc" ? cmp : -cmp;
  });

  function numero(indicador: Indicador, l: LinhaQualidadeNaTela) {
    const n = l[CAMPO[indicador]] as number;
    return n === 0 ? (
      <span className="text-muted-foreground">0</span>
    ) : (
      <Link href={l.hrefs[indicador]} scroll={false} className="font-medium underline-offset-4 hover:underline">
        {n}
        <span className="sr-only">
          {" "}
          — ver ocorrências de {rotulos[indicador]} de {l.nome}
        </span>
      </Link>
    );
  }

  const colunas: Coluna<LinhaQualidadeNaTela>[] = [
    { chave: "nome", rotulo: "Pessoa", ordenavel: true, render: (l) => l.nome },
    ...(Object.keys(CAMPO) as Indicador[]).map((indicador) => ({
      chave: indicador,
      rotulo: rotulos[indicador],
      numerica: true,
      ordenavel: true,
      render: (l: LinhaQualidadeNaTela) => numero(indicador, l),
    })),
    { chave: "total", rotulo: "Total", numerica: true, ordenavel: true, render: (l) => total(l) },
  ];

  return (
    <TabelaDados
      colunas={colunas}
      itens={ordenadas}
      chave={(l) => l.pessoaId}
      ordenacao={ordem}
      onOrdenar={(coluna) =>
        setOrdem((atual) => ({
          coluna,
          direcao: atual.coluna === coluna && atual.direcao === "desc" ? "asc" : "desc",
        }))
      }
      vazio={<EstadoVazio titulo="Nenhum erro registrado no período." descricao="Bom sinal. Amplie o período para comparar." />}
      cartaoMobile={(l) => (
        <div className="flex flex-col gap-1">
          <span className="font-medium">{l.nome}</span>
          <dl className="grid grid-cols-2 gap-1 text-denso">
            {(Object.keys(CAMPO) as Indicador[]).map((indicador) => (
              <div key={indicador} className="contents">
                <dt className="text-muted-foreground">{rotulos[indicador]}</dt>
                <dd className="text-right tabular-nums">{numero(indicador, l)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    />
  );
}
