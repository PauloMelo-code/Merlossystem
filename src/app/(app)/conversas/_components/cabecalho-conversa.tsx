"use client";

import Link from "next/link";
import { Archive, ArrowLeft, CircleCheck, MoreVertical, PanelRight, RotateCcw, UserRound } from "lucide-react";
import { AvatarContato } from "@/components/comum/avatar-contato";
import { IconeCanal, rotuloDoCanal } from "@/components/comum/icone-canal";
import { SeloStatus } from "@/components/comum/selo-status";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ConversaDto } from "@/lib/conversas/dto";

/**
 * Cabeçalho de 56 px (04-ui.md §5.2): voltar (celular), contato, canal + conta
 * (+ selo "não oficial" no uazapi), status e responsável. Ações: Transferir,
 * Resolver e "Mais ações". Todas reversíveis — executam já, com "Desfazer".
 */

const PRIORIDADES = [
  { valor: "baixa", rotulo: "Baixa" },
  { valor: "media", rotulo: "Média" },
  { valor: "alta", rotulo: "Alta" },
  { valor: "urgente", rotulo: "Urgente" },
] as const;

export function CabecalhoConversa({
  conversa: c,
  voltarPara,
  aoTransferir,
  aoResolver,
  aoReabrir,
  aoArquivar,
  aoPrioridade,
  aoAlternarPainel,
}: {
  conversa: ConversaDto;
  voltarPara: string;
  aoTransferir: () => void;
  aoResolver: () => void;
  aoReabrir: () => void;
  aoArquivar: () => void;
  aoPrioridade: (valor: string) => void;
  aoAlternarPainel: () => void;
}) {
  const encerrada = c.status === "resolvida" || c.status === "arquivada";
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-2 md:px-4">
      <Button asChild variant="ghost" size="icon-sm" className="md:hidden">
        <Link href={voltarPara} aria-label="Voltar para a lista">
          <ArrowLeft aria-hidden="true" />
        </Link>
      </Button>
      <AvatarContato nome={c.contatoNome} url={c.contatoAvatar} canal={c.provedor} tamanho="pequeno" />
      <div className="flex min-w-0 flex-1 flex-col">
        <h2 className="truncate text-corpo font-semibold">{c.contatoNome}</h2>
        <p className="flex min-w-0 items-center gap-1.5 text-legenda text-muted-foreground">
          <IconeCanal canal={c.provedor} tamanho="pequeno" />
          <span className="truncate">
            {rotuloDoCanal(c.provedor)} · {c.contaRotulo}
          </span>
          {c.provedor === "uazapi" ? (
            <span className="rounded border border-aviso-borda bg-aviso-fundo px-1 text-aviso">não oficial</span>
          ) : null}
          <SeloStatus dominio="status_conversa" valor={c.status} />
          <span className="hidden items-center gap-1 truncate sm:inline-flex">
            <UserRound aria-hidden="true" className="size-3" />
            {c.responsavelNome ?? "Sem responsável"}
          </span>
        </p>
      </div>

      {c.podeGerir ? (
        <>
          <Button type="button" variant="outline" size="sm" onClick={aoTransferir} className="hidden sm:inline-flex">
            Transferir
          </Button>
          {encerrada ? (
            <Button type="button" variant="outline" size="sm" onClick={aoReabrir}>
              <RotateCcw aria-hidden="true" />
              Reabrir
            </Button>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={aoResolver}>
              <CircleCheck aria-hidden="true" />
              Resolver
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Mais ações">
                <MoreVertical aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem className="sm:hidden" onSelect={aoTransferir}>
                Transferir
              </DropdownMenuItem>
              <DropdownMenuLabel>Prioridade</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={c.prioridade} onValueChange={aoPrioridade}>
                {PRIORIDADES.map((p) => (
                  <DropdownMenuRadioItem key={p.valor} value={p.valor}>
                    {p.rotulo}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              {c.status !== "arquivada" ? (
                <DropdownMenuItem onSelect={aoArquivar}>
                  <Archive aria-hidden="true" />
                  Arquivar
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem asChild>
                <Link href={`/contatos/${c.contatoId}`}>Abrir ficha do contato</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      ) : null}
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Mostrar ou esconder o painel do contato" onClick={aoAlternarPainel} className="hidden lg:inline-flex">
        <PanelRight aria-hidden="true" />
      </Button>
    </header>
  );
}
