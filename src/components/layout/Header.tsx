"use client"

import { useEffect, useState, useCallback } from "react"
import { useSession, signOut } from "next-auth/react"
import { useRouter } from "next/navigation"
import { formatDistanceToNow } from "date-fns"
import { ptBR } from "date-fns/locale"
import { Bell, LogOut, User, Search, ChevronDown, Sun, Moon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Input } from "@/components/ui/input"
import { MobileSidebarTrigger } from "./Sidebar"
import { SeletorLoja } from "./SeletorLoja"
import { useTheme } from "@/components/providers"

interface AlertPreview {
  id: string
  type: string
  severity: string
  message: string
  createdAt: string
}

export function Header() {
  const { data: session } = useSession()
  const router = useRouter()
  const [alertCount, setAlertCount] = useState(0)
  const [recentAlerts, setRecentAlerts] = useState<AlertPreview[]>([])

  const loadAlerts = useCallback(async () => {
    try {
      const res = await fetch("/api/alerts?acknowledged=false&limit=5")
      if (res.ok) {
        const data = await res.json()
        setAlertCount(data.unacknowledgedCount)
        setRecentAlerts(data.alerts)
      }
    } catch {
      // Silently fail
    }
  }, [])

  useEffect(() => {
    loadAlerts()
    const interval = setInterval(loadAlerts, 15000)
    return () => clearInterval(interval)
  }, [loadAlerts])

  const initials = session?.user?.name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "MS"

  const firstName = session?.user?.name?.split(" ")[0] || "User"
  const { theme, toggleTheme } = useTheme()

  return (
    <header className="flex h-14 items-center justify-between border-b border-black/[0.06] bg-white/80 dark:bg-neutral-900/80 dark:border-white/[0.06] backdrop-blur-sm px-4 lg:px-6">
      <div className="flex items-center gap-3">
        {/* Mobile menu button */}
        <MobileSidebarTrigger />

        {/* Loja ativa — gestao troca; vendedor so ve a dele */}
        <SeletorLoja />

        {/* Search */}
        <div className="relative hidden sm:block w-56 lg:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" strokeWidth={1.8} />
          <Input
            placeholder="Buscar conversas, contatos..."
            className="h-9 pl-9 bg-neutral-50/80 dark:bg-neutral-800/60 border-neutral-200/60 dark:border-neutral-700/60 text-sm placeholder:text-neutral-400 focus:bg-white dark:focus:bg-neutral-800 transition-colors rounded-lg"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* Mobile search button */}
        <Button variant="ghost" size="icon" className="sm:hidden h-9 w-9 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800">
          <Search className="h-[18px] w-[18px] text-neutral-600 dark:text-neutral-300" strokeWidth={1.8} />
        </Button>

        {/* Theme toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800"
          onClick={toggleTheme}
        >
          {theme === "light" ? (
            <Moon className="h-[18px] w-[18px] text-neutral-600 dark:text-neutral-300" strokeWidth={1.8} />
          ) : (
            <Sun className="h-[18px] w-[18px] text-neutral-600 dark:text-neutral-300" strokeWidth={1.8} />
          )}
        </Button>

        {/* Notifications */}
        <DropdownMenu>
          <DropdownMenuTrigger>
            <Button variant="ghost" size="icon" className="relative h-9 w-9 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800">
              <Bell className="h-[18px] w-[18px] text-neutral-600 dark:text-neutral-300" strokeWidth={1.8} />
              {alertCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 text-[10px] font-medium text-white px-1 ring-2 ring-white dark:ring-neutral-900">
                  {alertCount > 9 ? "9+" : alertCount}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80 rounded-xl shadow-premium-hover border-neutral-200/60 p-0">
            <div className="px-4 py-3 border-b border-neutral-100">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-neutral-900">Notificações</span>
                {alertCount > 0 && (
                  <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-neutral-900 text-[10px] font-medium text-white px-1.5">
                    {alertCount}
                  </span>
                )}
              </div>
            </div>
            <ScrollArea className="max-h-72">
              {recentAlerts.length === 0 ? (
                <div className="p-6 text-center">
                  <Bell className="h-8 w-8 text-neutral-300 mx-auto mb-2" strokeWidth={1.5} />
                  <p className="text-sm text-neutral-500">Nenhuma notificação</p>
                </div>
              ) : (
                <div className="p-1">
                  {recentAlerts.map((alert) => (
                    <DropdownMenuItem
                      key={alert.id}
                      className="flex flex-col items-start gap-1 px-3 py-2.5 cursor-pointer rounded-lg"
                      onClick={() => router.push("/alerts")}
                    >
                      <span className="text-[13px] font-medium text-neutral-800 line-clamp-2 leading-snug">
                        {alert.message}
                      </span>
                      <span className="text-[11px] text-neutral-400">
                        {formatDistanceToNow(new Date(alert.createdAt), {
                          addSuffix: true,
                          locale: ptBR,
                        })}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </div>
              )}
            </ScrollArea>
            {alertCount > 0 && (
              <>
                <DropdownMenuSeparator className="bg-neutral-100" />
                <DropdownMenuItem
                  className="text-center text-xs font-medium text-neutral-600 justify-center cursor-pointer py-2.5 hover:text-neutral-900"
                  onClick={() => router.push("/alerts")}
                >
                  Ver todas as notificações
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Divider */}
        <div className="hidden sm:block h-6 w-px bg-neutral-200 dark:bg-neutral-700 mx-1" />

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger>
            <Button variant="ghost" className="flex items-center gap-2 h-9 px-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800">
              <Avatar className="h-7 w-7 ring-1 ring-neutral-200 dark:ring-neutral-700">
                {/* A foto de "Minha conta"; sem ela, as iniciais. */}
                {session?.user?.image && <AvatarImage src={session.user.image} alt="" />}
                <AvatarFallback className="bg-neutral-900 text-white text-[11px] font-medium">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <span className="hidden sm:inline text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                {firstName}
              </span>
              <ChevronDown className="hidden sm:inline h-3.5 w-3.5 text-neutral-400 dark:text-neutral-500" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 rounded-xl shadow-premium-hover border-neutral-200/60">
            <div className="px-3 py-2.5">
              <p className="text-sm font-medium text-neutral-900">{session?.user?.name}</p>
              <p className="text-xs text-neutral-500">{session?.user?.email}</p>
            </div>
            <DropdownMenuSeparator className="bg-neutral-100" />
            {/* Levava a lugar nenhum: trocar a senha dependia do administrador. */}
            <DropdownMenuItem
              onClick={() => router.push("/perfil")}
              className="gap-2 text-neutral-600 cursor-pointer rounded-lg mx-1"
            >
              <User className="h-4 w-4" strokeWidth={1.8} />
              <span className="text-[13px]">Meu Perfil</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-neutral-100" />
            <DropdownMenuItem
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="gap-2 text-red-600 cursor-pointer rounded-lg mx-1 focus:text-red-600"
            >
              <LogOut className="h-4 w-4" strokeWidth={1.8} />
              <span className="text-[13px]">Sair</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
