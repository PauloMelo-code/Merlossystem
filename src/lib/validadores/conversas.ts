import { z } from "zod";
import { PRIORIDADES } from "@/lib/db/schema/_enums/conversas";
import { uuidSchema } from "./comum";

/**
 * Entradas das actions do atendimento (04-ui.md §5.2, §7.1). O servidor valida
 * de novo tudo o que a tela já validou: ele é a fonte da verdade.
 */

/** "true"/"1"/"on" do FormData e da URL viram booleano; ausência vira `false`. */
const marcador = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v) => v === true || v === "true" || v === "1" || v === "on");

const opcionalUuid = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))
  .pipe(uuidSchema.optional());

export const VISOES = ["minhas", "sem_responsavel", "todas"] as const;
export const FILTROS_DE_STATUS = ["andamento", "aberta", "pendente", "resolvida", "arquivada", "todas"] as const;

export const filtrosDaListaSchema = z.object({
  visao: z.enum(VISOES).catch("todas"),
  status: z.enum(FILTROS_DE_STATUS).catch("andamento"),
  integracaoId: opcionalUuid.catch(undefined),
  prioridade: z.enum(PRIORIDADES).optional().catch(undefined),
  etiquetaId: opcionalUuid.catch(undefined),
  busca: z.string().trim().max(80).optional().catch(undefined),
  semResposta: marcador.catch(false),
  slaEstourado: marcador.catch(false),
  cursor: z.string().max(200).optional().catch(undefined),
});

export type FiltrosDaUrl = z.output<typeof filtrosDaListaSchema>;

export const abrirConversaSchema = z.object({ conversaId: uuidSchema });

export const paginaDeMensagensSchema = z.object({
  conversaId: uuidSchema,
  cursor: z.string().min(1).max(200),
});

/** Teto do banco (CHECK `char_length <= 8000`); o canal pode ser menor. */
export const TETO_MENSAGEM = 8000;

export const enviarMensagemSchema = z
  .object({
    conversaId: uuidSchema,
    conteudo: z.string().trim().max(TETO_MENSAGEM, "A mensagem passou do limite de caracteres."),
    /** uuid gerado na bolha otimista: é a idempotência do envio. */
    chaveIdempotencia: uuidSchema,
    notaInterna: marcador,
    modeloId: opcionalUuid,
    /** Anexo já guardado na galeria (`POST /api/midias`); o texto vira legenda. */
    midiaId: opcionalUuid,
    variaveis: z.array(z.string().trim().min(1, "Preencha a variável.").max(1000)).max(20).default([]),
  })
  .refine((d) => d.modeloId !== undefined || d.midiaId !== undefined || d.conteudo.length > 0, {
    path: ["conteudo"],
    message: "Escreva a mensagem antes de enviar.",
  })
  .refine((d) => !(d.notaInterna && d.modeloId), {
    path: ["modeloId"],
    message: "Nota interna não usa modelo.",
  })
  .refine((d) => !(d.midiaId && (d.notaInterna || d.modeloId)), {
    path: ["midiaId"],
    message: "O anexo vai só em resposta à cliente.",
  });

export type EnviarMensagem = z.output<typeof enviarMensagemSchema>;

export const reenviarSchema = z.object({ mensagemId: uuidSchema });

const alvo = { conversaId: uuidSchema, updatedAt: z.coerce.date() };

export const alvoDeConversaSchema = z.object(alvo);

export const transferirSchema = z.object({
  ...alvo,
  responsavelId: z
    .union([uuidSchema, z.literal(""), z.null()])
    .transform((v) => (v ? v : null)),
});

export const prioridadeSchema = z.object({ ...alvo, prioridade: z.enum(PRIORIDADES) });

export const marcarLidaSchema = z.object({ conversaId: uuidSchema });

export const resumoSchema = filtrosDaListaSchema.extend({ conversaId: opcionalUuid.catch(undefined) });

/** Action sem parâmetro: o escopo vem da sessão e do seletor de loja. */
export const semEntrada = z.object({}).strip();
