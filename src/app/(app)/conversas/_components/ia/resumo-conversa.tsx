"use client";

import type { SituacaoDoProvedorIa } from "@/lib/inteligencia/tipos";

/** COSTURA — dono: R2-C. Resumo da conversa no cabeçalho (spec r2/final-r2c-inteligencia.md §7). */
export function ResumoConversa(_props: { conversaId: string; estado: Exclude<SituacaoDoProvedorIa, "desligado"> }) {
  return null;
}
