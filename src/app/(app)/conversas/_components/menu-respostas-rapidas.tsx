"use client";

import { useEffect, useState } from "react";
import { cn } from "cn";
import type { RespostaRapidaDto } from "@/lib/conversas/dto";

/**
 * Menu de respostas rápidas (04-ui.md §5.2): abre com `/` no começo do
 * composer, filtra por atalho ou título, navega por setas, Enter escolhe e Esc
 * fecha. A escolha só PREENCHE o composer — quem envia é a pessoa.
 */

export function filtrarRespostas(respostas: readonly RespostaRapidaDto[], termo: string): RespostaRapidaDto[] {
  const t = termo.trim().toLowerCase();
  if (!t) return respostas.slice(0, 8);
  return respostas
    .filter((r) => r.atalho?.toLowerCase().startsWith(t) || r.titulo.toLowerCase().includes(t))
    .slice(0, 8);
}

export function MenuRespostasRapidas({
  respostas,
  termo,
  aoEscolher,
  aoFechar,
}: {
  respostas: readonly RespostaRapidaDto[];
  termo: string;
  aoEscolher: (conteudo: string) => void;
  aoFechar: () => void;
}) {
  const itens = filtrarRespostas(respostas, termo);
  const [ativo, setAtivo] = useState(0);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        aoFechar();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setAtivo((i) => Math.min(itens.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setAtivo((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter" && itens[ativo]) {
        e.preventDefault();
        e.stopPropagation();
        aoEscolher(itens[ativo].conteudo);
      }
    };
    window.addEventListener("keydown", aoTeclar, true);
    return () => window.removeEventListener("keydown", aoTeclar, true);
  }, [itens, ativo, aoEscolher, aoFechar]);

  return (
    <div className="absolute right-0 bottom-full left-0 z-20 mb-2 rounded-md border border-border bg-popover p-1 shadow-2">
      {itens.length === 0 ? (
        <p className="px-3 py-2 text-denso text-muted-foreground">
          {respostas.length === 0 ? "Esta loja ainda não tem respostas rápidas." : `Nenhuma resposta para "${termo}".`}
        </p>
      ) : (
        <ul role="listbox" aria-label="Respostas rápidas">
          {itens.map((r, i) => (
            <li
              key={r.id}
              role="option"
              aria-selected={i === ativo}
              onMouseDown={(e) => {
                e.preventDefault();
                aoEscolher(r.conteudo);
              }}
              onMouseEnter={() => setAtivo(i)}
              className={cn("cursor-pointer rounded px-3 py-1.5", i === ativo && "bg-accent")}
            >
              <span className="block text-denso font-medium">
                {r.atalho ? <span className="mr-1 text-marca-texto">/{r.atalho}</span> : null}
                {r.titulo}
              </span>
              <span className="block truncate text-legenda text-muted-foreground">{r.conteudo}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
