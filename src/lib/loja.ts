import type { Role } from "@/lib/rbac"

/**
 * `Merlos Centro` -> `merlos-centro`.
 *
 * Vive aqui, e nao no route handler, porque o Next proibe rota exportar
 * qualquer coisa alem dos verbos HTTP — e porque duas rotas usam.
 *
 * O slug entra na URL de webhook: muda-lo obriga a reconfigurar os canais.
 */
export function gerarSlug(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 40)
}

/**
 * Escopo de loja — o que impede o Centro de ver o Cerro Azul.
 *
 * Regra (docs/integracoes.md, decisoes 1 e 2):
 *   vendedor/viewer -> presos a loja do proprio cadastro;
 *   admin/gerente   -> alcancam as duas, e escolhem por parametro.
 *
 * A loja do vendedor vem SEMPRE da sessao. Aceitar loja do cliente seria o
 * mesmo erro da autoria que ja corrigimos: parametro de navegador e
 * falsificavel.
 */

/** Papeis que alcancam todas as lojas. */
export const PAPEIS_GESTAO: readonly Role[] = ["admin", "gerente"]

export function ehGestao(role: string | undefined): boolean {
  return PAPEIS_GESTAO.includes(role as Role)
}

export type UsuarioComLoja = {
  id: string
  role: string
  /** Nulo para papel de gestao. */
  storeId: string | null
}

/**
 * Filtro de loja para o `where` do Prisma.
 *
 *   vendedor            -> { storeId: "<loja dele>" }
 *   gestao sem filtro   -> {}                    (as duas lojas)
 *   gestao com ?loja=x  -> { storeId: "x" }
 *
 * Usar em TODA consulta de dado operacional:
 *
 *   const where = { ...escopoDaLoja(usuario, req), status: "open" }
 */
/**
 * Filtro de ATENDIMENTO, para somar ao de loja nas consultas de conversa.
 *
 * Cada numero de WhatsApp tem a sua vendedora, e a conversa que entra por ele
 * e dela. A loja inteira enxergar tudo expoe conversa de cliente de uma
 * vendedora para as colegas — inclusive dado pessoal da cliente e negociacao
 * de preco. Entao:
 *
 *   vendedor           -> conversas do numero dela + as que passaram para ela
 *   admin e gerente    -> tudo da loja (precisam para cobrir e conferir)
 *   viewer             -> tudo da loja (papel de observacao, ja sem escrita)
 *
 * Vale para o `where` de `conversation`; para `message`, use dentro de
 * `{ conversation: escopoDoAtendimento(usuario) }`.
 */
export function escopoDoAtendimento(usuario: UsuarioComLoja): Record<string, unknown> {
  if (usuario.role !== "vendedor") return {}
  return {
    OR: [
      // O que passaram para ela, mesmo que o numero seja de outra.
      { assignedTo: usuario.id },
      // Tudo que entra pelo numero dela, inclusive o que ainda nao tem dono.
      { integracao: { vendedorId: usuario.id } },
    ],
  }
}

export function escopoDaLoja(
  usuario: UsuarioComLoja,
  lojaPedida?: string | null
): { storeId?: string } {
  if (!ehGestao(usuario.role)) {
    // Vendedor sem loja nao existe (constraint no banco), mas se acontecer o
    // escopo tem que fechar, nao abrir.
    return { storeId: usuario.storeId ?? "__sem_loja__" }
  }
  return lojaPedida ? { storeId: lojaPedida } : {}
}

/**
 * Loja em que um registro novo vai nascer.
 *
 * Devolve `null` quando quem cria e da gestao e nao disse qual loja — nesse
 * caso a rota responde 400. Criar registro "sem loja" ou chutando uma das duas
 * e pior do que recusar.
 */
export function lojaParaGravar(
  usuario: UsuarioComLoja,
  lojaPedida?: string | null
): string | null {
  if (!ehGestao(usuario.role)) return usuario.storeId
  return lojaPedida || null
}

/** Nome do cookie que guarda a loja escolhida no seletor. */
export const COOKIE_LOJA = "loja_ativa"

/**
 * Loja pedida na requisicao: `?loja=` na URL, senao o cookie do seletor.
 *
 * Os dois vem do cliente e valem o mesmo — por isso quem decide se eles contam
 * e `escopoDaLoja`, que so honra a escolha para papel de gestao. Vendedor pode
 * forjar cookie a vontade: o servidor usa a loja do cadastro dele.
 *
 * O cookie existe para o seletor nao precisar ser costurado nas ~48 chamadas
 * `fetch` espalhadas pelos componentes: cookie ja viaja em todas.
 */
export function lojaAtiva(req: Request): string | null {
  const naUrl = new URL(req.url).searchParams.get("loja")
  if (naUrl) return naUrl

  const cookies = req.headers.get("cookie")
  if (!cookies) return null
  for (const parte of cookies.split(";")) {
    const [nome, ...resto] = parte.trim().split("=")
    if (nome === COOKIE_LOJA) return decodeURIComponent(resto.join("=")) || null
  }
  return null
}

/** Resposta padrao quando a gestao esquece de escolher a loja ao criar. */
export function faltaLoja() {
  return Response.json(
    { error: "Informe a loja (?loja=<id>) para criar este registro" },
    { status: 400 }
  )
}

/**
 * Confere que um registro referenciado pertence a mesma loja.
 *
 * Sem isto, o escopo protege a LISTAGEM mas nao a ESCRITA: bastava mandar no
 * corpo o `contactId` da outra loja para criar um pedido cruzado. O filtro do
 * `where` nao pega isso — o id vem do body, nao da consulta.
 *
 *   const contato = await prisma.contact.findFirst({
 *     where: { id: data.contactId, ...escopoDaLoja(usuario) },
 *   })
 *   if (!contato) return foraDaLoja("contato")
 */
export function foraDaLoja(oQue: string) {
  return Response.json(
    { error: `${oQue} nao encontrado nesta loja` },
    { status: 404 }
  )
}

/**
 * Loja de um webhook de entrada.
 *
 * Webhook nao tem sessao: a loja vem da URL configurada no provedor —
 * `/api/webhooks/whatsapp?loja=centro`. Cada loja registra a propria URL.
 *
 * ponytail: slug na query resolve a etapa 1 com dois numeros distintos. Na
 * etapa 3 isso vira `stores_integracoes`, que identifica a CONTA e nao so a
 * loja — necessario quando a mesma loja tiver varios numeros.
 *
 * Devolve `null` quando a loja nao veio ou nao existe. O chamador responde 200
 * e descarta: criar conversa numa loja chutada e pior do que perder o evento.
 */
export async function lojaDoWebhook(
  req: Request,
  buscarPorSlug: (slug: string) => Promise<{ id: string } | null>
): Promise<string | null> {
  const slug = new URL(req.url).searchParams.get("loja")
  if (!slug) return null
  const loja = await buscarPorSlug(slug)
  return loja?.id ?? null
}
