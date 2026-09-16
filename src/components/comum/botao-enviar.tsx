"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Botão de envio do padrão único de formulário (04-ui.md §7.1): `useFormStatus`
 * dá o pendente, a largura é fixa para o botão não encolher no meio do envio, e
 * `disabled` enquanto pendente impede o duplo envio.
 *
 * `pendente` explícito existe para o caso em que a ação NÃO vem de um `<form>`
 * (confirmação em modal, por exemplo).
 */
export function BotaoEnviar({
  children,
  pendente,
  variante = "default",
  className,
}: {
  children: ReactNode;
  pendente?: boolean;
  variante?: "default" | "destructive" | "outline" | "secondary";
  className?: string;
}) {
  const status = useFormStatus();
  const emAndamento = pendente ?? status.pending;

  return (
    <Button
      type="submit"
      variant={variante}
      disabled={emAndamento}
      aria-busy={emAndamento}
      className={`min-w-32 ${className ?? ""}`}
    >
      {emAndamento ? (
        <>
          <Loader2
            aria-hidden="true"
            strokeWidth={2}
            className="movimento-essencial animate-spin"
          />
          Salvando…
        </>
      ) : (
        children
      )}
    </Button>
  );
}
