"use client";

import Link from "next/link";
import { Check, CheckCheck, Clock, FileText, OctagonAlert, Package, RotateCw, Smartphone } from "lucide-react";
import { Tempo } from "@/components/comum/tempo";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import type { MensagemDto, MidiaDaMensagem } from "@/lib/conversas/dto";

/**
 * Balão (04-ui.md §5.2). Estado de entrega com ÍCONE + TEXTO acessível, nunca
 * só cor. Falha mostra `falha_motivo` em texto visível + "Tentar de novo".
 * Mídia só pela rota interna (`/api/midias/[id]`), nunca pela URL do provedor.
 */

const ENTREGA = {
  pendente: { Icone: Clock, rotulo: "Enviando" },
  enviada: { Icone: Check, rotulo: "Enviada" },
  entregue: { Icone: CheckCheck, rotulo: "Entregue" },
  lida: { Icone: CheckCheck, rotulo: "Lida" },
  falhou: { Icone: OctagonAlert, rotulo: "Não entregue" },
} as const;

function Midia({ m }: { m: MidiaDaMensagem }) {
  if (!m.endereco) {
    return <p className="rounded-md border border-dashed border-border px-3 py-2 text-denso text-muted-foreground">Mídia indisponível</p>;
  }
  const descricao = m.legenda ?? (m.tipo === "imagem" ? "Imagem enviada na conversa" : "Anexo da conversa");
  switch (m.tipo) {
    case "imagem":
    case "sticker":
      return (
        <a href={m.endereco} target="_blank" rel="noreferrer" className="block">
          {/* Mídia privada: sem next/image (o otimizador não passa pelo portão). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={m.miniatura ?? m.endereco}
            alt={descricao}
            loading="lazy"
            className="aspect-[4/3] w-64 max-w-full rounded-md bg-muted object-cover"
          />
        </a>
      );
    case "audio":
      return <audio controls preload="none" src={m.endereco} className="w-64 max-w-full" aria-label="Áudio da conversa" />;
    case "video":
      return <video controls preload="none" src={m.endereco} className="aspect-video w-64 max-w-full rounded-md bg-muted" aria-label={descricao} />;
    default:
      return (
        <a href={m.endereco} className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-denso hover:bg-muted">
          <FileText aria-hidden="true" className="size-4" />
          {m.legenda ?? "Documento"}
        </a>
      );
  }
}

export type MensagemNaTela = MensagemDto & { otimista?: boolean };

export function BalaoMensagem({
  mensagem: m,
  mostrarAutor,
  colado,
  podeReenviar,
  aoReenviar,
}: {
  mensagem: MensagemNaTela;
  mostrarAutor: boolean;
  colado: boolean;
  podeReenviar: boolean;
  aoReenviar: (id: string) => void;
}) {
  const saida = m.direcao === "saida";
  const entrega = m.status ? ENTREGA[m.status as keyof typeof ENTREGA] : null;
  const card = m.cartao;
  const autor = m.notaInterna
    ? `Nota de ${m.autorNome ?? "alguém da equipe"}`
    : m.doAparelho
      ? "Enviada pelo aparelho"
      : m.autorTipo === "campanha"
        ? "Campanha"
        : m.autorNome;

  return (
    <li className={cn("flex flex-col", saida ? "items-end" : "items-start", colado ? "mt-0.5" : "mt-3")}>
      {mostrarAutor && saida && autor ? (
        <span className="mb-0.5 inline-flex items-center gap-1 px-1 text-legenda text-muted-foreground">
          {m.doAparelho ? <Smartphone aria-hidden="true" className="size-3" /> : null}
          {autor}
        </span>
      ) : null}
      <div
        className={cn(
          "flex max-w-[min(75%,60ch)] flex-col gap-1.5 rounded-lg px-3 py-2 text-mensagem shadow-sm",
          m.notaInterna
            ? "border border-nota-interna-borda bg-nota-interna-fundo text-nota-interna-texto"
            : saida
              ? "bg-balao-saida"
              : "bg-balao-entrada",
          m.status === "falhou" && "border border-perigo-borda",
          m.otimista && "opacity-80",
        )}
      >
        {m.midias.map((x) => (
          <Midia key={x.id} m={x} />
        ))}
        {card ? (
          <Link
            href={card.tipo === "pedido" ? `/pedidos/${card.id}` : `/produtos/${card.id}`}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-denso hover:bg-muted"
          >
            <Package aria-hidden="true" className="size-4" />
            {card.tipo === "pedido" ? "Pedido" : card.tipo === "pagamento" ? "Pagamento" : "Produto"}
          </Link>
        ) : null}
        {m.conteudo ? <p className="break-words whitespace-pre-wrap">{m.conteudo}</p> : null}
        <span
          className={cn(
            "inline-flex items-center gap-1 self-end text-legenda",
            saida && !m.notaInterna ? "text-balao-saida-hora" : "text-muted-foreground",
          )}
        >
          <Tempo valor={m.ocorridaEm} formato="hora" />
          {entrega && !m.notaInterna ? (
            <>
              <entrega.Icone aria-hidden="true" className={cn("size-3.5", m.status === "lida" && "text-marca-texto")} />
              <span className={m.status === "falhou" ? "text-perigo" : "sr-only"}>{entrega.rotulo}</span>
            </>
          ) : null}
        </span>
      </div>
      {m.status === "falhou" ? (
        <div className="mt-1 flex max-w-[min(75%,60ch)] flex-wrap items-center justify-end gap-2 text-legenda text-perigo">
          <span>{m.falhaMotivo ?? "O provedor recusou a mensagem."}</span>
          {podeReenviar ? (
            <Button type="button" variant="outline" size="xs" onClick={() => aoReenviar(m.id)}>
              <RotateCw aria-hidden="true" />
              Tentar de novo
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
