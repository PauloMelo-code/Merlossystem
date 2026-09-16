import { Skeleton } from "@/components/ui/skeleton";

/** Balões alternando entrada e saída, com a largura máxima real do chat. */
export function EsqueletoChat({ baloes = 6 }: { baloes?: number }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3 p-4">
      {Array.from({ length: baloes }, (_, indice) => {
        const daLoja = indice % 3 === 0;
        return (
          <div key={indice} className={daLoja ? "flex justify-end" : "flex justify-start"}>
            <Skeleton
              className={daLoja ? "h-12 w-56 rounded-lg" : "h-16 w-64 rounded-lg"}
            />
          </div>
        );
      })}
    </div>
  );
}
