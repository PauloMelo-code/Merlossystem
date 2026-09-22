"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "sonner"

/**
 * Numero de WhatsApp (uazapi) criado por aqui, e a vendedora dona dele.
 *
 * Antes, conectar um numero exigia ir ao painel do uazapi, criar a instancia,
 * copiar o token, voltar, colar no formulario e configurar o webhook la — e o
 * webhook esquecido deixava o numero mudo, sem erro nenhum na tela. A rota
 * `POST /api/integracoes/uazapi` faz os tres passos.
 *
 * A vendedora dona do numero recebe automaticamente a conversa que entrar por
 * ele. Trocar a dona vale das proximas conversas em diante: as que ja existem
 * continuam com quem as atendeu.
 */

export type Pessoa = { id: string; name: string; role: string }

/** Quem pode ser dona de um numero: quem atende. */
const ATENDE = ["vendedor", "gerente", "admin"]

/** Nome em ingles por exigencia do React: hook precisa comecar com "use". */
export function usePessoas(): Pessoa[] {
  const [pessoas, setPessoas] = useState<Pessoa[]>([])
  useEffect(() => {
    fetch("/api/usuarios")
      .then((r) => (r.ok ? r.json() : []))
      .then((d: Pessoa[]) => setPessoas(d.filter((p) => ATENDE.includes(p.role))))
      .catch(() => setPessoas([]))
  }, [])
  return pessoas
}

export function SeletorDeVendedora({
  integracaoId,
  vendedorId,
  pessoas,
  onTrocado,
}: {
  integracaoId: string
  vendedorId: string | null
  pessoas: Pessoa[]
  onTrocado: () => void
}) {
  const [salvando, setSalvando] = useState(false)

  async function trocar(novo: string) {
    setSalvando(true)
    try {
      const res = await fetch(`/api/integracoes/${integracaoId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendedorId: novo === "" ? null : novo }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(d.error || "Não foi possível definir a responsável.")
        return
      }
      toast.success(novo === "" ? "Número sem dona." : "Número vinculado.")
      onTrocado()
    } finally {
      setSalvando(false)
    }
  }

  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">Vendedora do número:</span>
      <select
        value={vendedorId ?? ""}
        disabled={salvando}
        onChange={(e) => trocar(e.target.value)}
        className="h-8 rounded-md border border-input bg-background px-2 text-sm"
      >
        <option value="">Ninguém (a conversa entra sem dono)</option>
        {pessoas.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  )
}

export function CriarNumero({
  pessoas,
  onCriado,
}: {
  pessoas: Pessoa[]
  onCriado: (id: string) => void
}) {
  const [aberto, setAberto] = useState(false)
  const [rotulo, setRotulo] = useState("")
  const [vendedorId, setVendedorId] = useState("")
  const [criando, setCriando] = useState(false)

  async function criar() {
    if (!rotulo.trim()) {
      toast.error("Dê um apelido ao número, por exemplo o nome da vendedora.")
      return
    }
    setCriando(true)
    try {
      const res = await fetch("/api/integracoes/uazapi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rotulo: rotulo.trim(),
          vendedorId: vendedorId === "" ? null : vendedorId,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(d.error || "Não foi possível criar o número.")
        return
      }
      toast.success("Número criado. Agora leia o QR code no celular.")
      setAberto(false)
      setRotulo("")
      setVendedorId("")
      onCriado(d.id)
    } finally {
      setCriando(false)
    }
  }

  return (
    <>
      <Button onClick={() => setAberto(true)}>Criar número de WhatsApp</Button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Criar número de WhatsApp</DialogTitle>
            <DialogDescription>
              O sistema cria a instância no uazapi e configura o webhook sozinho.
              Depois é só ler o QR code no celular do número.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="rotulo-numero">Apelido do número</Label>
              <Input
                id="rotulo-numero"
                value={rotulo}
                placeholder="ex.: WhatsApp da Ana"
                onChange={(e) => setRotulo(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="vendedora-numero">Vendedora do número</Label>
              <select
                id="vendedora-numero"
                value={vendedorId}
                onChange={(e) => setVendedorId(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Ninguém (a conversa entra sem dono)</option>
                {pessoas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Toda conversa que entrar por este número já nasce com ela.
              </p>
            </div>

            <p className="text-xs text-amber-700">
              O uazapi não é a API oficial do WhatsApp. O número pode ser bloqueado
              pela Meta.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button onClick={criar} disabled={criando}>
              {criando ? "Criando..." : "Criar e mostrar o QR"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
