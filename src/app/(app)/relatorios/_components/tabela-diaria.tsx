export type LinhaDiaria = { dia: string; receita: string; conversas: string };

/**
 * A tabela alternativa aos gráficos (04-ui.md §5.5): visível no celular,
 * `sr-only` no desktop — o leitor de tela sempre a encontra, o gráfico nunca.
 */
export function TabelaDiaria({ linhas, legenda }: { linhas: readonly LinhaDiaria[]; legenda: string }) {
  return (
    <div className="overflow-x-auto md:sr-only">
      <table className="w-full text-denso">
        <caption className="pb-2 text-left font-medium">{legenda}</caption>
        <thead>
          <tr className="border-b border-border text-left">
            <th scope="col" className="py-2 pr-4 font-medium">Dia</th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">Receita</th>
            <th scope="col" className="py-2 text-right font-medium">Conversas</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.dia} className="border-b border-border">
              <th scope="row" className="py-2 pr-4 text-left font-normal tabular-nums">{l.dia}</th>
              <td className="py-2 pr-4 text-right tabular-nums">{l.receita}</td>
              <td className="py-2 text-right tabular-nums">{l.conversas}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
