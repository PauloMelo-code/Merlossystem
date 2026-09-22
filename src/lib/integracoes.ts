import { z } from "zod"
import { resumoPublico } from "@/lib/cofre"

export * from "./integracoes-catalogo"
import { PROVEDORES, CHAVES_ESPERADAS, STATUS, type Provedor } from "./integracoes-catalogo"

/** Chaves exigidas que nao vieram. Vazio = tudo certo. */
export function chavesFaltando(provedor: string, credenciais: Record<string, string>): string[] {
  const esperadas = CHAVES_ESPERADAS[provedor as Provedor]
  if (!esperadas) return []
  return esperadas.filter((k) => !credenciais[k])
}

export const integracaoSchema = z.object({
  provedor: z.enum(PROVEDORES),
  rotulo: z.string().min(1, "Informe um rotulo para reconhecer a conta"),
  referenciaExterna: z.string().min(1, "Informe o identificador da conta no provedor"),
  /** Pares chave/valor. Vao cifrados; nunca voltam pela API. */
  credenciais: z.record(z.string(), z.string()).default({}),
  expiraEm: z.string().datetime().optional().nullable(),
})

export const atualizacaoSchema = z.object({
  rotulo: z.string().min(1).optional(),
  status: z.enum(STATUS).optional(),
  credenciais: z.record(z.string(), z.string()).optional(),
  expiraEm: z.string().datetime().optional().nullable(),
  /** Vendedora dona do numero. `null` tira o dono; ausente nao mexe. */
  vendedorId: z.string().uuid().nullable().optional(),
})

/** Campos do registro que a API pode devolver. */
type RegistroInterno = {
  id: string
  storeId: string | null
  provedor: string
  rotulo: string
  status: string
  credenciaisCifradas: string | null
  referenciaExterna: string
  expiraEm: Date | null
  ultimoErro: string | null
  ultimaSincronizacao: Date | null
  createdAt: Date
  updatedAt: Date
  store?: { id: string; nome: string } | null
  vendedorId?: string | null
  vendedor?: { id: string; name: string } | null
}

/**
 * Converte o registro do banco no que a API devolve.
 *
 * O segredo NAO sai daqui: `credenciaisCifradas` vira `credenciais`, um mapa
 * de chave -> valor mascarado. Ler o segredo e privilegio do servidor.
 */
export function paraApi(r: RegistroInterno) {
  return {
    id: r.id,
    storeId: r.storeId,
    loja: r.store ? { id: r.store.id, nome: r.store.nome } : null,
    escopo: r.storeId ? "loja" : "rede",
    provedor: r.provedor,
    rotulo: r.rotulo,
    status: r.status,
    referenciaExterna: r.referenciaExterna,
    vendedorId: r.vendedorId ?? null,
    vendedor: r.vendedor ? { id: r.vendedor.id, nome: r.vendedor.name } : null,
    credenciais: resumoPublico(r.credenciaisCifradas),
    expiraEm: r.expiraEm,
    expirada: r.expiraEm ? r.expiraEm.getTime() < Date.now() : false,
    ultimoErro: r.ultimoErro,
    ultimaSincronizacao: r.ultimaSincronizacao,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}
