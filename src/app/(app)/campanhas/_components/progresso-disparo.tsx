"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ConfirmarExclusao } from "@/components/comum/confirmar-exclusao";
import { FaixaAviso } from "@/components/comum/faixa-aviso";
import { ModalConfirmacaoBlock } from "@/components/comum/modal-confirmacao-block";
import {
  excluirCampanhaRegistro,
  iniciarDisparo,
  pausarDisparo,
  reenviarFalhasDaCampanha,
  retomarDisparo,
} from "@/lib/actions/campanhas";
import type { Metricas } from "@/lib/campanhas/_consultas";
import type { Resultado } from "@/lib/erros";
import { percentual } from "./tabela-campanhas";

type Campanha = {
  id: string;
  nome: string;
  status: string;
  atualizadoEm: string;
  conta: string;
  provedor: string;
  iniciadaEm: string | null;
  concluidaEm: string | null;
  conteudoTexto: string | null;
};

type Acao = "disparar" | "excluir" | null;

/** Enquanto envia, a tela relê o servidor — o progresso nunca é da aba. */
const RELEITURA_MS = 15_000;

const METRICAS: { chave: keyof Metricas; rotulo: string }[] = [
  { chave: "total", rotulo: "Destinatários" },
  { chave: "naFila", rotulo: "Na fila" },
  { chave: "enviados", rotulo: "Enviadas" },
  { chave: "entregues", rotulo: "Entregues" },
  { chave: "lidos", rotulo: "Lidas" },
  { chave: "respondidos", rotulo: "Responderam" },
  { chave: "falhas", rotulo: "Falhas" },
];

export function ProgressoDisparo({
  campanha,
  metricas,
  pessoasNoRascunho,
  pode,
}: {
  campanha: Campanha;
  metricas: Metricas;
  pessoasNoRascunho: number | null;
  pode: { disparar: boolean; pausar: boolean; excluir: boolean };
}) {
  const router = useRouter();
  const [aberta, setAberta] = useState<Acao>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const alvo = { id: campanha.id, updated_at: campanha.atualizadoEm };
  const enviando = campanha.status === "enviando";

  useEffect(() => {
    if (!enviando) return;
    const relogio = window.setInterval(() => router.refresh(), RELEITURA_MS);
    return () => window.clearInterval(relogio);
  }, [enviando, router]);

  function rodar(fn: () => Promise<Resultado<unknown>>, depois?: () => void) {
    iniciar(async () => {
      const r = await fn();
      if (r.ok) {
        setErro(null);
        setAberta(null);
        depois?.();
      } else setErro(r.mensagem);
    });
  }

  const pessoas = campanha.status === "rascunho" ? (pessoasNoRascunho ?? 0) : metricas.naFila;
  const retomando = campanha.status === "pausada";
  const podeDisparar = pode.disparar && (campanha.status === "rascunho" || retomando);

  return (
    <section className="flex flex-col gap-4">
      {erro && aberta === null ? <FaixaAviso tom="perigo" titulo={erro} /> : null}
      {aviso ? <FaixaAviso tom="sucesso" titulo={aviso} /> : null}

      {campanha.status === "rascunho" ? (
        <FaixaAviso
          tom="info"
          titulo={`Rascunho: hoje vai para ${pessoas} ${pessoas === 1 ? "pessoa" : "pessoas"}.`}
          descricao="A lista final é montada no momento do disparo, sem quem pediu para não receber promoções."
        />
      ) : (
        <div className="flex flex-col gap-2">
          <Progress value={percentual(metricas)} aria-label={`${percentual(metricas)}% processado`} className="h-2" />
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {METRICAS.map((m) => (
              <div key={m.chave} className="rounded-lg border border-border bg-card p-3">
                <dt className="text-legenda text-muted-foreground">{m.rotulo}</dt>
                <dd className="text-destaque tabular-nums">{metricas[m.chave]}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {campanha.conteudoTexto ? (
        <p className="rounded-lg bg-muted p-3 text-corpo whitespace-pre-wrap">{campanha.conteudoTexto}</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {podeDisparar ? (
          <Button type="button" onClick={() => setAberta("disparar")}>
            <Play aria-hidden="true" strokeWidth={2} />
            {retomando ? "Retomar disparo" : "Iniciar disparo"}
          </Button>
        ) : null}
        {pode.pausar && enviando ? (
          <Button type="button" variant="outline" disabled={pendente} onClick={() => rodar(() => pausarDisparo(alvo))}>
            <Pause aria-hidden="true" strokeWidth={2} />
            Pausar
          </Button>
        ) : null}
        {pode.disparar && metricas.falhas > 0 && campanha.status !== "rascunho" ? (
          <Button
            type="button"
            variant="outline"
            disabled={pendente}
            onClick={() =>
              rodar(
                () => reenviarFalhasDaCampanha(alvo),
                () => setAviso(`${metricas.falhas} falhas voltaram para a fila.`),
              )
            }
          >
            <RotateCcw aria-hidden="true" strokeWidth={2} />
            Reenviar falhas
          </Button>
        ) : null}
        {pode.excluir && !enviando ? (
          <Button type="button" variant="outline" onClick={() => setAberta("excluir")}>
            <Trash2 aria-hidden="true" strokeWidth={2} />
            Excluir
          </Button>
        ) : null}
      </div>

      <ModalConfirmacaoBlock
        aberto={aberta === "disparar"}
        titulo={retomando ? "Retomar o disparo?" : "Iniciar o disparo?"}
        resumo={`${pessoas} ${pessoas === 1 ? "pessoa vai" : "pessoas vão"} receber "${campanha.nome}" pelo número ${campanha.conta}.`}
        {...(campanha.provedor === "uazapi"
          ? { descricao: "Número não oficial pode ser banido pelo WhatsApp por envio em massa. O envio sai a 1 mensagem por segundo." }
          : {})}
        textoConfirmar={retomando ? "Retomar" : "Iniciar disparo"}
        carregando={pendente}
        {...(erro && aberta === "disparar" ? { erro } : {})}
        onConfirmar={() => rodar(() => (retomando ? retomarDisparo(alvo) : iniciarDisparo(alvo)))}
        onCancelar={() => {
          setAberta(null);
          setErro(null);
        }}
      />

      <ConfirmarExclusao
        aberto={aberta === "excluir"}
        entidade={`a campanha "${campanha.nome}"`}
        descricao="Quem já recebeu continua com a mensagem na conversa."
        carregando={pendente}
        {...(erro && aberta === "excluir" ? { erro } : {})}
        onConfirmar={() => rodar(() => excluirCampanhaRegistro(alvo), () => router.push("/campanhas"))}
        onCancelar={() => {
          setAberta(null);
          setErro(null);
        }}
      />
    </section>
  );
}
