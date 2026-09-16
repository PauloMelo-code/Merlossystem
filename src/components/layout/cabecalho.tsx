"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Marca } from "@/components/comum/marca";
import { BuscaGlobal } from "./busca-global";
import { MenuUsuario, type UsuarioDoMenu } from "./menu-usuario";
import { SeletorLoja, type LojaResumo } from "./seletor-loja";
import { SinoAlertas, type AlertaResumo } from "./sino-alertas";
import { ICONES_NAV } from "./navegacao-lateral";
import { ehRotaAtiva, porGrupo, type ItemNav } from "@/lib/navegacao";

/**
 * Cabeçalho de 56 px (04-ui.md §4.3): alternar menu no celular, contexto de
 * loja, busca global, sino de alertas e menu do usuário.
 *
 * Nunca botão dentro de botão: o gatilho do `sheet` é o próprio botão, com
 * `aria-label` explícito — o sistema antigo aninhava e o clique caía no
 * elemento errado.
 */
export function Cabecalho({
  itens,
  usuario,
  lojas,
  lojaAtiva,
  podeTrocarLoja,
  alertas,
  gravarLojaAtiva,
  sair,
}: {
  itens: readonly ItemNav[];
  usuario: UsuarioDoMenu;
  lojas: readonly LojaResumo[];
  lojaAtiva: string | null;
  podeTrocarLoja: boolean;
  alertas: { contador: number; ultimos: readonly AlertaResumo[] };
  gravarLojaAtiva: (lojaId: string) => Promise<void>;
  sair: () => Promise<void>;
}) {
  const caminho = usePathname();
  const [menuAberto, setMenuAberto] = useState(false);
  const nomeDaLoja = lojaAtiva
    ? (lojas.find((l) => l.id === lojaAtiva)?.nome ?? "Sua loja")
    : "Todas as lojas";

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-3 md:px-4">
      <Sheet open={menuAberto} onOpenChange={setMenuAberto}>
        <SheetTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Abrir menu" className="md:hidden">
            <Menu aria-hidden="true" strokeWidth={2} />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-72 overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              <Marca />
            </SheetTitle>
          </SheetHeader>
          <nav aria-label="Navegação principal" className="flex flex-col gap-4 px-4 pb-6">
            {porGrupo(itens).map(({ grupo, itens: doGrupo }) => (
              <div key={grupo} className="flex flex-col gap-1">
                <p className="text-legenda font-medium text-texto-terciario">{grupo}</p>
                <ul className="flex flex-col">
                  {doGrupo.map((item) => {
                    const Icone = ICONES_NAV[item.icone] ?? MessagesSquare;
                    const ativo = ehRotaAtiva(item.rota, caminho);
                    return (
                      <li key={item.rota}>
                        <Link
                          href={item.rota}
                          aria-current={ativo ? "page" : undefined}
                          onClick={() => setMenuAberto(false)}
                          className={`flex min-h-11 items-center gap-2.5 text-corpo ${
                            ativo ? "font-semibold text-marca-texto" : ""
                          }`}
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
          </nav>
        </SheetContent>
      </Sheet>

      <Link href="/conversas" className="md:hidden">
        <Marca />
      </Link>

      <SeletorLoja
        lojas={lojas}
        lojaAtiva={lojaAtiva}
        podeTrocar={podeTrocarLoja}
        gravarLojaAtiva={gravarLojaAtiva}
      />

      <div className="ml-auto flex items-center gap-1">
        <BuscaGlobal itens={itens} escopo={nomeDaLoja} />
        <SinoAlertas contador={alertas.contador} ultimos={alertas.ultimos} />
        <MenuUsuario usuario={usuario} sair={sair} />
      </div>
    </header>
  );
}
