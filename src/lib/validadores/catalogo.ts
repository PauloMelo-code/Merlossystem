import { z } from "zod";

/**
 * Entradas do catálogo. Catálogo é LEITURA: não existe esquema de criar ou
 * editar produto (a matriz nem tem a chave).
 */

export const buscaDeProdutoSchema = z.object({
  loja: z.string().trim().max(64).optional(),
  termo: z
    .string()
    .trim()
    .min(2, "Digite ao menos 2 letras.")
    .max(60, "Use no máximo 60 caracteres."),
});

export const produtoPorSkuSchema = z.object({
  loja: z.string().trim().max(64).optional(),
  sku: z.string().trim().min(1).max(60),
});

export const filtroDeProdutosSchema = z.object({
  q: z.string().trim().max(60).optional().catch(undefined),
  cursor: z.string().max(200).optional().catch(undefined),
  direcao: z.enum(["anterior", "proxima"]).optional().catch(undefined),
  porPagina: z.coerce.number().pipe(z.union([z.literal(25), z.literal(50), z.literal(100)])).catch(50),
});

/** Detalhe do produto. */
export const idDeProdutoSchema = z.object({ id: z.uuid("Identificador inválido.") });
