"use client"

import { formatDistanceToNow } from "date-fns"
import { ptBR } from "date-fns/locale"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Search } from "lucide-react"
import { ChannelBadge, ChannelAvatar } from "./ChannelBadge"
import { cn } from "@/lib/utils"

export interface ConversationItem {
  id: string
  channel: string
  status: string
  priority: string
  lastMessageAt: string | null
  lastMessagePreview: string | null
  unreadCount: number
  contact: {
    id: string
    name: string | null
    phone: string | null
    avatarUrl: string | null
    tags: string[]
  }
  agent: {
    id: string
    name: string
  } | null
  /** Número conectado por onde a conversa entrou. Nulo em conversa antiga. */
  integracao: {
    id: string
    rotulo: string
    provedor: string
  } | null
}

/** Número conectado, como `/api/integracoes/numeros` devolve. */
export interface NumeroConectado {
  id: string
  rotulo: string
  provedor: string
  vendedor: { id: string; nome: string } | null
}

/**
 * Texto que o seletor mostra fechado. Sem isto ele exibia o valor cru ("all",
 * e no filtro de número o identificador da conta): quem lê a tela precisa do
 * nome, não da chave.
 */
const ROTULO_CANAL: Record<string, string> = {
  all: "Todos os canais",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
}

const ROTULO_STATUS: Record<string, string> = {
  all: "Abertos",
  open: "Aberto",
  pending: "Pendente",
  resolved: "Resolvido",
}

/** O nome que a equipe reconhece: a vendedora do número, e só depois o apelido. */
function nomeDoNumero(numeros: NumeroConectado[], id: string): string {
  if (id === "all") return "Todos os números"
  const n = numeros.find((x) => x.id === id)
  if (!n) return "Todos os números"
  return n.vendedor ? n.vendedor.nome : n.rotulo
}

const priorityBadge: Record<string, string> = {
  urgent: "bg-red-50 text-red-600 border border-red-100",
  high: "bg-amber-50 text-amber-600 border border-amber-100",
  medium: "bg-blue-50 text-blue-600 border border-blue-100",
  low: "text-neutral-400",
}

