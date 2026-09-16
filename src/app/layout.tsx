import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

// Provedor de tema, Toaster e metadata completa entram com o shell (F7).
export const metadata: Metadata = {
  title: "MerlostoreChat",
};

export default function LayoutRaiz({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
