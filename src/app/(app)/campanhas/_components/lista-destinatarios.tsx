"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { EstadoVazio } from "@/components/comum/estado-vazio";
import { SeloStatus } from "@/components/comum/selo-status";
import { TabelaDados, type Coluna } from "@/components/comum/tabela-dados";
import { Tempo } from "@/components/comum/tempo";
import { STATUS_DESTINATARIO } from "@/lib/db/schema/_enums/catalogo";
import { tomDe } from "@/lib/ui/tons";

export type Destinatario = {
  id: string;
  status: string;
  erro: string | null;
  enviadoEm: string | null;
  tentativas: number;
  criadoEm: string;
  contatoId: string;
  nome: string | null;
};

const COLUNAS: Coluna<Destinatario>[] = [
  { chave: "nome", rotulo: "Cliente", render: (d) => d.nome ?? "Sem nome" },
  { chave: "status", rotulo: "Status", render: (d) => <SeloStatus dominio="status_destinatario" valor={d.status} /> },
  { chave: "enviado", rotulo: "Enviada em", render: (d) => (d.enviadoEm ? <Tempo valor={d.enviadoEm} /> : "—") },
  { chave: "tentativas", rotulo: "Tentativas", numerica: true, render: (d) => d.tentativas },
  { chave: "motivo", rotulo: "Motivo da falha", render: (d) => d.erro ?? "" },
];

/** `reservado` aparece como "Na fila", igual a `pendente`: não é filtro próprio. */
const FILTROS = STATUS_DESTINATARIO.filter((s) => s !== "reservado");

/** Destinatários por cursor, com filtro de status na URL (04-ui.md §8). */
export function ListaDestinatarios({ itens, status }: { itens: Destinatario[]; status: string | null }) {
  const router = useRouter();
  const caminho = usePathname();
  const parametros = useSearchParams();

  function filtrar(valor: string) {
    const proximos = new URLSearchParams(parametros.toString());
    if (valor) proximos.set("status", valor);
    else proximos.delete("status");
    proximos.delete("cursor");
    proximos.delete("direcao");
    router.replace(`${caminho}?${proximos.toString()}`);
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-denso">
        Status
        <select
          value={status ?? ""}
          onChange={(e) => filtrar(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-corpo"
        >
          <option value="">Todos</option>
          {FILTROS.map((s) => (
            <option key={s} value={s}>
              {tomDe("status_destinatario", s)?.rotulo ?? s}
            </option>
          ))}
        </select>
      </label>
      <TabelaDados
        colunas={COLUNAS}
        itens={itens}
        chave={(d) => d.id}
        vazio={<EstadoVazio titulo="Nenhum destinatário com este filtro" />}
        cartaoMobile={(d) => (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{d.nome ?? "Sem nome"}</span>
              <SeloStatus dominio="status_destinatario" valor={d.status} />
            </div>
            {d.erro ? <p className="text-legenda text-perigo">{d.erro}</p> : null}
          </div>
        )}
      />
    </div>
  );
}
