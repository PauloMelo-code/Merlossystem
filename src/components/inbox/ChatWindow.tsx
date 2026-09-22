"use client"

import { useEffect, useState, useRef, useCallback, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Send, StickyNote, Zap, ChevronUp } from "lucide-react"
import { CabecalhoConversa } from "./CabecalhoConversa"
import { BolhaMensagem, type Mensagem } from "./BolhaMensagem"
import { MenuAtalhos } from "./MenuAtalhos"
import { SeletorProduto } from "./SeletorProduto"
import { MediaBar } from "@/components/chat/MediaBar"
import { GalleryModal } from "@/components/chat/GalleryModal"
// IA fora de escopo (18/08/2026) — ver o bloco comentado no fim do arquivo.
import { armarAviso, tocarBipe, notificarSeEscondido } from "@/lib/chat/aviso-sonoro"
import { mesclarMensagens } from "@/lib/chat/mesclar"
import { subirEEnviar, enviarDaBiblioteca } from "@/lib/chat/midia"
import { toast } from "sonner"
import { PuxarHistorico } from "./PuxarHistorico"

const PAGINA = 40
const INTERVALO_POLLING = 5000
/** Distancia do fim em que ainda consideramos que a atendente "esta no fim". */
const FOLGA_DO_FIM = 120

interface ChatWindowProps {
  conversationId: string
  contactName: string
  channel: string
  /** Avisa a caixa de entrada que a conversa mudou (resolvida, transferida). */
  onConversaAtualizada?: () => void
}

/** Rotulo do dia para o separador do historico. */
function rotuloDoDia(iso: string): string {
  const data = new Date(iso)
  const hoje = new Date()
  const ontem = new Date(hoje)
  ontem.setDate(hoje.getDate() - 1)
  const mesmoDia = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (mesmoDia(data, hoje)) return "Hoje"
  if (mesmoDia(data, ontem)) return "Ontem"
  return data.toLocaleDateString("pt-BR", { day: "2-digit", month: "long" })
}

function porData(a: Mensagem, b: Mensagem) {
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
}

