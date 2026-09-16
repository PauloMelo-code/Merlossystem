import { Skeleton } from "@/components/ui/skeleton";

/** Linha de 40 px com célula 12x8, a mesma medida da tabela real (§2.6). */
export function EsqueletoTabela({
  linhas = 8,
  colunas = 5,
}: {
  linhas?: number;
  colunas?: number;
}) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2">
      <Skeleton className="h-9 w-full" />
      {Array.from({ length: linhas }, (_, linha) => (
        <div key={linha} className="flex items-center gap-3 px-3 py-2">
          {Array.from({ length: colunas }, (_, coluna) => (
            <Skeleton key={coluna} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}
