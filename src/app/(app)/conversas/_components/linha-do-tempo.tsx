"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { data as formatarData } from "@/lib/formato";
import { BalaoMensagem, type MensagemNaTela } from "./balao-mensagem";
import { EventoSistema } from "./evento-sistema";

/**
 * Linha do tempo (04-ui.md §5.2): separador de data sticky, divisor "Novas
 * mensagens", sequência do mesmo autor colada (2 px), botão flutuante "Ir para
 * a última" e histórico carregado preservando a posição (`overflow-anchor`).
 */

function diaDe(iso: string): string {
  return formatarData(new Date(iso));
}

function mesmoAutor(a: MensagemNaTela | undefined, b: MensagemNaTela): boolean {
  if (!a || a.tipo === "sistema" || b.tipo === "sistema") return false;
  return (
    a.direcao === b.direcao &&
    a.notaInterna === b.notaInterna &&
    a.autorNome === b.autorNome &&
    diaDe(a.ocorridaEm) === diaDe(b.ocorridaEm)
  );
}

export function LinhaDoTempo({
  mensagens,
  primeiraNova,
  temAnteriores,
  carregandoAnteriores,
  aoCarregarAnteriores,
  podeReenviar,
  aoReenviar,
}: {
  mensagens: MensagemNaTela[];
  primeiraNova: string | null;
  temAnteriores: boolean;
  carregandoAnteriores: boolean;
  aoCarregarAnteriores: () => void;
  podeReenviar: boolean;
  aoReenviar: (id: string) => void;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  const [longeDoFim, setLongeDoFim] = useState(false);
  const ultimaId = mensagens.at(-1)?.id;
  const primeiraId = mensagens[0]?.id;
  const alturaAntes = useRef(0);

  // Mensagem nova: desce só se a pessoa já estava perto do fim.
  useLayoutEffect(() => {
    const el = caixa.current;
    if (el && !longeDoFim) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ultimaId]);

  // Histórico carregado em cima: mantém o que estava na tela no mesmo lugar.
  useLayoutEffect(() => {
    const el = caixa.current;
    if (el && alturaAntes.current > 0) {
      el.scrollTop += el.scrollHeight - alturaAntes.current;
      alturaAntes.current = 0;
    }
  }, [primeiraId]);

  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const aoRolar = () => setLongeDoFim(el.scrollHeight - el.scrollTop - el.clientHeight > 160);
    el.addEventListener("scroll", aoRolar, { passive: true });
    return () => el.removeEventListener("scroll", aoRolar);
  }, []);

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={caixa} className="h-full overflow-y-auto bg-chat-fundo px-3 py-2 [overflow-anchor:auto] md:px-6">
        {temAnteriores ? (
          <div className="flex justify-center py-2">
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={carregandoAnteriores}
              onClick={() => {
                alturaAntes.current = caixa.current?.scrollHeight ?? 0;
                aoCarregarAnteriores();
              }}
            >
              {carregandoAnteriores ? "Carregando histórico…" : "Carregar mensagens anteriores"}
            </Button>
          </div>
        ) : null}
        <ol aria-label="Mensagens da conversa" className="flex flex-col pb-2">
          {mensagens.map((m, i) => {
            const anterior = mensagens[i - 1];
            const novoDia = !anterior || diaDe(anterior.ocorridaEm) !== diaDe(m.ocorridaEm);
            const colado = !novoDia && mesmoAutor(anterior, m);
            return (
              <FragmentoDoDia key={m.id} dia={novoDia ? diaDe(m.ocorridaEm) : null} novas={m.id === primeiraNova}>
                {m.tipo === "sistema" ? (
                  <EventoSistema texto={m.conteudo ?? ""} quando={m.ocorridaEm} />
                ) : (
                  <BalaoMensagem
                    mensagem={m}
                    mostrarAutor={!colado}
                    colado={colado}
                    podeReenviar={podeReenviar}
                    aoReenviar={aoReenviar}
                  />
                )}
              </FragmentoDoDia>
            );
          })}
        </ol>
      </div>
      {longeDoFim ? (
        <Button
          type="button"
          size="icon-sm"
          variant="secondary"
          aria-label="Ir para a última mensagem"
          className="absolute right-4 bottom-4 rounded-full shadow-1"
          onClick={() => caixa.current?.scrollTo({ top: caixa.current.scrollHeight, behavior: "smooth" })}
        >
          <ArrowDown aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}

function FragmentoDoDia({ dia, novas, children }: { dia: string | null; novas: boolean; children: React.ReactNode }) {
  return (
    <>
      {dia ? (
        <li role="separator" className="sticky top-0 z-1 flex justify-center py-2">
          <span className="rounded-full bg-card px-3 py-0.5 text-legenda text-muted-foreground shadow-sm">{dia}</span>
        </li>
      ) : null}
      {novas ? (
        <li role="separator" className="my-2 flex items-center gap-2 text-legenda font-medium text-marca-texto">
          <span className="h-px flex-1 bg-primary/40" />
          Novas mensagens
          <span className="h-px flex-1 bg-primary/40" />
        </li>
      ) : null}
      {children}
    </>
  );
}
