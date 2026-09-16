"use client";

import type { SugestaoPronta } from "@/lib/inteligencia/tipos";

/** COSTURA — dono: R2-C. Cartão da sugestão, usado só por `BotaoSugestao` (spec r2/final-r2c-inteligencia.md §7). */
export function CartaoSugestao(_props: {
  sugestao: SugestaoPronta;
  aoUsar: (texto: string) => void;
  aoGerarOutra: () => void;
  aoDescartar: () => void;
}) {
  return null;
}
