"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { reconhecerAlerta } from "@/lib/actions/alertas";

/**
 * "Reconhecer" marca CIÊNCIA. Não resolve: o alerta some sozinho quando a
 * condição deixa de valer. Não é ação da lista de block de 3 s (04-ui.md §9.1).
 *
 * Leva o `updated_at` que a tela viu: se outra pessoa reconheceu antes, a
 * trava de colisão devolve COLISAO e a lista recarrega.
 */
export function BotaoReconhecer({ id, updatedAt }: { id: string; updatedAt: string }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();

  function reconhecer() {
    iniciar(async () => {
      const resultado = await reconhecerAlerta({ id, updated_at: updatedAt });
      if (resultado.ok) {
        toast.success("Alerta reconhecido.");
      } else {
        toast.error(resultado.mensagem);
      }
      router.refresh();
    });
  }

  return (
    <Button type="button" size="sm" variant="outline" disabled={pendente} onClick={reconhecer}>
      {pendente ? "Reconhecendo…" : "Reconhecer"}
    </Button>
  );
}
