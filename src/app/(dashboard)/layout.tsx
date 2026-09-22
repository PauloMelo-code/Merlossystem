"use client"

import { Sidebar, SidebarProvider } from "@/components/layout/Sidebar"
import { BarraCelular } from "@/components/layout/BarraCelular"
import { Header } from "@/components/layout/Header"
import { motion, AnimatePresence } from "framer-motion"
import { usePathname } from "next/navigation"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()

  return (
    <SidebarProvider>
      {/* Skip link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-2 focus:left-2 focus:bg-neutral-900 focus:text-white focus:px-4 focus:py-2 focus:rounded-lg focus:text-sm"
      >
        Ir para o conteúdo principal
      </a>
      <div className="flex h-screen overflow-hidden bg-[#fafaf8] dark:bg-[#0a0a0a]">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden min-w-0">
          <Header />
          {/* `pb-[72px]` no celular: a barra de baixo é fixa e cobriria o fim
              da página (o campo de mensagem, o botão de salvar). */}
          <main id="main-content" className="flex-1 overflow-auto pb-[72px] lg:pb-0">
            <AnimatePresence mode="wait">
              <motion.div
                key={pathname}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                className="h-full p-4 lg:p-6"
              >
                {children}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
        <BarraCelular />
      </div>
    </SidebarProvider>
  )
}
