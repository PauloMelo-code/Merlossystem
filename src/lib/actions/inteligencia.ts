"use server";

import { z } from "zod";
import { executarAcao } from "@/lib/actions/_base";
import type { Resultado } from "@/lib/erros";
import { IA_DESLIGADA, type EstadoDaIa } from "@/lib/inteligencia/tipos";

/**
 * COSTURA — dono: R2-C (inteligência). Nasce só com a leitura do estado, que
 * as páginas de conversa (M1) consomem; o pacote acrescenta sugestão, resumo,
 * transcrição e usos (as três últimas por `executarAcaoExterna`).
 */

/** Até o R2-C: os quatro provedores desligados. */
export async function lerEstadoDaIa(): Promise<Resultado<EstadoDaIa>> {
  return executarAcao(
    {
      permissao: "conversas:ler",
      entrada: z.object({}),
      loja: "le",
      executar: async () => IA_DESLIGADA,
    },
    {},
  );
}
