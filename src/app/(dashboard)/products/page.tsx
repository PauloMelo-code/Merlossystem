"use client"

import { useEffect, useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Plus, Search, Pencil, Trash2, Image as ImageIcon } from "lucide-react"
import { toast } from "sonner"
import { Paginacao } from "@/components/comum/Paginacao"
import { SkeletonTable } from "@/components/ui/skeleton"

interface Product {
  id: string
  name: string
  sku: string | null
  description: string | null
  category: string | null
  sizeType: string
  sizes: string[]
  price: number
  compareAtPrice: number | null
  costPrice: number | null
  stock: Record<string, number>
  imageUrls: string[]
  active: boolean
  featured: boolean
}

const POR_PAGINA = 20

const categories = [
  { value: "vestidos", label: "Vestidos" },
  { value: "blusas", label: "Blusas" },
  { value: "calcas", label: "Calças" },
  { value: "saias", label: "Saias" },
  { value: "shorts", label: "Shorts" },
  { value: "conjuntos", label: "Conjuntos" },
  { value: "macacoes", label: "Macacões" },
  { value: "jaquetas", label: "Jaquetas" },
  { value: "acessorios", label: "Acessórios" },
]

/**
 * Rotulo da categoria de um produto.
 *
 * A lista acima e a taxonomia que a equipe digitava antes de o catalogo vir do
 * Bling. A categoria sincronizada e a do Bling — texto livre, que quase nunca
 * cai nesses nove valores. O `|| "—"` que existia aqui fazia TODO produto
 * importado aparecer sem categoria, como se a sincronizacao nao a tivesse
 * trazido.
 */
function rotuloDaCategoria(valor: string | null | undefined): string {
  if (!valor) return "—"
  return categories.find((c) => c.value === valor)?.label ?? valor
}

/**
 * As categorias que o seletor oferece — SO as que tem produto.
 *
 * A lista fixa de nove ficou de fora de proposito: com o catalogo vindo do
 * Bling, nenhuma delas tem produto, e o seletor mostrava 21 opcoes das quais
 * 9 nao levavam a lugar nenhum. Ela continua servindo de rotulo bonito em
 * `rotuloDaCategoria`, para produto antigo gravado com um daqueles valores.
 */
function opcoesDeCategoria(...presentes: (string | null | undefined)[]) {
  const opcoes = new Map<string, string>()
  for (const valor of presentes) {
    if (valor) opcoes.set(valor, rotuloDaCategoria(valor))
  }
  return Array.from(opcoes)
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"))
}

const sizeTypes = [
  { value: "slim", label: "Slim" },
  { value: "plussize", label: "Plus Size" },
  { value: "both", label: "Ambos" },
]

const defaultSizes: Record<string, string[]> = {
  slim: ["PP", "P", "M", "G", "GG"],
  plussize: ["46", "48", "50", "52", "54", "56", "58"],
  both: ["PP", "P", "M", "G", "GG", "46", "48", "50", "52", "54", "56", "58"],
}

/**
 * O quadradinho da foto na lista, como o Bling mostra.
 *
 * `<img>` cru, e nao `next/image`: a foto vem assinada do S3 do Bling, com
 * dominio e query que mudam a cada sincronizacao — o otimizador do Next exige
 * dominio liberado em configuracao e cairia para todo produto. Peca sem foto
 * fica com o quadro vazio, que e informacao: mostra de relance quanto do
 * catalogo ainda nao tem imagem.
 */
