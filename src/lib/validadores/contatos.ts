import { z } from "zod";
import { TIPOS_GRADE } from "@/lib/db/schema/_enums/catalogo";
import { normalizarTelefone } from "@/lib/contatos/telefone";
import { emailSchema, uuidSchema } from "./comum";

/**
 * Validadores do módulo de contatos (04-ui.md §5.3 e §7.1).
 *
 * Módulo PURO: a action valida com ele no servidor e o formulário pode usá-lo
 * no `blur`. O servidor é a fonte da verdade.
 *
 * `loja` é opcional em toda entrada de escrita: `executarAcao` lê esse campo
 * para resolver a loja de quem é gestão (a loja DO CONTATO, não a do seletor).
 * Para vendedora e viewer ele é ignorado — a loja vem do cadastro.
 */

/** `""` do formulário vira `null`: campo apagado é campo limpo, não string vazia. */
const vazioParaNulo = (valor: unknown) =>
  typeof valor === "string" && valor.trim() === "" ? null : valor;

const opcional = <T extends z.ZodType>(esquema: T) =>
  z.preprocess(vazioParaNulo, esquema.nullable().optional());

const lojaOpcional = z.preprocess(
  (valor) => (valor === "" || valor === null ? undefined : valor),
  uuidSchema.optional(),
);

export const telefoneSchema = z
  .string()
  .transform((valor, ctx) => {
    const canonico = normalizarTelefone(valor);
    if (!canonico) {
      ctx.addIssue({
        code: "custom",
        message: "Telefone inválido. Use DDD e número, por exemplo (51) 99999-0000.",
      });
      return z.NEVER;
    }
    return canonico;
  });

const UFS = /^[A-Z]{2}$/;

/** Endereço é tudo ou nada: metade de um endereço não entrega pedido. */
const enderecoSchema = z
  .object({
    cep: opcional(z.string().trim().regex(/^\d{5}-?\d{3}$/, "CEP com 8 dígitos.")),
    logradouro: opcional(z.string().trim().max(160)),
    numero: opcional(z.string().trim().max(20)),
    complemento: opcional(z.string().trim().max(80)),
    bairro: opcional(z.string().trim().max(80)),
    cidade: opcional(z.string().trim().max(80)),
    uf: opcional(z.string().trim().toUpperCase().regex(UFS, "UF com 2 letras.")),
  })
  .transform((e, ctx) => {
    const obrigatorios = ["cep", "logradouro", "numero", "bairro", "cidade", "uf"] as const;
    const preenchidos = obrigatorios.filter((campo) => e[campo]);
    if (preenchidos.length === 0 && !e.complemento) return null;
    for (const campo of obrigatorios) {
      if (!e[campo]) ctx.addIssue({ code: "custom", path: [campo], message: "Preencha para completar o endereço." });
    }
    return {
      cep: (e.cep ?? "").replace("-", ""),
      logradouro: e.logradouro ?? "",
      numero: e.numero ?? "",
      ...(e.complemento ? { complemento: e.complemento } : {}),
      bairro: e.bairro ?? "",
      cidade: e.cidade ?? "",
      uf: e.uf ?? "",
    };
  });

const camposDoContato = {
  loja: lojaOpcional,
  nome: opcional(z.string().trim().max(120, "Use no máximo 120 caracteres.")),
  telefone: opcional(telefoneSchema),
  email: opcional(emailSchema),
  tamanhoPreferido: opcional(z.enum(TIPOS_GRADE, "Escolha uma das opções.")),
  observacoes: opcional(z.string().trim().max(2000, "Use no máximo 2000 caracteres.")),
  aniversario: opcional(z.iso.date("Data inválida.")),
};

/** Os campos de endereço chegam achatados do formulário (`endereco.cep`...). */
function agruparEndereco(bruto: unknown): unknown {
  if (typeof bruto !== "object" || bruto === null) return bruto;
  const objeto = bruto as Record<string, unknown>;
  const endereco: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(objeto)) {
    if (chave.startsWith("endereco.")) endereco[chave.slice(9)] = valor;
  }
  return { ...objeto, endereco: objeto.endereco ?? endereco };
}

