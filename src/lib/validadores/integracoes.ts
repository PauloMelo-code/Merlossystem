import { z } from "zod";
import {
  FORMATO_DA_CHAVE,
  PROVEDORES,
  PROVEDORES_DE_CANAL,
  type ProvedorDeCanal,
} from "@/lib/integracoes/catalogo-provedores";

/**
 * Validadores das contas conectadas (01-dados.md §6.3; 04-ui.md §5.6).
 *
 * Módulo PURO. A credencial chega como campos `chave_<nome>` do formulário e
 * sai daqui como objeto — só com as chaves que o provedor declara em
 * `catalogo-provedores.ts`. Chave a mais é descartada; chave a menos reprova.
 */

export const rotuloContaSchema = z
  .string()
  .trim()
  .min(3, "Dê um nome que a equipe reconheça (ex.: WhatsApp Vendas Centro).")
  .max(80, "Use no máximo 80 caracteres.");

export const referenciaSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9._-]{1,128}$/, "Use só letras, números, ponto, hífen e sublinhado.");

const PREFIXO = "chave_";

/** Tira do formulário as chaves do provedor, com a mensagem por campo. */
function credencialDe(
  provedor: ProvedorDeCanal,
  bruto: Record<string, unknown>,
  ctx: z.RefinementCtx,
): Record<string, string> {
  const credencial: Record<string, string> = {};
  for (const chave of PROVEDORES[provedor].chaves) {
    const valor = typeof bruto[`${PREFIXO}${chave}`] === "string" ? String(bruto[`${PREFIXO}${chave}`]).trim() : "";
    if (!FORMATO_DA_CHAVE.test(valor)) {
      ctx.addIssue({
        code: "custom",
        path: [`${PREFIXO}${chave}`],
        message: valor === "" ? "Preencha este campo." : "Cole o valor sem espaços nem quebras de linha.",
      });
      continue;
    }
    credencial[chave] = valor;
  }
  return credencial;
}

export const conectarPorTokenSchema = z
  .looseObject({
    provedor: z.enum(PROVEDORES_DE_CANAL, "Escolha o canal."),
    lojaId: z.uuid("Escolha a loja desta conta."),
    rotulo: rotuloContaSchema,
    referencia: referenciaSchema,
  })
  .transform((dados, ctx) => ({
    provedor: dados.provedor,
    lojaId: dados.lojaId,
    rotulo: dados.rotulo,
    referencia: dados.referencia,
    credencial: credencialDe(dados.provedor, dados, ctx),
  }));
export type ConectarPorToken = z.output<typeof conectarPorTokenSchema>;

const alvo = {
  id: z.uuid("Conta inválida."),
  updatedAt: z.coerce.date(),
};

export const editarContaSchema = z.object({
  ...alvo,
  rotulo: rotuloContaSchema,
  lojaId: z
    .union([z.uuid("Escolha uma loja."), z.literal("")])
    .optional()
    .transform((v) => (v ? v : undefined)),
});
export type EditarConta = z.output<typeof editarContaSchema>;

export const substituirCredencialSchema = z
  .looseObject({ ...alvo, provedor: z.enum(PROVEDORES_DE_CANAL) })
  .transform((dados, ctx) => ({
    id: dados.id,
    updatedAt: dados.updatedAt,
    provedor: dados.provedor,
    credencial: credencialDe(dados.provedor, dados, ctx),
  }));
export type SubstituirCredencial = z.output<typeof substituirCredencialSchema>;

export const desconectarContaSchema = z.object(alvo);
export type DesconectarConta = z.output<typeof desconectarContaSchema>;

export const alvoContaSchema = z.object({ id: z.uuid("Conta inválida.") });
export const parearSchema = z.object(alvo);

/** Callback do OAuth: `code` e `state` só com forma, a prova é do servidor. */
export const callbackOAuthSchema = z.object({
  code: z.string().regex(/^[A-Za-z0-9._~-]{1,512}$/),
  state: z.string().regex(/^[A-Za-z0-9._-]{1,512}$/),
});
