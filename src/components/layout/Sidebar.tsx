"use client"

import { createContext, useContext, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useSession } from "next-auth/react"
import { cn } from "@/lib/utils"
import { InstalarApp } from "@/components/pwa/InstalarApp"
import { motion } from "framer-motion"
import {
  Inbox, Users, Kanban, ShoppingBag, Image, Package,
  ArrowLeftRight, Megaphone, FileText, BookOpen,
  BarChart3, Bell, MessageSquare, Settings, Menu,
} from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Logo } from "@/components/ui/logo"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"

// Context to control mobile sidebar from Header
const SidebarContext = createContext<{
  open: boolean
  setOpen: (v: boolean) => void
}>({ open: false, setOpen: () => {} })

export function useSidebar() {
  return useContext(SidebarContext)
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <SidebarContext.Provider value={{ open, setOpen }}>
      {children}
    </SidebarContext.Provider>
  )
}

const mainNav = [
  { name: "Inbox", href: "/inbox", icon: Inbox },
  { name: "Contatos", href: "/contacts", icon: Users },
  { name: "Pipeline", href: "/pipeline", icon: Kanban },
  { name: "Pedidos", href: "/orders", icon: Package },
  { name: "Produtos", href: "/products", icon: ShoppingBag },
]

const channelNav = [
  { name: "Broadcast", href: "/broadcasts", icon: Megaphone },
  { name: "Templates", href: "/templates", icon: FileText },
  { name: "Respostas Rápidas", href: "/quick-replies", icon: MessageSquare },
]

const toolsNav = [
  { name: "Analytics", href: "/analytics", icon: BarChart3 },
  { name: "Galeria", href: "/gallery", icon: Image },
  { name: "Trocas", href: "/returns", icon: ArrowLeftRight },
  { name: "Base de Conhecimento", href: "/knowledge-base", icon: BookOpen },
  { name: "Alertas", href: "/alerts", icon: Bell },
]

const settingsNav = [
  { name: "Configurações", href: "/settings", icon: Settings },
]

/**
 * O que a VENDEDORA usa no dia a dia. O resto (Broadcast, Templates,
 * Analytics, Base de Conhecimento, Alertas e Configurações) sai do menu dela:
 * é trabalho de gestão, e item que abre em "você não tem acesso" só ensina a
 * equipe a ignorar aviso de erro. O servidor recusa de qualquer forma — a tela
 * esconder é conforto, não é a tranca (src/lib/rbac.ts).
 */
const DA_VENDEDORA = [
  "/inbox",
  "/contacts",
  "/pipeline",
  "/orders",
  "/products",
  "/quick-replies",
  "/gallery",
  "/returns",
]

function paraOPapel(itens: typeof mainNav, papel: string | undefined) {
  if (papel !== "vendedor") return itens
  return itens.filter((i) => DA_VENDEDORA.includes(i.href))
}

function NavSection({
  label, items, pathname, onNavigate,
}: {
  label?: string
  items: typeof mainNav
  pathname: string
  onNavigate?: () => void
}) {
  return (
    <div className="space-y-0.5">
      {label && (
        <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.15em] text-neutral-500">
          {label}
        </p>
      )}
      {items.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(item.href + "/")
        return (
          <Link key={item.href} href={item.href} className="block relative" onClick={onNavigate}>
            <motion.div
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-200",
                isActive
                  ? "bg-white/10 text-white"
                  : "text-neutral-400 hover:bg-white/[0.05] hover:text-neutral-200"
              )}
              whileHover={{ x: 2 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
            >
              <item.icon className={cn("h-[18px] w-[18px] shrink-0", isActive && "text-white")} strokeWidth={1.8} />
              <span className="truncate">{item.name}</span>
              {isActive && (
                <motion.div
                  layoutId="sidebar-active"
                  className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-white"
                  transition={{ type: "spring", stiffness: 350, damping: 30 }}
                />
              )}
            </motion.div>
          </Link>
        )
      })}
    </div>
  )
}

// Shared sidebar content (used in both desktop and mobile)
function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()
  const { data: sessao } = useSession()
  const papel = sessao?.user?.role
  const comunicacao = paraOPapel(channelNav, papel)
  const ferramentas = paraOPapel(toolsNav, papel)
  const configuracao = paraOPapel(settingsNav, papel)

  return (
    <div className="flex h-full flex-col bg-[#141414]">
      {/* Logo */}
      <div className="flex h-16 items-center px-5">
        <Logo size="sm" variant="light" />
      </div>

      <Separator className="bg-white/[0.06]" />

      {/* Navigation */}
      <ScrollArea className="flex-1 px-3 py-4">
        <nav className="space-y-6">
          <NavSection items={paraOPapel(mainNav, papel)} pathname={pathname} onNavigate={onNavigate} />
          {comunicacao.length > 0 && (
            <NavSection label="Comunicação" items={comunicacao} pathname={pathname} onNavigate={onNavigate} />
          )}
          {ferramentas.length > 0 && (
            <NavSection label="Ferramentas" items={ferramentas} pathname={pathname} onNavigate={onNavigate} />
          )}
        </nav>
      </ScrollArea>

      {/* Bottom settings */}
      <div className="border-t border-white/[0.06] px-3 py-3 space-y-2">
        {configuracao.length > 0 && (
          <NavSection items={configuracao} pathname={pathname} onNavigate={onNavigate} />
        )}
        {/* Instalar como aplicativo: some sozinho quando já está instalado. */}
        <InstalarApp />
      </div>
    </div>
  )
}

// Desktop sidebar (hidden on mobile)
export function Sidebar() {
  return (
    <aside className="hidden lg:flex h-screen w-[260px] flex-col border-r border-white/[0.06]">
      <SidebarContent />
    </aside>
  )
}

// Mobile sidebar trigger button (for Header)
export function MobileSidebarTrigger() {
  const { open, setOpen } = useSidebar()

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger>
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden h-9 w-9 rounded-lg hover:bg-neutral-100"
        >
          <Menu className="h-5 w-5 text-neutral-600" strokeWidth={1.8} />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[280px] p-0 border-0 bg-[#141414]">
        <SidebarContent onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  )
}
