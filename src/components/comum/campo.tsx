import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { Label } from "@/components/ui/label";

/**
 * Associa `label`/`htmlFor`, `aria-describedby` e `aria-invalid` (04-ui.md
 * §6.1 e §7.1). É o defeito mais repetido do sistema antigo: campo sem rótulo
 * associado e erro que o leitor de tela nunca anunciava.
 *
 * Marca-se o OPCIONAL, nunca o obrigatório com asterisco.
 *
 * O `children` recebe o controle já com `id={nome}`; quem usa passa também
 * `aria-describedby={idsDeApoio(nome, { ajuda, erro })}` e
 * `aria-invalid={Boolean(erro)}`.
 */

export function idDeAjuda(nome: string): string {
  return `${nome}-ajuda`;
}

export function idDeErro(nome: string): string {
  return `${nome}-erro`;
}

/** String para `aria-describedby`; `undefined` quando não há apoio nenhum. */
export function idsDeApoio(
  nome: string,
  apoio: { ajuda?: string | undefined; erro?: string | undefined },
): string | undefined {
  const ids = [apoio.ajuda ? idDeAjuda(nome) : "", apoio.erro ? idDeErro(nome) : ""]
    .filter(Boolean)
    .join(" ");
  return ids || undefined;
}

export function Campo({
  nome,
  rotulo,
  ajuda,
  erro,
  opcional = false,
  children,
}: {
  nome: string;
  rotulo: string;
  ajuda?: string;
  erro?: string;
  opcional?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={nome} className="text-denso font-medium">
        {rotulo}
        {opcional ? (
          <span className="font-normal text-texto-terciario">(opcional)</span>
        ) : null}
      </Label>
      {children}
      {ajuda ? (
        <p id={idDeAjuda(nome)} className="text-legenda text-muted-foreground">
          {ajuda}
        </p>
      ) : null}
      {erro ? (
        <p id={idDeErro(nome)} className="flex items-center gap-1.5 text-legenda text-perigo">
          <CircleAlert aria-hidden="true" strokeWidth={2} className="size-3.5 shrink-0" />
          {erro}
        </p>
      ) : null}
    </div>
  );
}
