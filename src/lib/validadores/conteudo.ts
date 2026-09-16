import { z } from "zod";
import { CATEGORIAS_RESPOSTA } from "@/lib/db/schema/_enums/catalogo";
import { CATEGORIAS_TEMPLATE } from "@/lib/db/schema/_enums/plataforma";
import { contarVariaveis } from "@/lib/conteudo/variaveis";
import { uuidSchema } from "./comum";

/**
 * Forma das entradas de respostas rápidas e modelos (01-dados-dominio.md §5.2,
 * 01-dados.md §6.5). Módulo PURO: o formulário importa para o `blur`.
 */

/** O mesmo padrão do CHECK `respostas_rapidas_atalho_formato`. */
export const REGEX_ATALHO = /^\/[a-z0-9-]{1,30}$/;

/**
 * Equivale ao CHECK `lojas_integracoes_templates_nome` da migração 0018
 * (`^[a-z0-9_]+$` e `char_length(nome) <= 512`): no JS a repetição cabe na regex.
 */
export const REGEX_NOME_MODELO = /^[a-z0-9_]{1,512}$/;

/** Campo opcional de formulário: ausente ou vazio vira `null`. */
const opcional = (esquema: z.ZodString) =>
  z.preprocess(
    (v) => (v === undefined || (typeof v === "string" && v.trim() === "") ? null : v),
    esquema.nullable(),
  );

export const alvoSchema = z.object({ id: uuidSchema, updated_at: z.coerce.date() });

export const idModeloSchema = z.object({ id: uuidSchema });

export const respostaSchema = z.object({
  titulo: z.string().trim().min(2, "Dê um título com ao menos 2 letras.").max(80, "Use no máximo 80 caracteres."),
  atalho: opcional(
    z
      .string()
      .trim()
      .toLowerCase()
      .regex(REGEX_ATALHO, 'O atalho começa com "/" e usa só letras minúsculas, números e hífen (ex.: /frete).'),
  ),
  categoria: z.preprocess(
    (v) => (v === "" || v === undefined ? null : v),
    z.enum(CATEGORIAS_RESPOSTA, "Escolha uma categoria da lista.").nullable(),
  ),
  conteudo: z.string().trim().min(1, "Escreva o texto da resposta.").max(4000, "Use no máximo 4000 caracteres."),
});

export const editarRespostaSchema = respostaSchema.extend(alvoSchema.shape);

export const alternarRespostaSchema = alvoSchema.extend({
  ativa: z.preprocess((v) => v === true || v === "true", z.boolean()),
});

const corpoModelo = z
  .string()
  .trim()
  .min(1, "Escreva o corpo do modelo.")
  .max(1024, "A Meta aceita no máximo 1024 caracteres no corpo.")
  .refine((corpo) => contarVariaveis(corpo) !== null, {
    message: "Numere as variáveis de {{1}} em diante, sem pular número.",
  });

export const modeloSchema = z.object({
  integracao_id: uuidSchema,
  nome: z
    .string()
    .trim()
    .regex(REGEX_NOME_MODELO, "Use só letras minúsculas, números e _ (ex.: promocao_inverno)."),
  categoria: z.enum(CATEGORIAS_TEMPLATE, "Escolha uma categoria da lista."),
  cabecalho_conteudo: opcional(z.string().trim().max(60, "O cabeçalho aceita no máximo 60 caracteres.")),
  corpo: corpoModelo,
  rodape: opcional(z.string().trim().max(60, "O rodapé aceita no máximo 60 caracteres.")),
});

export const editarModeloSchema = modeloSchema.omit({ integracao_id: true }).extend(alvoSchema.shape);

export type EntradaResposta = z.output<typeof respostaSchema>;
export type EntradaModelo = z.output<typeof modeloSchema>;
