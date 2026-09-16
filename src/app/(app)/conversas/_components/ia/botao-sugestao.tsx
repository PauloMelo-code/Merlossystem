"use client";

import type { SituacaoDoProvedorIa } from "@/lib/inteligencia/tipos";

/** COSTURA — dono: R2-C. Sugestão da IA no composer (spec r2/final-r2c-inteligencia.md §7). */
export function BotaoSugestao(_props: {
  conversaId: string;
  estado: Exclude<SituacaoDoProvedorIa, "desligado">;
  desabilitado: boolean;
  textoAtual: string;
  aoUsar: (texto: string) => void;
}) {
  return null;
}
