import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { DetalheBling, ProdutoBling } from "@/lib/integracoes/bling/leitura";

/**
 * Espelho do Bling → catálogo (01-dados-dominio.md §4, ADR 0015). O cliente
 * HTTP é simulado; banco, mutações e trilha são de verdade. A função abre as
 * próprias transações, então a massa é commitada numa loja nova.
 */

const bling = vi.hoisted(() => ({
  contaId: "",
  paginas: [] as ProdutoBling[][],
  detalhes: new Map<string, DetalheBling>(),
}));

vi.mock("@/lib/integracoes/bling/cliente", () => ({
  contaBling: vi.fn(async () => ({ id: bling.contaId, token: "token-de-teste" })),
}));
vi.mock("@/lib/integracoes/bling/leitura", () => ({
  listarProdutos: vi.fn(async (_conta: unknown, pagina: number) => bling.paginas[pagina - 1] ?? []),
  detalharProduto: vi.fn(async (_conta: unknown, id: string) => bling.detalhes.get(id) ?? null),
}));

const { db, pool } = await import("@/lib/db/client");
const { sql } = await import("drizzle-orm");
const { sincronizarCatalogoBling } = await import("@/lib/catalogo/sincronizacao");
const { ATOR_SISTEMA } = await import("@/lib/db/mutacoes");
const apoio = await import("./pedidos-apoio");

beforeAll(async () => {
  apoio.exigirBancoDeTeste();
  const conta = await apoio.umaLinha<{ id: string }>(db, sql`
    insert into lojas_integracoes (loja_id, provedor, rotulo, status)
    values (null, 'bling', 'Bling da rede (teste)', 'conectado') returning id`);
  bling.contaId = conta.id;
});
afterAll(async () => {
  await pool.end().catch(() => undefined);
});

const base = (p: Partial<ProdutoBling> & { id: string; nome: string }): ProdutoBling => ({
  codigo: null,
  preco: 0,
  precoCusto: null,
  descricaoCurta: null,
  formato: "S",
  ...p,
});

async function produtosDa(lojaId: string) {
  const r = await db.execute(sql`
    select p.sku, p.nome, p.preco, p.preco_custo, p.tipo_grade, p.peso_gramas, p.sincronizado_em,
           coalesce(json_agg(json_build_object('t', v.tamanho, 's', v.sku) order by v.created_at)
                    filter (where v.id is not null), '[]') as variacoes
    from produtos p left join produtos_variacoes v on v.produto_id = p.id and v.is_deleted = false
    where p.loja_id = ${lojaId} and p.is_deleted = false
    group by p.id order by p.sku`);
  return r.rows as Record<string, unknown>[];
}

