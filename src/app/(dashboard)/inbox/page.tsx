"use client"

import { useEffect, useState, useCallback } from "react"
import {
  ConversationList,
  type ConversationItem,
  type NumeroConectado,
} from "@/components/inbox/ConversationList"
import { ChatWindow } from "@/components/inbox/ChatWindow"
import { ContactPanel } from "@/components/inbox/ContactPanel"
import { PainelVenda } from "./_components/painel-venda"
import { SkeletonConversationList, SkeletonChat } from "@/components/ui/skeleton"
import { Inbox as InboxIcon, ArrowLeft, UserCircle, ShoppingBag } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

export default function InboxPage() {
  const [conversations, setConversations] = useState<ConversationItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [channelFilter, setChannelFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  /** Número conectado escolhido. "all" = visão geral de todos os números. */
  const [numeroFilter, setNumeroFilter] = useState("all")
  const [numeros, setNumeros] = useState<NumeroConectado[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [vendendo, setVendendo] = useState(false)

  const selectedConv = conversations.find((c) => c.id === selectedId)

  // A busca vai para o servidor com atraso. Sem isto era um request por tecla:
  // digitar "Fernanda" disparava 8 consultas, e a resposta lenta de um prefixo
  // antigo chegava depois e sobrescrevia o resultado do termo completo.
  const [buscaAplicada, setBuscaAplicada] = useState("")
  useEffect(() => {
    const timer = setTimeout(() => setBuscaAplicada(search), 350)
    return () => clearTimeout(timer)
  }, [search])

  const loadConversations = useCallback(async () => {
    const params = new URLSearchParams()
    if (buscaAplicada) params.set("search", buscaAplicada)
    if (channelFilter !== "all") params.set("channel", channelFilter)
    if (statusFilter !== "all") params.set("status", statusFilter)
    if (numeroFilter !== "all") params.set("integracaoId", numeroFilter)

    const res = await fetch(`/api/conversations?${params}`)
    if (res.ok) {
      const data = await res.json()
      setConversations(data.conversations)
    }
    setIsLoading(false)
  }, [buscaAplicada, channelFilter, statusFilter, numeroFilter])

  // Os números da loja mudam raramente: carrega uma vez, fora do polling.
  useEffect(() => {
    fetch("/api/integracoes/numeros")
      .then((r) => (r.ok ? r.json() : []))
      .then((d: NumeroConectado[]) => setNumeros(Array.isArray(d) ? d : []))
      .catch(() => setNumeros([]))
  }, [])

  // Trocar de número com uma conversa aberta deixaria na tela uma conversa que
  // sumiu da lista, com o nome da cliente errada no topo.
  useEffect(() => {
    setSelectedId(null)
  }, [numeroFilter])

  useEffect(() => {
    loadConversations()
  }, [loadConversations])

  useEffect(() => {
    const interval = setInterval(loadConversations, 5000)
    return () => clearInterval(interval)
  }, [loadConversations])

  function handleBack() {
    setSelectedId(null)
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] lg:h-[calc(100vh-8rem)] -m-4 lg:-m-6 mt-[-1rem] lg:mt-[-1.5rem]">
      {/* Column 1: Conversation List */}
      <div className={cn(
        "w-full lg:w-80 shrink-0 lg:block",
        selectedId ? "hidden" : "block"
      )}>
        {isLoading ? (
          <div className="h-full border-r bg-white">
            <SkeletonConversationList />
          </div>
        ) : (
          <ConversationList
            conversations={conversations}
            selectedId={selectedId}
            onSelect={setSelectedId}
            search={search}
            onSearchChange={setSearch}
            channelFilter={channelFilter}
            onChannelFilterChange={setChannelFilter}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            numeros={numeros}
            numeroFilter={numeroFilter}
            onNumeroFilterChange={setNumeroFilter}
          />
        )}
      </div>

      {/* Column 2: Chat */}
      <div className={cn(
        "flex-1 min-w-0 flex flex-col",
        selectedId ? "flex" : "hidden lg:flex"
      )}>
        {selectedConv ? (
          <div className="flex flex-col h-full">
            {/* Mobile back button */}
            <div className="flex lg:hidden items-center gap-2 px-3 py-2 border-b bg-white">
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={handleBack}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm font-medium truncate">
                {selectedConv.contact.name || selectedConv.contact.phone || "Desconhecido"}
              </span>
              {/* Mobile contact info sheet trigger */}
              <Button
                variant="outline"
                size="sm"
                className="ml-auto h-8 gap-1.5 lg:hidden"
                onClick={() => setVendendo(true)}
              >
                <ShoppingBag className="h-3.5 w-3.5" aria-hidden="true" />
                Vender
              </Button>
              <Sheet>
                <SheetTrigger>
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg lg:hidden">
                    <UserCircle className="h-4 w-4" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-[300px] p-0">
                  <ContactPanel contactId={selectedConv.contact.id} />
                </SheetContent>
              </Sheet>
            </div>
            <div className="flex-1 min-h-0">
              <ChatWindow
                conversationId={selectedConv.id}
                contactName={selectedConv.contact.name || selectedConv.contact.phone || "Desconhecido"}
                channel={selectedConv.channel}
                onConversaAtualizada={loadConversations}
              />
            </div>
          </div>
        ) : isLoading ? (
          <div className="h-full bg-neutral-50 p-4">
            <SkeletonChat />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center bg-neutral-50">
            <div className="text-center text-muted-foreground">
              <InboxIcon className="mx-auto h-12 w-12 mb-3 opacity-30" />
              <p className="text-lg font-medium">Selecione uma conversa</p>
              <p className="text-sm mt-1">
                Escolha uma conversa na lista para iniciar o atendimento
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Column 3: Contact Panel (desktop only) */}
      {selectedConv && (
        <div className="hidden lg:flex w-72 shrink-0 flex-col border-l bg-white">
          <div className="border-b p-3">
            <Button className="w-full gap-1.5" onClick={() => setVendendo(true)}>
              <ShoppingBag className="h-4 w-4" aria-hidden="true" />
              Nova venda
            </Button>
          </div>
          <div className="min-h-0 flex-1">
            <ContactPanel contactId={selectedConv.contact.id} />
          </div>
        </div>
      )}

      {/* Venda sem sair da conversa. O pedido nasce pendente de lancamento no
          Masc, que e o dono da venda (ADR 0004). */}
      {selectedConv && (
        <PainelVenda
          aberto={vendendo}
          onFechar={() => setVendendo(false)}
          contactId={selectedConv.contact.id}
          contactNome={selectedConv.contact.name || selectedConv.contact.phone || "Cliente"}
          conversationId={selectedConv.id}
        />
      )}
    </div>
  )
}
