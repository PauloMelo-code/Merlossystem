import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CabecalhoPagina } from "@/components/comum/cabecalho-pagina";
import { Copiar } from "@/components/comum/copiar";
import { Dinheiro } from "@/components/comum/dinheiro";
import { EstadoErro } from "@/components/comum/estado-erro";
import { EstadoVazio } from "@/components/comum/estado-vazio";
import { SeloStatus } from "@/components/comum/selo-status";
import { Tempo } from "@/components/comum/tempo";
import { verPedido } from "@/lib/actions/pedidos";
import { AcoesDoPedido } from "./_components/acoes-do-pedido";

export const metadata: Metadata = { title: "Pedido" };

/** A linha do tempo rotula o evento pelo que ele é (04-ui.md §5.3). */
const ROTULO_EVENTO: Record<string, string> = {
  pedido_criado: "Pedido criado",
  pedido_status_alterado: "Andamento atualizado",
  pedido_cancelado: "Pedido cancelado",
  pedido_lancado_masc: "Lançado no Masc",
  pedido_dispensado_masc: "Dispensado do Masc",
  pedido_voltou_fila_masc: "Voltou para a fila do Masc",
};

/**
 * `/pedidos/[id]` — itens, valores, linha do tempo, rastreio e a ponte com o
 * Masc. SEM aba de pagamento: `pagamentos` está fora do R1 e mostrar "marcar
 * pago" seria fachada (U8).
 */
export default async function PaginaPedido({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const resultado = await verPedido({ id });
  if (!resultado.ok) {
    if (resultado.codigo === "NAO_ENCONTRADO" || resultado.codigo === "VALIDACAO") notFound();
    return <EstadoErro titulo="Não foi possível abrir o pedido." descricao={resultado.mensagem} />;
  }
  const { pedido, eventos, pode } = resultado.dados;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-6">
      <CabecalhoPagina
        titulo={`Pedido ${pedido.numero}`}
        descricao={`${pedido.contatoNome ?? "Cliente sem nome"} · ${pedido.lojaNome}`}
        breadcrumb={[{ rotulo: "Pedidos", rota: "/pedidos" }, { rotulo: pedido.numero }]}
        acoes={<Copiar valor={pedido.numero} rotulo="Copiar número" />}
      />

      <div className="flex flex-wrap items-center gap-2">
        <SeloStatus dominio="status_pedido" valor={pedido.status} />
        <SeloStatus dominio="masc_status" valor={pedido.mascStatus} />
        {pedido.mascVendaId ? (
          <span className="text-denso">
            Venda no Masc <code className="font-mono">{pedido.mascVendaId}</code>
            {pedido.mascLancadoEm ? (
              <>
                {" "}em <Tempo valor={pedido.mascLancadoEm} />
                {pedido.mascLancadoPorNome ? ` por ${pedido.mascLancadoPorNome}` : ""}
              </>
            ) : null}
          </span>
        ) : null}
        {pedido.conversaId ? (
          <Link href={`/conversas/${pedido.conversaId}`} className="text-denso underline">
            Abrir a conversa
          </Link>
        ) : null}
      </div>

      {pedido.canceladoEm ? (
        <p className="text-denso text-perigo">
          Cancelado em <Tempo valor={pedido.canceladoEm} />. Motivo: {pedido.canceladoMotivo}
        </p>
      ) : null}
      {pedido.mascStatus === "dispensado" && pedido.mascObservacao ? (
        <p className="text-denso text-muted-foreground">Dispensado do Masc: {pedido.mascObservacao}</p>
      ) : null}

      <section aria-labelledby="itens" className="flex flex-col gap-3">
        <h2 id="itens" className="text-titulo-secao font-semibold">Itens</h2>
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {pedido.itens.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div className="min-w-0">
                <Link href={`/produtos/${item.produtoId}`} className="font-medium underline-offset-4 hover:underline">
                  {item.nome}
                </Link>
                <p className="text-legenda text-muted-foreground">
                  Tamanho {item.tamanho}
                  {item.sku ? <> · <code className="font-mono">{item.sku}</code></> : null}
                </p>
              </div>
              <span className="text-denso tabular-nums">
                {item.quantidade} × <Dinheiro valor={item.precoUnitario} />
              </span>
              <Dinheiro valor={item.totalItem} className="font-medium" />
            </li>
          ))}
        </ul>
        <dl className="ml-auto grid w-full max-w-xs grid-cols-2 gap-1 text-denso">
          <dt>Produtos</dt>
          <dd className="text-right"><Dinheiro valor={pedido.subtotal} /></dd>
          <dt>Frete</dt>
          <dd className="text-right"><Dinheiro valor={pedido.frete} /></dd>
          <dt>Desconto</dt>
          <dd className="text-right">− <Dinheiro valor={pedido.desconto} /></dd>
          <dt className="font-semibold">Total</dt>
          <dd className="text-right font-semibold"><Dinheiro valor={pedido.total} /></dd>
        </dl>
        {pedido.rastreioCodigo ? (
          <p className="text-denso">
            Rastreio <code className="font-mono">{pedido.rastreioCodigo}</code>
            {pedido.rastreioUrl ? (
              <>
                {" · "}
                <a href={pedido.rastreioUrl} target="_blank" rel="noopener noreferrer" className="underline">
                  acompanhar entrega
                </a>
              </>
            ) : null}
          </p>
        ) : null}
        {pedido.observacoes ? <p className="text-denso text-muted-foreground">{pedido.observacoes}</p> : null}
      </section>

      <AcoesDoPedido
        pedido={{
          id: pedido.id,
          lojaId: pedido.lojaId,
          numero: pedido.numero,
          total: pedido.total,
          status: pedido.status,
          mascStatus: pedido.mascStatus,
          rastreioCodigo: pedido.rastreioCodigo,
          rastreioUrl: pedido.rastreioUrl,
          entregaMetodo: pedido.entregaMetodo,
          atualizadoEm: new Date(pedido.atualizadoEm).toISOString(),
        }}
        pode={pode}
      />

      <section aria-labelledby="linha-do-tempo" className="flex flex-col gap-3">
        <h2 id="linha-do-tempo" className="text-titulo-secao font-semibold">Linha do tempo</h2>
        {eventos.length === 0 ? (
          <EstadoVazio titulo="Nenhum evento registrado." />
        ) : (
          <ol className="flex flex-col gap-2">
            {eventos.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-2 text-denso">
                <Tempo valor={e.criadoEm} className="tabular-nums text-muted-foreground" />
                <span className="font-medium">{ROTULO_EVENTO[e.acao] ?? e.acao}</span>
                <span className="text-muted-foreground">
                  {e.atorTipo === "usuario" ? (e.atorNome ?? "Pessoa removida") : "Sistema"}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
