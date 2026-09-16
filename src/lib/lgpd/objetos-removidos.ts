import "server-only";
import { z } from "zod";
import {
  atualizarComTrava,
  contextoDeSistema,
  emTransacao,
  type Transacao,
} from "@/lib/db/mutacoes";
import { lgpd_solicitacoes } from "@/lib/db/schema/lgpd";
import { ErroDeEscopo } from "@/lib/erros";
import { eliminacaoParaGravar } from "./_consultas";

/**
 * COSTURA — dono: M2, consumida por M8 (job `manutencao/limpar-midia` vindo da
 * anonimização, 01-dados-dominio.md §8). Assinatura final criada pela
 * integração (D11).
 *
 * Grava `lgpd_solicitacoes.resultado.objetos_removidos = n` da solicitação de
 * eliminação, pelo ATOR_SISTEMA, com a trilha `lgpd_anonimizado` na entidade
 * `lgpd_solicitacoes` (o fim da parte de arquivo da eliminação). Idempotente:
 * o job pode rodar de novo; o mesmo número não regrava nem duplica a trilha.
 */

const cargaSchema = z.object({ solicitacaoId: z.uuid(), n: z.number().int().min(0) });

export async function registrarObjetosRemovidos(solicitacaoId: string, n: number): Promise<void> {
  const carga = cargaSchema.parse({ solicitacaoId, n });
  const ctx = contextoDeSistema({ origem: "worker" });
  await emTransacao(ctx, (tx) => gravarObjetosRemovidos(tx, carga.solicitacaoId, carga.n));
}

/** O corpo, numa transação já aberta. Devolve `false` quando nada mudou. */
export async function gravarObjetosRemovidos(
  tx: Transacao,
  solicitacaoId: string,
  n: number,
): Promise<boolean> {
  const atual = await eliminacaoParaGravar(tx, { tipo: "todas" }, solicitacaoId);
  if (!atual?.resultado) throw new ErroDeEscopo();
  if (atual.resultado.objetos_removidos === n) return false;
  const ctx = contextoDeSistema({ origem: "worker", lojaId: atual.lojaId });
  await atualizarComTrava(
    tx,
    lgpd_solicitacoes,
    {
      id: solicitacaoId,
      escopo: ctx.escopo,
      updatedAtOriginal: atual.updatedAt,
      dados: { resultado: { ...atual.resultado, objetos_removidos: n } },
    },
    ctx,
    "lgpd_anonimizado",
  );
  return true;
}
