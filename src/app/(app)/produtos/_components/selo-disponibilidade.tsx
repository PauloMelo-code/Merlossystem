import { CLASSES_DE_TOM } from "@/components/comum/selo-status";
import { Badge } from "@/components/ui/badge";
import type { Disponibilidade } from "@/lib/catalogo/disponibilidade";
import { hora } from "@/lib/formato";
import { tomDeDisponibilidade } from "@/lib/ui/tons";

/**
 * Selo verde/âmbar/vermelho da disponibilidade (04-ui.md §5.2). Saldo
 * desconhecido é "Não sabemos", nunca zero. Leitura antiga ganha o aviso por
 * extenso — cor sozinha não conta a história (§11).
 */
export function SeloDisponibilidade({ valor }: { valor: Disponibilidade | null }) {
  const disponivel = valor?.disponivel ?? null;
  const { rotulo, tom } = tomDeDisponibilidade(disponivel);
  const cores = CLASSES_DE_TOM[tom];
  const lidoEm = valor?.atualizadoEm ? new Date(valor.atualizadoEm) : null;
  const texto = disponivel === null ? rotulo : `${rotulo} · ${disponivel}`;
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <Badge variant="outline" className={`${cores.fundo} ${cores.texto} ${cores.borda} tabular-nums`}>
        {texto}
      </Badge>
      {valor && disponivel !== null && valor.leituraAntiga && lidoEm ? (
        <span className="text-legenda text-aviso">Leitura antiga ({hora(lidoEm)})</span>
      ) : null}
    </span>
  );
}
