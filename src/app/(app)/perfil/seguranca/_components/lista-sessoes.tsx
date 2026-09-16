"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ModalConfirmacaoBlock } from "@/components/comum/modal-confirmacao-block";
import { ModalReautenticacao } from "@/components/comum/modal-reautenticacao";
import { Tempo } from "@/components/comum/tempo";
import {
  encerrarSessao,
  encerrarTodasAsSessoes,
  reautenticar,
} from "@/lib/actions/seguranca";
import { pediuProva, useReautenticacao } from "./usar-reautenticacao";

export type SessaoNaTela = {
  id: string;
  ip: string | null;
  agente: string | null;
  criadaEm: string;
  expiraEm: string;
  atual: boolean;
};

/**
 * Sessões abertas (02-seguranca.md §10, F6/G13).
 *
 * A projeção que chega aqui NUNCA tem a coluna `token` — o `/list-sessions` do
 * Better Auth, que devolve o token, está desligado por isso.
 *
 * "Encerrar todas" derruba TUDO, inclusive esta: a revogação em massa do Better
 * Auth é por pessoa. A tela avisa antes, no resumo do bloqueio de 3 s (§9.1,
 * item 17).
 */
export function ListaSessoes({ sessoes }: { sessoes: readonly SessaoNaTela[] }) {
  const router = useRouter();
  const [confirmandoTodas, setConfirmandoTodas] = useState(false);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const { aberto, exigirProva, confirmado, cancelar } = useReautenticacao();

  async function encerrarUma(sessaoAlvoId: string) {
    setErro("");
    const resultado = await encerrarSessao(sessaoAlvoId);
    if (pediuProva(resultado)) {
      exigirProva(() => void encerrarUma(sessaoAlvoId));
      return;
    }
    if (!resultado.ok) {
      setErro(resultado.mensagem);
      return;
    }
    router.refresh();
  }

  async function encerrarTodas() {
    setOcupado(true);
    setErro("");
    const resultado = await encerrarTodasAsSessoes();
    setOcupado(false);
    if (pediuProva(resultado)) {
      exigirProva(() => void encerrarTodas());
      return;
    }
    setConfirmandoTodas(false);
    if (!resultado.ok) {
      setErro(resultado.mensagem);
      return;
    }
    // A própria sessão acabou de morrer: o portão da próxima navegação manda
    // para `/entrar` de qualquer jeito, mas ir direto evita a tela em branco.
    router.replace("/entrar?motivo=sessao");
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-titulo-secao font-medium">Sessões abertas</h2>
        <p className="text-denso text-muted-foreground">
          Cada sessão dura no máximo 12 horas e cai depois de 60 minutos sem uso.
        </p>
      </div>

      {erro ? (
        <p role="alert" className="text-corpo text-perigo">
          {erro}
        </p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {sessoes.map((sessao) => (
          <li
            key={sessao.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3"
          >
            <Monitor aria-hidden="true" strokeWidth={2} className="size-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-corpo">
                {sessao.agente ?? "Navegador não identificado"}
                {sessao.atual ? " · esta é a sessão atual" : ""}
              </p>
              <p className="text-legenda text-muted-foreground">
                {sessao.ip ?? "sem IP registrado"} · aberta em{" "}
                <Tempo valor={sessao.criadaEm} /> · expira em{" "}
                <Tempo valor={sessao.expiraEm} />
              </p>
            </div>
            {sessao.atual ? null : (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void encerrarUma(sessao.id)}
              >
                Encerrar
              </Button>
            )}
          </li>
        ))}
      </ul>

      <Button
        type="button"
        variant="outline"
        className="self-start"
        onClick={() => setConfirmandoTodas(true)}
      >
        Encerrar todas as sessões
      </Button>

      <ModalConfirmacaoBlock
        aberto={confirmandoTodas}
        titulo="Encerrar todas as sessões"
        resumo={`${String(sessoes.length)} sessão(ões) serão encerradas, inclusive esta. Você vai precisar entrar de novo em todos os aparelhos.`}
        textoConfirmar="Encerrar todas"
        variante="destrutiva"
        carregando={ocupado}
        onConfirmar={() => void encerrarTodas()}
        onCancelar={() => setConfirmandoTodas(false)}
      />

      <ModalReautenticacao
        aberto={aberto}
        reautenticarComSenha={reautenticar}
        onConfirmado={confirmado}
        onCancelar={cancelar}
      />
    </section>
  );
}
