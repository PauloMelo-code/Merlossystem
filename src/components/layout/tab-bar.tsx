"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Ellipsis, MessagesSquare } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ICONES_NAV } from "./navegacao-lateral";
import { ehRotaAtiva, porGrupo, ROTAS_DA_TAB_BAR, type Contador, type ItemNav } from "@/lib/navegacao";

/**
 * Navegação do celular (04-ui.md §4.2 e §4.4): Conversas, Contatos, Pedidos e
 * "Mais" num `sheet`.
 *
 * `escondida` some com a barra quando o chat está aberto — no celular o chat é
 * tela cheia e a tab bar cobriria o composer.
 *
 * Alvo de toque de 44 px em `pointer: coarse` (§2.6): por ponteiro, não por
 * largura de tela.
 */
export function TabBar({
  itens,
  contadores = {},
  escondida = false,
}: {
  itens: readonly ItemNav[];
  contadores?: Partial<Record<Contador, number>>;
  escondida?: boolean;
}) {
  const caminho = usePathname();
  const [maisAberto, setMaisAberto] = useState(false);

  if (escondida) return null;

  const principais = ROTAS_DA_TAB_BAR.map((rota) => itens.find((i) => i.rota === rota)).filter(
    (item): item is ItemNav => item !== undefined,
  );
  const restantes = itens.filter((item) => !(ROTAS_DA_TAB_BAR as readonly string[]).includes(item.rota));

  return (
    <nav
      aria-label="Navegação do celular"
      className="fixed inset-x-0 bottom-0 z-20 flex border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {principais.map((item) => {
        const Icone = ICONES_NAV[item.icone] ?? MessagesSquare;
        const ativo = ehRotaAtiva(item.rota, caminho);
        const contador = item.contador ? contadores[item.contador] : undefined;
        return (
          <Link
            key={item.rota}
            href={item.rota}
            aria-current={ativo ? "page" : undefined}
            className={`relative flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-legenda ${
              ativo ? "font-semibold text-marca-texto" : "text-muted-foreground"
            }`}
          >
            <Icone aria-hidden="true" strokeWidth={2} className="size-5" />
            {item.rotulo}
            {contador && contador > 0 ? (
              <span className="absolute top-1 right-1/4 size-2 rounded-full bg-primary">
                <span className="sr-only">{`${contador} sem ler`}</span>
              </span>
            ) : null}
          </Link>
        );
      })}

      <Sheet open={maisAberto} onOpenChange={setMaisAberto}>
        <SheetTrigger asChild>
          <button
            type="button"
            className="flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-legenda text-muted-foreground"
          >
            <Ellipsis aria-hidden="true" strokeWidth={2} className="size-5" />
            Mais
          </button>
        </SheetTrigger>
        <SheetContent side="bottom" className="max-h-dvh overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Mais</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4 pb-6">
            {porGrupo(restantes).map(({ grupo, itens: doGrupo }) => (
              <div key={grupo} className="flex flex-col gap-1">
                <p className="text-legenda font-medium text-texto-terciario">{grupo}</p>
                <ul className="flex flex-col">
                  {doGrupo.map((item) => {
                    const Icone = ICONES_NAV[item.icone] ?? MessagesSquare;
                    return (
                      <li key={item.rota}>
                        <Link
                          href={item.rota}
                          onClick={() => setMaisAberto(false)}
                          className="flex min-h-11 items-center gap-2.5 text-corpo"
                        >
                          <Icone aria-hidden="true" strokeWidth={2} className="size-5" />
                          {item.rotulo}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </nav>
  );
}
