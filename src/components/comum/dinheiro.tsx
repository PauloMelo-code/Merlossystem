import { moeda, REGEX_DINHEIRO } from "@/lib/formato";

/**
 * Dinheiro na fronteira é a STRING `"1234.56"`, igual ao banco (04-ui.md §2.5
 * e 01-dados.md §4.5). Centavos só existem dentro de `formato.ts`; nenhum
 * `toFixed(2)` em TSX.
 *
 * `tabular-nums` para a coluna de preço não dançar linha a linha.
 */
export function Dinheiro({ valor, className }: { valor: string; className?: string }) {
  // Valor que não casa com o formato do banco vira travessão em vez de `NaN`:
  // preço errado na tela é pior do que preço ausente.
  if (!REGEX_DINHEIRO.test(valor)) {
    return (
      <span className={className} aria-label="valor indisponível">
        —
      </span>
    );
  }

  return (
    <span data-numerico="" className={`tabular-nums ${className ?? ""}`}>
      {moeda(valor)}
    </span>
  );
}
