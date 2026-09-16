import { Skeleton } from "@/components/ui/skeleton";

/**
 * Espelha o layout REAL da lista (04-ui.md §6.1): linha de 64 px com avatar de
 * 40 px, duas linhas de texto e a terceira de chips. Esqueleto que não tem a
 * forma do conteúdo só troca uma espera por um susto quando o conteúdo entra.
 */
export function EsqueletoListaConversas({ linhas = 8 }: { linhas?: number }) {
  return (
    <div aria-hidden="true" className="flex flex-col">
      {Array.from({ length: linhas }, (_, indice) => (
        <div key={indice} className="flex min-h-16 items-center gap-3 px-3 py-2.5">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-10" />
            </div>
            <Skeleton className="h-3 w-48" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}
