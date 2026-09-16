import { z } from "zod";
import { TIPOS_CONSENTIMENTO } from "@/lib/db/schema/_enums/auditoria";
import { uuidSchema } from "./comum";

/**
 * Validadores do módulo LGPD (01-dados-dominio.md §7 e §8; 02-seguranca.md §16).
 *
 * O IP do consentimento NÃO existe aqui: ele vem de `ipDoCliente()` no
 * servidor. Um campo `ip` no corpo seria prova forjável (02/L-08, D-04) — e
 * como o Zod descarta chave desconhecida, `ip` enviado pelo cliente some antes
 * de chegar ao domínio.
 */

const lojaOpcional = z.preprocess(
  (v) => (v === "" || v === null ? undefined : v),
  uuidSchema.optional(),
);

/** Protocolo do atendimento ao titular: curto, sem espaço, único por loja. */
export const protocoloSchema = z
  .string()
  .trim()
  .min(4, "O protocolo tem ao menos 4 caracteres.")
  .max(40, "Use no máximo 40 caracteres.")
  .regex(/^[A-Za-z0-9./_-]+$/, "Use letras, números, ponto, barra, traço ou sublinhado.");

/** O motivo entra na solicitação: nada de dado pessoal nele (a tela avisa). */
export const motivoLgpdSchema = z
  .string()
  .trim()
  .min(8, "Escreva o motivo com ao menos 8 caracteres.")
  .max(255, "Use no máximo 255 caracteres.");

export const registrarConsentimentoSchema = z.object({
  loja: lojaOpcional,
  contatoId: uuidSchema,
  tipo: z.enum(TIPOS_CONSENTIMENTO, "Tipo de consentimento inválido."),
  concedido: z.preprocess(
    (v) => (v === "true" ? true : v === "false" ? false : v),
    z.boolean("Informe se a pessoa aceitou ou recusou."),
  ),
});

export const anonimizarContatoSchema = z.object({
  loja: lojaOpcional,
  contatoId: uuidSchema,
  updatedAt: z.coerce.date("Versão do registro inválida."),
  protocolo: protocoloSchema,
  motivo: motivoLgpdSchema,
});

/** Abre a exportação do dossiê: registra a solicitação de ACESSO. */
export const iniciarExportacaoSchema = z.object({
  loja: lojaOpcional,
  contatoId: uuidSchema,
  protocolo: protocoloSchema,
  motivo: motivoLgpdSchema,
});

export const SECOES_DOSSIE = [
  "contato",
  "conversas",
  "mensagens",
  "pedidos",
  "pedidos_itens",
  "pagamentos",
  "devolucoes",
  "devolucoes_itens",
  "negocios",
  "consentimentos",
  "pesquisas",
  "agendamentos",
] as const;
export type SecaoDossie = (typeof SECOES_DOSSIE)[number];

/** Uma PÁGINA de uma seção do dossiê — nunca "todas as mensagens" de uma vez. */
export const lerDossieSchema = z.object({
  loja: lojaOpcional,
  solicitacaoId: uuidSchema,
  secao: z.enum(SECOES_DOSSIE),
  cursor: z.string().max(200).optional(),
});

export const registrarSolicitacaoSchema = z.object({
  loja: lojaOpcional,
  contatoId: uuidSchema,
  tipo: z.literal("correcao", "Só o pedido de correção é registrado por aqui."),
  protocolo: protocoloSchema,
  motivo: motivoLgpdSchema,
});
