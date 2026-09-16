import Link from "next/link";
import { AvatarContato } from "@/components/comum/avatar-contato";
import { SeloStatus } from "@/components/comum/selo-status";
import { Tempo } from "@/components/comum/tempo";
import { cn } from "cn";
import type { ItemDaLista } from "@/lib/conversas/dto";

/**
 * Linha da lista (04-ui.md §5.2): `<li><a>` de 64 px no mínimo, com
 * `aria-current` na selecionada — nunca `div onClick`.
 */

function minutosDeAtraso(desde: string, agora: number): number {
  return Math.max(1, Math.round((agora - new Date(desde).getTime()) / 60_000));
}

export function LinhaConversa({
  item,
  selecionada,
  href,
  agora,
}: {
  item: ItemDaLista;
  selecionada: boolean;
  href: string;
  agora: number;
}) {
  const desconectado = item.contaStatus !== "conectado";
  return (
    <li>
      <Link
        href={href}
        aria-current={selecionada ? "page" : undefined}
        className={cn(
          "relative flex min-h-16 gap-3 border-b border-border px-3 py-2.5 outline-none transition-colors",
          "hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          selecionada && "bg-accent before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-primary",
        )}
      >
        <AvatarContato nome={item.contatoNome} url={item.contatoAvatar} canal={item.provedor} tamanho="medio" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className={cn("truncate text-corpo", item.naoLidas > 0 ? "font-semibold" : "font-medium")}>
              {item.contatoNome}
            </span>
            {item.ultimaMensagemEm ? (
              <Tempo valor={item.ultimaMensagemEm} formato="lista" className="shrink-0 text-legenda text-muted-foreground" />
            ) : null}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-denso text-muted-foreground">{item.previa ?? "Sem mensagens"}</span>
            {item.naoLidas > 0 ? (
              <span
                className="grid min-w-5 place-items-center rounded-full bg-primary px-1.5 text-legenda font-semibold text-primary-foreground tabular-nums"
                aria-label={`${item.naoLidas} não lidas`}
              >
                {item.naoLidas > 99 ? "99+" : item.naoLidas}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-1 pt-0.5 text-legenda text-muted-foreground">
            <span className="rounded border border-border px-1.5">{item.contaRotulo}</span>
            <span className="rounded border border-border px-1.5">{item.lojaNome}</span>
            {item.slaEstouradoEm ? (
              <span className="rounded border border-perigo-borda bg-perigo-fundo px-1.5 text-perigo">
                Atrasada {minutosDeAtraso(item.slaEstouradoEm, agora)} min
              </span>
            ) : null}
            {desconectado ? (
              <span className="rounded border border-aviso-borda bg-aviso-fundo px-1.5 text-aviso">Número desconectado</span>
            ) : null}
            <SeloStatus dominio="prioridade" valor={item.prioridade} />
            {item.status !== "aberta" ? <SeloStatus dominio="status_conversa" valor={item.status} /> : null}
            <span className="truncate">{item.responsavelNome ?? "Sem responsável"}</span>
          </div>
        </div>
      </Link>
    </li>
  );
}
