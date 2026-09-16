"use client";

import { X } from "lucide-react";

/**
 * Filtro ativo visível (04-ui.md §6.1). O estado do filtro mora na URL (§8);
 * este componente só mostra o que está ligado e devolve o pedido de remoção.
 */
export function ChipFiltro({
  rotulo,
  valor,
  onRemover,
}: {
  rotulo: string;
  valor: string;
  onRemover: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary py-1 pr-1 pl-2.5 text-legenda text-secondary-foreground">
      <span className="text-texto-terciario">{rotulo}:</span>
      <span className="font-medium">{valor}</span>
      <button
        type="button"
        onClick={onRemover}
        aria-label={`Remover filtro ${rotulo}: ${valor}`}
        className="inline-flex size-5 items-center justify-center rounded-full hover:bg-muted"
      >
        <X aria-hidden="true" className="size-3.5" strokeWidth={2} />
      </button>
    </span>
  );
}
