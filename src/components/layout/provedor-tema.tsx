"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * O provedor ÚNICO de tema (04-ui.md U3 e §2.10). O `Toaster` do sonner mora
 * DENTRO dele — no sistema antigo o toast seguia um tema próprio e aparecia
 * claro sobre a tela escura.
 *
 * Padrão `system`: loja de rua com vitrine, o claro é o caso principal, mas
 * quem decide é a pessoa. `suppressHydrationWarning` está no `<html>` do
 * layout raiz, que é onde o `next-themes` escreve a classe antes da hidratação.
 *
 * O 8º arquivo de `layout/`: não é componente de tela (a tabela de §6.1 lista
 * sete), é a casca que o layout raiz precisa em client.
 */

const LARGURA_CELULAR = "(max-width: 767px)";

export function ProvedorTema({ children }: { children: ReactNode }) {
  // Toast no canto inferior direito no desktop e no topo central no celular,
  // onde ele não cobre o composer do chat (§9).
  const [noCelular, setNoCelular] = useState(false);

  useEffect(() => {
    const consulta = window.matchMedia(LARGURA_CELULAR);
    const atualizar = () => setNoCelular(consulta.matches);
    atualizar();
    consulta.addEventListener("change", atualizar);
    return () => consulta.removeEventListener("change", atualizar);
  }, []);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TooltipProvider delayDuration={300}>
        {children}
        <Toaster
          position={noCelular ? "top-center" : "bottom-right"}
          visibleToasts={3}
          closeButton
        />
      </TooltipProvider>
    </ThemeProvider>
  );
}
