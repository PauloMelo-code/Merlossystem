import "server-only";
import { eq, isNotNull } from "drizzle-orm";
import type { Contexto } from "@/lib/auth/guard";
import { db } from "@/lib/db/client";
import { vivosE } from "@/lib/db/consultas";
import {
  atualizarComTrava,
  atualizarContador,
  emTransacao,
  inserirAuditado,
  type Transacao,
} from "@/lib/db/mutacoes";
import { produtos, produtos_variacoes } from "@/lib/db/schema/catalogo";
import { lojas_integracoes } from "@/lib/db/schema/integracoes";
import { lojas } from "@/lib/db/schema/lojas";
import { ErroDeIntegracao } from "@/lib/erros";
import { contaBling, type ContaBling } from "@/lib/integracoes/bling/cliente";
import {
  detalharProduto,
  listarProdutos,
  type ProdutoBling,
} from "@/lib/integracoes/bling/leitura";
import { logger } from "@/lib/logger";
import { precoDoBling, tamanhoDoRotulo, tamanhosDaGrade, tipoGradeDe } from "./_regras";

/**
 * Espelho do Bling → catálogo local (01-dados-dominio.md §4, ADR 0015).
 *
 * Chamado pelo processador `integracoes/sincronizar-bling` (costura de M5,
 * `src/server/processadores/integracoes.ts`). É o ÚNICO caminho que cria ou
 * altera produto: não existe cadastro manual.
 *
 * - casa por `codigo` do Bling = `produtos.sku`, por loja com depósito;
 * - produto sem `codigo` é ignorado (sem SKU não há elo entre os catálogos);
 * - grava só o que mudou, com ator `sistema` e trilha `produto_sincronizado`
 *   ou `produto_preco_alterado`;
 * - variação por TAMANHO da grade; sem variação reconhecível no Bling, cria a
 *   grade com SKU nulo e a reserva degrada para o nível do produto;
 * - produto que some do Bling NÃO é excluído aqui (pedido antigo aponta para
 *   ele, e "sumiu da listagem" não é prova de que deixou de existir).
 */

export type DadosSincronizacao = { integracaoId: string; lojaId?: string | null };
export type ResumoSincronizacao = { lidos: number; criados: number; alterados: number; ignorados: number };

const PAGINAS_MAXIMAS = 500;

/** Worker não tem sessão: ator `sistema`, `modified_by` nulo (ver docs/modulos/pedidos.md). */
function contextoDeSistema(lojaId: string): Contexto {
  return {
    sessao: undefined as never,
    escopo: { tipo: "uma", lojaId },
    autorId: null as unknown as string,
    origem: "worker",
  };
}

type Variacao = { tamanho: string; sku: string | null; blingId: string | null };
type ProdutoLido = { base: ProdutoBling; sku: string; pesoGramas: number | null; variacoes: Variacao[]; tipo: ReturnType<typeof tipoGradeDe> };

async function lerProdutoCompleto(conta: ContaBling, base: ProdutoBling): Promise<ProdutoLido | null> {
  if (!base.codigo) return null;
  const detalhe = base.formato === "V" ? await detalharProduto(conta, base.id) : null;
  const vistos = new Set<string>();
  const variacoes: Variacao[] = [];
  for (const v of detalhe?.variacoes ?? []) {
    const tamanho = tamanhoDoRotulo(v.rotulo);
    // Dois registros do Bling no mesmo tamanho (ex.: cores): vale o primeiro.
    if (!tamanho || vistos.has(tamanho)) continue;
    vistos.add(tamanho);
    variacoes.push({ tamanho, sku: v.codigo, blingId: v.id });
  }
  const tipo = tipoGradeDe(variacoes.map((v) => v.tamanho));
  const finais =
    variacoes.length > 0
      ? variacoes
      : tamanhosDaGrade(tipo).map((tamanho) => ({ tamanho, sku: null, blingId: null }));
  return { base, sku: base.codigo, pesoGramas: detalhe?.pesoGramas ?? null, variacoes: finais, tipo };
}

