import { EsqueletoTabela } from "@/components/comum/esqueletos/esqueleto-tabela";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Esqueleto do segmento (04-ui.md §4.1 e §10): a espera entre 100 ms e 1 s
 * mostra a FORMA do conteúdo, não um spinner solto.
 *
 * Cada segmento com dado ganha o seu `loading.tsx` com a forma real; este é o
 * genérico de quem ainda não tem um mais próximo.
 */
export default function CarregandoDoAplicativo() {
  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <Skeleton className="h-7 w-48" />
      <EsqueletoTabela />
    </div>
  );
}
