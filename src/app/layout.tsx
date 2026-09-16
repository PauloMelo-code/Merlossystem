import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { Inter } from "next/font/google";
import { ProvedorTema } from "@/components/layout/provedor-tema";
import { NOME_COMPLETO, TITULO_ABA } from "@/lib/marca";

import "./globals.css";

/**
 * Layout raiz (04-ui.md §4.1): `html lang="pt-BR"`, Inter, provedor único de
 * tema com o Toaster dentro e a metadata.
 *
 * `suppressHydrationWarning` no `<html>` porque o `next-themes` escreve a
 * classe do tema antes da hidratação — sem ele, todo carregamento reclama.
 *
 * O NONCE da CSP é escrito por `src/proxy.ts` no cabeçalho `x-nonce` e o Next
 * o consome sozinho quando a requisição o traz. O único `<script>` inline que
 * nasce aqui é o do `next-themes`, que recebe o mesmo nonce. Consequência já
 * aceita (02-seguranca.md §14.2): nenhuma rota de `(app)` pode usar
 * `generateStaticParams` nem cache estático.
 */

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: { default: TITULO_ABA, template: `%s · ${NOME_COMPLETO}` },
  description: `Atendimento multicanal e CRM da ${NOME_COMPLETO}.`,
  applicationName: NOME_COMPLETO,
  // Sistema 100% autenticado: nada aqui deve aparecer em busca.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // O teclado do celular REDIMENSIONA a tela em vez de cobrir o composer (§4.4).
  interactiveWidget: "resizes-content",
};

export default async function LayoutRaiz({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? "";
  return (
    <html lang="pt-BR" suppressHydrationWarning className={inter.variable}>
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        <ProvedorTema nonce={nonce}>{children}</ProvedorTema>
      </body>
    </html>
  );
}
