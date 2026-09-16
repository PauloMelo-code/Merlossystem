import "server-only";
import type { EscopoLoja } from "@/lib/auth/loja";
import {
  abrirAlerta,
  atualizarComTrava,
  atualizarEstado,
  type ContextoDeGravacao,
  type NovoAlerta,
  type Transacao,
} from "@/lib/db/mutacoes";
import { alertas } from "@/lib/db/schema/alertas";

/**
 * As TRÊS gravações do módulo de alertas (01-dados.md §6.6), todas pelos
 * helpers de `mutacoes.ts`:
 *
 *   abrir      estado de sistema: dedupe no único parcial
 *              `(loja_id, chave_deduplicacao) WHERE resolvido_em IS NULL`,
 *              sem trilha, autor ATOR_SISTEMA;
 *   resolver   SÓ quem gera (o gerador, ou a reconciliação para o tipo dela):
 *              `resolvido_em` é estado de sistema, sem trava nem trilha;
 *   reconhecer a pessoa marca ciência: trava de colisão e trilha
 *              `alerta_reconhecido`.
 */

/** `true` quando nasceu linha nova; `false` quando a dedupe segurou. */
export async function abrir(tx: Transacao, alerta: NovoAlerta): Promise<boolean> {
  return (await abrirAlerta(tx, alerta)) !== null;
}

export async function resolver(
  tx: Transacao,
  alvo: { id: string; lojaId: string },
  quando: Date,
): Promise<void> {
  await atualizarEstado(
    tx,
    alertas,
    { id: alvo.id, escopo: { tipo: "uma", lojaId: alvo.lojaId } },
    { resolvido_em: quando },
  );
}

export type AlvoReconhecimento = {
  id: string;
  escopo: EscopoLoja;
  updatedAtOriginal: Date;
};

/** Alerta de outra loja vira 404; duas pessoas ao mesmo tempo, 409. */
export async function reconhecer(
  tx: Transacao,
  alvo: AlvoReconhecimento,
  ctx: ContextoDeGravacao,
): Promise<void> {
  await atualizarComTrava(
    tx,
    alertas,
    { ...alvo, dados: { reconhecido_em: new Date(), reconhecido_por: ctx.autorId } },
    ctx,
    "alerta_reconhecido",
  );
}
