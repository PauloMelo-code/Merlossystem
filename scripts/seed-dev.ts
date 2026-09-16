import { Pool, type PoolClient } from "pg";
import { env } from "../src/lib/env";

/**
 * Semente de DESENVOLVIMENTO (03-arquitetura.md §17, 02-seguranca.md §18).
 *
 *   npm run db:seed
 *
 * NÃO CRIA USUÁRIO E NÃO CRIA CREDENCIAL. Nenhuma senha, nenhum hash, nenhum
 * convite. Quem entra no sistema entra pelo `npm run primeiro-dono`, que emite
 * um convite e imprime o link uma única vez. Seed com senha literal é a porta
 * que fica aberta depois de todo deploy — é o defeito D-02 do sistema antigo.
 *
 * NUNCA RODA EM PRODUÇÃO: aborta com `NODE_ENV=production` e aborta se o host
 * do banco não for local. As duas conferências acontecem antes de qualquer
 * comando.
 *
 * O que a massa REPRODUZ DE PROPÓSITO, porque é onde o sistema antigo quebrava:
 *   - DUAS LOJAS, para o escopo de loja aparecer em toda tela;
 *   - DOIS NÚMEROS NA MESMA LOJA, que é o que torna `conversas.integracao_id`
 *     obrigatório: sem isso a resposta sai pelo número errado (ADR 0016);
 *   - O MESMO TELEFONE NAS DUAS LOJAS, que é legítimo — a cliente compra nas
 *     duas — e é o caso que quebra qualquer unicidade global de telefone.
 *
 * Idempotente: tudo por `ON CONFLICT DO NOTHING` sobre os índices únicos que já
 * existem. Rodar duas vezes não duplica nada.
 *
 * Usa `pg` direto, e não `src/lib/db/client.ts`, porque o client importa
 * `server-only` e estoura fora do runtime do Next — mesma razão de
 * `scripts/primeiro-dono.ts`. E grava por SQL parametrizado, e não pelos
 * helpers de `mutacoes.ts`, porque não há `Contexto` nem trilha de negócio numa
 * carga de dados de desenvolvimento.
 */

type Cliente = PoolClient;

const LOJAS = [
  { slug: "centro", nome: "Merlo Store Centro", sigla: "MSC" },
  { slug: "shopping", nome: "Merlo Store Shopping", sigla: "MSS" },
] as const;

/** Dois números na loja `centro`: um oficial e um não oficial. */
const INTEGRACOES = [
  { loja: "centro", provedor: "whatsapp_oficial", rotulo: "WhatsApp oficial (vendas)" },
  { loja: "centro", provedor: "uazapi", rotulo: "WhatsApp não oficial (pós-venda)" },
  { loja: "shopping", provedor: "whatsapp_oficial", rotulo: "WhatsApp oficial (vendas)" },
  { loja: "shopping", provedor: "instagram", rotulo: "Instagram Direct" },
] as const;

const ETIQUETAS = [
  { slug: "vip", nome: "VIP", cor: "#7c3aed" },
  { slug: "atacado", nome: "Atacado", cor: "#0891b2" },
  { slug: "primeira-compra", nome: "Primeira compra", cor: "#16a34a" },
] as const;

/** O MESMO telefone nas duas lojas — o caso que a unicidade é por loja. */
const TELEFONE_COMPARTILHADO = "5551999990001";

const CONTATOS = [
  { loja: "centro", nome: "Ana Ribeiro", telefone: TELEFONE_COMPARTILHADO },
  { loja: "shopping", nome: "Ana Ribeiro", telefone: TELEFONE_COMPARTILHADO },
  { loja: "centro", nome: "Bruna Camargo", telefone: "5551999990002" },
  { loja: "shopping", nome: "Carla Duarte", telefone: "5551999990003" },
] as const;

const CATEGORIAS = [
  { slug: "vestidos", nome: "Vestidos" },
  { slug: "blusas", nome: "Blusas" },
] as const;

const PRODUTOS = [
  { categoria: "vestidos", nome: "Vestido midi canelado", sku: "VST-001", preco: "259.90",
    grade: "ambos", tamanhos: ["P", "M", "G", "46", "48"] },
  { categoria: "vestidos", nome: "Vestido longo fenda", sku: "VST-002", preco: "329.90",
    grade: "slim", tamanhos: ["P", "M", "G", "GG"] },
  { categoria: "blusas", nome: "Blusa cropped tricot", sku: "BLS-001", preco: "149.90",
    grade: "plussize", tamanhos: ["46", "48", "50", "52"] },
] as const;

function abortarSeNaoForLocal(): void {
  if (env.NODE_ENV === "production") {
    console.error("db:seed não roda em produção. Nunca.");
    process.exit(1);
  }
  const host = new URL(env.DATABASE_URL).hostname;
  if (!["localhost", "127.0.0.1", "::1", "db"].includes(host)) {
    console.error(`db:seed só roda em banco local. Host recebido: ${host}`);
    process.exit(1);
  }
}

