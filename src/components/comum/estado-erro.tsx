import type { ReactNode } from "react";
import { OctagonAlert } from "lucide-react";

/**
 * Erro diz O QUE ACONTECEU + POR QUÊ + O QUE FAZER (04-ui.md §10), sem código
 * cru e sem culpar a pessoa. O `digest` aparece só como "Código para o
 * suporte", que é a única forma em que um identificador técnico ajuda quem
 * está do outro lado do telefone.
 */
export function EstadoErro({
  titulo,
  descricao,
  acao,
  codigoDeSuporte,
}: {
  titulo: string;
  descricao?: string;
  acao?: ReactNode;
  codigoDeSuporte?: string;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center"
    >
      <OctagonAlert aria-hidden="true" strokeWidth={2} className="size-5 text-perigo" />
      <p className="text-titulo-secao font-medium text-foreground">{titulo}</p>
      {descricao ? (
        <p className="max-w-prose text-corpo text-muted-foreground">{descricao}</p>
      ) : null}
      {acao ? <div className="mt-2 flex gap-2">{acao}</div> : null}
      {codigoDeSuporte ? (
        <p className="text-legenda text-texto-terciario">
          Código para o suporte: {codigoDeSuporte}
        </p>
      ) : null}
    </div>
  );
}
