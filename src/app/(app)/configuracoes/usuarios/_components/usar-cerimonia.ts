"use client";

import { useCallback, useRef, useState } from "react";
import type { Resultado } from "@/lib/erros";

/**
 * A cerimônia de toda ação desta tela (04-ui.md §7.3 e §9.1), num hook só:
 *
 *   formulário -> (bloqueio de 3 s, quando a ação está na lista) -> action ->
 *   `SESSAO_NAO_FRESCA`? -> `ModalReautenticacao` -> a MESMA chamada de novo.
 *
 * A tentativa pendente fica em `ref`: ela não pinta nada, e ler `ref.current`
 * só dentro de callback é o que o lint do React Compiler aceita.
 */
export function useCerimonia<T>(aoConcluir: (dados: T) => void) {
  const [confirmando, setConfirmando] = useState(false);
  const [reautenticando, setReautenticando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | undefined>(undefined);
  const pendente = useRef<(() => Promise<Resultado<T>>) | null>(null);

  const executar = useCallback(async () => {
    const chamada = pendente.current;
    if (!chamada) return;
    setOcupado(true);
    setErro(undefined);
    try {
      const resultado = await chamada();
      if (!resultado.ok && resultado.codigo === "SESSAO_NAO_FRESCA") {
        setReautenticando(true);
        return;
      }
      if (!resultado.ok) {
        // O modal NÃO fecha no erro: o que a pessoa escolheu continua na tela.
        setErro(resultado.mensagem);
        return;
      }
      setConfirmando(false);
      pendente.current = null;
      aoConcluir(resultado.dados);
    } finally {
      setOcupado(false);
    }
  }, [aoConcluir]);

  /** `bloqueio = true` abre o `ModalConfirmacaoBlock`; `false` chama direto. */
  const iniciar = useCallback(
    (chamada: () => Promise<Resultado<T>>, bloqueio: boolean) => {
      pendente.current = chamada;
      setErro(undefined);
      if (bloqueio) setConfirmando(true);
      else void executar();
    },
    [executar],
  );

  const cancelar = useCallback(() => {
    setConfirmando(false);
    setErro(undefined);
    pendente.current = null;
  }, []);

  const reautenticado = useCallback(() => {
    setReautenticando(false);
    void executar();
  }, [executar]);

  const desistirDaProva = useCallback(() => setReautenticando(false), []);

  return {
    confirmando,
    reautenticando,
    ocupado,
    erro,
    iniciar,
    executar,
    cancelar,
    reautenticado,
    desistirDaProva,
  };
}
