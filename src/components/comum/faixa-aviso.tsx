import type { ReactNode } from "react";
import { CircleCheck, Info, TriangleAlert, OctagonAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CLASSES_DE_TOM } from "./selo-status";
import type { Tom } from "@/lib/ui/tons";

/**
 * Faixa PERSISTENTE de estado (04-ui.md §6.1 e §10): estoque não ao vivo,
 * número desconectado, conflito de edição, sem conexão, "somente leitura".
 *
 * Diferente do toast: fica enquanto a situação durar e sempre oferece a saída.
 * Ícone + texto, nunca só cor (§11.5).
 */

const ICONES: Readonly<Record<Tom, typeof Info>> = {
  sucesso: CircleCheck,
  aviso: TriangleAlert,
  perigo: OctagonAlert,
  info: Info,
  neutro: Info,
  marca: Info,
};

export function FaixaAviso({
  tom,
  titulo,
  descricao,
  acao,
}: {
  tom: Tom;
  titulo: string;
  descricao?: string;
  acao?: ReactNode;
}) {
  const cores = CLASSES_DE_TOM[tom];
  const Icone = ICONES[tom];

  return (
    <Alert
      // Perigo interrompe a leitura; o resto é informativo e espera a pausa.
      role={tom === "perigo" ? "alert" : "status"}
      className={`${cores.fundo} ${cores.borda} ${cores.texto}`}
    >
      <Icone aria-hidden="true" strokeWidth={2} />
      <AlertTitle>{titulo}</AlertTitle>
      {descricao || acao ? (
        <AlertDescription className={cores.texto}>
          {descricao ? <p>{descricao}</p> : null}
          {acao ? <div className="mt-2">{acao}</div> : null}
        </AlertDescription>
      ) : null}
    </Alert>
  );
}
