import type { Metadata, Viewport } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { cn } from "@/lib/utils"
import { Providers } from "@/components/providers"
import { Toaster } from "@/components/ui/sonner"

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" })

export const metadata: Metadata = {
  title: "Merlos Store — Atendimento",
  description: "Plataforma Unificada de Atendimento + CRM com IA",
  // Instalável no computador e no celular (PWA): sem o manifesto e os ícones,
  // o navegador não oferece instalar.
  manifest: "/manifest.webmanifest",
  applicationName: "Merlos Store",
  icons: {
    icon: [
      { url: "/icones/icone-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icones/icone-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icones/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "Merlos",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
}

/**
 * `viewportFit: "cover"` com as áreas seguras no CSS: no celular instalado, a
 * barra de gestos do iPhone cobriria os botões de baixo.
 */
export const viewport: Viewport = {
  themeColor: "#171717",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="pt-BR" className={cn("font-sans", inter.variable)}>
      <body className="antialiased">
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  )
}
