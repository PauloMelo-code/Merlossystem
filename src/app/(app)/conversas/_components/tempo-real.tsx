"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

/**
 * UM `EventSource` por aba (03-arquitetura.md §9; o teto por pessoa é 3).
 * Lista e conversa assinam o mesmo stream por este provedor.
 *
 * - O evento não traz conteúdo: quem recebe busca o dado pela action.
 * - Ao reconectar, emite `reconciliar`: a tela SEMPRE refaz a leitura completa.
 * - 2 falhas seguidas → fecha o stream e passa a polling de 15 s (emite
 *   `reconciliar` a cada ciclo) com a faixa "Atualização automática pausada".
 * - `sessao-invalidada` → a sessão acabou: vai para `/entrar`.
 */

export type EventoDaTela = {
  tipo: "mensagem-nova" | "mensagem-atualizada" | "conversa-atualizada" | "integracao-atualizada" | "reconciliar";
  conversaId?: string;
  mensagemId?: string;
  versao?: number;
};

export type EstadoDaConexao = "conectando" | "ao-vivo" | "polling" | "offline";

type Assinante = (evento: EventoDaTela) => void;

type ValorDoContexto = {
  estado: EstadoDaConexao;
  assinar: (fn: Assinante) => () => void;
  religar: () => void;
};

const Contexto = createContext<ValorDoContexto | null>(null);

const TIPOS = ["mensagem-nova", "mensagem-atualizada", "conversa-atualizada", "integracao-atualizada"] as const;
export const POLLING_MS = 15_000;

export function ProvedorTempoReal({ children }: { children: ReactNode }) {
  const assinantes = useRef(new Set<Assinante>());
  const [estado, setEstado] = useState<EstadoDaConexao>("conectando");
  const [geracao, setGeracao] = useState(0);
  const router = useRouter();

  useEffect(() => {
    const emitir = (e: EventoDaTela) => {
      for (const fn of assinantes.current) fn(e);
    };
    if (typeof EventSource === "undefined") {
      const t = setInterval(() => {
        setEstado("polling");
        emitir({ tipo: "reconciliar" });
      }, POLLING_MS);
      return () => clearInterval(t);
    }

    let falhas = 0;
    let caiu = false;
    let polling: ReturnType<typeof setInterval> | null = null;
    const fonte = new EventSource("/api/eventos");

    fonte.onopen = () => {
      if (caiu) emitir({ tipo: "reconciliar" });
      falhas = 0;
      caiu = false;
      setEstado("ao-vivo");
    };
    fonte.onerror = () => {
      falhas += 1;
      caiu = true;
      if (falhas >= 2) {
        fonte.close();
        setEstado("polling");
        polling = setInterval(() => emitir({ tipo: "reconciliar" }), POLLING_MS);
      } else {
        setEstado("conectando");
      }
    };
    for (const tipo of TIPOS) {
      fonte.addEventListener(tipo, (m) => {
        try {
          const dados = JSON.parse((m as MessageEvent<string>).data) as EventoDaTela;
          emitir({ ...dados, tipo });
        } catch {
          // evento ilegível: a próxima leitura completa corrige
        }
      });
    }
    fonte.addEventListener("sessao-invalidada", () => {
      fonte.close();
      router.replace("/entrar?motivo=sessao");
    });

    const semRede = () => setEstado("offline");
    const comRede = () => {
      setEstado("conectando");
      emitir({ tipo: "reconciliar" });
    };
    window.addEventListener("offline", semRede);
    window.addEventListener("online", comRede);

    return () => {
      fonte.close();
      if (polling) clearInterval(polling);
      window.removeEventListener("offline", semRede);
      window.removeEventListener("online", comRede);
    };
  }, [geracao, router]);

  const valor: ValorDoContexto = {
    estado,
    assinar: (fn) => {
      assinantes.current.add(fn);
      return () => {
        assinantes.current.delete(fn);
      };
    },
    religar: () => setGeracao((g) => g + 1),
  };

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

/** Assina os eventos. Fora do provedor, não faz nada (tela estática, teste). */
export function useTempoReal(aoReceber: Assinante): { estado: EstadoDaConexao; religar: () => void } {
  const contexto = useContext(Contexto);
  const ultimo = useRef(aoReceber);
  useEffect(() => {
    ultimo.current = aoReceber;
  });
  useEffect(() => contexto?.assinar((e) => ultimo.current(e)), [contexto]);
  return { estado: contexto?.estado ?? "ao-vivo", religar: contexto?.religar ?? (() => undefined) };
}
