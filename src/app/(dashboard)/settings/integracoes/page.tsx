"use client"

import { useCallback, useEffect, useState } from "react"
import { Plug, AlertTriangle, CheckCircle2, Clock, XCircle, Building2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SkeletonTable } from "@/components/ui/skeleton"
import { toast } from "sonner"
import { ConectarConta } from "./_components/conectar-conta"
import { CriarNumero, SeletorDeVendedora, usePessoas } from "./_components/numero-uazapi"

interface Integracao {
  id: string
  provedor: string
  rotulo: string
  status: string
  escopo: "loja" | "rede"
  loja: { id: string; nome: string } | null
  referenciaExterna: string
  /** Vendedora dona do número: a conversa que entra por ele já nasce dela. */
  vendedorId: string | null
  vendedor: { id: string; nome: string } | null
  credenciais: Record<string, string>
  expiraEm: string | null
  expirada: boolean
  ultimoErro: string | null
  ultimaSincronizacao: string | null
}

/** Sessão do uazapi — não existe nos outros provedores. */
interface EstadoSessao {
  status: "conectado" | "desconectado" | "conectando" | "desconhecido"
  qrcode?: string
  numero?: string
}

const PROVEDORES: Record<string, string> = {
  bling: "Bling",
  tiktok_shop: "TikTok Shop",
  instagram: "Instagram",
  facebook: "Facebook",
  whatsapp_oficial: "WhatsApp (oficial)",
  uazapi: "WhatsApp (uazapi)",
}

const STATUS: Record<string, { texto: string; classe: string; Icone: typeof CheckCircle2 }> = {
  conectado: { texto: "Conectado", classe: "bg-green-100 text-green-700", Icone: CheckCircle2 },
  desconectado: { texto: "Desconectado", classe: "bg-neutral-100 text-neutral-600", Icone: Plug },
  expirado: { texto: "Token expirado", classe: "bg-amber-100 text-amber-700", Icone: Clock },
  erro: { texto: "Com erro", classe: "bg-red-100 text-red-700", Icone: XCircle },
}

function Selo({ status, expirada }: { status: string; expirada: boolean }) {
  const chave = expirada && status === "conectado" ? "expirado" : status
  const s = STATUS[chave] ?? STATUS.desconectado
  return (
    <Badge className={`${s.classe} gap-1`}>
      <s.Icone className="h-3 w-3" aria-hidden="true" />
      {s.texto}
    </Badge>
  )
}

/**
 * Teto de rodadas por clique. 40 pecas por rodada dao 1.600 pecas — mais que o
 * catalogo inteiro — e o teto existe so para a tela nunca ficar presa num laco
 * se a fila nao diminuir.
 */
const RODADAS_MAXIMAS = 40

