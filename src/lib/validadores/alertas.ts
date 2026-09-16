import { z } from "zod";
import { SEVERIDADES, TIPOS_ALERTA } from "@/lib/db/schema/_enums/plataforma";
import { uuidSchema } from "./comum";

/**
 * Entradas de `/alertas` (04-ui.md §5.5). Módulo PURO.
 *
 * Os filtros vêm da URL: valor fora da lista é DESCARTADO (vira "sem filtro"),
 * não recusado — URL velha ou editada à mão não pode derrubar a central.
 */

const opcional = <T extends readonly [string, ...string[]]>(valores: T) =>
  z.enum(valores).optional().catch(undefined);

export const TAMANHOS_PAGINA = [25, 50, 100] as const;

/** Cursor e direção valem para toda lista paginada do pacote. */
export const paginacaoSchema = z.object({
  cursor: z.string().max(200).optional().catch(undefined),
  direcao: z.enum(["anterior", "proxima"]).catch("proxima"),
  porPagina: z.coerce
    .number()
    .int()
    .refine((n) => (TAMANHOS_PAGINA as readonly number[]).includes(n))
    .catch(50),
});

export const filtrosAlertasSchema = paginacaoSchema.extend({
  tipo: opcional(TIPOS_ALERTA),
  severidade: opcional(SEVERIDADES),
  reconhecido: opcional(["sim", "nao"] as const),
});

export type FiltrosAlertasEntrada = z.input<typeof filtrosAlertasSchema>;

export const reconhecerAlertaSchema = z.object({
  id: uuidSchema,
  /** O `updated_at` que a tela levou: é ele que a trava de colisão compara. */
  updated_at: z.coerce.date({ error: "Recarregue a página e tente de novo." }),
});
