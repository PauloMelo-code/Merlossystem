import "server-only";
import type { Contexto } from "@/lib/auth/guard";
import type { Transacao } from "@/lib/db/mutacoes";
import { reconhecer } from "./escrita";

/**
 * API pública do módulo `alertas` (03-arquitetura.md §4.2): regras, geração,
 * reconhecimento e resolução pelo gerador.
 */

export { gerarAlertas, type ResumoDaGeracao } from "./gerador";
export {
  contarAlertas,
  listarAlertas,
  type AlertaNaLista,
  type ContadoresAlertas,
  type FiltrosAlertas,
} from "./_consultas";
export { PRAZOS_SLA_TEXTO, rotaDoAlerta, TIPOS_GERADOS_R1 } from "./regras";

/**
 * A pessoa só RECONHECE (marca ciência). Nunca resolve: `resolvido_em` é do
 * gerador. Escopo e trava de colisão vão para a gravação — alerta de outra loja
 * vira 404, e duas pessoas reconhecendo ao mesmo tempo, 409.
 */
export async function reconhecerAlerta(
  dados: { id: string; updatedAt: Date },
  ctx: Contexto,
  tx: Transacao,
): Promise<void> {
  await reconhecer(
    tx,
    { id: dados.id, escopo: ctx.escopo, updatedAtOriginal: dados.updatedAt },
    ctx,
  );
}
export { encontrarDivergencias, reconciliar, type Divergencia } from "./reconciliacao";
