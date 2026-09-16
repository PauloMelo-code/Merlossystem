import { z } from "zod";

/**
 * Validadores do cadastro de lojas (01-dados.md §6.1; 04-ui.md §5.6).
 *
 * Módulo PURO: a tela usa o mesmo esquema no `blur`.
 */

export const nomeLojaSchema = z
  .string()
  .trim()
  .min(2, "Escreva o nome da loja.")
  .max(80, "Use no máximo 80 caracteres.");

/** Vai para a URL e para o seletor: minúsculas, números e hífen. */
export const slugLojaSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use letras minúsculas, números e hífen (ex.: cerro-azul).")
  .max(60, "Use no máximo 60 caracteres.");

/** 3 letras maiúsculas, CADASTRADA — entra no número do pedido (MS2609-CEN-0042). */
export const siglaLojaSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "A sigla tem exatamente 3 letras (ex.: CEN).");

/** Id do depósito no Bling. Vazio = loja sem estoque no Bling. */
export const depositoBlingSchema = z
  .string()
  .trim()
  .regex(/^\d{0,20}$/, "O depósito do Bling é um número.")
  .transform((v) => (v === "" ? null : v));

export const criarLojaSchema = z.object({
  nome: nomeLojaSchema,
  slug: slugLojaSchema,
  sigla: siglaLojaSchema,
  blingDepositoId: depositoBlingSchema.default(""),
});
export type CriarLoja = z.output<typeof criarLojaSchema>;

export const editarLojaSchema = criarLojaSchema.extend({
  id: z.uuid("Loja inválida."),
  updatedAt: z.coerce.date(),
});
export type EditarLoja = z.output<typeof editarLojaSchema>;

export const desativarLojaSchema = z.object({
  id: z.uuid("Loja inválida."),
  updatedAt: z.coerce.date(),
});
export type DesativarLoja = z.output<typeof desativarLojaSchema>;
