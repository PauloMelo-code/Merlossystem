import { z } from "zod";
import { PAPEIS_COM_LOJA, PAPEIS_CONVIDAVEIS } from "@/lib/db/schema/_enums/auth";
import { emailSchema, motivoSchema, uuidSchema } from "@/lib/validadores/comum";

/**
 * Validadores da administração de acessos (02-seguranca.md §11.2; 04-ui.md §5.6).
 *
 * Módulo PURO: a tela usa o mesmo Zod no `blur` e o servidor valida de novo.
 *
 * Nenhum esquema daqui tem `senha`: o admin NUNCA define a senha de outra
 * pessoa (E8). E nenhum aceita `ativo`, `precisa_*` ou `two_factor_enabled`:
 * campo de privilégio só muda por action dedicada (H12).
 */

/** Versão da ciência exigida para conceder `admin` (CHECK `convites_ciencia_admin`). */
export const CIENCIA_ADMIN_VERSAO = "CIENCIA_ADMIN_V1";

/**
 * O que a pessoa DIGITA (04-ui.md §5.6: campo de texto, não checkbox). Mudar a
 * frase é mudar a versão — a trilha guarda qual ciência foi dada.
 */
export const FRASE_CIENCIA_ADMIN = "CONCEDO ACESSO DE ADMINISTRADOR";

/** O texto que a tela mostra antes de pedir a frase. */
export const TEXTO_CIENCIA_ADMIN =
  "Um administrador convida e desativa pessoas, troca papéis, conecta e desconecta integrações e altera as lojas. Ele não consegue agir sobre o dono nem sobre outro administrador.";

const cienciaSchema = z
  .string()
  .trim()
  .refine((valor) => valor.toUpperCase() === FRASE_CIENCIA_ADMIN, {
    message: `Digite exatamente: ${FRASE_CIENCIA_ADMIN}`,
  });

/** Loja vazia no formulário vira ausência, nunca string vazia no banco. */
const lojaOpcional = z
  .union([uuidSchema, z.literal("")])
  .optional()
  .transform((valor) => (valor ? valor : null));

const COM_LOJA = new Set<string>(PAPEIS_COM_LOJA);

/**
 * CHECK papel × loja do banco, repetido aqui só para a mensagem ser boa: a
 * barreira real é o `usuarios_papel_loja` (06/INV-14).
 */
function papelELojaCoerentes(dados: { papel: string; lojaId: string | null }): boolean {
  return COM_LOJA.has(dados.papel) ? dados.lojaId !== null : dados.lojaId === null;
}

const MENSAGEM_LOJA = {
  path: ["lojaId"],
  message: "Vendedora e somente leitura precisam de loja; gestão não tem loja.",
};

/** `alvoId` + `updatedAt` + `motivo`: a base de toda ação sobre conta alheia. */
export const alvoSchema = z.strictObject({
  alvoId: uuidSchema,
  motivo: motivoSchema,
});

export const alvoComVersaoSchema = z.strictObject({
  alvoId: uuidSchema,
  updatedAt: z.coerce.date(),
  motivo: motivoSchema,
});

export const convidarSchema = z
  .strictObject({
    email: emailSchema,
    papel: z.enum(PAPEIS_CONVIDAVEIS, "Escolha um papel."),
    lojaId: lojaOpcional,
    ciencia: z.string().optional(),
    motivo: motivoSchema,
  })
  .refine(papelELojaCoerentes, MENSAGEM_LOJA)
  .refine(
    (dados) =>
      dados.papel !== "admin" ||
      (dados.ciencia ?? "").trim().toUpperCase() === FRASE_CIENCIA_ADMIN,
    { path: ["ciencia"], message: `Digite exatamente: ${FRASE_CIENCIA_ADMIN}` },
  );

export const reenviarConviteSchema = z.strictObject({
  conviteId: uuidSchema,
  motivo: motivoSchema,
});

/**
 * Trocar papel e loja. `dono` nunca é destino (posse só por `transferirPosse`).
 * `admin` só é destino quando o alvo é `dono` sendo rebaixado; CONCEDER `admin`
 * a quem está abaixo é `promoverAAdmin`, com ciência (`regras.ts` decide).
 */
export const trocarPapelSchema = z
  .strictObject({
    alvoId: uuidSchema,
    updatedAt: z.coerce.date(),
    papel: z.enum(["admin", "gerente", "vendedor", "viewer"], "Escolha um papel."),
    lojaId: lojaOpcional,
    motivo: motivoSchema,
  })
  .refine(papelELojaCoerentes, MENSAGEM_LOJA);

export const cerimoniaAdminSchema = z.strictObject({
  alvoId: uuidSchema,
  updatedAt: z.coerce.date(),
  motivo: motivoSchema,
  ciencia: cienciaSchema,
});

export const trocarEmailSchema = z.strictObject({
  alvoId: uuidSchema,
  emailNovo: emailSchema,
  motivo: motivoSchema,
});

export const codigoTrocaEmailSchema = z.strictObject({
  codigo: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "O código tem 6 dígitos."),
});

export type EntradaConvite = z.output<typeof convidarSchema>;
export type EntradaTrocaPapel = z.output<typeof trocarPapelSchema>;

/** Para o seletor da tela; a regra de quem pode vem de `permissoes/alvo.ts`. */
export const PAPEIS_EDITAVEIS = ["gerente", "vendedor", "viewer"] as const;

