"use client";

import { useState, useTransition } from "react";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Campo } from "@/components/comum/campo";
import { FaixaAviso } from "@/components/comum/faixa-aviso";
import { previaDeSegmento } from "@/lib/actions/campanhas";
import type { Previa } from "@/lib/campanhas/segmento";
import type { Segmento } from "@/lib/validadores/campanhas";

/**
 * Filtro de audiência com a prévia "vai para N pessoas" (04-ui.md §5.4). A
 * contagem vem do servidor com EXATAMENTE o filtro do envio — inclusive o
 * opt-out lido de `consentimentos`.
 */
export function PreviaSegmento({
  etiquetas,
  segmento,
  aoMudar,
}: {
  etiquetas: { id: string; nome: string }[];
  segmento: Segmento;
  aoMudar: (s: Segmento) => void;
}) {
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function mudar(parcial: Partial<Segmento>) {
    const proximo: Segmento = { ...segmento };
    for (const [chave, valor] of Object.entries(parcial)) {
      if (valor === undefined || valor === "" || (Array.isArray(valor) && valor.length === 0)) {
        delete (proximo as Record<string, unknown>)[chave];
      } else {
        (proximo as Record<string, unknown>)[chave] = valor;
      }
    }
    setPrevia(null);
    aoMudar(proximo);
  }

  function calcular() {
    iniciar(async () => {
      const r = await previaDeSegmento({ segmento });
      if (r.ok) {
        setPrevia(r.dados);
        setErro(null);
      } else setErro(r.mensagem);
    });
  }

  const marcadas = new Set(segmento.etiquetas_ids ?? []);

  return (
    <div className="flex flex-col gap-4">
      {etiquetas.length > 0 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-denso font-medium">Etiquetas (qualquer uma)</legend>
          <div className="flex flex-wrap gap-3">
            {etiquetas.map((e) => (
              <label key={e.id} className="flex items-center gap-2 text-corpo">
                <Checkbox
                  checked={marcadas.has(e.id)}
                  onCheckedChange={(v) => {
                    const lista = new Set(marcadas);
                    if (v) lista.add(e.id);
                    else lista.delete(e.id);
                    mudar({ etiquetas_ids: [...lista] });
                  }}
                />
                {e.nome}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Campo nome="tamanho" rotulo="Grade" opcional>
          <select
            id="tamanho"
            value={segmento.tamanho ?? ""}
            onChange={(e) => mudar({ tamanho: (e.target.value || undefined) as Segmento["tamanho"] })}
            className="h-9 rounded-md border border-input bg-background px-3 text-corpo"
          >
            <option value="">Todas</option>
            <option value="slim">Slim</option>
            <option value="plussize">Plus size</option>
            <option value="ambos">Ambas</option>
          </select>
        </Campo>
        <Campo nome="gasto_minimo" rotulo="Já gastou ao menos (R$)" opcional>
          <Input
            id="gasto_minimo"
            inputMode="decimal"
            placeholder="150.00"
            value={segmento.gasto_minimo ?? ""}
            onChange={(e) => mudar({ gasto_minimo: e.target.value.replace(",", ".") })}
          />
        </Campo>
        <Campo nome="dias_sem_compra" rotulo="Sem comprar há (dias)" opcional>
          <Input
            id="dias_sem_compra"
            type="number"
            min={1}
            value={segmento.dias_sem_compra ?? ""}
            onChange={(e) => mudar({ dias_sem_compra: e.target.value ? Number(e.target.value) : undefined })}
          />
        </Campo>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-titulo-secao font-medium" role="status" aria-live="polite">
            <Users aria-hidden="true" strokeWidth={2} className="size-4" />
            {pendente
              ? "Contando…"
              : previa
                ? `Vai para ${previa.total} ${previa.total === 1 ? "pessoa" : "pessoas"}`
                : "Calcule quantas pessoas recebem"}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={calcular} disabled={pendente}>
            Calcular prévia
          </Button>
        </div>
        {previa && previa.amostra.length > 0 ? (
          <p className="text-legenda text-muted-foreground">Por exemplo: {previa.amostra.join(", ")}.</p>
        ) : null}
        <p className="text-legenda text-muted-foreground">
          Quem pediu para não receber promoções fica de fora automaticamente.
        </p>
        {erro ? <FaixaAviso tom="perigo" titulo={erro} /> : null}
      </div>
    </div>
  );
}
