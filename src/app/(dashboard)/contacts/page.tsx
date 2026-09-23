"use client"

import { useEffect, useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Plus, Search, Pencil, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { SkeletonTable } from "@/components/ui/skeleton"
import { Paginacao } from "@/components/comum/Paginacao"

interface Contact {
  id: string
  name: string | null
  phone: string | null
  email: string | null
  whatsappId: string | null
  instagramId: string | null
  preferredSize: string | null
  tags: string[]
  notes: string | null
  totalOrders: number
  totalSpent: number
  lastContactAt: string | null
}

const sizeOptions = [
  { value: "slim", label: "Slim" },
  { value: "plussize", label: "Plus Size" },
  { value: "both", label: "Ambos" },
]

function ContactForm({
  contact,
  onSave,
  onCancel,
}: {
  contact?: Contact
  onSave: () => void
  onCancel: () => void
}) {
  const [name, setName] = useState(contact?.name || "")
  const [phone, setPhone] = useState(contact?.phone || "")
  const [email, setEmail] = useState(contact?.email || "")
  const [whatsappId, setWhatsappId] = useState(contact?.whatsappId || "")
  const [instagramId, setInstagramId] = useState(contact?.instagramId || "")
  const [preferredSize, setPreferredSize] = useState(contact?.preferredSize || "")
  const [tagsStr, setTagsStr] = useState(contact?.tags?.join(", ") || "")
  const [notes, setNotes] = useState(contact?.notes || "")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    const data = {
      name: name || null,
      phone: phone || null,
      email: email || null,
      whatsappId: whatsappId || null,
      instagramId: instagramId || null,
      preferredSize: preferredSize || null,
      tags: tagsStr ? tagsStr.split(",").map((t) => t.trim()).filter(Boolean) : [],
      notes: notes || null,
    }

    const url = contact ? `/api/contacts/${contact.id}` : "/api/contacts"
    const method = contact ? "PUT" : "POST"

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })

    setLoading(false)

    if (res.ok) {
      toast.success(contact ? "Contato atualizado" : "Contato criado")
      onSave()
    } else {
      toast.error("Erro ao salvar contato")
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Nome</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Telefone</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="5511999999999" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Email</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Preferência de Tamanho</Label>
          <Select value={preferredSize} onValueChange={(v) => setPreferredSize(v || "")}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {sizeOptions.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>WhatsApp ID</Label>
          <Input value={whatsappId} onChange={(e) => setWhatsappId(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Instagram ID</Label>
          <Input value={instagramId} onChange={(e) => setInstagramId(e.target.value)} />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Tags (separadas por vírgula)</Label>
        <Input
          value={tagsStr}
          onChange={(e) => setTagsStr(e.target.value)}
          placeholder="vip, nova, plussize"
        />
      </div>
      <div className="space-y-2">
        <Label>Notas</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
      </div>
      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={loading}>
          {loading ? "Salvando..." : contact ? "Atualizar" : "Criar"}
        </Button>
      </div>
    </form>
  )
}

/** Numero conectado, como `/api/integracoes/numeros` devolve. */
type Numero = {
  id: string
  rotulo: string
  vendedor: { id: string; nome: string } | null
}

/** A vendedora primeiro: e como a equipe chama o numero ("o da Dani"). */
function nomeDoNumero(n: Numero): string {
  return n.vendedor ? n.vendedor.nome : n.rotulo
}

/** As vendedoras que tem numero, sem repetir quem tem mais de um. */
function vendedorasDosNumeros(numeros: Numero[]): { id: string; nome: string }[] {
  const porId = new Map<string, string>()
  for (const n of numeros) {
    if (n.vendedor) porId.set(n.vendedor.id, n.vendedor.nome)
  }
  return Array.from(porId)
    .map(([id, nome]) => ({ id, nome }))
    .sort((a, b) => a.nome.localeCompare(b.nome))
}

const POR_PAGINA = 20

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [filterSize, setFilterSize] = useState("")
  const [filterNumero, setFilterNumero] = useState("")
  const [filterVendedor, setFilterVendedor] = useState("")
  const [numeros, setNumeros] = useState<Numero[]>([])
  const [pagina, setPagina] = useState(1)
  const [total, setTotal] = useState(0)
  const [limite, setLimite] = useState(POR_PAGINA)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingContact, setEditingContact] = useState<Contact | undefined>()

  // Os numeros conectados alimentam os dois filtros: o de numero e o de
  // vendedora, que sai do `vendedor` de cada numero.
  useEffect(() => {
    fetch("/api/integracoes/numeros")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setNumeros(Array.isArray(d) ? d : []))
      .catch(() => setNumeros([]))
  }, [])

  const loadContacts = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (search) params.set("search", search)
    // "all" e o valor do item "Todos" — um Select do Radix nao aceita item de
    // valor vazio. Mandado para a API, ele virava um filtro literal por "all" e
    // a lista voltava vazia.
    if (filterSize && filterSize !== "all") params.set("preferredSize", filterSize)
    if (filterNumero && filterNumero !== "all") params.set("numero", filterNumero)
    if (filterVendedor && filterVendedor !== "all") params.set("vendedor", filterVendedor)
    params.set("page", String(pagina))
    params.set("limit", String(POR_PAGINA))

    const res = await fetch(`/api/contacts?${params}`)
    const data = await res.json()
    setContacts(data.contacts)
    setTotal(data.total ?? 0)
    setLimite(data.limit ?? POR_PAGINA)
    setLoading(false)
  }, [search, filterSize, filterNumero, filterVendedor, pagina])

  useEffect(() => {
    loadContacts()
  }, [loadContacts])

  // Trocar de filtro tem de voltar para a pagina 1: na pagina 4, um filtro mais
  // estreito devolve lista vazia e parece que nao ha contato nenhum.
  useEffect(() => {
    setPagina(1)
  }, [search, filterSize, filterNumero, filterVendedor])

  async function handleDelete(id: string) {
    if (!confirm("Tem certeza que deseja excluir este contato?")) return
    const res = await fetch(`/api/contacts/${id}`, { method: "DELETE" })
    if (res.ok) {
      toast.success("Contato excluído")
      loadContacts()
    }
  }

  function handleEdit(contact: Contact) {
    setEditingContact(contact)
    setDialogOpen(true)
  }

  function handleNew() {
    setEditingContact(undefined)
    setDialogOpen(true)
  }

  function handleSaved() {
    setDialogOpen(false)
    setEditingContact(undefined)
    loadContacts()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Contatos</h1>
          <p className="text-muted-foreground">Clientes da Merlos Store</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <Button onClick={handleNew}>
              <Plus className="mr-2 h-4 w-4" />
              Novo Contato
            </Button>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {editingContact ? "Editar Contato" : "Novo Contato"}
              </DialogTitle>
            </DialogHeader>
            <ContactForm
              contact={editingContact}
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
            placeholder="Buscar por nome, telefone ou email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filterNumero} onValueChange={(v) => setFilterNumero(v || "")}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Número" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os números</SelectItem>
            {numeros.map((n) => (
              <SelectItem key={n.id} value={n.id}>
                {nomeDoNumero(n)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterVendedor} onValueChange={(v) => setFilterVendedor(v || "")}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Vendedora" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as vendedoras</SelectItem>
            {vendedorasDosNumeros(numeros).map((v) => (
              <SelectItem key={v.id} value={v.id}>
                {v.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterSize} onValueChange={(v) => setFilterSize(v || "")}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Tamanho" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {sizeOptions.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <SkeletonTable rows={8} cols={6} />
      ) : (
      <div className="rounded-md border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Telefone</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Tamanho</TableHead>
              <TableHead>Tags</TableHead>
              <TableHead className="text-right">Total Gasto</TableHead>
              <TableHead className="w-24">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contacts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  Nenhum contato encontrado
                </TableCell>
              </TableRow>
            ) : (
              contacts.map((contact) => (
                <TableRow key={contact.id} className="hover:bg-neutral-50/80 transition-colors cursor-pointer">
                  <TableCell className="font-medium">{contact.name || "—"}</TableCell>
                  <TableCell>{contact.phone || "—"}</TableCell>
                  <TableCell>{contact.email || "—"}</TableCell>
                  <TableCell>
                    {contact.preferredSize ? (
                      <Badge variant="outline">
                        {sizeOptions.find((s) => s.value === contact.preferredSize)?.label}
                      </Badge>
                    ) : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {contact.tags?.slice(0, 3).map((tag) => (
                        <Badge key={tag} variant="secondary" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                      {contact.tags?.length > 3 && (
                        <Badge variant="secondary" className="text-xs">
                          +{contact.tags.length - 3}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    R$ {Number(contact.totalSpent).toFixed(2)}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" aria-label="Editar contato" onClick={() => handleEdit(contact)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" aria-label="Excluir contato" onClick={() => handleDelete(contact.id)}>
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
