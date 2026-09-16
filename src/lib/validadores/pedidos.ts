import { z } from "zod";
import { FORMAS_PAGAMENTO, MASC_STATUS, STATUS_PEDIDO, type StatusPedido } from "@/lib/db/schema/_enums/pedidos";
import { REGEX_DINHEIRO } from "@/lib/formato";
import { motivoSchema, uuidSchema } from "./comum";

/**
 * Entradas das actions de pedido (04-ui.md §5.2, §5.3 e §7). Módulo PURO: o
 * mesmo Zod serve ao servidor e ao `blur` da tela.
 *
 * Preço NÃO entra aqui: o cliente manda variação e quantidade, e o valor vem
 * do catálogo no servidor (02/O-01).
 */

/**
 * Status que a operação escolhe na tela. `devolvido` fica fora: só a devolução
 * concluída chega lá (fora do R1); `cancelado` tem ação própria, com motivo.
 */
export const STATUS_OPERACIONAIS = [
  "confirmado",
  "preparando",
  "enviado",
  "entregue",
] as const satisfies readonly StatusPedido[];

/** Número da venda no Masc: texto curto, sem espaço. */
export const REGEX_VENDA_MASC = /^[A-Za-z0-9][A-Za-z0-9./-]{0,39}$/;

const dinheiro = z
  .string()
  .trim()
  .transform((v) => (v === "" ? "0" : v.replace(",", ".")))
  .pipe(z.string().regex(REGEX_DINHEIRO, "Use um valor como 12,90."))
  .transform((v) => {
    const [inteiro = "0", decimal = ""] = v.split(".");
    return `${inteiro}.${decimal.padEnd(2, "0")}`;
  });

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use no máximo ${max} caracteres.`)
    .optional()
    .transform((v) => (v ? v : undefined));

const opcionalUuid = z
  .union([uuidSchema, z.literal("")])
  .optional()
  .transform((v) => (v ? v : undefined));

export const itemDoPedidoSchema = z.object({
  variacaoId: uuidSchema,
  quantidade: z.coerce
    .number()
    .int("A quantidade é um número inteiro.")
    .min(1, "A quantidade mínima é 1.")
    .max(999, "Quantidade acima do permitido."),
});

/** Loja pedida pela tela: gestão escolhe; operação usa a do cadastro (valor ignorado). */
const loja = z.string().trim().max(64).optional();

export const novoPedidoSchema = z.object({
  loja,
  contatoId: uuidSchema,
  conversaId: opcionalUuid,
  negocioId: opcionalUuid,
  itens: z
    .array(itemDoPedidoSchema)
    .min(1, "Adicione ao menos um produto.")
    .max(50, "No máximo 50 itens por pedido."),
  frete: dinheiro.default("0.00"),
  desconto: dinheiro.default("0.00"),
  formaPagamento: z.enum(FORMAS_PAGAMENTO).optional(),
  entregaMetodo: textoOpcional(60),
  observacoes: textoOpcional(1000),
});
export type NovoPedido = z.output<typeof novoPedidoSchema>;

/** Todo alvo de edição carrega o `updated_at` que a tela levou (§7.4). */
export const alvoDePedidoSchema = z.object({
  loja,
  id: uuidSchema,
  updatedAt: z.coerce.date("Recarregue a página e tente de novo."),
});
export type AlvoDePedido = z.output<typeof alvoDePedidoSchema>;

export const lancarNoMascSchema = alvoDePedidoSchema.extend({
  mascVendaId: z
    .string()
    .trim()
    .min(1, "Informe o número da venda no Masc.")
    .regex(REGEX_VENDA_MASC, "Use só letras, números, ponto, barra ou hífen (até 40)."),
});
export type LancarNoMasc = z.output<typeof lancarNoMascSchema>;

export const dispensarDoMascSchema = alvoDePedidoSchema.extend({
  observacao: motivoSchema,
});
export type DispensarDoMasc = z.output<typeof dispensarDoMascSchema>;

export const cancelarPedidoSchema = alvoDePedidoSchema.extend({
  motivo: motivoSchema,
});
export type CancelarPedido = z.output<typeof cancelarPedidoSchema>;

export const alterarStatusSchema = alvoDePedidoSchema.extend({
  status: z.enum(STATUS_OPERACIONAIS, "Escolha um status da lista."),
});
export type AlterarStatus = z.output<typeof alterarStatusSchema>;

export const informarRastreioSchema = alvoDePedidoSchema.extend({
  rastreioCodigo: z
    .string()
    .trim()
    .min(4, "Informe o código de rastreio.")
    .max(60, "Use no máximo 60 caracteres."),
  rastreioUrl: z
    .union([z.url({ protocol: /^https$/, error: "O link precisa começar com https://." }), z.literal("")])
    .optional()
    .transform((v) => (v ? v : undefined)),
  entregaMetodo: textoOpcional(60),
});
export type InformarRastreio = z.output<typeof informarRastreioSchema>;

/** Filtros da lista (`searchParams`). Valor fora da lista é descartado, nunca vira erro. */
export const filtroDePedidosSchema = z.object({
  status: z.enum(STATUS_PEDIDO).optional().catch(undefined),
  masc: z.enum([...MASC_STATUS, "fila", "todos"]).optional().catch(undefined),
  de: z.iso.date().optional().catch(undefined),
  ate: z.iso.date().optional().catch(undefined),
  q: z.string().trim().max(40).optional().catch(undefined),
  cursor: z.string().max(200).optional().catch(undefined),
  direcao: z.enum(["anterior", "proxima"]).optional().catch(undefined),
  porPagina: z.coerce.number().pipe(z.union([z.literal(25), z.literal(50), z.literal(100)])).catch(50),
});
