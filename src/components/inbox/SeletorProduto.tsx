"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Package } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Mandar um produto para a cliente no meio da conversa.
 *
 * O botao existia na barra de midia e so mostrava um aviso: "Seletor de produto
 * (Fase 6)". Era o unico marcador de pendencia que sobrou visivel na interface.
 *
 * Manda TEXTO, nao um card estruturado: WhatsApp, Instagram e Facebook tem
 * formatos de catalogo diferentes e nenhum deles esta implementado nos
 * adapters. Texto com nome, preco, tamanhos disponiveis e link da foto funciona
 * nos quatro canais hoje, e e o que a vendedora escreveria a mao.
 */

type Produto = {
  id: string
  name: string
  sku: string | null
  price: string
  sizes: string[]
  stock: Record<string, number>
  imageUrls: string[]
}

const dinheiro = (v: string) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v))

/** Tamanhos com peca em estoque. Oferecer o que acabou gera troca e frustracao. */
function tamanhosDisponiveis(p: Produto): string[] {
  const estoque = p.stock ?? {}
  return (p.sizes ?? []).filter((t) => Number(estoque[t] ?? 0) > 0)
}

/** O texto que vai para a cliente. */
export function textoDoProduto(p: Produto): string {
  const disponiveis = tamanhosDisponiveis(p)
  const linhas = [`*${p.name}*`, dinheiro(p.price)]

  // Peca SEM grade cadastrada nao e peca sem estoque. Enquanto o catalogo
  // esteve vazio de tamanhos, este texto dizia "sem estoque" para o catalogo
  // inteiro — a vendedora recusava venda de peca que existia. Sem grade, o
  // texto simplesmente nao fala de tamanho.
  if ((p.sizes ?? []).length > 0) {
    linhas.push(
      disponiveis.length > 0
        ? `Tamanhos disponíveis: ${disponiveis.join(", ")}`
        : "No momento sem estoque — posso avisar quando chegar."
    )
  }
  if (p.imageUrls?.[0]) linhas.push(p.imageUrls[0])
  return linhas.join("\n")
}

export function SeletorProduto({
  aberto,
  onFechar,
  onEscolher,
}: {
  aberto: boolean
  onFechar: () => void
  onEscolher: (texto: string) => void
}) {
  const [busca, setBusca] = useState("")
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [carregando, setCarregando] = useState(false)

  useEffect(() => {
    if (!aberto) return
    let vivo = true
    // Debounce: sem ele cada tecla dispara uma consulta e a resposta lenta de
    // um prefixo antigo sobrescreve o resultado do termo completo.
    const timer = setTimeout(async () => {
      setCarregando(true)
      try {
        const params = new URLSearchParams({ limit: "20" })
        if (busca) params.set("search", busca)
        const res = await fetch(`/api/products?${params}`)
        if (!vivo) return
        const d = res.ok ? await res.json() : { products: [] }
        if (vivo) setProdutos(d.products ?? [])
      } finally {
        if (vivo) setCarregando(false)
      }
    }, 250)
    return () => {
      vivo = false
      clearTimeout(timer)
    }
  }, [busca, aberto])

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Enviar produto</DialogTitle>
          <DialogDescription>
            Vai como mensagem de texto com nome, preço e tamanhos em estoque.
          </DialogDescription>
        </DialogHeader>

        <Input
          autoFocus
          value={busca}
          placeholder="Buscar por nome ou SKU..."
          onChange={(e) => setBusca(e.target.value)}
        />

        <ul className="max-h-80 space-y-1 overflow-y-auto">
          {carregando && produtos.length === 0 && (
            <li className="p-4 text-sm text-muted-foreground">Buscando...</li>
          )}
          {!carregando && produtos.length === 0 && (
            <li className="flex flex-col items-center gap-2 p-6 text-center">
              <Package className="h-7 w-7 text-muted-foreground/40" />
              <span className="text-sm text-muted-foreground">
                {busca ? `Nada encontrado para "${busca}".` : "Nenhum produto cadastrado."}
              </span>
            </li>
          )}
          {produtos.map((p) => {
            const disponiveis = tamanhosDisponiveis(p)
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    onEscolher(textoDoProduto(p))
                    onFechar()
                  }}
                  className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-muted"
                >
                  {p.imageUrls?.[0] ? (
                    <Image
                      src={p.imageUrls[0]}
                      alt=""
                      width={44}
                      height={44}
                      className="h-11 w-11 shrink-0 rounded object-cover"
                    />
                  ) : (
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded bg-muted">
                      <Package className="h-4 w-4 text-muted-foreground" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{p.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {dinheiro(p.price)}
                      {p.sku ? ` · ${p.sku}` : ""}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "shrink-0 text-xs",
                      disponiveis.length > 0 ? "text-muted-foreground" : "text-destructive"
                    )}
                  >
                    {disponiveis.length > 0 ? disponiveis.join(" ") : "sem estoque"}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>

        <div className="flex justify-end">
          <Button variant="outline" onClick={onFechar}>
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
