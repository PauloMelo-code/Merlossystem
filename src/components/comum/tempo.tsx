import { data, dataHora, hora, horaDaLista } from "@/lib/formato";

/**
 * `<time dateTime>` com título absoluto (04-ui.md §2.5). Data na tela é SEMPRE
 * absoluta; o relativo, quando existe, vive no `title`.
 *
 * Nenhum componente formata data por conta própria: tudo sai de
 * `src/lib/formato.ts`, o mesmo módulo do servidor.
 */

export type FormatoDeTempo = "data" | "hora" | "dataHora" | "lista";

const FORMATADORES: Readonly<Record<FormatoDeTempo, (v: Date) => string>> = {
  data,
  hora,
  dataHora,
  lista: (v) => horaDaLista(v),
};

export function Tempo({
  valor,
  formato = "dataHora",
  className,
}: {
  valor: Date | string;
  formato?: FormatoDeTempo;
  className?: string;
}) {
  const quando = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(quando.getTime())) return null;

  return (
    <time dateTime={quando.toISOString()} title={dataHora(quando)} className={className}>
      {FORMATADORES[formato](quando)}
    </time>
  );
}