interface ConversationListProps {
  conversations: ConversationItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  search: string
  onSearchChange: (v: string) => void
  channelFilter: string
  onChannelFilterChange: (v: string) => void
  statusFilter: string
  onStatusFilterChange: (v: string) => void
  /** Números conectados da loja; lista vazia esconde o filtro. */
  numeros: NumeroConectado[]
  numeroFilter: string
  onNumeroFilterChange: (v: string) => void
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  search,
  onSearchChange,
  channelFilter,
  onChannelFilterChange,
  statusFilter,
  onStatusFilterChange,
  numeros,
  numeroFilter,
  onNumeroFilterChange,
}: ConversationListProps) {
  const unanswered = conversations.filter((c) => c.unreadCount > 0).length

  return (
    <div className="flex h-full flex-col border-r bg-white">
      {/* Header */}
      <div className="border-b p-3 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm text-neutral-900">Conversas</h2>
          {unanswered > 0 && (
            <Badge className="text-[10px] bg-neutral-900 text-white hover:bg-neutral-800 rounded-xl">
              {unanswered} sem resposta
            </Badge>
          )}
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
          <Input
            placeholder="Buscar..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-8 h-9 text-sm rounded-lg bg-neutral-50/80 border-neutral-200/60 focus:border-neutral-300 transition-colors"
          />
        </div>
        {/* Filtro por número conectado: "Todos" é a visão geral da loja; cada
            número tem o seu atendimento, e é assim que a vendedora vê só o
            dela. Some quando a loja tem um número só — filtro de uma opção
            confunde mais do que ajuda. */}
        {numeros.length > 1 && (
          <Select value={numeroFilter} onValueChange={(v) => onNumeroFilterChange(v || "all")}>
            <SelectTrigger className="h-8 text-xs rounded-lg border-neutral-200/60">
              {/* O texto vai explícito: sem isto o seletor mostrava o
                  identificador da conta em vez do nome. */}
              <SelectValue placeholder="Número">{nomeDoNumero(numeros, numeroFilter)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os números</SelectItem>
              {numeros.map((n) => (
                <SelectItem key={n.id} value={n.id}>
                  {nomeDoNumero(numeros, n.id)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className="flex gap-1.5">
          <Select value={channelFilter} onValueChange={(v) => onChannelFilterChange(v || "all")}>
            <SelectTrigger className="h-7 text-xs flex-1 rounded-lg border-neutral-200/60">
              <SelectValue placeholder="Canal">{ROTULO_CANAL[channelFilter] ?? "Todos os canais"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="whatsapp">WhatsApp</SelectItem>
              <SelectItem value="instagram">Instagram</SelectItem>
              <SelectItem value="facebook">Facebook</SelectItem>
              <SelectItem value="tiktok">TikTok</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v) => onStatusFilterChange(v || "all")}>
            <SelectTrigger className="h-7 text-xs flex-1 rounded-lg border-neutral-200/60">
              <SelectValue placeholder="Status">{ROTULO_STATUS[statusFilter] ?? "Abertos"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Abertos</SelectItem>
              <SelectItem value="open">Aberto</SelectItem>
              <SelectItem value="pending">Pendente</SelectItem>
              <SelectItem value="resolved">Resolvido</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* List */}
      <ScrollArea className="flex-1">
        {conversations.length === 0 ? (
          <div className="p-6 text-center text-sm text-neutral-500">
            Nenhuma conversa encontrada
          </div>
        ) : (
          conversations.map((conv) => {
            return (
              <div
                key={conv.id}
                className={cn(
                  "flex items-start gap-3 px-3 py-3 cursor-pointer border-b transition-all duration-150 hover:bg-neutral-50/80",
                  selectedId === conv.id && "bg-neutral-100/60 hover:bg-neutral-100/60 shadow-[0_1px_3px_0_rgba(0,0,0,0.06)]"
                )}
                onClick={() => onSelect(conv.id)}
              >
                {/* Channel Avatar */}
                <ChannelAvatar
                  channel={conv.channel}
                  contactName={conv.contact.name}
                  avatarUrl={conv.contact.avatarUrl}
                />

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className={cn(
                      "text-sm font-medium truncate text-neutral-900",
                      conv.unreadCount > 0 && "font-bold"
                    )}>
                      {conv.contact.name || conv.contact.phone || "Desconhecido"}
                    </span>
                    <span className="text-[10px] text-neutral-500 whitespace-nowrap">
                      {conv.lastMessageAt
                        ? formatDistanceToNow(new Date(conv.lastMessageAt), {
                            addSuffix: false,
                            locale: ptBR,
                          })
                        : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <ChannelBadge channel={conv.channel} />
                    {/* Por qual número entrou. Na visão geral é o que diz de
                        quem é o atendimento sem abrir a conversa. */}
                    {/* Veio de anúncio: quem chega por aí não conhece a loja,
                        e a resposta é outra. */}
                    {conv.contact.tags?.includes("Anúncio") && (
                      <span className="rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] font-bold text-violet-700">
                        ANÚNCIO
                      </span>
                    )}
                    {numeroFilter === "all" && conv.integracao && (
                      <span className="max-w-[9rem] truncate rounded-md bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600">
                        {conv.integracao.rotulo}
                      </span>
                    )}
                    {conv.priority === "urgent" || conv.priority === "high" ? (
                      <span className={cn("text-[10px] font-bold rounded-md px-1.5 py-0.5", priorityBadge[conv.priority])}>
                        {conv.priority === "urgent" ? "URGENTE" : "ALTA"}
                      </span>
                    ) : null}
                  </div>
                  <p className={cn(
                    "text-xs text-neutral-500 mt-0.5 truncate",
                    conv.unreadCount > 0 && "text-neutral-700 font-medium"
                  )}>
                    {conv.lastMessagePreview || "Sem mensagens"}
                  </p>
                </div>

                {/* Unread badge */}
                {conv.unreadCount > 0 && (
                  <div className="shrink-0 mt-1">
                    <div className="h-5 min-w-[20px] flex items-center justify-center rounded-full bg-neutral-900 text-white text-[10px] font-bold px-1.5 ring-2 ring-neutral-900/20">
                      {conv.unreadCount}
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </ScrollArea>
    </div>
  )
}
