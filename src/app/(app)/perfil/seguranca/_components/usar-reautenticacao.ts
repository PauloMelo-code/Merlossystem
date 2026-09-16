"use client";

import { useCallback, useRef, useState } from "react";
import type { Resultado } from "@/lib/erros";

/**
 * Reautenticação de frescor em uma linha (04-ui.md §7.3).
 *
 * Toda action desta tela exige sessão fresca (15 min). Quando ela responde
 * `SESSAO_NAO_FRESCA`, a pessoa confirma a identidade sem sair da página e a
 * AÇÃO PENDENTE É REFEITA com os mesmos dados. Sem isso, qualquer sessão com
 * mais de 15 minutos receberia 403 sem saída.
 *
 * `refazer` guarda a tentativa em `ref` — e não em estado — porque ela não
 * pinta nada: reexecutar o componente a cada tentativa só criaria render
 * desnecessário, e o lint do React Compiler reprova ler `ref.current` durante o
 * render (aqui só lemos dentro de callback).
 */
export function useReautenticacao() {
  const [aberto, setAberto] = useState(false);
  const refazer = useRef<(() => void) | null>(null);

  /** Chame com o que deve ser refeito depois da confirmação. */
  const exigirProva = useCallback((tentativa: () => void) => {
    refazer.current = tentativa;
    setAberto(true);
  }, []);

  const confirmado = useCallback(() => {
    setAberto(false);
    const tentativa = refazer.current;
    refazer.current = null;
    tentativa?.();
  }, []);

  const cancelar = useCallback(() => {
    setAberto(false);
    refazer.current = null;
  }, []);

  return { aberto, exigirProva, confirmado, cancelar };
}

/** `true` quando a action pediu prova de identidade em vez de recusar. */
export function pediuProva(resultado: Resultado<unknown>): boolean {
  return !resultado.ok && resultado.codigo === "SESSAO_NAO_FRESCA";
}
