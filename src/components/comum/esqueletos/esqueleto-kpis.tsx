import { Skeleton } from "@/components/ui/skeleton";

/** Fila de cartões de KPI: rótulo curto em cima, número grande embaixo. */
export function EsqueletoKpis({ cartoes = 4 }: { cartoes?: number }) {
  return (
    <div aria-hidden="true" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: cartoes }, (_, indice) => (
        <div key={indice} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-20" />
        </div>
      ))}
    </div>
  );
}
