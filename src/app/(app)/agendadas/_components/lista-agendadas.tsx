"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Campo } from "@/components/comum/campo";
import { ConfirmarExclusao } from "@/components/comum/confirmar-exclusao";
import { EstadoVazio } from "@/components/comum/estado-vazio";
import { FaixaAviso } from "@/components/comum/faixa-aviso";
import { SeloStatus } from "@/components/comum/selo-status";
import { TabelaDados, type Coluna } from "@/components/comum/tabela-dados";
import { Tempo } from "@/components/comum/tempo";
import { isoParaLocal, localParaIso, respeitaOptOut, ROTULO_GATILHO } from "@/lib/agendamentos/rotulos";
import { STATUS_AGENDAMENTO, type GatilhoAgendamento } from "@/lib/db/schema/_enums/conversas";
import { tomDe } from "@/lib/ui/tons";
import { cancelarMensagem, reagendarMensagem } from "../_acoes";

export type Agendada = {
  id: string;
  atualizadoEm: string;
  criadoEm: string;
  agendadaPara: string;
  status: string;
  gatilho: string;
  tipo: string;
  conteudo: string | null;
  erro: string | null;
  contato: string | null;
  conta: string;
  modelo: string | null;
};

function Motivo({ gatilho }: { gatilho: string }) {
  return (
    <span className="flex flex-col">
      <span>{ROTULO_GATILHO[gatilho as GatilhoAgendamento] ?? gatilho}</span>
      <span className="text-legenda text-muted-foreground">
        {respeitaOptOut(gatilho) ? "respeita opt-out" : "sai mesmo com opt-out"}
      </span>
    </span>
  );
}

export function ListaAgendadas({
  itens,
  status,
  podeReagendar,
  podeCancelar,
}: {
  itens: Agendada[];
  status: string | null;
  podeReagendar: boolean;
  podeCancelar: boolean;
}) {
  const router = useRouter();
  const caminho = usePathname();
  const parametros = useSearchParams();
  const [cancelando, setCancelando] = useState<Agendada | null>(null);
  const [reagendando, setReagendando] = useState<Agendada | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function filtrar(valor: string) {
    const proximos = new URLSearchParams(parametros.toString());
    if (valor) proximos.set("status", valor);
    else proximos.delete("status");
    proximos.delete("cursor");
    proximos.delete("direcao");
    router.replace(`${caminho}?${proximos.toString()}`);
  }

  function fechar() {
    setCancelando(null);
    setReagendando(null);
    setErro(null);
  }

  function cancelar() {
    if (!cancelando) return;
    iniciar(async () => {
      const r = await cancelarMensagem({ id: cancelando.id, updated_at: cancelando.atualizadoEm });
      if (r.ok) fechar();
      else setErro(r.mensagem);
    });
  }

  function reagendar(quando: string) {
    if (!reagendando) return;
    iniciar(async () => {
      const r = await reagendarMensagem({
        id: reagendando.id,
        updated_at: reagendando.atualizadoEm,
        agendada_para: localParaIso(quando),
      });
      if (r.ok) fechar();
      else setErro(r.erros?.["agendada_para"]?.[0] ?? r.mensagem);
    });
  }

  const colunas: Coluna<Agendada>[] = [
    { chave: "quando", rotulo: "Quando", render: (a) => <Tempo valor={a.agendadaPara} /> },
    { chave: "cliente", rotulo: "Cliente", render: (a) => a.contato ?? "Sem nome" },
    {
      chave: "conteudo",
      rotulo: "Mensagem",
      render: (a) => (
        <span className="line-clamp-2 max-w-xs">{a.modelo ? `Modelo ${a.modelo}` : (a.conteudo ?? "")}</span>
      ),
    },
    { chave: "motivo", rotulo: "Motivo", render: (a) => <Motivo gatilho={a.gatilho} /> },
    { chave: "conta", rotulo: "Número", render: (a) => a.conta },
    {
      chave: "status",
      rotulo: "Status",
      render: (a) => (
        <span className="flex flex-col gap-1">
          <SeloStatus dominio="status_agendamento" valor={a.status} />
          {a.erro ? <span className="text-legenda text-muted-foreground">{a.erro}</span> : null}
        </span>
      ),
    },
    {
      chave: "acoes",
      rotulo: "Ações",
      render: (a) =>
        a.status === "agendada" ? (
          <span className="flex gap-2">
            {podeReagendar ? (
              <Button type="button" size="sm" variant="outline" onClick={() => setReagendando(a)}>
                Reagendar
              </Button>
            ) : null}
            {podeCancelar ? (
              <Button type="button" size="sm" variant="outline" onClick={() => setCancelando(a)}>
                Cancelar
              </Button>
            ) : null}
          </span>
        ) : null,
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-denso">
        Status
        <select
          value={status ?? ""}
          onChange={(e) => filtrar(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-corpo"
        >
          <option value="">Todos</option>
          {STATUS_AGENDAMENTO.map((s) => (
            <option key={s} value={s}>
              {tomDe("status_agendamento", s)?.rotulo ?? s}
            </option>
          ))}
        </select>
      </label>

      <TabelaDados
        colunas={colunas}
        itens={itens}
        chave={(a) => a.id}
        vazio={<EstadoVazio titulo="Nenhuma mensagem agendada" descricao="Agende um retorno ou um aviso para a cliente." />}
        cartaoMobile={(a) => (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{a.contato ?? "Sem nome"}</span>
              <SeloStatus dominio="status_agendamento" valor={a.status} />
            </div>
            <Tempo valor={a.agendadaPara} className="text-legenda" />
            <Motivo gatilho={a.gatilho} />
            {colunas[6]!.render(a)}
          </div>
        )}
      />

      <ConfirmarExclusao
        aberto={cancelando !== null}
        entidade={`a mensagem agendada para ${cancelando?.contato ?? "a cliente"}`}
        descricao="A mensagem não sai. O registro fica, com quem cancelou."
        carregando={pendente}
        {...(erro && cancelando ? { erro } : {})}
        onConfirmar={cancelar}
        onCancelar={fechar}
      />

      {reagendando ? (
        <Dialog open onOpenChange={(aberto) => !aberto && !pendente && fechar()}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reagendar</DialogTitle>
              <DialogDescription>A mensagem para {reagendando.contato ?? "a cliente"} sai no novo horário.</DialogDescription>
            </DialogHeader>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                reagendar(String(new FormData(e.currentTarget).get("quando") ?? ""));
              }}
            >
              {erro ? <FaixaAviso tom="perigo" titulo={erro} /> : null}
              <Campo nome="quando" rotulo="Novo horário">
                <Input id="quando" name="quando" type="datetime-local" required defaultValue={isoParaLocal(reagendando.agendadaPara)} />
              </Campo>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={fechar} disabled={pendente}>
                  Voltar
                </Button>
                <Button type="submit" disabled={pendente} aria-busy={pendente}>
                  {pendente ? "Salvando…" : "Reagendar"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
