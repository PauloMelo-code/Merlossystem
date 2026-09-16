import "server-only";
import { z } from "zod";
import { lerDoBling, type ContaBling } from "./cliente";
import { PRODUTOS_POR_PAGINA } from "./config";

/**
 * As três leituras que o sistema faz do Bling, com a resposta validada por Zod
 * TOLERANTE: campo desconhecido é ignorado, campo ausente vira `null`. Um
 * produto malformado é descartado, não derruba a página inteira.
 *
 * Conferir contra a documentação vigente da API v3 antes de trocar qualquer
 * nome de campo (docs/integracoes.md, aviso de provedores).
 */

const numero = z.coerce.number().finite();
const textoOpcional = z.string().trim().min(1).nullish().catch(null);

const produtoResumo = z.object({
  id: z.coerce.string(),
  nome: z.string().trim().min(1),
  codigo: textoOpcional,
  preco: numero.nonnegative().catch(0),
  precoCusto: numero.nonnegative().nullish().catch(null),
  descricaoCurta: textoOpcional,
  formato: textoOpcional,
});

const variacao = z.object({
  id: z.coerce.string(),
  nome: z.string().catch(""),
  codigo: textoOpcional,
  variacao: z.object({ nome: z.string().catch("") }).nullish().catch(null),
});

const produtoDetalhe = produtoResumo.extend({
  pesoLiquido: numero.nonnegative().nullish().catch(null),
  variacoes: z.array(z.unknown()).catch([]),
});

const saldo = z.object({
  produto: z.object({ id: z.coerce.string(), codigo: textoOpcional }),
  saldoFisicoTotal: numero,
});

export type ProdutoBling = z.infer<typeof produtoResumo>;
export type VariacaoBling = { id: string; codigo: string | null; rotulo: string };
export type DetalheBling = ProdutoBling & {
  pesoGramas: number | null;
  variacoes: VariacaoBling[];
};

function listaDe(bruto: unknown): unknown[] {
  if (typeof bruto !== "object" || bruto === null) return [];
  const dados = (bruto as { data?: unknown }).data;
  return Array.isArray(dados) ? dados : [];
}

function validos<T>(itens: unknown[], esquema: z.ZodType<T>): T[] {
  return itens.flatMap((item) => {
    const r = esquema.safeParse(item);
    return r.success ? [r.data] : [];
  });
}

/** Uma página da listagem. Página vazia = fim. */
export async function listarProdutos(conta: ContaBling, pagina: number): Promise<ProdutoBling[]> {
  const bruto = await lerDoBling(conta, "/produtos", {
    pagina,
    limite: PRODUTOS_POR_PAGINA,
    criterio: 2, // 2 = só ativos
  });
  return validos(listaDe(bruto), produtoResumo);
}

/** Detalhe com as variações (a listagem não as traz). `null` = sumiu no Bling. */
export async function detalharProduto(conta: ContaBling, id: string): Promise<DetalheBling | null> {
  const bruto = await lerDoBling(conta, `/produtos/${encodeURIComponent(id)}`);
  const dados = typeof bruto === "object" && bruto !== null ? (bruto as { data?: unknown }).data : null;
  const r = produtoDetalhe.safeParse(dados);
  if (!r.success) return null;
  const variacoes = validos(r.data.variacoes, variacao).map((v) => ({
    id: v.id,
    codigo: v.codigo ?? null,
    // "Tamanho:P;Cor:Azul" — quem interpreta é `catalogo/_regras.ts`.
    rotulo: v.variacao?.nome || v.nome,
  }));
  const peso = r.data.pesoLiquido;
  return {
    ...r.data,
    pesoGramas: typeof peso === "number" ? Math.round(peso * 1000) : null,
    variacoes,
  };
}

/**
 * Saldo físico por produto no depósito. Devolve só o que o Bling respondeu:
 * produto ausente no mapa = "não sabemos", nunca zero.
 */
export async function lerSaldos(
  conta: ContaBling,
  depositoId: string,
  idsProdutos: readonly string[],
): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  if (idsProdutos.length === 0) return mapa;
  const bruto = await lerDoBling(conta, `/estoques/saldos/${encodeURIComponent(depositoId)}`, {
    idsProdutos,
  });
  for (const item of validos(listaDe(bruto), saldo)) {
    mapa.set(item.produto.id, item.saldoFisicoTotal);
  }
  return mapa;
}
