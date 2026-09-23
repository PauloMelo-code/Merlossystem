"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SkeletonTable } from "@/components/ui/skeleton"
import { ModalConfirmacaoBlock } from "@/components/modal-confirmacao-block"
import { Store, Plus, AlertTriangle, Pencil } from "lucide-react"

/**
 * Cadastro das lojas da rede.
 *
 * Sem esta tela o sistema multi-loja nao tinha como nascer: as lojas so
 * existiam se alguem as criasse direto no banco, e o `bling_deposito_id` — que
 * separa Centro de Cerro Azul dentro da conta unica do Bling — nao tinha
 * campo em lugar nenhum.
 */

interface Loja {
  id: string
  nome: string
  slug: string
  blingDepositoId: string | null
}

interface Deposito {
  id: string
  descricao: string | null
}

export default function LojasPage() {
  const [lojas, setLojas] = useState<Loja[]>([])
  const [depositos, setDepositos] = useState<Deposito[]>([])
  const [blingConectado, setBlingConectado] = useState(false)
  /** Por que a lista de depositos nao veio. Vazio = nao houve falha. */
  const [falhaDosDepositos, setFalhaDosDepositos] = useState("")
  const [carregando, setCarregando] = useState(true)
  const [semPermissao, setSemPermissao] = useState(false)

  const [editando, setEditando] = useState<Loja | null>(null)
  const [criando, setCriando] = useState(false)
  const [nome, setNome] = useState("")
  const [deposito, setDeposito] = useState("")
  const [confirmando, setConfirmando] = useState(false)
  const [gravando, setGravando] = useState(false)

  const carregar = useCallback(async () => {
    setCarregando(true)
    const res = await fetch("/api/lojas")
    if (res.status === 403) {
      setSemPermissao(true)
    } else if (res.ok) {
      const d = await res.json()
      setLojas(d.lojas)
    }

    // Bling desconectado nao impede cadastrar loja — so tira a lista de
    // depositos e o campo vira texto livre. Mas a falha precisa APARECER: cair
    // no texto livre em silencio faz a tela dizer "conecte o Bling" para quem
    // ja conectou, e o unico caminho que sobra e caçar o id dentro do Bling.
    const dep = await fetch("/api/integracoes/bling/depositos")
    const corpo = await dep.json().catch(() => ({}))
    if (dep.ok) {
      setBlingConectado(corpo.conectado)
      setDepositos(corpo.depositos ?? [])
      if (corpo.conectado && (corpo.depositos ?? []).length === 0) {
        setFalhaDosDepositos("O Bling respondeu, mas não devolveu nenhum depósito.")
      }
    } else {
      setFalhaDosDepositos(corpo.error || `O Bling não respondeu (HTTP ${dep.status}).`)
    }
    setCarregando(false)
  }, [])

  useEffect(() => {
    carregar()
  }, [carregar])

  function abrirNova() {
    setEditando(null)
    setNome("")
    setDeposito("")
    setCriando(true)
  }

  function abrirEdicao(loja: Loja) {
    setEditando(loja)
    setNome(loja.nome)
    setDeposito(loja.blingDepositoId ?? "")
    setCriando(true)
  }

  async function gravar() {
    setGravando(true)
    try {
      const corpo = JSON.stringify({ nome, blingDepositoId: deposito || null })
      const res = editando
        ? await fetch(`/api/lojas/${editando.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: corpo,
          })
        : await fetch("/api/lojas", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: corpo,
          })

      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(typeof d.error === "string" ? d.error : "Nao foi possivel gravar a loja")
        return
      }
      toast.success(editando ? `Loja ${nome} atualizada` : `Loja ${nome} cadastrada`)
      setConfirmando(false)
      setCriando(false)
      carregar()
    } finally {
      setGravando(false)
    }
  }

  if (semPermissao) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold">Lojas</h1>
        <p className="mt-2 text-muted-foreground">
          Cadastrar loja é função do administrador. Fale com quem administra a rede.
        </p>
      </div>
    )
  }

  const semDeposito = lojas.filter((l) => !l.blingDepositoId)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Lojas</h1>
          <p className="text-muted-foreground">
            As unidades da rede. Cada vendedor pertence a uma; admin e gerente veem todas.
          </p>
        </div>
        <Button onClick={abrirNova} className="gap-1.5">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Nova loja
        </Button>
      </div>

      {!carregando && semDeposito.length > 0 && (
        <p className="flex items-start gap-1.5 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            <strong>
              {semDeposito.length === 1
                ? "1 loja está sem depósito do Bling"
                : `${semDeposito.length} lojas estão sem depósito do Bling`}
            </strong>{" "}
            ({semDeposito.map((l) => l.nome).join(", ")}). Enquanto isso, a tela de venda
            não mostra estoque ao vivo para elas — o saldo é por depósito, e sem o de-para
            não há como saber qual saldo é de qual loja.
          </span>
        </p>
      )}

      {carregando ? (
        <SkeletonTable rows={3} cols={3} />
      ) : lojas.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-white p-10 text-center">
          <Store className="mx-auto h-10 w-10 text-neutral-300" aria-hidden="true" />
          <p className="mt-3 font-medium">Nenhuma loja cadastrada</p>
          <p className="mt-1 text-sm text-muted-foreground">
            O sistema precisa de pelo menos uma loja: contatos, pedidos e conversas
            pertencem a ela.
          </p>
          <Button onClick={abrirNova} className="mt-4 gap-1.5">
            <Plus className="h-4 w-4" aria-hidden="true" />
            Cadastrar a primeira
          </Button>
        </div>
      ) : (
        <ul className="space-y-3">
          {lojas.map((loja) => (
            <li
              key={loja.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white p-4"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{loja.nome}</span>
                  <Badge variant="outline" className="font-mono text-xs">
                    {loja.slug}
                  </Badge>
                  {loja.blingDepositoId ? (
                    <Badge className="bg-green-100 text-green-700 text-xs">
                      depósito {loja.blingDepositoId}
                    </Badge>
                  ) : (
                    <Badge className="bg-amber-100 text-amber-800 text-xs">sem depósito</Badge>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  O identificador entra na URL de webhook — mudá-lo exige reconfigurar os
                  canais.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => abrirEdicao(loja)} className="gap-1.5">
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                Editar
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={criando} onOpenChange={(o) => !o && setCriando(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editando ? `Editar ${editando.nome}` : "Nova loja"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="nome">Nome da loja</Label>
              <Input
                id="nome"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Centro"
                autoComplete="off"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="deposito">Depósito no Bling</Label>
              {blingConectado && depositos.length > 0 ? (
                <Select value={deposito} onValueChange={(v) => setDeposito(v || "")}>
                  <SelectTrigger id="deposito">
                    <SelectValue placeholder="Escolha o depósito" />
                  </SelectTrigger>
                  <SelectContent>
                    {depositos.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.descricao ? `${d.descricao} (${d.id})` : d.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <>
                  <Input
                    id="deposito"
                    value={deposito}
                    onChange={(e) => setDeposito(e.target.value)}
                    placeholder="id do depósito"
                    autoComplete="off"
                  />
                  {falhaDosDepositos ? (
                    <p className="text-xs text-red-600">
                      {falhaDosDepositos} Pegue o id em Cadastros → Estoques → Depósitos,
                      dentro do Bling: ele aparece na URL ao abrir o depósito.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Conecte o Bling em Integrações para escolher de uma lista em vez de
                      digitar o id.
                    </p>
                  )}
                </>
              )}
              <p className="text-xs text-muted-foreground">
                É o que separa esta loja das outras dentro da conta única do Bling. Id
                errado mostra o estoque da loja errada, sem dar erro.
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setCriando(false)}>
              Cancelar
            </Button>
            <Button disabled={!nome.trim()} onClick={() => setConfirmando(true)}>
              {editando ? "Salvar" : "Cadastrar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Acao critica: a loja define o escopo de tudo — contato, pedido,
          conversa e estoque. Bloqueio de 3s. */}
      <ModalConfirmacaoBlock
        aberto={confirmando}
        titulo={editando ? "Salvar alteração da loja" : "Cadastrar loja"}
        rotuloConfirmar={editando ? "Salvar" : "Cadastrar"}
        onConfirmar={gravar}
        onCancelar={() => setConfirmando(false)}
        carregando={gravando}
      >
        <div className="space-y-2 text-sm">
          <p>
            Loja <strong>{nome}</strong>
            {deposito ? (
              <>
                {" "}
                no depósito <strong>{deposito}</strong> do Bling.
              </>
            ) : (
              <>
                {" "}
                <span className="text-amber-700">sem depósito do Bling definido</span> — a
                tela de venda não mostrará estoque ao vivo para ela.
              </>
            )}
          </p>
          {editando && editando.blingDepositoId !== (deposito || null) && (
            <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800">
              O depósito está mudando de{" "}
              <strong>{editando.blingDepositoId ?? "nenhum"}</strong> para{" "}
              <strong>{deposito || "nenhum"}</strong>. O estoque exibido para esta loja
              passa a vir de outro lugar.
            </p>
          )}
        </div>
      </ModalConfirmacaoBlock>
    </div>
  )
}