async function gravarProduto(
  tx: Transacao,
  ctx: Contexto,
  lojaId: string,
  lido: ProdutoLido,
  agora: Date,
): Promise<"criado" | "alterado" | "igual"> {
  const desejado = {
    nome: lido.base.nome,
    preco: precoDoBling(lido.base.preco),
    preco_custo: typeof lido.base.precoCusto === "number" ? precoDoBling(lido.base.precoCusto) : null,
    descricao: lido.base.descricaoCurta ?? null,
    tipo_grade: lido.tipo,
    bling_produto_id: lido.base.id,
    ...(lido.pesoGramas === null ? {} : { peso_gramas: lido.pesoGramas }),
  };

  const [atual] = await tx
    .select()
    .from(produtos)
    .where(vivosE(produtos, eq(produtos.loja_id, lojaId), eq(produtos.sku, lido.sku)))
    .limit(1);

  let produtoId: string;
  let resultado: "criado" | "alterado" | "igual" = "igual";
  if (!atual) {
    const linha = await inserirAuditado(
      tx,
      produtos,
      { loja_id: lojaId, sku: lido.sku, ...desejado, sincronizado_em: agora },
      ctx,
      "produto_sincronizado",
    );
    produtoId = String(linha.id);
    resultado = "criado";
  } else {
    produtoId = atual.id;
    const mudou = Object.entries(desejado).some(
      ([campo, valor]) => (atual as Record<string, unknown>)[campo] !== valor,
    );
    if (mudou) {
      await atualizarComTrava(
        tx,
        produtos,
        {
          id: atual.id,
          escopo: ctx.escopo,
          updatedAtOriginal: atual.updated_at,
          dados: { ...desejado, sincronizado_em: agora },
        },
        ctx,
        atual.preco !== desejado.preco ? "produto_preco_alterado" : "produto_sincronizado",
      );
      resultado = "alterado";
    }
  }

  const existentes = await tx
    .select()
    .from(produtos_variacoes)
    .where(vivosE(produtos_variacoes, eq(produtos_variacoes.produto_id, produtoId)));
  const porTamanho = new Map(existentes.map((v) => [v.tamanho, v]));

  for (const v of lido.variacoes) {
    const existente = porTamanho.get(v.tamanho);
    if (!existente) {
      await inserirAuditado(
        tx,
        produtos_variacoes,
        { loja_id: lojaId, produto_id: produtoId, tamanho: v.tamanho, sku: v.sku, bling_produto_id: v.blingId },
        ctx,
        "produto_sincronizado",
      );
      if (resultado === "igual") resultado = "alterado";
    } else if (existente.sku !== v.sku || existente.bling_produto_id !== v.blingId) {
      await atualizarComTrava(
        tx,
        produtos_variacoes,
        {
          id: existente.id,
          escopo: ctx.escopo,
          updatedAtOriginal: existente.updated_at,
          dados: { sku: v.sku, bling_produto_id: v.blingId },
        },
        ctx,
        "produto_sincronizado",
      );
      if (resultado === "igual") resultado = "alterado";
    }
  }
  return resultado;
}

async function lojasComDeposito(lojaId?: string | null): Promise<string[]> {
  const linhas = await db
    .select({ id: lojas.id })
    .from(lojas)
    .where(
      vivosE(
        lojas,
        isNotNull(lojas.bling_deposito_id),
        lojaId ? eq(lojas.id, lojaId) : undefined,
      ),
    );
  return linhas.map((l) => l.id);
}

async function marcarConta(integracaoId: string, lojaId: string, erro: string | null): Promise<void> {
  await emTransacao(contextoDeSistema(lojaId), (tx) =>
    atualizarContador(
      tx,
      lojas_integracoes,
      { id: integracaoId, escopo: { tipo: "todas" } },
      erro === null ? { ultima_sincronizacao: new Date(), ultimo_erro: null } : { ultimo_erro: erro },
    ),
  );
}

export async function sincronizarCatalogoBling(
  dados: DadosSincronizacao,
): Promise<ResumoSincronizacao> {
  const resumo: ResumoSincronizacao = { lidos: 0, criados: 0, alterados: 0, ignorados: 0 };
  const idsDeLoja = await lojasComDeposito(dados.lojaId);
  if (idsDeLoja.length === 0) {
    logger.info({ integracaoId: dados.integracaoId }, "nenhuma loja com depósito do Bling");
    return resumo;
  }
  const lojaDoContador = idsDeLoja[0]!;

  try {
    const conta = await contaBling();
    if (conta.id !== dados.integracaoId) {
      throw new ErroDeIntegracao("A conta do Bling pedida não é a conta conectada.", true);
    }
    for (let pagina = 1; pagina <= PAGINAS_MAXIMAS; pagina += 1) {
      const lista = await listarProdutos(conta, pagina);
      if (lista.length === 0) break;
      const lidos: ProdutoLido[] = [];
      for (const base of lista) {
        resumo.lidos += 1;
        const lido = await lerProdutoCompleto(conta, base);
        if (lido) lidos.push(lido);
        else resumo.ignorados += 1;
      }
      const agora = new Date();
      for (const lojaId of idsDeLoja) {
        const ctx = contextoDeSistema(lojaId);
        await emTransacao(ctx, async (tx) => {
          for (const lido of lidos) {
            const r = await gravarProduto(tx, ctx, lojaId, lido, agora);
            if (r === "criado") resumo.criados += 1;
            if (r === "alterado") resumo.alterados += 1;
          }
        });
      }
    }
    await marcarConta(dados.integracaoId, lojaDoContador, null);
    return resumo;
  } catch (erro) {
    const mensagem = erro instanceof ErroDeIntegracao ? erro.message : "Falha ao sincronizar o catálogo.";
    await marcarConta(dados.integracaoId, lojaDoContador, mensagem).catch(() => undefined);
    throw erro;
  }
}

/** Para a tela: hora da última sincronização bem-sucedida da conta Bling. */
export async function ultimaSincronizacao(): Promise<Date | null> {
  const [linha] = await db
    .select({ quando: lojas_integracoes.ultima_sincronizacao })
    .from(lojas_integracoes)
    .where(vivosE(lojas_integracoes, eq(lojas_integracoes.provedor, "bling")))
    .limit(1);
  return linha?.quando ?? null;
}

