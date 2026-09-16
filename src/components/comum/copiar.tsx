"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Copiar com confirmação ACESSÍVEL (04-ui.md §6.1 e §11): a troca de ícone é
 * acompanhada de texto em `aria-live`, porque nenhum estado pode ser só cor ou
 * só forma.
 */
export function Copiar({ valor, rotulo }: { valor: string; rotulo: string }) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sem permissão de área de transferência o valor continua na tela para
      // seleção manual: falhar em silêncio é melhor do que um toast de erro
      // para algo que a pessoa consegue fazer com o mouse.
      setCopiado(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() => void copiar()}
        aria-label={`Copiar ${rotulo}`}
      >
        {copiado ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </Button>
      <span role="status" aria-live="polite" className="sr-only">
        {copiado ? `${rotulo} copiado` : ""}
      </span>
    </>
  );
}
