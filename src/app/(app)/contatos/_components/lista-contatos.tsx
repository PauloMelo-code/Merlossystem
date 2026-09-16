"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, Tag } from "lucide-react";
import { toast } from "sonner";
import { AvatarContato } from "@/components/comum/avatar-contato";
import { CLASSES_DE_TOM } from "@/components/comum/selo-status";
import { TabelaDados, type Coluna } from "@/components/comum/tabela-dados";
import { Tempo } from "@/components/comum/tempo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { etiquetarContatos, exportarContatosCsv } from "@/lib/actions/contatos";
import { telefone } from "@/lib/formato";
import { baixarArquivo, hojeParaArquivo } from "./baixar";

/**
 * Tabela da carteira (04-ui.md §5.3). Seleção em massa existe SÓ para
 * etiquetar — não há exclusão em massa no R1 (§15, R-03).
 *
 * Em "Todas as lojas" a seleção some: etiqueta é por loja, e etiquetar em massa
 * contatos de duas lojas seria gravar sem loja resolvida (INV-05).
 */

export type ItemCarteira = {
  id: string;
  lojaId: string;
  lojaNome: string | null;
  nome: string | null;
  telefone: string | null;
  email: string | null;
  canal: string | null;
  optOut: boolean;
  ultimoContatoEm: string | null;
  pedidosContagem: number;
  anonimizado: boolean;
};

export interface ListaContatosProps {
  itens: readonly ItemCarteira[];
  variasLojas: boolean;
  etiquetas: readonly { id: string; nome: string }[];
  podeEtiquetar: boolean;
  vazio: React.ReactNode;
}

function nomeDe(item: ItemCarteira): string {
  return item.nome ?? (item.telefone ? telefone(item.telefone) : (item.email ?? "Sem nome"));
}

function SeloOptOut() {
  const tom = CLASSES_DE_TOM.aviso;
  return (
    <Badge variant="outline" className={`${tom.fundo} ${tom.texto} ${tom.borda}`}>
      Não quer promoções
    </Badge>
  );
}

export function ListaContatos({ itens, variasLojas, etiquetas, podeEtiquetar, vazio }: ListaContatosProps) {
  const router = useRouter();
  const parametros = useSearchParams();
  const [selecionados, setSelecionados] = useState<ReadonlySet<string>>(new Set());
  const [etiquetaEmMassa, setEtiquetaEmMassa] = useState<string>("");
  const [exportando, iniciarExportacao] = useTransition();
  const [etiquetando, iniciarEtiquetagem] = useTransition();

  const colunas: Coluna<ItemCarteira>[] = [
    {
      chave: "nome",
      rotulo: "Contato",
      render: (item) => (
        <Link href={`/contatos/${item.id}`} className="inline-flex items-center gap-2 font-medium hover:underline">
          <AvatarContato nome={nomeDe(item)} canal={item.canal} tamanho="pequeno" />
          {nomeDe(item)}
        </Link>
      ),
    },
    {
      chave: "telefone",
      rotulo: "Telefone",
      render: (item) => (item.telefone ? <span className="tabular-nums">{telefone(item.telefone)}</span> : "—"),
    },
    ...(variasLojas
      ? [{ chave: "loja", rotulo: "Loja", render: (item: ItemCarteira) => item.lojaNome ?? "—" }]
      : []),
    {
      chave: "promocoes",
      rotulo: "Promoções",
      render: (item) => (item.optOut ? <SeloOptOut /> : <span className="text-muted-foreground">Aceita</span>),
    },
    {
      chave: "ultimoContato",
      rotulo: "Último contato",
      render: (item) => (item.ultimoContatoEm ? <Tempo valor={item.ultimoContatoEm} formato="lista" /> : "—"),
    },
    { chave: "pedidos", rotulo: "Pedidos", numerica: true, render: (item) => item.pedidosContagem },
  ];

  const selecaoLigada = podeEtiquetar && !variasLojas;

  function alternar(id: string) {
    setSelecionados((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }

  function exportar() {
    iniciarExportacao(async () => {
      const r = await exportarContatosCsv(Object.fromEntries(parametros.entries()));
      if (!r.ok) {
        toast.error(r.mensagem);
        return;
      }
      baixarArquivo(`contatos-${hojeParaArquivo()}.csv`, r.dados.csv, "text/csv;charset=utf-8");
      toast.success(`${r.dados.quantidade} contatos exportados.`);
    });
  }

  function etiquetar() {
    if (!etiquetaEmMassa) return;
    const loja = itens.find((i) => selecionados.has(i.id))?.lojaId;
    iniciarEtiquetagem(async () => {
      const r = await etiquetarContatos({
        contatoIds: [...selecionados],
        etiquetaId: etiquetaEmMassa,
        ...(loja ? { loja } : {}),
      });
      if (!r.ok) {
        toast.error(r.mensagem);
        return;
      }
      toast.success(
        r.dados.jaTinham > 0
          ? `${r.dados.etiquetados} etiquetados; ${r.dados.jaTinham} já tinham a etiqueta.`
          : `${r.dados.etiquetados} contatos etiquetados.`,
      );
      setSelecionados(new Set());
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button type="button" variant="outline" size="sm" onClick={exportar} disabled={exportando} aria-busy={exportando}>
          <Download aria-hidden="true" strokeWidth={2} />
          {exportando ? "Exportando…" : "Exportar CSV da lista filtrada"}
        </Button>
      </div>

      <TabelaDados
        colunas={colunas}
        itens={itens}
        chave={(item) => item.id}
        vazio={vazio}
        {...(selecaoLigada
          ? {
              selecao: {
                selecionados,
                onAlternar: alternar,
                onAlternarTodos: () =>
                  setSelecionados((atual) =>
                    atual.size === itens.length ? new Set() : new Set(itens.map((i) => i.id)),
                  ),
              },
              acoesEmMassa: (
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={etiquetaEmMassa} onValueChange={setEtiquetaEmMassa}>
                    <SelectTrigger size="sm" aria-label="Etiqueta para aplicar" className="w-44">
                      <SelectValue placeholder="Escolha a etiqueta" />
                    </SelectTrigger>
                    <SelectContent>
                      {etiquetas.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    size="sm"
                    onClick={etiquetar}
                    disabled={!etiquetaEmMassa || etiquetando}
                    aria-busy={etiquetando}
                  >
                    <Tag aria-hidden="true" strokeWidth={2} />
                    Etiquetar
                  </Button>
                </div>
              ),
            }
          : {})}
        cartaoMobile={(item) => (
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <Link href={`/contatos/${item.id}`} className="font-medium hover:underline">
                {nomeDe(item)}
              </Link>
              <span className="text-legenda text-muted-foreground tabular-nums">
                {item.telefone ? telefone(item.telefone) : (item.email ?? "")}
              </span>
              {item.optOut ? <SeloOptOut /> : null}
            </div>
            {item.ultimoContatoEm ? (
              <Tempo valor={item.ultimoContatoEm} formato="lista" className="text-legenda text-texto-terciario" />
            ) : null}
          </div>
        )}
      />
    </div>
  );
}
