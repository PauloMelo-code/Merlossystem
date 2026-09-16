"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

/**
 * Modal de ação crítica com bloqueio de 3 segundos (04-ui.md §6.1 e §9.1;
 * regra da casa em CLAUDE.md).
 *
 * Os 3 segundos são FIXOS e não viram prop: a lista de ações que passam por
 * aqui é fechada (§9.1) e um `duracao` configurável viraria `duracao={0}` na
 * primeira pressa. O atraso é para a pessoa LER o resumo, não um limite de
 * tempo — por isso `resumo` é obrigatório.
 *
 * Máquina de estados: `fechado -> bloqueado -> liberado -> processando ->
 * fechado`, ou `-> liberado + erro` (erro NÃO fecha o modal; o que a pessoa
 * digitou e escolheu continua na tela atrás dele).
 *
 * Enquanto bloqueado, Confirmar fica `aria-disabled` e NÃO `disabled`: um
 * botão `disabled` some da ordem de tabulação e do leitor de tela, e quem
 * navega por teclado perderia a referência do que está esperando.
 */

const BLOQUEIO_MS = 3000;
const PASSO_MS = 100;

export type VarianteBlock = "padrao" | "destrutiva";

export type PropsBlock = {
  aberto: boolean;
  titulo: string;
  /** Obrigatório: o que exatamente vai acontecer, em números concretos. */
  resumo: string;
  descricao?: string;
  textoConfirmar: string;
  variante?: VarianteBlock;
  carregando?: boolean;
  erro?: string;
  onConfirmar: () => void;
  onCancelar: () => void;
};

export function ModalConfirmacaoBlock(props: PropsBlock) {
  return (
    <AlertDialog open={props.aberto}>
      <AlertDialogContent
        // Esc é SEMPRE inerte no primitivo; quem decide se ele cancela é o
        // corpo, que só liga o próprio ouvinte depois dos 3 s. Clique fora não
        // fecha nunca: `AlertDialogContentProps` do Radix faz `Omit` de
        // `onPointerDownOutside`/`onInteractOutside` para ninguém religar isso.
        onEscapeKeyDown={(evento) => evento.preventDefault()}
        onOpenAutoFocus={(evento) => evento.preventDefault()}
      >
        {/*
         * O corpo é um componente separado de propósito: o Radix o DESMONTA ao
         * fechar, e com ele some a contagem. Reabrir o modal recomeça os 3 s
         * sem nenhum `setState` dentro de efeito para "zerar".
         */}
        <CorpoDoBlock {...props} />
      </AlertDialogContent>
    </AlertDialog>
  );
}

function CorpoDoBlock({
  titulo,
  resumo,
  descricao,
  textoConfirmar,
  variante = "padrao",
  carregando = false,
  erro,
  onConfirmar,
  onCancelar,
}: PropsBlock) {
  const [decorrido, setDecorrido] = useState(0);
  const refCancelar = useRef<HTMLButtonElement>(null);

  const bloqueado = decorrido < BLOQUEIO_MS;
  const inerte = bloqueado || carregando;

  // Foco inicial em CANCELAR: a ação segura é a que o dedo encontra primeiro.
  useEffect(() => {
    refCancelar.current?.focus();
  }, []);

  useEffect(() => {
    const relogio = window.setInterval(() => {
      setDecorrido((anterior) => Math.min(BLOQUEIO_MS, anterior + PASSO_MS));
    }, PASSO_MS);
    return () => window.clearInterval(relogio);
  }, []);

  // Esc só cancela DEPOIS da liberação — e nunca durante o processamento.
  useEffect(() => {
    if (inerte) return;
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") onCancelar();
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [inerte, onCancelar]);

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{titulo}</AlertDialogTitle>
        <AlertDialogDescription>{resumo}</AlertDialogDescription>
      </AlertDialogHeader>

      {descricao ? <p className="text-corpo text-muted-foreground">{descricao}</p> : null}

      {bloqueado ? (
        <div className="flex flex-col gap-1.5">
          <Progress aria-hidden="true" value={(decorrido / BLOQUEIO_MS) * 100} className="h-1" />
          <p className="text-legenda text-texto-terciario">Aguarde 3s</p>
        </div>
      ) : null}

      {/* Anúncio único: o leitor de tela avisa a liberação uma vez só. */}
      <span role="status" aria-live="polite" className="sr-only">
        {bloqueado ? "" : "Confirmação liberada"}
      </span>

      {erro ? (
        <p role="alert" className="rounded-md bg-perigo-fundo p-2 text-denso text-perigo">
          {erro}
        </p>
      ) : null}

      <AlertDialogFooter>
        <Button
          ref={refCancelar}
          type="button"
          variant="outline"
          onClick={() => !carregando && onCancelar()}
          aria-disabled={carregando}
        >
          Cancelar
        </Button>
        <Button
          type="button"
          variant={variante === "destrutiva" ? "destructive" : "default"}
          onClick={() => !inerte && onConfirmar()}
          aria-disabled={inerte}
          aria-busy={carregando}
        >
          {carregando ? (
            <Loader2
              aria-hidden="true"
              strokeWidth={2}
              className="movimento-essencial animate-spin"
            />
          ) : null}
          {textoConfirmar}
        </Button>
      </AlertDialogFooter>
    </>
  );
}