describe("sincronizarCatalogoBling", () => {
  it("cria produtos por SKU, com a grade do Bling ou a padrão, e ignora quem não tem código", async () => {
    const c = await apoio.cenario(db, { deposito: `dep-sync-${Date.now()}` });
    const s = Date.now().toString(36);
    bling.paginas = [
      [
        base({ id: `1${s}`, nome: "Blusa Lisa", codigo: `BL-${s}`, preco: 59.9, precoCusto: 20, formato: "S" }),
        base({ id: `2${s}`, nome: "Calça Plus", codigo: `CP-${s}`, preco: 149.9, formato: "V" }),
        base({ id: `3${s}`, nome: "Sem código", preco: 10 }),
      ],
    ];
    bling.detalhes.set(`2${s}`, {
      ...base({ id: `2${s}`, nome: "Calça Plus", codigo: `CP-${s}`, preco: 149.9, formato: "V" }),
      pesoGramas: 450,
      variacoes: [
        { id: `21${s}`, codigo: `CP-${s}-46`, rotulo: "Tamanho:46;Cor:Preto" },
        { id: `22${s}`, codigo: `CP-${s}-46A`, rotulo: "Tamanho:46;Cor:Azul" },
        { id: `23${s}`, codigo: `CP-${s}-48`, rotulo: "Tamanho:48" },
        { id: `24${s}`, codigo: `CP-${s}-XG`, rotulo: "Tamanho:XG" },
      ],
    });

    const resumo = await sincronizarCatalogoBling({ integracaoId: bling.contaId, lojaId: c.lojaId });
    expect(resumo).toMatchObject({ lidos: 3, criados: 2, ignorados: 1 });

    const linhas = (await produtosDa(c.lojaId)).filter((l) => String(l.sku).endsWith(s));
    expect(linhas).toHaveLength(2);
    const [blusa, calca] = [linhas.find((l) => l.sku === `BL-${s}`)!, linhas.find((l) => l.sku === `CP-${s}`)!];
    expect(blusa).toMatchObject({ preco: "59.90", preco_custo: "20.00", tipo_grade: "ambos" });
    expect((blusa.variacoes as { t: string; s: string | null }[]).map((v) => v.t).sort()).toEqual(
      ["PP", "P", "M", "G", "GG", "46", "48", "50", "52", "54", "56", "58"].sort(),
    );
    expect((blusa.variacoes as { s: string | null }[]).every((v) => v.s === null)).toBe(true);
    expect(calca).toMatchObject({ preco: "149.90", tipo_grade: "plussize", peso_gramas: 450 });
    expect([...(calca.variacoes as { t: string }[])].sort((a, b) => a.t.localeCompare(b.t))).toEqual([
      { t: "46", s: `CP-${s}-46` },
      { t: "48", s: `CP-${s}-48` },
    ]);

    const trilha = await apoio.umaLinha<{ n: number; sistema: number }>(db, sql`
      select count(*)::int as n,
             count(*) filter (where ator_tipo = 'sistema' and ator_id = ${ATOR_SISTEMA})::int as sistema
      from auditoria_eventos where loja_id = ${c.lojaId} and acao = 'produto_sincronizado'`);
    expect(trilha.n).toBeGreaterThan(0);
    expect(trilha.sistema).toBe(trilha.n);
    const autores = await db.execute(sql`
      select distinct modified_by from produtos
      where loja_id = ${c.lojaId} and sku in (${`BL-${s}`}, ${`CP-${s}`})`);
    expect(autores.rows).toEqual([{ modified_by: ATOR_SISTEMA }]);

    const conta = await apoio.umaLinha<{ ultima_sincronizacao: Date | null; ultimo_erro: string | null }>(db, sql`
      select ultima_sincronizacao, ultimo_erro from lojas_integracoes where id = ${bling.contaId}`);
    expect(conta.ultima_sincronizacao).not.toBeNull();
    expect(conta.ultimo_erro).toBeNull();

    // Segunda passada sem mudança: nada é regravado.
    const repetida = await sincronizarCatalogoBling({ integracaoId: bling.contaId, lojaId: c.lojaId });
    expect(repetida).toMatchObject({ criados: 0, alterados: 0 });

    // Preço mudou no Bling: atualiza e grava `produto_preco_alterado`.
    bling.paginas[0]![0] = { ...bling.paginas[0]![0]!, preco: 64.9 };
    const nova = await sincronizarCatalogoBling({ integracaoId: bling.contaId, lojaId: c.lojaId });
    expect(nova).toMatchObject({ criados: 0, alterados: 1 });
    const preco = await apoio.umaLinha<{ preco: string }>(db, sql`
      select preco from produtos where loja_id = ${c.lojaId} and sku = ${`BL-${s}`}`);
    expect(preco.preco).toBe("64.90");
    const alterado = await apoio.umaLinha<{ n: number }>(db, sql`
      select count(*)::int as n from auditoria_eventos where loja_id = ${c.lojaId} and acao = 'produto_preco_alterado'`);
    expect(alterado.n).toBe(1);
  });

  it("conta diferente da conectada falha sem gravar e registra o erro na conta", async () => {
    const c = await apoio.cenario(db, { deposito: `dep-sync-err-${Date.now()}` });
    const outra = await apoio.umaLinha<{ id: string }>(db, sql`
      insert into lojas_integracoes (loja_id, provedor, rotulo, status)
      values (null, 'bling', 'Outra conta (teste)', 'conectado') returning id`);
    await expect(sincronizarCatalogoBling({ integracaoId: outra.id, lojaId: c.lojaId })).rejects.toMatchObject({
      codigo: "INTEGRACAO",
      permanente: true,
    });
    const conta = await apoio.umaLinha<{ ultimo_erro: string | null }>(db, sql`
      select ultimo_erro from lojas_integracoes where id = ${outra.id}`);
    expect(conta.ultimo_erro).toContain("não é a conta conectada");
  });
});
