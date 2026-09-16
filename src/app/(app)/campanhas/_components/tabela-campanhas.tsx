"use client";

import Link from "next/link";
import { Progress } from "@/components/ui/progress";
import { EstadoVazio } from "@/components/comum/estado-vazio";
import { SeloStatus } from "@/components/comum/selo-status";
import { TabelaDados, type Coluna } from "@/components/comum/tabela-dados";
import { Tempo } from "@/components/comum/tempo";
import type { Metricas } from "@/lib/campanhas/_consultas";

export type ItemCampanha = {
  id: string;
  nome: string;
  status: string;
  conta: string;
  criadoEm: string;
  iniciadaEm: string | null;
  metricas: Metricas;
};

/** Parte já resolvida (enviada ou falhou) sobre o total materializado. */
export function percentual(m: Metricas): number {
  return m.total === 0 ? 0 : Math.round(((m.total - m.naFila) / m.total) * 100);
}

function Progresso({ m }: { m: Metricas }) {
  if (m.total === 0) return <span className="text-legenda text-muted-foreground">Ainda não iniciada</span>;
  const p = percentual(m);
  return (
    <div className="flex min-w-32 flex-col gap-1">
      <Progress value={p} aria-label={`${p}% processado`} className="h-1.5" />
      <span className="text-legenda text-muted-foreground tabular-nums">
        {m.enviados} de {m.total} enviadas{m.falhas > 0 ? ` · ${m.falhas} falhas` : ""}
      </span>
    </div>
  );
}

const COLUNAS: Coluna<ItemCampanha>[] = [
  {
    chave: "nome",
    rotulo: "Campanha",
    render: (c) => (
      <Link href={`/campanhas/${c.id}`} className="font-medium underline-offset-4 hover:underline">
        {c.nome}
      </Link>
    ),
  },
  { chave: "status", rotulo: "Status", render: (c) => <SeloStatus dominio="status_campanha" valor={c.status} /> },
  { chave: "conta", rotulo: "Número de saída", render: (c) => c.conta },
  { chave: "progresso", rotulo: "Progresso", render: (c) => <Progresso m={c.metricas} /> },
  { chave: "lidas", rotulo: "Lidas", numerica: true, render: (c) => c.metricas.lidos },
  { chave: "criada", rotulo: "Criada em", render: (c) => <Tempo valor={c.criadoEm} formato="data" /> },
];

export function TabelaCampanhas({ itens }: { itens: ItemCampanha[] }) {
  return (
    <TabelaDados
      colunas={COLUNAS}
      itens={itens}
      chave={(c) => c.id}
      vazio={
        <EstadoVazio
          titulo="Nenhuma campanha por aqui"
          descricao="Crie a primeira: escolha o número, o conteúdo e quem recebe."
        />
      }
      cartaoMobile={(c) => (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <Link href={`/campanhas/${c.id}`} className="font-medium">
              {c.nome}
            </Link>
            <SeloStatus dominio="status_campanha" valor={c.status} />
          </div>
          <p className="text-legenda text-muted-foreground">{c.conta}</p>
          <Progresso m={c.metricas} />
        </div>
      )}
    />
  );
}
