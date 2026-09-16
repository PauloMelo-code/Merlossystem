"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  BookImage,
  BookOpen,
  CalendarClock,
  ChartColumn,
  ChevronsLeft,
  ChevronsRight,
  CircleUser,
  FileText,
  GitBranch,
  Images,
  Megaphone,
  MessagesSquare,
  Package,
  PackageX,
  ScrollText,
  Settings,
  Shirt,
  Smile,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ehRotaAtiva, porGrupo, type Contador, type ItemNav } from "@/lib/navegacao";

/**
 * A navegação é NOSSA, não o primitivo `sidebar` do shadcn (04-ui.md U11):
 * `<nav>` + lista + `tooltip` no trilho. O `sidebar` passa folgado dos 499
 * linhas e exigiria uma exceção de tamanho que ninguém mediu.
 *
 * Os itens chegam JÁ FILTRADOS pelo servidor (`pode()` puro, §4.2): montar
 * menu com `exigirPermissao()` gravaria `recusa_403` na trilha a cada page
 * view.
 *
 * Item ativo: `--accent` + barra de 3 px + peso 600 + `aria-current="page"` —
 * quatro sinais, nunca só cor (§11.5).
 */

/** Chave de `ItemNav.icone` -> glifo. O catálogo guarda o nome, não o componente. */
export const ICONES_NAV: Readonly<Record<string, LucideIcon>> = {
  conversas: MessagesSquare,
  contatos: Users,
  funil: GitBranch,
  pedidos: Package,
  produtos: Shirt,
  trocas: PackageX,
  campanhas: Megaphone,
  modelos: FileText,
  respostas: Zap,
  lookbooks: BookImage,
  agendadas: CalendarClock,
  galeria: Images,
  relatorios: ChartColumn,
  alertas: Bell,
  auditoria: ScrollText,
  satisfacao: Smile,
  conhecimento: BookOpen,
  configuracoes: Settings,
  perfil: CircleUser,
};

export type Contadores = Partial<Record<Contador, number>>;

export function NavegacaoLateral({
  itens,
  contadores = {},
  expandidaInicial = true,
}: {
  itens: readonly ItemNav[];
  contadores?: Contadores;
  /** Preferência lembrada em cookie, lida no servidor (§4.2). */
  expandidaInicial?: boolean;
}) {
  const caminho = usePathname();
  const [expandida, setExpandida] = useState(expandidaInicial);
  const grupos = porGrupo(itens);

  return (
    <nav
      aria-label="Navegação principal"
      // Trilho de 56 px <-> 232 px (w-14 <-> w-58), §4.2 e §4.4.
      className={`hidden shrink-0 flex-col border-r border-border bg-card md:flex ${
        expandida ? "w-58" : "w-14"
      }`}
    >
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto py-3">
        {grupos.map(({ grupo, itens: doGrupo }) => (
          <div key={grupo} className="flex flex-col gap-0.5">
            {expandida ? (
              <p className="px-3 pb-1 text-legenda font-medium text-texto-terciario">{grupo}</p>
            ) : null}
            <ul className="flex flex-col gap-0.5">
              {doGrupo.map((item) => (
                <li key={item.rota}>
                  <ItemDeMenu
                    item={item}
                    ativo={ehRotaAtiva(item.rota, caminho)}
                    expandida={expandida}
                    contador={item.contador ? contadores[item.contador] : undefined}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setExpandida((antes) => !antes)}
        aria-label={expandida ? "Recolher menu" : "Expandir menu"}
        className="flex h-10 items-center justify-center border-t border-border text-texto-terciario hover:bg-accent"
      >
        {expandida ? (
          <ChevronsLeft aria-hidden="true" strokeWidth={2} className="size-5" />
        ) : (
          <ChevronsRight aria-hidden="true" strokeWidth={2} className="size-5" />
        )}
      </button>
    </nav>
  );
}

function ItemDeMenu({
  item,
  ativo,
  expandida,
  contador,
}: {
  item: ItemNav;
  ativo: boolean;
  expandida: boolean;
  contador: number | undefined;
}) {
  const Icone = ICONES_NAV[item.icone] ?? MessagesSquare;

  const conteudo = (
    <Link
      href={item.rota}
      aria-current={ativo ? "page" : undefined}
      className={`relative flex h-10 items-center gap-2.5 px-3 text-corpo ${
        ativo
          ? "bg-accent font-semibold text-accent-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      }`}
    >
      {/* Barra de seleção de 3 px (§2.7). */}
      {ativo ? (
        <span aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5 bg-primary" />
      ) : null}
      <Icone aria-hidden="true" strokeWidth={2} className="size-5 shrink-0" />
      {expandida ? <span className="min-w-0 flex-1 truncate">{item.rotulo}</span> : null}
      {contador && contador > 0 ? (
        <span
          className={
            expandida
              ? "inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-legenda font-semibold text-primary-foreground tabular-nums"
              : "absolute top-1 right-1 size-2 rounded-full bg-primary"
          }
        >
          {expandida ? contador : null}
          <span className="sr-only">{`${contador} sem ler`}</span>
        </span>
      ) : null}
    </Link>
  );

  if (expandida) return conteudo;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{conteudo}</TooltipTrigger>
      <TooltipContent side="right">{item.rotulo}</TooltipContent>
    </Tooltip>
  );
}
