import type { ReactNode } from "react";

/**
 * Vazio SEMPRE com a próxima ação (04-ui.md §10). "Nenhum resultado" sozinho
 * deixa a pessoa sem saída — e foi o que o sistema antigo fazia em todas as
 * listas.
 */
export function EstadoVazio({
  titulo,
  descricao,
  acao,
}: {
  titulo: string;
  descricao?: string;
  acao?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <p className="text-titulo-secao font-medium text-foreground">{titulo}</p>
      {descricao ? (
        <p className="max-w-prose text-corpo text-muted-foreground">{descricao}</p>
      ) : null}
      {acao ? <div className="mt-2">{acao}</div> : null}
    </div>
  );
}