function MiniaturaDoProduto({ produto }: { produto: Product }) {
  const foto = produto.imageUrls?.[0]
  if (!foto) {
    return (
      <div className="flex h-12 w-12 items-center justify-center rounded-md border border-dashed border-neutral-200 bg-neutral-50">
        <ImageIcon className="h-4 w-4 text-neutral-300" />
      </div>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={foto}
      alt={produto.name}
      loading="lazy"
      className="h-12 w-12 rounded-md border border-neutral-200 object-cover"
      // Link assinado expira: quando expirar, o quadro vazio aparece de novo em
      // vez de um icone de imagem quebrada.
      onError={(e) => {
        e.currentTarget.style.display = "none"
      }}
    />
  )
}

function ProductForm({
  product,
  categoriasDoCatalogo,
  onSave,
  onCancel,
}: {
  product?: Product
  categoriasDoCatalogo: string[]
  onSave: () => void
  onCancel: () => void
}) {
  const [name, setName] = useState(product?.name || "")
  const [sku, setSku] = useState(product?.sku || "")
  const [description, setDescription] = useState(product?.description || "")
  const [category, setCategory] = useState(product?.category || "")
  const [sizeType, setSizeType] = useState(product?.sizeType || "both")
  const [price, setPrice] = useState(product?.price?.toString() || "")
  const [compareAtPrice, setCompareAtPrice] = useState(
    product?.compareAtPrice?.toString() || ""
  )
  const [active, setActive] = useState(product?.active ?? true)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    const data = {
      name,
      sku: sku || null,
      description: description || null,
      category: category || null,
      sizeType,
      sizes: defaultSizes[sizeType] || [],
      price: parseFloat(price),
      compareAtPrice: compareAtPrice ? parseFloat(compareAtPrice) : null,
      stock: {},
      active,
    }

    const url = product ? `/api/products/${product.id}` : "/api/products"
    const method = product ? "PUT" : "POST"

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })

    setLoading(false)

    if (res.ok) {
      toast.success(product ? "Produto atualizado" : "Produto criado")
      onSave()
    } else {
      toast.error("Erro ao salvar produto")
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Nome *</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label>SKU</Label>
          <Input value={sku} onChange={(e) => setSku(e.target.value)} />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Descrição</Label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
        />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label>Categoria</Label>
          <Select value={category} onValueChange={(v) => setCategory(v || "")}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {/* A categoria vinda do Bling entra na lista: sem ela o campo
                  abria vazio e salvar apagava a categoria do produto. */}
              {opcoesDeCategoria(...categoriasDoCatalogo, product?.category, category).map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Tipo de Tamanho</Label>
          <Select value={sizeType} onValueChange={(v) => setSizeType(v || "both")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sizeTypes.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Status</Label>
          <Select
            value={active ? "active" : "inactive"}
            onValueChange={(v) => setActive((v || "active") === "active")}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Ativo</SelectItem>
              <SelectItem value="inactive">Inativo</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Preço (R$) *</Label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label>Preço Anterior (R$)</Label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={compareAtPrice}
            onChange={(e) => setCompareAtPrice(e.target.value)}
          />
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={loading}>
          {loading ? "Salvando..." : product ? "Atualizar" : "Criar"}
        </Button>
      </div>
    </form>
  )
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [filterCategory, setFilterCategory] = useState("")
  const [filterSizeType, setFilterSizeType] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | undefined>()

  const [pagina, setPagina] = useState(1)
  const [total, setTotal] = useState(0)
  const [limite, setLimite] = useState(POR_PAGINA)
  // As categorias que existem no catalogo inteiro, nao so na pagina visivel.
  const [categoriasDoCatalogo, setCategoriasDoCatalogo] = useState<string[]>([])

  const loadProducts = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set("page", String(pagina))
    params.set("limit", String(POR_PAGINA))
    if (search) params.set("search", search)
    // "all" e o valor do item "Todas" do seletor — um Select do Radix nao
    // aceita item de valor vazio. Mandar esse "all" para a API filtrava pela
    // categoria literal "all" e a tela ficava sem produto nenhum.
    if (filterCategory && filterCategory !== "all") params.set("category", filterCategory)
    if (filterSizeType && filterSizeType !== "all") params.set("sizeType", filterSizeType)

    const res = await fetch(`/api/products?${params}`)
    const data = await res.json()
    setProducts(data.products)
    setTotal(data.total ?? 0)
    setLimite(data.limit ?? POR_PAGINA)
    if (Array.isArray(data.categorias)) setCategoriasDoCatalogo(data.categorias)
    setLoading(false)
  }, [search, filterCategory, filterSizeType, pagina])

  useEffect(() => {
    loadProducts()
  }, [loadProducts])

  // Trocar de filtro volta para a pagina 1: na pagina 8, um filtro mais estreito
  // devolve lista vazia e parece que o filtro nao encontrou nada.
  useEffect(() => {
    setPagina(1)
  }, [search, filterCategory, filterSizeType])

  async function handleDelete(id: string) {
    if (!confirm("Tem certeza que deseja excluir este produto?")) return

    const res = await fetch(`/api/products/${id}`, { method: "DELETE" })
    if (res.ok) {
      toast.success("Produto excluído")
      loadProducts()
    }
  }

  function handleEdit(product: Product) {
    setEditingProduct(product)
    setDialogOpen(true)
  }

  function handleNew() {
    setEditingProduct(undefined)
    setDialogOpen(true)
  }

  function handleSaved() {
    setDialogOpen(false)
    setEditingProduct(undefined)
    loadProducts()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Produtos</h1>
          <p className="text-muted-foreground">Catálogo de produtos da Merlos Store</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <Button onClick={handleNew}>
              <Plus className="mr-2 h-4 w-4" />
              Novo Produto
            </Button>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {editingProduct ? "Editar Produto" : "Novo Produto"}
              </DialogTitle>
            </DialogHeader>
            <ProductForm
              product={editingProduct}
              categoriasDoCatalogo={categoriasDoCatalogo}
              onSave={handleSaved}
              onCancel={() => setDialogOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou SKU..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filterCategory} onValueChange={(v) => setFilterCategory(v || "")}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Categoria" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            {/* Todas as categorias do catalogo, vindas da API — nao as da
                pagina visivel. Com 569 pecas em 12 categorias, derivar as
                opcoes do que esta na tela deixava quase todas inalcancaveis. */}
            {opcoesDeCategoria(...categoriasDoCatalogo).map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterSizeType} onValueChange={(v) => setFilterSizeType(v || "")}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Tamanho" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {sizeTypes.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <SkeletonTable rows={8} cols={7} />
      ) : (
      <div className="rounded-md border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Imagem</TableHead>
              <TableHead>Nome</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="text-right">Preço</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-24">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  Nenhum produto encontrado
                </TableCell>
              </TableRow>
            ) : (
              products.map((product) => (
                <TableRow key={product.id} className="hover:bg-neutral-50/80 transition-colors cursor-pointer">
                  <TableCell>
                    <MiniaturaDoProduto produto={product} />
                  </TableCell>
                  <TableCell className="font-medium">{product.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {product.sku || "—"}
                  </TableCell>
                  <TableCell>
                    {rotuloDaCategoria(product.category)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {sizeTypes.find((s) => s.value === product.sizeType)?.label}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    R$ {Number(product.price).toFixed(2)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={product.active ? "default" : "secondary"}>
                      {product.active ? "Ativo" : "Inativo"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Editar produto"
                        onClick={() => handleEdit(product)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Excluir produto"
                        onClick={() => handleDelete(product.id)}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <Paginacao
          pagina={pagina}
          limite={limite}
          total={total}
          carregando={loading}
          onMudar={setPagina}
        />
      </div>
      )}
    </div>
  )
}
