import { z } from "zod";
import { MAX_BYTES_SENHA, MAX_SENHA, MIN_SENHA } from "@/lib/auth/senha-regras";

/**
 * Validadores compartilhados (03-arquitetura.md §4.3, 04-ui.md §7.1).
 *
 * Módulo PURO: sem `server-only`, sem banco. É o mesmo Zod que a action usa no
 * servidor e que o componente cliente pode importar para o `blur` — uma regra
 * só, escrita uma vez.
 *
 * O que NÃO mora aqui: a política de senha (é `src/lib/auth/senha-regras.ts`
 * para a parte pura e `politica-senha.ts` para HIBP e histórico) e a aritmética
 * de dinheiro (é `src/lib/formato.ts`). Este arquivo só declara FORMA.
 */

/** Recorta e normaliza antes de medir: " Ana " e "Ana" são o mesmo nome. */
export const nomeSchema = z
  .string()
  .trim()
  .min(2, "Escreva o nome completo.")
  .max(120, "Use no máximo 120 caracteres.");

/** O e-mail é sempre gravado em minúsculas (01-dados.md §5.1). */
export const emailSchema = z
  .email("Escreva um e-mail válido.")
  .trim()
  .toLowerCase()
  .max(254, "Use no máximo 254 caracteres.");

/**
 * FORMA da senha, não política. O teto de bytes é conferido antes de qualquer
 * avaliação ou hash (B8) e os limites saem do mesmo módulo do servidor, para a
 * tela nunca prometer um mínimo diferente do que o servidor cobra.
 */
export const senhaSchema = z
  .string()
  .min(MIN_SENHA, `Use ao menos ${MIN_SENHA} caracteres — uma frase curta serve.`)
  .max(MAX_SENHA, `Use no máximo ${MAX_SENHA} caracteres.`)
  .refine((valor) => new TextEncoder().encode(valor).length <= MAX_BYTES_SENHA, {
    message: "A senha é longa demais.",
  });

/** Senha de quem já tem conta: só presença, nunca política (seria oráculo). */
export const senhaAtualSchema = z
  .string()
  .min(1, "Informe a sua senha atual.")
  .max(MAX_SENHA);

/**
 * Token de uso único: 32 bytes em base64url (`src/lib/auth/tokens.ts`). Vem
 * SEMPRE do corpo do POST, lido de `location.hash` — nunca de segmento de rota
 * nem de query (U12, F12/G15).
 */
export const tokenSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{43}$/, "Este convite não vale mais. Peça um novo ao administrador.");

/** TOTP: 6 dígitos, 30 s. Espaço e traço colados são tolerados na colagem. */
export const codigoTotpSchema = z
  .string()
  .trim()
  .transform((valor) => valor.replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, "O código tem 6 dígitos."));

export const uuidSchema = z.uuid("Identificador inválido.");

/** Motivo de ação sobre conta alheia (02-seguranca.md §11.2). */
export const motivoSchema = z
  .string()
  .trim()
  .min(8, "Escreva o motivo com ao menos 8 caracteres.")
  .max(255, "Use no máximo 255 caracteres.");

/** Apelido de passkey e de aparelho: texto curto, sem exigência de formato. */
export const apelidoSchema = z
  .string()
  .trim()
  .min(1, "Dê um nome para reconhecer este aparelho.")
  .max(60, "Use no máximo 60 caracteres.");

/**
 * A resposta do navegador ao WebAuthn. Não validamos a forma interna: quem faz
 * isso é o `@simplewebauthn/server` dentro do Better Auth, com a prova
 * criptográfica. Aqui só garantimos que é objeto e que cabe no corpo.
 */
export const respostaWebauthnSchema = z
  .record(z.string(), z.unknown())
  .refine((valor) => JSON.stringify(valor).length <= 8_192, {
    message: "Não foi possível concluir. Tente de novo.",
  });

/** Confirmação de duas senhas iguais, usada no primeiro acesso e no reset. */
export function confirmacaoDeSenha<E extends z.ZodObject>(esquema: E) {
  return esquema.refine(
    (dados) => (dados as { senha?: string; confirmacao?: string }).senha ===
      (dados as { senha?: string; confirmacao?: string }).confirmacao,
    { path: ["confirmacao"], message: "As duas senhas precisam ser iguais." },
  );
}
