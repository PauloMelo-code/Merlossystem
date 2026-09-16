"use client";

import Link from "next/link";
import { Dinheiro } from "@/components/comum/dinheiro";
import { EstadoVazio } from "@/components/comum/estado-vazio";
import { SeloStatus } from "@/components/comum/selo-status";
import { TabelaDados, type Coluna } from "@/components/comum/tabela-dados";
import { Tempo } from "@/components/comum/tempo";
import type { PedidoDaLista } from "@/lib/pedidos/_consultas";

/** Lista de pedidos. O número é o link; `masc_status` em destaque (§5.3). */
export function TabelaPedidos({
  itens,
  mostrarLoja,
  naFila,
  comFiltro,
}: {
  itens: PedidoDaLista[];
  mostrarLoja: boolean;
  naFila: boolean;
  comFiltro: boolean;
}) {
  const colunas: Coluna<PedidoDaLista>[] = [
    {
      chave: "numero",
      rotulo: "Pedido",
      render: (p) => (
        <Link href={`/pedidos/${p.id}`} className="font-mono font-medium underline-offset-4 hover:underline">
          {p.numero}
        </Link>
      ),
    },
    { chave: "contato", rotulo: "Cliente", render: (p) => p.contatoNome ?? "Sem nome" },
    ...(mostrarLoja ? [{ chave: "loja", rotulo: "Loja", render: (p: PedidoDaLista) => p.lojaNome }] : []),
    {
      chave: "masc",
      rotulo: "Masc",
      render: (p) => (
        <span className="inline-flex flex-col gap-0.5">
          <SeloStatus dominio="masc_status" valor={p.mascStatus} />
          {p.mascVendaId ? <code className="font-mono text-legenda">nº {p.mascVendaId}</code> : null}
        </span>
      ),
    },
    { chave: "status", rotulo: "Status", render: (p) => <SeloStatus dominio="status_pedido" valor={p.status} /> },
    { chave: "total", rotulo: "Total", numerica: true, render: (p) => <Dinheiro valor={p.total} /> },
    { chave: "criado", rotulo: "Criado", render: (p) => <Tempo valor={p.criadoEm} /> },
  ];

  const vazio = naFila ? (
    <EstadoVazio titulo="Todos os pedidos foram lançados no Masc." />
  ) : comFiltro ? (
    <EstadoVazio
      titulo="Nenhum pedido com esses filtros."
      acao={
        <Link href="/pedidos?masc=todos" className="underline">
          Limpar filtros
        </Link>
      }
    />
  ) : (
    <EstadoVazio titulo="Nenhum pedido ainda." descricao="Pedidos nascem em Nova venda, dentro da conversa." />
  );

  return (
    <TabelaDados
      colunas={colunas}
      itens={itens}
      chave={(p) => p.id}
      vazio={vazio}
      cartaoMobile={(p) => (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <Link href={`/pedidos/${p.id}`} className="font-mono font-medium underline-offset-4 hover:underline">
              {p.numero}
            </Link>
            <Dinheiro valor={p.total} />
          </div>
          <p className="text-denso">
            {p.contatoNome ?? "Sem nome"}
            {mostrarLoja ? ` · ${p.lojaNome}` : ""}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <SeloStatus dominio="masc_status" valor={p.mascStatus} />
            <SeloStatus dominio="status_pedido" valor={p.status} />
          </div>
        </div>
      )}
    />
  );
}