const identificavel = (c: { nome?: string | null | undefined; telefone?: string | null | undefined; email?: string | null | undefined }) =>
  Boolean(c.nome || c.telefone || c.email);
const SEM_IDENTIDADE = {
  path: ["nome"],
  message: "Informe ao menos o nome, o telefone ou o e-mail.",
};

const contatoBase = z.object({ ...camposDoContato, endereco: enderecoSchema });

export const criarContatoSchema = z.preprocess(
  agruparEndereco,
  contatoBase.refine(identificavel, SEM_IDENTIDADE),
);

export const editarContatoSchema = z.preprocess(
  agruparEndereco,
  contatoBase
    .extend({ id: uuidSchema, updatedAt: z.coerce.date("Versão do registro inválida.") })
    .refine(identificavel, SEM_IDENTIDADE),
);

export const excluirContatoSchema = z.object({
  loja: lojaOpcional,
  id: uuidSchema,
  updatedAt: z.coerce.date("Versão do registro inválida."),
});

/** Campo repetido no `FormData` vira lista; um só vira string — aqui vira lista. */
const lista = <T extends z.ZodType>(item: T, max: number) =>
  z.preprocess(
    (v) => (v === undefined || v === null || v === "" ? [] : Array.isArray(v) ? v : [v]),
    z.array(item).max(max, `No máximo ${max} por vez.`),
  );

/** Troca o conjunto de etiquetas de UM contato. */
export const etiquetasDoContatoSchema = z.object({
  loja: lojaOpcional,
  contatoId: uuidSchema,
  etiquetaIds: lista(uuidSchema, 50),
});

/**
 * Seleção em massa SÓ PARA ETIQUETAR (04-ui.md §5.3). Não existe exclusão em
 * massa no R1 (§15, R-03) — e não existe schema para ela.
 */
export const etiquetarEmMassaSchema = z.object({
  loja: lojaOpcional,
  contatoIds: lista(uuidSchema, 200).refine((l) => l.length > 0, "Selecione ao menos um contato."),
  etiquetaId: uuidSchema,
});

export const TAMANHOS_DE_PAGINA = [25, 50, 100] as const;

/**
 * Filtros da carteira, lidos da URL. Valor desconhecido é IGNORADO (`catch`),
 * nunca interpretado: `optOut=all` não significa "todos" — "todos" é a
 * AUSÊNCIA do parâmetro (bug histórico `02/C-12`).
 */
export const filtrosContatosSchema = z.object({
  loja: lojaOpcional.catch(undefined),
  busca: z.string().trim().max(80).optional().catch(undefined),
  etiqueta: uuidSchema.optional().catch(undefined),
  optOut: z.enum(["sim", "nao"]).optional().catch(undefined),
  cursor: z.string().max(200).optional().catch(undefined),
  direcao: z.enum(["anterior", "proxima"]).optional().catch(undefined),
  porPagina: z.coerce
    .number()
    .refine((n) => (TAMANHOS_DE_PAGINA as readonly number[]).includes(n))
    .default(50)
    .catch(50),
});

export type FiltrosContatos = z.output<typeof filtrosContatosSchema>;

/**
 * Aplica um filtro à URL. `null` (a opção "Todos") APAGA o parâmetro — nunca
 * grava `all`. Mudar filtro invalida o cursor, que aponta para outra fatia.
 */
export function aplicarFiltro(
  atuais: URLSearchParams | string,
  chave: string,
  valor: string | null,
): URLSearchParams {
  const proximos = new URLSearchParams(atuais.toString());
  if (valor === null || valor === "") proximos.delete(chave);
  else proximos.set(chave, valor);
  proximos.delete("cursor");
  proximos.delete("direcao");
  return proximos;
}
