"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Dinheiro } from "@/components/comum/dinheiro";
import { Input } from "@/components/ui/input";
import { buscarProdutosParaVenda } from "@/lib/actions/catalogo";
import type { ResultadoDeBusca } from "@/lib/catalogo/_consultas";

/**
 * COSTURA — dono: M4, dentro da pasta de M1 (05-plano-construcao.md §5).
 *
 * Busca de produto por nome ou SKU (04-ui.md §8.2): 2+ caracteres, espera de
 * 250 ms e descarte da resposta atrasada. `onEscolher` devolve o SKU; quem
 * monta o item de pedido é quem chamou. O seletor não grava nada — a mesma
 * busca serve a "mandar produto" e a "gerar pedido".
 *
 * `lojaId` é opcional: vendedor e viewer buscam na loja do cadastro; gestão
 * precisa dizer em qual loja está atendendo.
 */

export type SeletorProdutoProps = {
  onEscolher: (sku: string) => void;
  lojaId?: string;
};

const ESPERA_MS = 250;

type Estado =
  | { tipo: "ocioso" }
  | { tipo: "carregando" }
  | { tipo: "pronto"; itens: ResultadoDeBusca[] }
  | { tipo: "erro"; mensagem: string };

export function SeletorProduto({ onEscolher, lojaId }: SeletorProdutoProps) {
  const [termo, setTermo] = useState("");
  const [estado, setEstado] = useState<Estado>({ tipo: "ocioso" });
  const sequencia = useRef(0);

  useEffect(() => {
    const limpo = termo.trim();
    const minha = ++sequencia.current;
    if (limpo.length < 2) return;
    const relogio = window.setTimeout(async () => {
      setEstado({ tipo: "carregando" });
      const r = await buscarProdutosParaVenda({ termo: limpo, ...(lojaId ? { loja: lojaId } : {}) });
      // Resposta atrasada de uma busca antiga não sobrescreve a atual.
      if (minha !== sequencia.current) return;
      setEstado(r.ok ? { tipo: "pronto", itens: r.dados } : { tipo: "erro", mensagem: r.mensagem });
    }, ESPERA_MS);
    return () => window.clearTimeout(relogio);
  }, [termo, lojaId]);

  const curto = termo.trim().length < 2;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="busca-produto" className="text-denso font-medium">
        Buscar produto
      </label>
      <div className="relative">
        <Search aria-hidden="true" className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="busca-produto"
          type="search"
          value={termo}
          placeholder="Nome ou SKU"
          className="pl-8"
          autoComplete="off"
          onChange={(e) => setTermo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !curto && estado.tipo === "pronto" && estado.itens[0]) {
              e.preventDefault();
              onEscolher(estado.itens[0].sku);
            }
          }}
        />
      </div>

      <div aria-live="polite" className="text-denso">
        {curto ? (
          <p className="text-muted-foreground">Digite ao menos 2 letras.</p>
        ) : estado.tipo === "carregando" ? (
          <p className="text-muted-foreground">Buscando…</p>
        ) : estado.tipo === "erro" ? (
          <p role="alert" className="text-perigo">{estado.mensagem}</p>
        ) : estado.tipo === "pronto" && estado.itens.length === 0 ? (
          <p className="text-muted-foreground">
            Nenhum produto para &quot;{termo.trim()}&quot;. Confira a grafia ou busque pelo SKU.
          </p>
        ) : null}
      </div>

      {!curto && estado.tipo === "pronto" && estado.itens.length > 0 ? (
        <ul className="flex max-h-64 flex-col divide-y divide-border overflow-y-auto rounded-md border border-border">
          {estado.itens.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onEscolher(item.sku)}
                className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{item.nome}</span>
                  <code className="font-mono text-legenda text-muted-foreground">{item.sku}</code>
                </span>
                <Dinheiro valor={item.preco} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
