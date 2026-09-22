"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"

/**
 * Pede ao WhatsApp as mensagens anteriores desta conversa.
 *
 * O que existia antes da conexao nao esta no sistema: o pedido vai ao CELULAR
 * do numero e volta aos poucos, pelo webhook. Por isso o botao avisa que o
 * pedido foi enviado, em vez de prometer a conversa inteira — e nao fica
 * girando esperando algo que pode nunca chegar.
 */
export function PuxarHistorico({ conversationId }: { conversationId: string }) {
  const [pedindo, setPedindo] = useState(false)

  async function pedir() {
    setPedindo(true)
    try {
      const res = await fetch(`/api/conversations/${conversationId}/historico`, { method: "POST" })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(d.error || "Não foi possível pedir o histórico.")
        return
      }
      toast.success(d.aviso ?? "Pedido enviado ao WhatsApp.")
    } finally {
      setPedindo(false)
    }
  }

  return (
    <div className="mb-3 flex justify-center">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 rounded-lg text-xs text-muted-foreground"
        disabled={pedindo}
        onClick={pedir}
      >
        {pedindo ? "Pedindo..." : "Puxar conversa antiga do WhatsApp"}
      </Button>
    </div>
  )
}
