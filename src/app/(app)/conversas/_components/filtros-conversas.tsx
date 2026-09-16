"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { ChipFiltro } from "@/components/comum/chip-filtro";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import type { OpcoesDeFiltro } from "@/lib/conversas";

/**
 * Toolbar da lista (04-ui.md §5.2): busca, segmentado Minhas · Sem responsável ·
 * Todas e os filtros. TUDO na URL (`router.replace`): o voltar do navegador e
 * o "abrir em nova aba" continuam funcionando. Ordenação única: mais recentes.
 */

const VISOES = [
  { valor: "minhas", rotulo: "Minhas" },
  { valor: "sem_responsavel", rotulo: "Sem responsável" },
  { valor: "todas", rotulo: "Todas" },
] as const;

const STATUS = [
  { valor: "andamento", rotulo: "Em andamento" },
  { valor: "aberta", rotulo: "Abertas" },
  { valor: "pendente", rotulo: "Aguardando" },
  { valor: "resolvida", rotulo: "Resolvidas" },
  { valor: "arquivada", rotulo: "Arquivadas" },
  { valor: "todas", rotulo: "Todos os status" },
] as const;

const PRIORIDADES = [
  { valor: "urgente", rotulo: "Urgente" },
  { valor: "alta", rotulo: "Alta" },
  { valor: "media", rotulo: "Média" },
  { valor: "baixa", rotulo: "Baixa" },
] as const;

const ESPERA_MS = 250;
const PARAMETROS = ["status", "integracaoId", "prioridade", "etiquetaId", "busca", "semResposta", "slaEstourado"] as const;

