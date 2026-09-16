import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import type { Contexto } from "@/lib/auth/guard";
import { db } from "@/lib/db/client";
import type { Transacao } from "@/lib/db/mutacoes";

/**
 * Apoio dos testes de catálogo e pedidos (pacote M4).
 *
 * Duas formas de isolar, as duas sem apagar linha (T25):
 *   - `emRollback`: transação que SEMPRE volta atrás, pelo papel `merlo_app`
 *     (05-plano §3.3). Serve a tudo que recebe `tx`.
 *   - massa com loja NOVA e sigla sorteada, COMMITADA: para o que abre a
 *     própria transação (numeração concorrente, sincronização,
 *     disponibilidade). Nenhum teste enxerga a loja do outro.
 *
 * Não termina em `.test.ts`: o Vitest não o coleta.
 */

type Executor = { execute: (consulta: SQL) => Promise<{ rows: unknown[] }> };

export function exigirBancoDeTeste(): void {
  const url = process.env.DATABASE_URL ?? "";
  if (!/\/[^/]*test[^/]*$/.test(new URL(url).pathname)) {
    throw new Error(`Banco "${url}" não parece de teste: o nome precisa conter "test".`);
  }
}

class Desfazer extends Error {}

export async function emRollback(fn: (tx: Transacao) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local role merlo_app`);
      await fn(tx);
      throw new Desfazer("rollback do teste");
    });
  } catch (erro) {
    if (!(erro instanceof Desfazer)) throw erro;
  }
}

export async function umaLinha<T = Record<string, unknown>>(ex: Executor, consulta: SQL): Promise<T> {
  const r = await ex.execute(consulta);
  return r.rows[0] as T;
}

let contador = 0;
const sufixo = () => `${Date.now().toString(36)}${(contador++).toString(36)}${randomUUID().slice(0, 4)}`;
const sigla = () =>
  Array.from({ length: 3 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join("");

export type Cenario = {
  lojaId: string;
  sigla: string;
  usuarioId: string;
  contatoId: string;
  produtoId: string;
  skuProduto: string;
  /** Tamanho → id da variação. `P` tem SKU próprio; `M` não tem. */
  variacoes: Record<"P" | "M", string>;
  skuP: string;
};

/** Loja (com depósito opcional), dona, contato e um vestido R$ 129,90 com P e M. */
export async function cenario(ex: Executor, opcoes: { deposito?: string } = {}): Promise<Cenario> {
  const s = sufixo();
  // Sigla repetida entre lojas vivas viola o único: sorteia de novo.
  let loja: { id: string; sigla: string } | undefined;
  for (let i = 0; !loja && i < 20; i += 1) {
    const tentativa = sigla();
    const existe = await umaLinha<{ n: number }>(
      ex,
      sql`select count(*)::int as n from lojas where sigla = ${tentativa} and is_deleted = false`,
    );
    if (existe.n > 0) continue;
    loja = await umaLinha(ex, sql`
      insert into lojas (nome, slug, sigla, bling_deposito_id)
      values (${`Loja ${s}`}, ${`loja-${s}`}, ${tentativa}, ${opcoes.deposito ?? null})
      returning id, sigla`);
  }
  if (!loja) throw new Error("não achei sigla livre");

  const usuario = await umaLinha<{ id: string }>(ex, sql`
    insert into usuarios (nome, email, papel) values ('Vendedora de Teste', ${`v-${s}@exemplo.invalido`}, 'dono')
    returning id`);
  const contato = await umaLinha<{ id: string }>(ex, sql`
    insert into contatos (loja_id, nome) values (${loja.id}, 'Cliente de Teste') returning id`);
  const skuProduto = `VEST-${s}`;
  const produto = await umaLinha<{ id: string }>(ex, sql`
    insert into produtos (loja_id, nome, sku, preco, bling_produto_id)
    values (${loja.id}, 'Vestido Midi', ${skuProduto}, '129.90', ${`b-${s}`}) returning id`);
  const skuP = `${skuProduto}-P`;
  const p = await umaLinha<{ id: string }>(ex, sql`
    insert into produtos_variacoes (loja_id, produto_id, tamanho, sku, bling_produto_id)
    values (${loja.id}, ${produto.id}, 'P', ${skuP}, ${`b-${s}-p`}) returning id`);
  const m = await umaLinha<{ id: string }>(ex, sql`
    insert into produtos_variacoes (loja_id, produto_id, tamanho)
    values (${loja.id}, ${produto.id}, 'M') returning id`);

  return {
    lojaId: loja.id,
    sigla: loja.sigla,
    usuarioId: usuario.id,
    contatoId: contato.id,
    produtoId: produto.id,
    skuProduto,
    variacoes: { P: p.id, M: m.id },
    skuP,
  };
}

export function contexto(c: Pick<Cenario, "lojaId" | "usuarioId">): Contexto {
  return {
    sessao: {
      usuarioId: c.usuarioId,
      sessaoId: randomUUID(),
      papel: "dono",
      lojaId: null,
      ativo: true,
      precisaTrocarSenha: false,
      precisaConfigurarFator: false,
    },
    escopo: { tipo: "uma", lojaId: c.lojaId },
    autorId: c.usuarioId,
    origem: "ui",
  };
}

/** Pedido direto no banco, para montar a reserva sem passar pela criação. */
export async function pedidoCru(
  ex: Executor,
  c: Cenario,
  campos: { sku: string | null; quantidade: number; status?: string; masc?: string },
): Promise<string> {
  const numero = `T-${sufixo()}`;
  const masc = campos.masc ?? "pendente";
  const pedido = await umaLinha<{ id: string }>(ex, sql`
    insert into pedidos (loja_id, contato_id, numero, status, masc_status, masc_venda_id, masc_lancado_em,
                         masc_observacao, subtotal, total, criado_por)
    values (${c.lojaId}, ${c.contatoId}, ${numero}, ${campos.status ?? "confirmado"}, ${masc},
            ${masc === "lancado" ? numero : null}, ${masc === "lancado" ? new Date() : null},
            ${masc === "dispensado" ? "dispensado no teste" : null}, '0', '0', ${c.usuarioId})
    returning id`);
  await ex.execute(sql`
    insert into pedidos_itens (loja_id, pedido_id, produto_id, variacao_id, sku, nome, tamanho,
                               quantidade, preco_unitario, total_item)
    values (${c.lojaId}, ${pedido.id}, ${c.produtoId}, ${c.variacoes.P}, ${campos.sku}, 'Vestido Midi', 'P',
            ${campos.quantidade}, '0', '0')`);
  return pedido.id;
}
