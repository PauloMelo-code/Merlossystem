import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CabecalhoPagina } from "@/components/comum/cabecalho-pagina";
import { Copiar } from "@/components/comum/copiar";
import { Dinheiro } from "@/components/comum/dinheiro";
import { EstadoErro } from "@/components/comum/estado-erro";
import { EstadoVazio } from "@/components/comum/estado-vazio";
import { FaixaAviso } from "@/components/comum/faixa-aviso";
import { SeloStatus } from "@/components/comum/selo-status";
import { Tempo } from "@/components/comum/tempo";
import { verProduto } from "@/lib/actions/catalogo";
import { dataHora } from "@/lib/formato";
import { SeloDisponibilidade } from "../_components/selo-disponibilidade";

export const metadata: Metadata = { title: "Produto" };

const ROTULO_GRADE: Record<string, string> = {
  slim: "Slim (PP a GG)",
  plussize: "Plus size (46 a 58)",
  ambos: "Slim e plus size",
};

/**
 * `/produtos/[id]` — ficha do produto (04-ui.md §5.3): preço, grade com saldo
 * por tamanho e onde foi vendido. `preco_custo` só chega no DTO para dono,
 * admin e gerente. Nada aqui grava.
 */
export default async function PaginaProduto({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const resultado = await verProduto({ id });
  if (!resultado.ok) {
    if (resultado.codigo === "NAO_ENCONTRADO" || resultado.codigo === "VALIDACAO") notFound();
    return <EstadoErro titulo="Não foi possível abrir o produto." descricao={resultado.mensagem} />;
  }
  const { produto, disponiveis, vendas, verCusto } = resultado.dados;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-6">
      <CabecalhoPagina
        titulo={produto.nome}
        descricao={`${produto.lojaNome} · ${ROTULO_GRADE[produto.tipoGrade] ?? produto.tipoGrade}`}
        breadcrumb={[{ rotulo: "Produtos", rota: "/produtos" }, { rotulo: produto.nome }]}
        {...(produto.sku ? { acoes: <Copiar valor={produto.sku} rotulo="Copiar SKU" /> } : {})}
      />

      <FaixaAviso
        tom="info"
        titulo="Dados lidos do Bling (somente leitura)."
        {...(produto.sincronizadoEm
          ? { descricao: `Última alteração recebida: ${dataHora(new Date(produto.sincronizadoEm))}.` }
          : {})}
      />
      {!produto.depositoId ? (
        <FaixaAviso
          tom="aviso"
          titulo="Esta loja não tem depósito do Bling cadastrado."
          descricao="Sem depósito não sabemos o saldo. Peça ao administrador para ligar a loja ao depósito."
        />
      ) : null}

      <section aria-labelledby="valores" className="flex flex-col gap-3">
        <h2 id="valores" className="text-titulo-secao font-semibold">Valores</h2>
        <dl className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-legenda text-muted-foreground">SKU</dt>
            <dd><code className="font-mono">{produto.sku ?? "—"}</code></dd>
          </div>
          <div>
            <dt className="text-legenda text-muted-foreground">Preço</dt>
            <dd><Dinheiro valor={produto.preco} /></dd>
          </div>
          {verCusto ? (
            <div>
              <dt className="text-legenda text-muted-foreground">Custo</dt>
              <dd>{produto.precoCusto ? <Dinheiro valor={produto.precoCusto} /> : "—"}</dd>
            </div>
          ) : null}
        </dl>
        {produto.descricao ? <p className="max-w-prose text-corpo text-muted-foreground">{produto.descricao}</p> : null}
      </section>

      <section aria-labelledby="grade" className="flex flex-col gap-3">
        <h2 id="grade" className="text-titulo-secao font-semibold">Grade e saldo</h2>
        {produto.variacoes.length === 0 ? (
          <EstadoVazio titulo="Nenhum tamanho cadastrado." descricao="A grade chega na próxima sincronização com o Bling." />
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {produto.variacoes.map((v) => {
              const sku = v.sku ?? produto.sku;
              return (
                <li key={v.id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card p-3">
                  <span className="font-medium">{v.tamanho}</span>
                  <SeloDisponibilidade valor={(sku && disponiveis[sku]) || null} />
                </li>
              );
            })}
          </ul>
        )}
        {produto.variacoes.some((v) => !v.sku) ? (
          <p className="text-legenda text-muted-foreground">
            Tamanhos sem SKU próprio no Bling usam o saldo do produto inteiro.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="vendas" className="flex flex-col gap-3">
        <h2 id="vendas" className="text-titulo-secao font-semibold">Onde foi vendido</h2>
        {vendas.length === 0 ? (
          <EstadoVazio titulo="Nenhum pedido com este produto." />
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {vendas.map((v) => (
              <li key={`${v.pedidoId}-${v.tamanho}`} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <Link href={`/pedidos/${v.pedidoId}`} className="font-mono underline-offset-4 hover:underline">
                  {v.numero}
                </Link>
                <span className="text-denso">{v.quantidade} × {v.tamanho}</span>
                <SeloStatus dominio="status_pedido" valor={v.status} />
                <Tempo valor={v.criadoEm} formato="data" className="text-legenda text-muted-foreground" />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
