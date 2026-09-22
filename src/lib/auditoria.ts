import { prisma } from "@/lib/db/prisma"

/**
 * Trilha de auditoria: quem fez, o que, quando.
 *
 * A tabela `activity_logs` existia desde o inicio e estava VAZIA — a unica
 * escrita era a propria rota `POST /api/activity-logs`, que ninguem chamava.
 * O painel de auditoria lia uma tabela sem linhas, e a regra da base ("toda
 * acao do usuario deve ser registrada: quem, o que, quando") nao era cumprida
 * em lugar nenhum do sistema.
 *
 * Duas decisoes que valem explicar:
 *
 * 1. NUNCA derruba a operacao. Se o registro falhar, a acao do usuario ja
 *    aconteceu — abortar depois do fato deixaria o sistema em estado pior do
 *    que ficar sem a linha de log. O erro vai para o console e segue.
 *
 * 2. Nao guarda o valor de segredo. `details` vira resposta de API na tela de
 *    auditoria; credencial, token e senha nao entram (`limparDetalhes`).
 */

/** Acoes registradas. Lista fechada para o painel poder filtrar e agrupar. */
export const ACOES = [
  "usuario_criado",
  "usuario_alterado",
  "usuario_desativado",
  "usuario_reativado",
  /** Troca feita pela PROPRIA pessoa, em /api/perfil. O valor nunca entra. */
  "senha_alterada",
  "integracao_conectada",
  "integracao_desconectada",
  "conversa_resolvida",
  "conversa_transferida",
  "pedido_lancado_masc",
  "contato_apagado_lgpd",
  "campanha_disparada",
] as const
export type Acao = (typeof ACOES)[number]

/** Chaves que nunca entram no log, mesmo que venham no objeto de detalhes. */
const SEGREDOS = /senha|password|token|secret|credencia|authorization|apikey|api_key/i

function limparDetalhes(detalhes: Record<string, unknown>): Record<string, unknown> {
  const limpo: Record<string, unknown> = {}
  for (const [chave, valor] of Object.entries(detalhes)) {
    limpo[chave] = SEGREDOS.test(chave) ? "[omitido]" : valor
  }
  return limpo
}

/**
 * IP de quem fez, atras do proxy.
 *
 * `x-forwarded-for` e do cliente e pode ser forjado; guardamos assim mesmo
 * porque serve de pista numa investigacao, nao de prova. O primeiro item da
 * lista e o mais proximo do usuario real.
 */
export function ipDaRequisicao(req: Request): string | null {
  const encaminhado = req.headers.get("x-forwarded-for")
  if (encaminhado) return encaminhado.split(",")[0].trim() || null
  return req.headers.get("x-real-ip")
}

export async function registrar(opts: {
  /** Nulo em acao de REDE: cadastrar admin, conectar o Bling. */
  storeId: string | null
  /** Nulo quando a acao veio de webhook ou de rotina, sem usuario. */
  userId: string | null
  acao: Acao
  entidade?: string
  entidadeId?: string
  detalhes?: Record<string, unknown>
  req?: Request
}): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        storeId: opts.storeId,
        userId: opts.userId,
        action: opts.acao,
        entityType: opts.entidade ?? null,
        entityId: opts.entidadeId ?? null,
        details: limparDetalhes(opts.detalhes ?? {}),
        ipAddress: opts.req ? ipDaRequisicao(opts.req) : null,
      },
    })
  } catch (e) {
    // Ver decisao 1 no cabecalho: a acao ja aconteceu.
    console.error(`[auditoria] falhou ao registrar ${opts.acao}:`, e)
  }
}

/**
 * O que mudou, campo a campo — para o log dizer "trocou X de A para B" em vez
 * de so "alterou".
 *
 * So compara o que veio em `depois`: os campos que a edicao nao tocou nao
 * viram ruido na trilha.
 */
export function diferenca(
  antes: Record<string, unknown>,
  depois: Record<string, unknown>
): Record<string, { de: unknown; para: unknown }> {
  const mudou: Record<string, { de: unknown; para: unknown }> = {}
  for (const [chave, novo] of Object.entries(depois)) {
    if (novo === undefined) continue
    if (antes[chave] !== novo) mudou[chave] = { de: antes[chave], para: novo }
  }
  return mudou
}