async function idDaLoja(c: Cliente, slug: string): Promise<string> {
  const r = await c.query<{ id: string }>(
    "select id from lojas where lower(slug) = $1 and is_deleted = false",
    [slug],
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error(`loja "${slug}" não foi criada`);
  return id;
}

async function semearLojas(c: Cliente): Promise<void> {
  for (const l of LOJAS) {
    await c.query(
      `insert into lojas (nome, slug, sigla) values ($1, $2, $3)
       on conflict do nothing`,
      [l.nome, l.slug, l.sigla],
    );
  }
}

async function semearEtiquetas(c: Cliente, lojaId: string): Promise<void> {
  for (const e of ETIQUETAS) {
    await c.query(
      `insert into lojas_etiquetas (loja_id, nome, slug, cor) values ($1, $2, $3, $4)
       on conflict do nothing`,
      [lojaId, e.nome, e.slug, e.cor],
    );
  }
}

/**
 * `status = 'desconectado'` e SEM credencial: a semente nunca guarda segredo,
 * nem de mentira. Conectar é tela, com o cofre (§13).
 *
 * `referencia_externa` preenchida porque é o ÚNICO índice único da tabela
 * (`uq_lojas_integracoes_referencia`, parcial em `referencia_externa is not
 * null`). Sem ela o `on conflict do nothing` não tem em que conflitar e cada
 * `npm run db:seed` acrescentaria mais quatro números à mesma loja.
 */
async function semearIntegracoes(c: Cliente, porSlug: Map<string, string>): Promise<void> {
  for (const i of INTEGRACOES) {
    await c.query(
      `insert into lojas_integracoes (loja_id, provedor, rotulo, status, referencia_externa)
       values ($1, $2, $3, 'desconectado', $4)
       on conflict do nothing`,
      [porSlug.get(i.loja), i.provedor, i.rotulo, `seed-${i.loja}-${i.provedor}`],
    );
  }
}

async function semearContatos(c: Cliente, porSlug: Map<string, string>): Promise<void> {
  for (const ct of CONTATOS) {
    await c.query(
      `insert into contatos (loja_id, nome, telefone, ultimo_contato_em)
       values ($1, $2, $3, now())
       on conflict do nothing`,
      [porSlug.get(ct.loja), ct.nome, ct.telefone],
    );
  }
}

async function semearCatalogo(c: Cliente, lojaId: string): Promise<void> {
  for (const cat of CATEGORIAS) {
    await c.query(
      `insert into produtos_categorias (loja_id, nome, slug) values ($1, $2, $3)
       on conflict do nothing`,
      [lojaId, cat.nome, cat.slug],
    );
  }

  for (const p of PRODUTOS) {
    const categoria = await c.query<{ id: string }>(
      "select id from produtos_categorias where loja_id = $1 and slug = $2 and is_deleted = false",
      [lojaId, p.categoria],
    );
    await c.query(
      `insert into produtos (loja_id, categoria_id, nome, sku, tipo_grade, preco)
       values ($1, $2, $3, $4, $5, $6)
       on conflict do nothing`,
      [lojaId, categoria.rows[0]?.id ?? null, p.nome, p.sku, p.grade, p.preco],
    );
    const produto = await c.query<{ id: string }>(
      "select id from produtos where loja_id = $1 and sku = $2 and is_deleted = false",
      [lojaId, p.sku],
    );
    const produtoId = produto.rows[0]?.id;
    if (!produtoId) continue;
    for (const tamanho of p.tamanhos) {
      await c.query(
        `insert into produtos_variacoes (loja_id, produto_id, tamanho, sku)
         values ($1, $2, $3, $4)
         on conflict do nothing`,
        [lojaId, produtoId, tamanho, `${p.sku}-${tamanho}`],
      );
    }
  }
}

async function principal(): Promise<void> {
  abortarSeNaoForLocal();

  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1 });
  const c = await pool.connect();
  try {
    await c.query("begin");
    await semearLojas(c);

    const porSlug = new Map<string, string>();
    for (const l of LOJAS) porSlug.set(l.slug, await idDaLoja(c, l.slug));

    for (const id of porSlug.values()) await semearEtiquetas(c, id);
    await semearIntegracoes(c, porSlug);
    await semearContatos(c, porSlug);
    for (const id of porSlug.values()) await semearCatalogo(c, id);

    await c.query("commit");
    console.log(
      `Semente aplicada: ${LOJAS.length} lojas, ${INTEGRACOES.length} integrações, ` +
        `${CONTATOS.length} contatos, ${PRODUTOS.length} produtos.`,
    );
    console.log("Nenhum usuário foi criado. Para entrar: npm run primeiro-dono -- <e-mail>");
  } catch (erro) {
    await c.query("rollback");
    throw erro;
  } finally {
    c.release();
    await pool.end();
  }
}

void principal().catch((erro: unknown) => {
  console.error(erro);
  process.exit(1);
});
