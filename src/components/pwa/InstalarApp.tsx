"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Download, Share } from "lucide-react"

/**
 * Registra o service worker e oferece instalar o sistema como aplicativo.
 *
 * Duas realidades diferentes:
 *   - Android e computador disparam `beforeinstallprompt`, e o botao chama a
 *     janela nativa de instalacao;
 *   - iPhone NAO tem esse evento: instalar e "Compartilhar > Adicionar a Tela
 *     de Inicio", feito a mao. Por isso a dica, em vez de um botao que nao
 *     faria nada.
 *
 * Instalado, o app roda em janela propria, sem barra de endereco, e ganha
 * icone na area de trabalho e na tela do celular.
 */

type EventoDeInstalacao = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

export function InstalarApp() {
  const [evento, setEvento] = useState<EventoDeInstalacao | null>(null)
  const [instalado, setInstalado] = useState(false)
  const [noIphone, setNoIphone] = useState(false)

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Sem service worker o sistema funciona igual; so nao instala.
      })
    }

    const jaInstalado =
      window.matchMedia("(display-mode: standalone)").matches ||
      // Safari do iPhone expoe assim, fora do padrao.
      (window.navigator as { standalone?: boolean }).standalone === true
    setInstalado(jaInstalado)

    const ua = window.navigator.userAgent
    setNoIphone(/iPhone|iPad|iPod/.test(ua) && !jaInstalado)

    const aoPoderInstalar = (e: Event) => {
      // Sem isto o Chrome mostra a barra dele, no lugar que ele escolher.
      e.preventDefault()
      setEvento(e as EventoDeInstalacao)
    }
    window.addEventListener("beforeinstallprompt", aoPoderInstalar)
    window.addEventListener("appinstalled", () => setInstalado(true))
    return () => window.removeEventListener("beforeinstallprompt", aoPoderInstalar)
  }, [])

  if (instalado) return null

  if (noIphone) {
    return (
      <p className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground">
        <Share className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Para instalar: toque em Compartilhar e em &quot;Adicionar à Tela de Início&quot;.
      </p>
    )
  }

  if (!evento) return null

  return (
    <Button
      variant="outline"
      size="sm"
      className="w-full justify-start gap-2"
      onClick={async () => {
        await evento.prompt()
        const escolha = await evento.userChoice
        // O evento so vale uma vez; guardar o antigo daria erro no segundo toque.
        setEvento(null)
        if (escolha.outcome === "accepted") setInstalado(true)
      }}
    >
      <Download className="h-4 w-4" aria-hidden="true" />
      Instalar aplicativo
    </Button>
  )
}
