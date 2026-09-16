import { z } from "zod";
import { lerPeriodo } from "./auditoria";

/**
 * Entrada de `/relatorios` (04-ui.md §5.5): só o período. A loja vem do
 * escopo (seletor do cabeçalho), nunca de campo da tela. Módulo PURO.
 */

export const DIAS_PADRAO_RELATORIO = 30;

export const filtrosRelatorioSchema = z
  .object({
    de: z.string().max(20).optional().catch(undefined),
    ate: z.string().max(20).optional().catch(undefined),
  })
  .transform((v, ctx) => lerPeriodo(v.de, v.ate, DIAS_PADRAO_RELATORIO, ctx));
