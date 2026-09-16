"use client";

import Link from "next/link";
import { Dinheiro } from "@/components/comum/dinheiro";
import { EstadoVazio } from "@/components/comum/estado-vazio";
import { TabelaDados, type Coluna } from "@/components/comum/tabela-dados";
import { Tempo } from "@/components/comum/tempo";
import type { LinhaDeProduto } from "@/lib/actions/catalogo";
import { SeloDisponibilidade } from "./selo-disponibilidade";

/** Lista do catálogo (somente leitura). A linha abre pelo link do nome. */
export function TabelaProdutos({
  itens,
  mostrarLoja,
  mostrarSaldo,
  comBusca,
}: {
  itens: LinhaDeProduto[];
  mostrarLoja: boolean;
  mostrarSaldo: boolean;
  comBusca: boolean;
}) {
  const colunas: Coluna<LinhaDeProduto>[] = [
    {
      chave: "nome",
      rotulo: "Produto",
      render: (p) => (
        <Link href={`/produtos/${p.id}`} className="font-medium text-foreground underline-offset-4 hover:underline">
          {p.nome}
        </Link>
      ),
    },
    { chave: "sku", rotulo: "SKU", render: (p) => <code className="font-mono text-denso">{p.sku ?? "—"}</code> },
    ...(mostrarLoja ? [{ chave: "loja", rotulo: "Loja", render: (p: LinhaDeProduto) => p.lojaNome }] : []),
    { chave: "preco", rotulo: "Preço", numerica: true, render: (p) => <Dinheiro valor={p.preco} /> },
    ...(mostrarSaldo
      ? [
          {
            chave: "disponivel",
            rotulo: "Disponível",
            numerica: true,
            render: (p: LinhaDeProduto) => <SeloDisponibilidade valor={p.disponivel} />,
          },
        ]
      : []),
    {
      chave: "sincronizado",
      rotulo: "Lido do Bling",
      render: (p) => (p.sincronizadoEm ? <Tempo valor={p.sincronizadoEm} /> : "—"),
    },
  ];

  return (
    <TabelaDados
      colunas={colunas}
      itens={itens}
      chave={(p) => p.id}
      vazio={
        <EstadoVazio
          titulo={comBusca ? "Nenhum produto com essa busca." : "Nenhum produto no catálogo ainda."}
          descricao={
            comBusca
              ? "Confira a grafia ou busque pelo SKU."
              : "O catálogo chega do Bling pela sincronização. Se a conta do Bling não estiver conectada, fale com o administrador."
          }
          {...(comBusca ? { acao: <Link href="/produtos" className="underline">Limpar busca</Link> } : {})}
        />
      }
      cartaoMobile={(p) => (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link href={`/produtos/${p.id}`} className="font-medium underline-offset-4 hover:underline">
              {p.nome}
            </Link>
            <p className="text-legenda text-muted-foreground">
              <code className="font-mono">{p.sku ?? "—"}</code>
              {mostrarLoja ? ` · ${p.lojaNome}` : ""}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Dinheiro valor={p.preco} />
            {mostrarSaldo ? <SeloDisponibilidade valor={p.disponivel} /> : null}
          </div>
        </div>
      )}
    />
  );
}