export function FiltrosConversas({ opcoes, semResposta }: { opcoes: OpcoesDeFiltro; semResposta: number }) {
  const router = useRouter();
  const caminho = usePathname();
  const parametros = useSearchParams();
  const [termo, setTermo] = useState(parametros.get("busca") ?? "");

  function trocar(mudancas: Record<string, string | null>) {
    const novos = new URLSearchParams(parametros.toString());
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor === null || valor === "") novos.delete(chave);
      else novos.set(chave, valor);
    }
    novos.delete("cursor");
    const consulta = novos.toString();
    router.replace(consulta ? `${caminho}?${consulta}` : caminho, { scroll: false });
  }

  useEffect(() => {
    const atual = parametros.get("busca") ?? "";
    if (termo === atual || (termo.length > 0 && termo.length < 2)) return;
    const t = setTimeout(() => trocar({ busca: termo }), ESPERA_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termo]);

  const visao = parametros.get("visao") ?? "todas";
  const status = parametros.get("status") ?? "andamento";
  const conta = opcoes.contas.find((c) => c.id === parametros.get("integracaoId"));
  const etiqueta = opcoes.etiquetas.find((e) => e.id === parametros.get("etiquetaId"));
  const prioridade = PRIORIDADES.find((p) => p.valor === parametros.get("prioridade"));
  const temFiltro = PARAMETROS.some((p) => parametros.has(p));

  return (
    <div className="sticky top-0 z-10 flex flex-col gap-2 border-b border-border bg-card p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-titulo-secao font-semibold">Conversas</h1>
        <button
          type="button"
          onClick={() => trocar({ semResposta: parametros.get("semResposta") ? null : "1" })}
          className="text-denso text-marca-texto underline-offset-2 hover:underline"
        >
          {semResposta} sem resposta
        </button>
      </div>

      <label className="relative block">
        <span className="sr-only">Buscar nome ou telefone</span>
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          placeholder="Buscar nome ou telefone"
          className="pl-8"
        />
      </label>

      <div role="group" aria-label="Quais conversas" className="grid grid-cols-3 rounded-md border border-border p-0.5">
        {VISOES.map((v) => (
          <button
            key={v.valor}
            type="button"
            aria-pressed={visao === v.valor}
            onClick={() => trocar({ visao: v.valor === "todas" ? null : v.valor })}
            className={cn(
              "rounded px-2 py-1 text-denso",
              visao === v.valor ? "bg-accent font-medium text-marca-texto" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {v.rotulo}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Seletor rotulo="Status" valor={status} opcoes={STATUS} aoMudar={(v) => trocar({ status: v === "andamento" ? null : v })} />
        {opcoes.contas.length > 1 ? (
          <Seletor
            rotulo="Número"
            valor={parametros.get("integracaoId") ?? ""}
            opcoes={[{ valor: "", rotulo: "Todos os números" }, ...opcoes.contas.map((c) => ({ valor: c.id, rotulo: c.rotulo }))]}
            aoMudar={(v) => trocar({ integracaoId: v })}
          />
        ) : null}
        {opcoes.etiquetas.length > 0 ? (
          <Seletor
            rotulo="Etiqueta"
            valor={parametros.get("etiquetaId") ?? ""}
            opcoes={[{ valor: "", rotulo: "Todas as etiquetas" }, ...opcoes.etiquetas.map((e) => ({ valor: e.id, rotulo: e.nome }))]}
            aoMudar={(v) => trocar({ etiquetaId: v })}
          />
        ) : null}
        <Seletor
          rotulo="Prioridade"
          valor={parametros.get("prioridade") ?? ""}
          opcoes={[{ valor: "", rotulo: "Qualquer prioridade" }, ...PRIORIDADES]}
          aoMudar={(v) => trocar({ prioridade: v })}
        />
        <Alternar rotulo="SLA estourado" ligado={parametros.has("slaEstourado")} aoMudar={(l) => trocar({ slaEstourado: l ? "1" : null })} />
      </div>

      {temFiltro ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {status !== "andamento" ? (
            <ChipFiltro rotulo="Status" valor={STATUS.find((s) => s.valor === status)?.rotulo ?? status} onRemover={() => trocar({ status: null })} />
          ) : null}
          {conta ? <ChipFiltro rotulo="Número" valor={conta.rotulo} onRemover={() => trocar({ integracaoId: null })} /> : null}
          {etiqueta ? <ChipFiltro rotulo="Etiqueta" valor={etiqueta.nome} onRemover={() => trocar({ etiquetaId: null })} /> : null}
          {prioridade ? <ChipFiltro rotulo="Prioridade" valor={prioridade.rotulo} onRemover={() => trocar({ prioridade: null })} /> : null}
          {parametros.has("semResposta") ? <ChipFiltro rotulo="Filtro" valor="Sem resposta" onRemover={() => trocar({ semResposta: null })} /> : null}
          {parametros.has("busca") ? (
            <ChipFiltro
              rotulo="Busca"
              valor={parametros.get("busca") ?? ""}
              onRemover={() => {
                setTermo("");
                trocar({ busca: null });
              }}
            />
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => {
              setTermo("");
              trocar(Object.fromEntries(PARAMETROS.map((p) => [p, null])));
            }}
          >
            Limpar filtros
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Seletor({
  rotulo,
  valor,
  opcoes,
  aoMudar,
}: {
  rotulo: string;
  valor: string;
  opcoes: readonly { valor: string; rotulo: string }[];
  aoMudar: (valor: string) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-legenda">
      <span className="text-muted-foreground">{rotulo}</span>
      <select
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        className="max-w-36 bg-transparent font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.rotulo}
          </option>
        ))}
      </select>
    </label>
  );
}

function Alternar({ rotulo, ligado, aoMudar }: { rotulo: string; ligado: boolean; aoMudar: (ligado: boolean) => void }) {
  return (
    <button
      type="button"
      aria-pressed={ligado}
      onClick={() => aoMudar(!ligado)}
      className={cn(
        "rounded-full border px-2 py-0.5 text-legenda",
        ligado ? "border-primary bg-accent font-medium text-marca-texto" : "border-border text-muted-foreground hover:bg-muted",
      )}
    >
      {rotulo}
    </button>
  );
}
