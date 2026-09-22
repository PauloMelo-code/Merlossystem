"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Inbox, Users, Kanban, Package, Menu } from "lucide-react"
import { useSidebar } from "./Sidebar"
import { cn } from "@/lib/utils"

/**
 * Barra de baixo, no estilo de aplicativo de celular.
 *
 * No celular a vendedora usa o sistema com UMA mao, em pe na loja: menu
 * escondido atras de um botao no topo e alvo pequeno nao servem. Aqui ficam os
 * quatro lugares do dia a dia, com alvo de 44 px (o minimo que o dedo acerta) e
 * rotulo escrito — icone sozinho vira adivinhacao.
 *
 * "Mais" abre o mesmo menu completo que ja existia, sem duplicar navegacao.
 *
 * Some no computador (`lg:hidden`), onde a lateral ja da conta.
 */

const ITENS = [
  { nome: "Conversas", href: "/inbox", Icone: Inbox },
  { nome: "Contatos", href: "/contacts", Icone: Users },
  { nome: "Funil", href: "/pipeline", Icone: Kanban },
  { nome: "Pedidos", href: "/orders", Icone: Package },
]

export function BarraCelular() {
  const pathname = usePathname()
  const { setOpen } = useSidebar()

  return (
    <nav
      aria-label="Navegação principal"
      // `pb-[env(safe-area-inset-bottom)]`: instalado no iPhone, a barra de
      // gestos comeria os botoes.
      className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden dark:border-neutral-800 dark:bg-neutral-950"
    >
      <ul className="flex items-stretch">
        {ITENS.map(({ nome, href, Icone }) => {
          const ativo = pathname === href || pathname.startsWith(href + "/")
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={ativo ? "page" : undefined}
                className={cn(
                  "flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 py-2 text-[11px] font-medium transition-colors active:bg-neutral-100 dark:active:bg-neutral-900",
                  ativo ? "text-neutral-900 dark:text-white" : "text-neutral-500"
                )}
              >
                <Icone className="h-5 w-5" strokeWidth={ativo ? 2.2 : 1.8} aria-hidden="true" />
                {nome}
              </Link>
            </li>
          )
        })}

        <li className="flex-1">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex min-h-[56px] w-full flex-col items-center justify-center gap-0.5 px-1 py-2 text-[11px] font-medium text-neutral-500 transition-colors active:bg-neutral-100 dark:active:bg-neutral-900"
          >
            <Menu className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
            Mais
          </button>
        </li>
      </ul>
    </nav>
  )
}