export function ChatWindow({
  conversationId,
  contactName,
  channel,
  onConversaAtualizada,
}: ChatWindowProps) {
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [texto, setTexto] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [reenviando, setReenviando] = useState<string | null>(null)
  const [galeriaAberta, setGaleriaAberta] = useState(false)
  const [seletorProdutoAberto, setSeletorProdutoAberto] = useState(false)
  const [temMais, setTemMais] = useState(false)
  const [carregandoAnteriores, setCarregandoAnteriores] = useState(false)

  const viewportRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  /** Ultima mensagem conhecida, para detectar chegada sem depender do render. */
  const ultimaVistaRef = useRef<string | null>(null)
  /** Sequencial das mensagens otimistas. */
  const seqRef = useRef(0)

  // ---------------------------------------------------------------- rolagem

  const estaNoFim = useCallback(() => {
    const v = viewportRef.current
    if (!v) return true
    return v.scrollHeight - v.scrollTop - v.clientHeight < FOLGA_DO_FIM
  }, [])

  const irParaOFim = useCallback(() => {
    const v = viewportRef.current
    if (v) v.scrollTop = v.scrollHeight
  }, [])

  // ------------------------------------------------------------ carregamento

  /** Traz a pagina mais recente e mescla com a tela (ver lib/chat/mesclar). */
  const carregar = useCallback(async () => {
    const res = await fetch(
      `/api/messages?conversationId=${conversationId}&limit=${PAGINA}`
    )
    if (!res.ok) return null
    const recentes: Mensagem[] = await res.json()

    setMensagens((atuais) => mesclarMensagens(atuais, recentes))
    setTemMais(recentes.length >= PAGINA)
    return recentes
  }, [conversationId])

  /** Pagina para tras. Preserva a posicao de leitura ao inserir no topo. */
  async function carregarAnteriores() {
    const maisAntiga = mensagens.find((m) => !m.pendente)
    if (!maisAntiga || carregandoAnteriores) return

    setCarregandoAnteriores(true)
    const v = viewportRef.current
    const alturaAntes = v?.scrollHeight ?? 0
    const topoAntes = v?.scrollTop ?? 0

    try {
      const res = await fetch(
        `/api/messages?conversationId=${conversationId}&limit=${PAGINA}` +
          `&before=${encodeURIComponent(maisAntiga.createdAt)}`
      )
      if (!res.ok) return
      const antigas: Mensagem[] = await res.json()
      if (antigas.length === 0) {
        setTemMais(false)
        return
      }

      // Ordem invertida de proposito: aqui o servidor traz o passado, e o que
      // esta na tela e mais atual (pode ter status de entrega ja atualizado).
      setMensagens((atuais) => mesclarMensagens(antigas, atuais))
      setTemMais(antigas.length >= PAGINA)

      // Sem isto o conteudo inserido acima empurra a leitura para baixo e a
      // atendente perde o ponto onde estava.
      requestAnimationFrame(() => {
        const vv = viewportRef.current
        if (vv) vv.scrollTop = topoAntes + (vv.scrollHeight - alturaAntes)
      })
    } finally {
      setCarregandoAnteriores(false)
    }
  }

  // Troca de conversa: limpa antes de buscar, senao o historico da conversa
  // anterior fica na tela por um instante — com o nome da outra cliente no topo.
  useEffect(() => {
    setMensagens([])
    setTemMais(false)
    ultimaVistaRef.current = null
    void carregar().then(() => requestAnimationFrame(irParaOFim))
  }, [conversationId, carregar, irParaOFim])

  useEffect(() => armarAviso(), [])


  // -------------------------------------------------- polling, aviso, lida

  const marcarLida = useCallback(async () => {
    await fetch(`/api/conversations/${conversationId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markRead: true }),
    })
    onConversaAtualizada?.()
  }, [conversationId, onConversaAtualizada])

  useEffect(() => {
    void marcarLida()
  }, [marcarLida])

  useEffect(() => {
    const timer = setInterval(async () => {
      const colado = estaNoFim()
      const recentes = await carregar()
      if (!recentes || recentes.length === 0) return

      const ultima = recentes[recentes.length - 1]
      const primeiraLeitura = ultimaVistaRef.current === null
      const novidade = ultima.id !== ultimaVistaRef.current
      ultimaVistaRef.current = ultima.id

      if (!primeiraLeitura && novidade && ultima.senderType === "customer") {
        tocarBipe()
        notificarSeEscondido(contactName, ultima.content || "Enviou um anexo")
        // A conversa esta aberta na tela: o contador de nao lidas tem que zerar
        // de novo, senao a lista anuncia "1 nao lida" do que ja esta a vista.
        // Antes isto rodava so na montagem do componente.
        void marcarLida()
      }

      // Rola sozinho SO se a atendente ja estava no fim. Se estava lendo o
      // historico, puxar a tela para baixo tira o texto do olho dela.
      if (colado) requestAnimationFrame(irParaOFim)
    }, INTERVALO_POLLING)
    return () => clearInterval(timer)
  }, [carregar, estaNoFim, irParaOFim, marcarLida, contactName])

  // ------------------------------------------------------------------ envio

  async function enviar(comoNota = false) {
    const conteudo = texto.trim()
    if (!conteudo || enviando) return

    // Bolha otimista: aparece na hora. Antes a mensagem so surgia no ciclo
    // seguinte do polling — ate 5 segundos de tela parada depois do Enter, e a
    // atendente mandava de novo achando que nao tinha ido.
    const idLocal = `local:${++seqRef.current}`
    const otimista: Mensagem = {
      id: idLocal,
      senderType: "agent",
      content: conteudo,
      contentType: "text",
      isInternalNote: comoNota,
      externalStatus: null,
      createdAt: new Date().toISOString(),
      sender: null,
      media: [],
      pendente: true,
    }
    setMensagens((m) => [...m, otimista])
    setTexto("")
    requestAnimationFrame(irParaOFim)
    setEnviando(true)

    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          content: conteudo,
          contentType: "text",
          isInternalNote: comoNota,
        }),
      })

      if (!res.ok) {
        const erro = await res.json().catch(() => ({}))
        // Devolve o texto ao campo: perder o que a atendente escreveu por causa
        // de uma falha de rede e inaceitavel.
        setMensagens((m) => m.filter((x) => x.id !== idLocal))
        setTexto(conteudo)
        toast.error(erro.error || "Não foi possível enviar. Texto devolvido ao campo.")
        return
      }

      const salva: Mensagem = await res.json()
      setMensagens((m) => m.map((x) => (x.id === idLocal ? salva : x)).sort(porData))
      onConversaAtualizada?.()

      // 201 com `failed` = a tentativa foi gravada e o canal recusou. A bolha
      // vermelha com "tentar de novo" ja esta na tela; o toast diz o motivo.
      if (salva.externalStatus === "failed") {
        toast.error(salva.metadata?.erroDeEnvio || "O canal recusou a mensagem.")
      }
      textareaRef.current?.focus()
    } finally {
      setEnviando(false)
    }
  }

  async function reenviar(id: string) {
    setReenviando(id)
    try {
      const res = await fetch(`/api/messages/${id}/reenviar`, { method: "POST" })
      const dados = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(dados.error || "Não foi possível reenviar.")
        return
      }
      setMensagens((m) => m.map((x) => (x.id === id ? { ...x, ...dados } : x)))
      if (dados.externalStatus === "failed") {
        toast.error(dados.metadata?.erroDeEnvio || "O canal recusou de novo.")
      } else {
        toast.success("Mensagem entregue.")
      }
    } finally {
      setReenviando(null)
    }
  }

  // ----------------------------------------------------- transferir/resolver

  async function atualizarConversa(corpo: Record<string, unknown>, ok: string) {
    const res = await fetch(`/api/conversations/${conversationId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    })
    const dados = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(dados.error || "Não foi possível atualizar a conversa.")
      return false
    }
    toast.success(ok)
    onConversaAtualizada?.()
    return true
  }

  // ------------------------------------------------------------------ midia

  async function enviarMidia(arquivo: File) {
    const r = await subirEEnviar(conversationId, arquivo)
    if (!r.ok) toast.error(r.erro)
    await carregar()
    requestAnimationFrame(irParaOFim)
  }

  async function enviarDaGaleria(ids: string[], legenda?: string) {
    const r = await enviarDaBiblioteca(conversationId, ids, legenda)
    if (!r.ok) toast.error(r.erro)
    await carregar()
    requestAnimationFrame(irParaOFim)
  }

  // ---------------------------------------------------------------- atalhos

  // O menu abre quando a linha inteira e um atalho sendo digitado. Nao abre no
  // meio de uma frase que por acaso tenha barra ("parcelo em 10/12").
  const atalhoDigitado = /^\/(\S*)$/.exec(texto)
  const menuAberto = atalhoDigitado !== null

  function aoTeclar(e: React.KeyboardEvent) {
    // Com o menu aberto o Enter escolhe o atalho: o MenuAtalhos trata em
    // captura e chama preventDefault, entao aqui so saimos.
    if (menuAberto) return
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void enviar()
    }
  }

  // Separadores de dia calculados uma vez por lista, nao por bolha.
  const comDias = useMemo(() => {
    let ultimoDia = ""
    return mensagens.map((m) => {
      const dia = rotuloDoDia(m.createdAt)
      const novo = dia !== ultimoDia
      ultimoDia = dia
      return { msg: m, dia: novo ? dia : null }
    })
  }, [mensagens])

  return (
    <div className="flex h-full flex-col bg-white">
      <CabecalhoConversa
        contactName={contactName}
        channel={channel}
        onTransferir={async (destino, nome) => {
          await atualizarConversa(
            { assignedTo: destino },
            `Conversa transferida para ${nome}.`
          )
        }}
        onResolver={async () => {
          await atualizarConversa({ status: "resolved" }, "Conversa resolvida.")
        }}
      />

      <ScrollArea className="flex-1 bg-[#fafaf8] p-4" viewportRef={viewportRef}>
        {/* O que veio antes da conexão só existe no celular — ver o componente. */}
        {channel === "whatsapp" && <PuxarHistorico conversationId={conversationId} />}

        {temMais && (
          <div className="mb-3 flex justify-center">
            <Button
              variant="outline"
              size="sm"
              className="h-7 rounded-lg text-xs"
              onClick={carregarAnteriores}
              disabled={carregandoAnteriores}
            >
              <ChevronUp className="mr-1 h-3 w-3" />
              {carregandoAnteriores ? "Carregando..." : "Mensagens anteriores"}
            </Button>
          </div>
        )}

        <div className="space-y-3">
          {comDias.map(({ msg, dia }) => (
            <div key={msg.id} className="space-y-3">
              {dia && (
                <div className="flex justify-center">
                  <span className="rounded-full bg-white px-2.5 py-0.5 text-[10px] font-medium text-neutral-500 shadow-sm">
                    {dia}
                  </span>
                </div>
              )}
              <BolhaMensagem
                msg={msg}
                onReenviar={reenviar}
                reenviando={reenviando === msg.id}
              />
            </div>
          ))}
        </div>
      </ScrollArea>

      {/*
        Sugestao por IA — FORA DE ESCOPO neste projeto (decisao de 18/08/2026).

        Escondido, nao removido: o componente e as rotas `/api/ai/*` continuam
        no repositorio. Esconder e reversivel; apagar nao, e a decisao pode
        mudar. Sem a chave da Anthropic configurada isto so mostraria erro.

        <AiSuggestion
          conversationId={conversationId}
          onSend={(t) => { setTexto(t); enviar() }}
        />
      */}

      <MediaBar
        onImageSelect={enviarMidia}
        onVideoSelect={enviarMidia}
        onFileSelect={enviarMidia}
        onGalleryOpen={() => setGaleriaAberta(true)}
        onProductSelect={() => setSeletorProdutoAberto(true)}
        onQuickReply={() => {
          setTexto("/")
          textareaRef.current?.focus()
        }}
      />

      <div className="relative border-t border-neutral-200/60 bg-white p-3">
        <MenuAtalhos
          termo={atalhoDigitado?.[1] ?? ""}
          aberto={menuAberto}
          onEscolher={(conteudo) => {
            setTexto(conteudo)
            textareaRef.current?.focus()
          }}
          onFechar={() => setTexto("")}
        />

        <div className="flex gap-2">
          <Textarea
            ref={textareaRef}
            placeholder="Digite sua mensagem... (/ abre as respostas rápidas)"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={aoTeclar}
            rows={1}
            className="max-h-[120px] min-h-[44px] resize-none rounded-xl border-neutral-200/60 bg-[#fafaf8] text-sm placeholder:text-neutral-400 focus:border-neutral-400 focus:ring-neutral-400/20"
          />
          <div className="flex flex-col gap-1">
            <Button
              size="icon"
              className="h-9 w-9 rounded-xl bg-neutral-900 text-white hover:bg-neutral-800"
              onClick={() => enviar(false)}
              disabled={!texto.trim() || enviando}
              title="Enviar (Enter)"
            >
              <Send className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 rounded-xl border-neutral-200/60 text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700"
              onClick={() => enviar(true)}
              disabled={!texto.trim() || enviando}
              title="Salvar como nota interna (não vai para a cliente)"
            >
              <StickyNote className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {!menuAberto && (
          <button
            type="button"
            onClick={() => {
              setTexto("/")
              textareaRef.current?.focus()
            }}
            className="mt-1.5 flex items-center gap-1 text-[11px] text-neutral-400 hover:text-neutral-600"
          >
            <Zap className="h-3 w-3" />
            Respostas rápidas
          </button>
        )}
      </div>

      <GalleryModal
        open={galeriaAberta}
        onOpenChange={setGaleriaAberta}
        onSend={enviarDaGaleria}
      />

      {/* Coloca o texto no campo em vez de enviar direto: a vendedora quase
          sempre acrescenta uma frase ("esse ficou lindo em voce") antes de
          mandar, e enviar sozinho tiraria essa chance. */}
      <SeletorProduto
        aberto={seletorProdutoAberto}
        onFechar={() => setSeletorProdutoAberto(false)}
        onEscolher={(texto) => {
          setTexto((atual) => (atual ? `${atual}

${texto}` : texto))
          textareaRef.current?.focus()
        }}
      />
    </div>
  )
}
