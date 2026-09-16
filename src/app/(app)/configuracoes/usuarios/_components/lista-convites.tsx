"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Copiar } from "@/components/comum/copiar";
import { FaixaAviso } from "@/components/comum/faixa-aviso";
import { ModalConfirmacaoBlock } from "@/components/comum/modal-confirmacao-block";
import { ModalReautenticacao } from "@/components/comum/modal-reautenticacao";
import { SeloStatus } from "@/components/comum/selo-status";
import { Tempo } from "@/components/comum/tempo";
import { reautenticar } from "@/lib/actions/seguranca";
import { reenviarConvite } from "@/lib/actions/convites";
import type { Papel } from "@/lib/db/schema/_enums/auth";
import { reenviarConviteSchema } from "@/lib/validadores/usuarios";
import { CampoMotivo, errosDe } from "./campos-comuns";
import { useCerimonia } from "./usar-cerimonia";

export type ConviteNaTela = {
  id: string;
  email: string;
  papel: Papel;
  lojaNome: string | null;
  expiraEm: string;
  vencido: boolean;
  criadoPorNome: string | null;
  /** A escada vale aqui também: admin não reenvia convite de admin. */
  podeReenviar: boolean;
};

type Emitido = { link: string; expiraEm: Date };

/**
 * Convites ainda não usados (04-ui.md §5.6: "reenviar convite"). Reenviar
 * aposenta o link antigo e emite outro — o antigo deixa de valer na hora.
 */
export function ListaConvites({ convites }: { convites: readonly ConviteNaTela[] }) {
  const router = useRouter();
  const [alvo, setAlvo] = useState<ConviteNaTela | null>(null);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | undefined>(undefined);
  const [emitido, setEmitido] = useState<Emitido | null>(null);

  const cerimonia = useCerimonia<Emitido>((dados) => {
    setEmitido(dados);
    setAlvo(null);
    router.refresh();
  });

  if (convites.length === 0) return null;

  function continuar(evento: FormEvent) {
    evento.preventDefault();
    if (!alvo) return;
    const entrada = { conviteId: alvo.id, motivo };
    const erros = errosDe(reenviarConviteSchema, entrada);
    setErro(erros.motivo);
    if (erros.motivo) return;
    cerimonia.iniciar(() => reenviarConvite(entrada), true);
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-titulo-secao font-medium">Convites em aberto</h2>

      {emitido ? (
        <FaixaAviso
          tom="sucesso"
          titulo="Convite reenviado"
          descricao="O link anterior deixou de valer. Este aparece só agora."
          acao={
            <span className="flex flex-wrap items-center gap-2">
              <code className="break-all text-legenda">{emitido.link}</code>
              <Copiar valor={emitido.link} rotulo="Copiar link do convite" />
            </span>
          }
        />
      ) : null}

      <ul className="flex flex-col gap-2">
        {convites.map((convite) => (
          <li
            key={convite.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-corpo font-medium">{convite.email}</p>
              <p className="flex flex-wrap items-center gap-1 text-legenda text-muted-foreground">
                <SeloStatus dominio="papel" valor={convite.papel} />
                {convite.lojaNome ?? "Todas as lojas"} ·{" "}
                {convite.vencido ? "venceu em " : "vale até "}
                <Tempo valor={convite.expiraEm} />
                {convite.criadoPorNome ? ` · por ${convite.criadoPorNome}` : ""}
              </p>
            </div>
            {convite.podeReenviar ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setMotivo("");
                  setErro(undefined);
                  setEmitido(null);
                  setAlvo(convite);
                }}
              >
                Reenviar
              </Button>
            ) : null}
          </li>
        ))}
      </ul>

      <Dialog
        open={alvo !== null && !cerimonia.confirmando}
        onOpenChange={(aberto) => {
          if (!aberto) {
            setAlvo(null);
            cerimonia.cancelar();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reenviar convite</DialogTitle>
            <DialogDescription>{alvo?.email}</DialogDescription>
          </DialogHeader>
          <form onSubmit={continuar} noValidate className="flex flex-col gap-4">
            <CampoMotivo valor={motivo} onMudar={setMotivo} erro={erro} />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setAlvo(null)}>
                Cancelar
              </Button>
              <Button type="submit">Reenviar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ModalConfirmacaoBlock
        aberto={cerimonia.confirmando}
        titulo="Reenviar convite"
        resumo={`Um link novo, válido por 24 horas, será emitido para ${alvo?.email ?? ""}. O link anterior deixa de valer. Motivo: “${motivo.trim()}”.`}
        textoConfirmar="Reenviar convite"
        carregando={cerimonia.ocupado}
        {...(cerimonia.erro ? { erro: cerimonia.erro } : {})}
        onConfirmar={() => void cerimonia.executar()}
        onCancelar={cerimonia.cancelar}
      />
      <ModalReautenticacao
        aberto={cerimonia.reautenticando}
        reautenticarComSenha={reautenticar}
        onConfirmado={cerimonia.reautenticado}
        onCancelar={cerimonia.desistirDaProva}
      />
    </section>
  );
}
