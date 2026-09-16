"use client";

import { useEffect, useRef } from "react";
import { CircleAlert } from "lucide-react";
import { idDeErro } from "./campo";

/**
 * Bloco FOCÁVEL no topo quando há 2+ erros (04-ui.md §6.1 e §7.1). Recebe o
 * `erros` do `Resultado<T>` — `Record<campo, string[]>`, que é o formato que o
 * Zod devolve no servidor.
 *
 * Cada item leva ao campo. O foco vai para o resumo assim que ele aparece:
 * sem isso, quem navega por teclado fica no botão de enviar e nunca sabe o que
 * deu errado.
 */
export function ResumoDeErros({ erros }: { erros: Record<string, string[]> }) {
  const alvo = useRef<HTMLDivElement>(null);
  const campos = Object.entries(erros).filter(([, lista]) => lista.length > 0);

  useEffect(() => {
    if (campos.length >= 2) alvo.current?.focus();
  }, [campos.length]);

  if (campos.length < 2) return null;

  return (
    <div
      ref={alvo}
      tabIndex={-1}
      role="alert"
      className="scroll-mt-20 rounded-lg border border-perigo-borda bg-perigo-fundo p-3 text-perigo"
    >
      <p className="flex items-center gap-1.5 text-denso font-medium">
        <CircleAlert aria-hidden="true" strokeWidth={2} className="size-4 shrink-0" />
        Confira {campos.length} campos antes de salvar
      </p>
      <ul className="mt-2 flex flex-col gap-1 text-legenda">
        {campos.map(([campo, lista]) => (
          <li key={campo}>
            <a href={`#${campo}`} className="underline" aria-describedby={idDeErro(campo)}>
              {lista[0]}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
