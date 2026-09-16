import type { ReactNode } from "react";
import Link from "next/link";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

/**
 * `h1` + ações da página (04-ui.md §6.1). UM `h1` por página (§11.9): quem usa
 * este componente não escreve outro.
 *
 * Breadcrumb só em Configurações e Auditoria com profundidade (§3).
 */

export type Migalha = { rotulo: string; rota?: string };

export function CabecalhoPagina({
  titulo,
  descricao,
  breadcrumb,
  acoes,
}: {
  titulo: string;
  descricao?: string;
  breadcrumb?: readonly Migalha[];
  acoes?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      {breadcrumb && breadcrumb.length > 0 ? (
        <Breadcrumb>
          <BreadcrumbList>
            {breadcrumb.map((migalha, indice) => (
              <BreadcrumbItem key={`${migalha.rotulo}-${String(indice)}`}>
                {migalha.rota ? (
                  <>
                    <BreadcrumbLink asChild>
                      <Link href={migalha.rota}>{migalha.rotulo}</Link>
                    </BreadcrumbLink>
                    <BreadcrumbSeparator />
                  </>
                ) : (
                  <BreadcrumbPage>{migalha.rotulo}</BreadcrumbPage>
                )}
              </BreadcrumbItem>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
      ) : null}

      {/* No celular o título quebra acima das ações; no desktop dividem a linha. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-titulo-pagina font-semibold text-foreground">{titulo}</h1>
          {descricao ? (
            <p className="mt-1 text-corpo text-muted-foreground">{descricao}</p>
          ) : null}
        </div>
        {acoes ? <div className="flex shrink-0 flex-wrap gap-2">{acoes}</div> : null}
      </div>
    </div>
  );
}