export default function IntegracoesPage() {
  const [integracoes, setIntegracoes] = useState<Integracao[]>([])
  const [carregando, setCarregando] = useState(true)
  const [buscandoDetalhes, setBuscandoDetalhes] = useState(false)
  const [progressoDetalhes, setProgressoDetalhes] = useState("")
  const [semPermissao, setSemPermissao] = useState(false)
  const [sessaoDe, setSessaoDe] = useState<string | null>(null)
  const [estado, setEstado] = useState<EstadoSessao | null>(null)
  const pessoas = usePessoas()

  const carregar = useCallback(async () => {
    setCarregando(true)
    const res = await fetch("/api/integracoes")
    if (res.status === 403) {
      setSemPermissao(true)
    } else if (res.ok) {
      const d = await res.json()
      setIntegracoes(d.integracoes)
    }
    setCarregando(false)
  }, [])

  useEffect(() => {
    carregar()
  }, [carregar])

  /** O consentimento acontece no domínio do provedor — sai do fetch para navegação. */
  async function conectar(provedor: "bling" | "tiktok") {
    const res = await fetch(`/api/integracoes/${provedor}/autorizar`)
    const d = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(d.error || "Não foi possível iniciar a autorização")
      return
    }
    window.location.href = d.url
  }

  /** Sessão do uazapi: GET consulta, POST gera QR novo. */
  async function sessao(item: Integracao, gerarQr: boolean) {
    setSessaoDe(item.id)
    setEstado(null)
    const res = await fetch(`/api/integracoes/uazapi/${item.id}/sessao`, {
      method: gerarQr ? "POST" : "GET",
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(d.error || "Não foi possível falar com o uazapi")
      setSessaoDe(null)
      return
    }
    setEstado(d)
    if (!gerarQr) carregar()
  }

  /** Renomear a conta AQUI, sem tocar na instância do provedor. */
  async function renomear(item: Integracao) {
    const novo = window.prompt(
      `Novo nome para este número no sistema.\n\n` +
        `Só muda aqui: no provedor a conta continua como "${item.referenciaExterna}".`,
      item.rotulo
    )
    if (novo === null) return
    const rotulo = novo.trim()
    if (!rotulo || rotulo === item.rotulo) return

    const res = await fetch(`/api/integracoes/${item.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rotulo }),
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(d.error || "Não foi possível renomear.")
      return
    }
    toast.success(`Agora aparece como "${rotulo}".`)
    carregar()
  }

  /**
   * Pede ao celular o histórico das conversas recentes deste número.
   *
   * Em dois tempos, de propósito: primeiro só quem JÁ é contato da loja.
   * O aparelho é de trabalho, mas tem conversa pessoal; trazer tudo sem
   * perguntar colocaria médico, banco e família no sistema, à vista da equipe.
   */
  async function puxarHistorico(item: Integracao) {
    const confirmado = window.confirm(
      `Puxar o histórico de "${item.rotulo}"?\n\n` +
        `Traz as conversas de quem já é contato da loja. O pedido vai ao celular ` +
        `do número e as mensagens antigas chegam aos poucos — mantenha o aparelho ` +
        `ligado e com internet.`
    )
    if (!confirmado) return

    const pedir = async (escopo: "contatos" | "todas") => {
      const res = await fetch(`/api/integracoes/uazapi/${item.id}/historico`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversas: 20, mensagens: 50, escopo }),
      })
      return { ok: res.ok, d: await res.json().catch(() => ({})) }
    }

    toast.info("Pedindo o histórico ao WhatsApp…")
    const { ok, d } = await pedir("contatos")
    if (!ok) {
      toast.error(d.error || "Não foi possível puxar o histórico.")
      return
    }

    if (d.pedidas === 0 && d.ignorados > 0) {
      const todas = window.confirm(
        `Nenhuma das conversas deste aparelho é de contato já cadastrado na loja.\n\n` +
          `Trazer TODAS as conversas do aparelho? Isso inclui as conversas pessoais ` +
          `deste celular, que passam a ficar visíveis para a loja.`
      )
      if (!todas) {
        toast.info(d.aviso ?? "Nada foi importado.")
        return
      }
      const segunda = await pedir("todas")
      if (!segunda.ok) {
        toast.error(segunda.d.error || "Não foi possível puxar o histórico.")
        return
      }
      toast.success(segunda.d.aviso ?? "Pedido enviado.")
      return
    }

    toast.success(d.aviso ?? "Pedido enviado.")
  }

  /** Traz o catálogo do Bling para o banco (é o que enche a tela de Produtos). */
  async function sincronizarCatalogo() {
    toast.info("Trazendo o catálogo do Bling… isso leva um tempo.")
    const res = await fetch("/api/integracoes/bling/sincronizar", { method: "POST" })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(d.error || "Não foi possível sincronizar o catálogo.")
      return
    }
    toast.success(d.aviso ?? "Catálogo sincronizado.")
    carregar()
  }

  /**
   * Busca foto e grade de tamanhos, peca a peca, pelo detalhe do Bling.
   *
   * Em LOTES, repetindo ate a fila zerar: sao centenas de pecas a 3 requisicoes
   * por segundo, e uma unica requisicao HTTP morreria no tempo limite do proxy
   * antes de terminar. Cada rodada diz quantas faltam, e o progresso aparece no
   * aviso — uma barra que nao anda por tres minutos parece travada.
   */
  async function buscarFotosETamanhos() {
    if (buscandoDetalhes) return
    setBuscandoDetalhes(true)
    let comFoto = 0
    let comGrade = 0

    try {
      for (let rodada = 1; rodada <= RODADAS_MAXIMAS; rodada++) {
        const res = await fetch("/api/integracoes/bling/detalhes", { method: "POST" })
        const d = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error(d.error || "Não foi possível buscar as fotos.")
          return
        }
        comFoto += d.comFoto ?? 0
        comGrade += d.comGrade ?? 0

        if (d.restantes > 0) {
          setProgressoDetalhes(`${d.restantes} peça(s) restantes…`)
          continue
        }
        toast.success(
          `Pronto: ${comFoto} peça(s) ganharam foto e ${comGrade} ganharam grade de tamanhos.`
        )
        return
      }
      toast.info(
        `Parei em ${RODADAS_MAXIMAS} rodadas para não prender a tela. Clique de novo para continuar de onde parou.`
      )
    } finally {
      setBuscandoDetalhes(false)
      setProgressoDetalhes("")
      carregar()
    }
  }

  /** Aponta o webhook da conta para este sistema (uazapi). */
  async function apontarWebhook(item: Integracao) {
    const res = await fetch(`/api/integracoes/uazapi/${item.id}/webhook`, { method: "POST" })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(d.error || "Não foi possível configurar o webhook.")
      return
    }
    toast.success(d.aviso ?? "Webhook configurado.")
  }

  async function desconectar(item: Integracao) {
    // Acao critica: a credencial e apagada de verdade, e reconectar exige
    // passar de novo pelo provedor.
    const confirmado = window.confirm(
      `Desconectar "${item.rotulo}"?\n\nA credencial sera apagada. Para voltar a usar, ` +
        `sera preciso conectar novamente pelo provedor.`
    )
    if (!confirmado) return

    const res = await fetch(`/api/integracoes/${item.id}`, { method: "DELETE" })
    if (res.ok) {
      toast.success("Integracao desconectada")
      carregar()
    } else {
      toast.error("Nao foi possivel desconectar")
    }
  }

  if (semPermissao) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold">Integrações</h1>
        <p className="mt-2 text-muted-foreground">
          Conectar e desconectar integração é função do administrador. Se você precisa
          de acesso a um canal, fale com quem administra a rede.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Integrações</h1>
          <p className="text-muted-foreground">
            Contas conectadas por loja. As credenciais ficam cifradas e nunca são exibidas.
          </p>
        </div>
        {/* Dois caminhos porque os provedores conectam de jeitos diferentes:
            Bling e TikTok por OAuth (o consentimento acontece no site deles),
            os canais de mensagem por token colado a mao. Ate aqui so os de
            OAuth tinham botao, e Instagram, Facebook e os dois WhatsApp nao
            tinham nenhuma forma de ser conectados pela interface. */}
        <div className="flex flex-wrap gap-2">
          <CriarNumero
            pessoas={pessoas}
            onCriado={async (id) => {
              await carregar()
              // Já abre o QR: criar sem parear deixa o número mudo.
              const criada = { id } as Integracao
              sessao(criada, true)
            }}
          />
          <ConectarConta onConectado={carregar} />
          <Button variant="outline" onClick={() => conectar("bling")}>
            {integracoes.some((i) => i.provedor === "bling") ? "Reconectar Bling" : "Conectar Bling"}
          </Button>
          <Button onClick={() => conectar("tiktok")}>
            {integracoes.some((i) => i.provedor === "tiktok_shop")
              ? "Conectar outra loja TikTok"
              : "Conectar TikTok Shop"}
          </Button>
        </div>
      </div>

      {carregando ? (
        <SkeletonTable rows={4} cols={4} />
      ) : integracoes.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-white p-10 text-center">
          <Plug className="mx-auto h-10 w-10 text-neutral-300" aria-hidden="true" />
          <p className="mt-3 font-medium">Nenhuma integração conectada</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Bling, TikTok Shop, Instagram e WhatsApp aparecem aqui depois de conectados.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {integracoes.map((item) => (
            <li
              key={item.id}
              className="rounded-lg border bg-white p-4 flex flex-wrap items-start justify-between gap-4"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{item.rotulo}</span>
                  <Badge variant="outline">{PROVEDORES[item.provedor] ?? item.provedor}</Badge>
                  <Selo status={item.status} expirada={item.expirada} />
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                    {item.escopo === "rede" ? "Toda a rede" : item.loja?.nome ?? "—"}
                  </span>
                  <span className="font-mono text-xs">{item.referenciaExterna}</span>
                  {Object.entries(item.credenciais).map(([chave, mascarado]) => (
                    <span key={chave} className="font-mono text-xs">
                      {chave}: {mascarado}
                    </span>
                  ))}
                </div>

                {item.provedor === "uazapi" && (
                  <div className="mt-2">
                    <SeletorDeVendedora
                      integracaoId={item.id}
                      vendedorId={item.vendedorId}
                      pessoas={pessoas}
                      onTrocado={carregar}
                    />
                  </div>
                )}

                {item.ultimoErro && (
                  <p className="mt-2 inline-flex items-start gap-1.5 text-sm text-red-600">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {item.ultimoErro}
                  </p>
                )}
              </div>

              <div className="flex gap-2">
                {item.provedor === "uazapi" && (
                  <>
                    <Button variant="outline" size="sm" onClick={() => sessao(item, false)}>
                      Sessão
                    </Button>
                    {/* Número criado à mão no painel costuma ficar sem webhook: a
                        mensagem chega no WhatsApp e nunca aparece aqui. */}
                    <Button variant="outline" size="sm" onClick={() => apontarWebhook(item)}>
                      Apontar webhook
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => puxarHistorico(item)}>
                      Puxar histórico
                    </Button>
                  </>
                )}
                {item.provedor === "bling" && (
                  <>
                    <Button variant="outline" size="sm" onClick={sincronizarCatalogo}>
                      Sincronizar catálogo
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={buscarFotosETamanhos}
                      disabled={buscandoDetalhes}
                    >
                      {progressoDetalhes || "Buscar fotos e tamanhos"}
                    </Button>
                  </>
                )}
                <Button variant="outline" size="sm" onClick={() => renomear(item)}>
                  Renomear
                </Button>
                <Button variant="outline" size="sm" onClick={() => desconectar(item)}>
                  Desconectar
                </Button>
              </div>

              {sessaoDe === item.id && (
                <div className="w-full rounded-md border bg-neutral-50 p-4">
                  {estado === null ? (
                    <p className="text-sm text-muted-foreground">Consultando o uazapi…</p>
                  ) : (
                    <div className="flex flex-wrap items-center gap-4">
                      <div className="text-sm">
                        <p>
                          Sessão: <strong>{estado.status}</strong>
                          {estado.numero && <span className="ml-2 font-mono">{estado.numero}</span>}
                        </p>
                        {estado.status !== "conectado" && (
                          <p className="mt-1 text-muted-foreground">
                            Leia o QR no WhatsApp do celular da loja:
                            Aparelhos conectados → Conectar aparelho.
                            O código expira em segundos — gere outro se não der tempo.
                          </p>
                        )}
                      </div>
                      {estado.qrcode && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={
                            estado.qrcode.startsWith("data:")
                              ? estado.qrcode
                              : `data:image/png;base64,${estado.qrcode}`
                          }
                          alt="QR code para parear o WhatsApp"
                          className="h-44 w-44 rounded border bg-white p-1"
                        />
                      )}
                      <Button size="sm" onClick={() => sessao(item, true)}>
                        {estado.qrcode ? "Gerar outro QR" : "Gerar QR code"}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        Bling e TikTok Shop conectam por aqui (OAuth) e são <strong>somente leitura</strong>:
        o sistema consulta catálogo, saldo e pedidos, e não escreve nada nesses
        sistemas. Instagram, Facebook e WhatsApp são conectados colando o token da
        conta — as chaves esperadas de cada um estão na documentação da API.
      </p>
      <p className="text-xs text-muted-foreground">
        Uma conta do TikTok Shop nasce sem loja definida: escolha a loja depois de
        conectar, porque o TikTok Shop é por loja.
      </p>
      {integracoes.some((i) => i.provedor === "uazapi") && (
        <p className="inline-flex items-start gap-1.5 text-xs text-amber-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            <strong>WhatsApp (uazapi)</strong> não é a API oficial: é uso fora dos termos
            do WhatsApp e o número <strong>pode ser banido</strong>. A sessão cai e exige
            ler o QR de novo, e não há template aprovado — disparo em massa por esses
            números aumenta muito o risco. Números na API oficial da Meta não têm esse
            problema.
          </span>
        </p>
      )}
    </div>
  )
}
