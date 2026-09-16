import { z } from "zod";
import { STATUS_DESTINATARIO, TIPOS_GRADE } from "@/lib/db/schema/_enums/catalogo";
import { GATILHOS_AGENDAMENTO } from "@/lib/db/schema/_enums/conversas";
import { REGEX_DINHEIRO } from "@/lib/formato";
import { uuidSchema } from "./comum";
import { alvoSchema } from "./conteudo";

/**
 * Forma das entradas de campanhas e mensagens agendadas
 * (01-dados-dominio.md §2.5, §5.4; 01-dados.md §10). Módulo PURO.
 *
 * A contagem de variáveis contra o modelo NÃO mora aqui: ela depende do
 * modelo, que é lido do banco (`src/lib/campanhas/regras.ts`).
 */

export const variavelSchema = z.object({
  indice: z.coerce.number().int().min(1).max(20),
  valor: z.string().trim().min(1, "Preencha a variável.").max(200, "Use no máximo 200 caracteres."),
});

export const variaveisSchema = z.array(variavelSchema).max(20);

/** `campanhas.segmento` — `etiquetas_ids` é conferido contra a loja no servidor. */
export const segmentoSchema = z.object({
  etiquetas_ids: z.array(uuidSchema).max(50).optional(),
  tamanho: z.enum(TIPOS_GRADE).optional(),
  gasto_minimo: z.string().regex(REGEX_DINHEIRO, "Use o formato 150.00").optional(),
  dias_sem_compra: z.coerce.number().int().min(1).max(3650).optional(),
});

export type Segmento = z.output<typeof segmentoSchema>;

export const campanhaSchema = z
  .object({
    nome: z.string().trim().min(3, "Dê um nome com ao menos 3 letras.").max(120, "Use no máximo 120 caracteres."),
    /** Conta de saída: OBRIGATÓRIA (`campanhas.integracao_id NOT NULL`). */
    integracao_id: uuidSchema,
    template_id: uuidSchema.nullable().default(null),
    conteudo_texto: z
      .string()
      .trim()
      .max(4000, "Use no máximo 4000 caracteres.")
      .nullable()
      .default(null)
      .transform((v) => (v === "" ? null : v)),
    variaveis: variaveisSchema.default([]),
    segmento: segmentoSchema.default({}),
  })
  .refine((c) => (c.template_id === null) !== (c.conteudo_texto === null), {
    path: ["conteudo_texto"],
    message: "Escolha um modelo OU escreva o texto — um dos dois.",
  });

export const previaSchema = z.object({ segmento: segmentoSchema });

export const campanhaAlvoSchema = alvoSchema;

export const destinatariosFiltroSchema = z.object({
  status: z.enum(STATUS_DESTINATARIO).optional(),
});

// -- Mensagens agendadas ------------------------------------------------------

/**
 * `midia` fica FORA da entrada de propósito: a costura de saída
 * (`registrarEnvio`) só leva texto hoje, e aceitar o agendamento de mídia seria
 * prometer um envio que não sai (U8). Bloqueio registrado pelo pacote M6.
 */
export const TIPOS_AGENDAMENTO_ACEITOS = ["texto", "template"] as const;

const instanteFuturo = z.coerce
  .date("Escolha data e hora.")
  .refine((d) => d.getTime() > Date.now() + 60_000, {
    message: "Escolha um horário a partir do próximo minuto.",
  });

export const agendamentoSchema = z
  .object({
    contato_id: uuidSchema,
    integracao_id: uuidSchema,
    tipo_conteudo: z.enum(TIPOS_AGENDAMENTO_ACEITOS),
    conteudo: z
      .string()
      .trim()
      .max(4000, "Use no máximo 4000 caracteres.")
      .nullable()
      .default(null)
      .transform((v) => (v === "" ? null : v)),
    template_id: z.preprocess((v) => (v === "" ? null : v), uuidSchema.nullable()).default(null),
    variaveis: variaveisSchema.default([]),
    agendada_para: instanteFuturo,
    gatilho: z.enum(GATILHOS_AGENDAMENTO, "Escolha o motivo do envio."),
  })
  .superRefine((a, ctx) => {
    if (a.tipo_conteudo === "texto" && !a.conteudo) {
      ctx.addIssue({ code: "custom", path: ["conteudo"], message: "Escreva a mensagem." });
    }
    if (a.tipo_conteudo === "template" && !a.template_id) {
      ctx.addIssue({ code: "custom", path: ["template_id"], message: "Escolha o modelo." });
    }
  });

export const reagendarSchema = alvoSchema.extend({ agendada_para: instanteFuturo });
