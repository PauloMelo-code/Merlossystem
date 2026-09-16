import { MessageCircle } from "lucide-react";

/**
 * Logos de canal não existem no lucide (04-ui.md §2.9): os glifos moram aqui,
 * desenhados com `currentColor` para a cor sair do token `--canal-*` e nunca
 * de um hex no TSX.
 *
 * Canal desconhecido tem FALLBACK NEUTRO — no sistema antigo virava WhatsApp,
 * e a vendedora respondia pelo canal errado.
 */

export type Canal = "whatsapp_oficial" | "uazapi" | "instagram" | "facebook" | "tiktok_shop";

const ROTULOS: Readonly<Record<Canal, string>> = {
  whatsapp_oficial: "WhatsApp",
  uazapi: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok_shop: "TikTok",
};

const CORES: Readonly<Record<Canal, string>> = {
  whatsapp_oficial: "text-canal-whatsapp",
  uazapi: "text-canal-whatsapp",
  instagram: "text-canal-instagram",
  facebook: "text-canal-facebook",
  tiktok_shop: "text-canal-tiktok",
};

const TAMANHOS = { pequeno: "size-3.5", medio: "size-4", grande: "size-5" } as const;

function ehCanal(valor: string): valor is Canal {
  return valor in ROTULOS;
}

/** Nome do canal em PT-BR, para o texto ao lado do glifo (nunca só cor). */
export function rotuloDoCanal(canal: string): string {
  return ehCanal(canal) ? ROTULOS[canal] : "Canal";
}

const GLIFOS: Readonly<Record<Canal, string>> = {
  whatsapp_oficial:
    "M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .1-1.7-.1a12 12 0 0 1-3.3-1.7 12.4 12.4 0 0 1-2.6-3.2c-.5-.9-.1-2 .3-2.5.2-.2.4-.3.6-.3h.5c.2 0 .4 0 .6.4l.8 1.9c.1.2 0 .4-.1.5l-.4.5c-.1.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.1 1 2 1.3 2.3 1.4.2.1.4.1.6-.1l.7-.8c.2-.2.3-.2.5-.1l2 .9c.2.1.4.2.4.3 0 .2 0 .8-.2 1.1Z",
  uazapi:
    "M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .1-1.7-.1a12 12 0 0 1-3.3-1.7 12.4 12.4 0 0 1-2.6-3.2c-.5-.9-.1-2 .3-2.5.2-.2.4-.3.6-.3h.5c.2 0 .4 0 .6.4l.8 1.9c.1.2 0 .4-.1.5l-.4.5c-.1.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.1 1 2 1.3 2.3 1.4.2.1.4.1.6-.1l.7-.8c.2-.2.3-.2.5-.1l2 .9c.2.1.4.2.4.3 0 .2 0 .8-.2 1.1Z",
  instagram:
    "M12 2.2c3.2 0 3.6 0 4.9.1 1.2 0 1.8.3 2.2.4.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.2.4.4 1 .4 2.2.1 1.3.1 1.7.1 4.9s0 3.6-.1 4.9c0 1.2-.2 1.8-.4 2.2-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.2-1 .4-2.2.4-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-1.2 0-1.8-.2-2.2-.4-.6-.2-1-.5-1.4-.9-.4-.4-.7-.8-.9-1.4-.2-.4-.4-1-.4-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.9c0-1.2.2-1.8.4-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1-.4 2.2-.4 1.3-.1 1.7-.1 4.8-.1Zm0 3.3a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm0 10.7a4.2 4.2 0 1 1 0-8.4 4.2 4.2 0 0 1 0 8.4Zm6.8-10.9a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z",
  facebook:
    "M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.5 2.9h-2.3v7A10 10 0 0 0 22 12Z",
  tiktok_shop:
    "M16.5 2h-3v13.3a2.8 2.8 0 1 1-2.8-2.8c.3 0 .6 0 .8.1V9.5a6 6 0 1 0 5 5.9V8.8a6.7 6.7 0 0 0 3.5 1V6.7a3.7 3.7 0 0 1-3.5-3.7V2Z",
};

export function IconeCanal({
  canal,
  tamanho = "medio",
  comSelo = false,
  className,
}: {
  canal: string;
  tamanho?: keyof typeof TAMANHOS;
  /** Selo sobre avatar: ganha anel de 2 px da cor do cartão (§2.9). */
  comSelo?: boolean;
  className?: string;
}) {
  const medida = TAMANHOS[tamanho];
  const selo = comSelo ? "rounded-full bg-card ring-2 ring-card" : "";

  if (!ehCanal(canal)) {
    return (
      <MessageCircle
        aria-hidden="true"
        strokeWidth={2}
        className={`${medida} ${selo} text-texto-terciario ${className ?? ""}`}
      />
    );
  }

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={`${medida} ${selo} ${CORES[canal]} ${className ?? ""}`}
    >
      <path d={GLIFOS[canal]} />
    </svg>
  );
}
