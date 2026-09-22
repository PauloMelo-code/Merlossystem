"use client"

import { useEffect, useRef, useState } from "react"
import { useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { Camera, Loader2 } from "lucide-react"

/**
 * Minha conta: foto, nome e senha.
 *
 * O menu já tinha "Meu Perfil", mas não levava a lugar nenhum: trocar a senha
 * dependia do administrador, o que na prática vira senha combinada no grupo.
 * Aqui a própria pessoa resolve, e a senha atual é sempre exigida — uma sessão
 * esquecida aberta no balcão não pode trocar a senha de quem a deixou aberta.
 *
 * Papel e loja NÃO aparecem como campo: são de administração. Ficam à mostra
 * só para a pessoa saber com que acesso está.
 */

type Perfil = {
  id: string
  name: string
  email: string
  role: string
  avatarUrl: string | null
  store: { id: string; nome: string } | null
}

const PAPEL: Record<string, string> = {
  admin: "Administrador",
  gerente: "Gerente",
  vendedor: "Vendedora",
  viewer: "Observador",
}

export default function PerfilPage() {
  const { update: atualizarSessao } = useSession()
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [nome, setNome] = useState("")
  const [salvandoNome, setSalvandoNome] = useState(false)
  const [enviandoFoto, setEnviandoFoto] = useState(false)
  const [senhaAtual, setSenhaAtual] = useState("")
  const [novaSenha, setNovaSenha] = useState("")
  const [repetida, setRepetida] = useState("")
  const [trocandoSenha, setTrocandoSenha] = useState(false)
  const arquivoRef = useRef<HTMLInputElement>(null)

  async function carregar() {
    const res = await fetch("/api/perfil")
    if (!res.ok) return
    const d: Perfil = await res.json()
    setPerfil(d)
    setNome(d.name ?? "")
  }

  useEffect(() => {
    void carregar()
  }, [])

  async function salvar(corpo: Record<string, unknown>): Promise<boolean> {
    const res = await fetch("/api/perfil", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(d.error || "Não foi possível salvar.")
      return false
    }
    setPerfil((p) => (p ? { ...p, ...d } : d))
    // A sessão guarda nome e foto: sem atualizar, o canto da tela fica velho
    // até o próximo login.
    await atualizarSessao?.()
    return true
  }

  async function trocarFoto(arquivo: File) {
    if (!arquivo.type.startsWith("image/")) {
      toast.error("Escolha uma imagem.")
      return
    }
    setEnviandoFoto(true)
    try {
      const form = new FormData()
      form.append("file", arquivo)
      form.append("folder", "avatars")
      const res = await fetch("/api/media/upload", { method: "POST", body: form })
      const midia = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(midia.error || "Não foi possível enviar a foto.")
        return
      }
      if (await salvar({ avatarMediaId: midia.id })) toast.success("Foto atualizada.")
    } finally {
      setEnviandoFoto(false)
      if (arquivoRef.current) arquivoRef.current.value = ""
    }
  }

  async function trocarSenha() {
    if (novaSenha !== repetida) {
      toast.error("A nova senha e a repetição não conferem.")
      return
    }
    if (novaSenha.length < 8) {
      toast.error("A nova senha precisa de ao menos 8 caracteres.")
      return
    }
    setTrocandoSenha(true)
    try {
      if (await salvar({ senhaAtual, novaSenha })) {
        toast.success("Senha alterada.")
        setSenhaAtual("")
        setNovaSenha("")
        setRepetida("")
      }
    } finally {
      setTrocandoSenha(false)
    }
  }

  if (!perfil) {
    return <p className="text-sm text-muted-foreground">Carregando…</p>
  }

  const iniciais =
    perfil.name
      ?.split(" ")
      .map((p) => p[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "?"

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Minha conta</h1>
        <p className="text-muted-foreground">
          {PAPEL[perfil.role] ?? perfil.role}
          {perfil.store ? ` · ${perfil.store.nome}` : " · todas as lojas"}
        </p>
      </div>

      {/* Foto */}
      <section className="rounded-lg border bg-white p-4">
        <h2 className="font-medium">Foto</h2>
        <div className="mt-3 flex items-center gap-4">
          {perfil.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={perfil.avatarUrl}
              alt=""
              className="h-16 w-16 rounded-xl object-cover"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-neutral-100 text-lg font-semibold text-neutral-600">
              {iniciais}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <input
              ref={arquivoRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const arquivo = e.target.files?.[0]
                if (arquivo) void trocarFoto(arquivo)
              }}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={enviandoFoto}
              onClick={() => arquivoRef.current?.click()}
            >
              {enviandoFoto ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Camera className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              {perfil.avatarUrl ? "Trocar foto" : "Escolher foto"}
            </Button>
            {perfil.avatarUrl && (
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  if (await salvar({ avatarMediaId: null })) toast.success("Foto removida.")
                }}
              >
                Remover
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* Nome */}
      <section className="rounded-lg border bg-white p-4">
        <h2 className="font-medium">Nome</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          É o nome que aparece para as colegas na transferência de conversa.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-[240px] flex-1 space-y-1">
            <Label htmlFor="nome">Seu nome</Label>
            <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <Button
            disabled={salvandoNome || nome.trim() === perfil.name || nome.trim().length < 2}
            onClick={async () => {
              setSalvandoNome(true)
              try {
                if (await salvar({ name: nome.trim() })) toast.success("Nome atualizado.")
              } finally {
                setSalvandoNome(false)
              }
            }}
          >
            Salvar
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          E-mail: <span className="font-mono">{perfil.email}</span>. Para trocar o e-mail,
          fale com quem administra o sistema.
        </p>
      </section>

      {/* Senha */}
      <section className="rounded-lg border bg-white p-4">
        <h2 className="font-medium">Senha</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          A senha atual é sempre exigida, mesmo com a sessão aberta.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="atual">Senha atual</Label>
            <Input
              id="atual"
              type="password"
              autoComplete="current-password"
              value={senhaAtual}
              onChange={(e) => setSenhaAtual(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="nova">Nova senha</Label>
            <Input
              id="nova"
              type="password"
              autoComplete="new-password"
              value={novaSenha}
              onChange={(e) => setNovaSenha(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="repetida">Repita a nova</Label>
            <Input
              id="repetida"
              type="password"
              autoComplete="new-password"
              value={repetida}
              onChange={(e) => setRepetida(e.target.value)}
            />
          </div>
        </div>
        <Button
          className="mt-3"
          disabled={trocandoSenha || !senhaAtual || !novaSenha || !repetida}
          onClick={trocarSenha}
        >
          {trocandoSenha ? "Alterando..." : "Alterar senha"}
        </Button>
      </section>
    </div>
  )
}
