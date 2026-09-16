import type { Transacao } from "@/lib/db/mutacoes";

/**
 * COSTURA — dono: R2-A (pós-venda). Consumida pelo gerador de alertas de M8
 * via `src/lib/alertas/fontes-r2.ts`. Só leitura; NÃO importa `@/lib/alertas`
 * (a forma é estrutural, igual a `CandidatoDeAlerta`).
 *
 * `conversaId` vai nulo de propósito: o alerta abre o negócio (`/funil/<id>`).
 * Chave de deduplicação: `negocio-parado-<id>` (prefixo da fonte).
 */
export type CandidatoDeAlertaDeNegocio = {
  tipo: "negocio_parado";
  severidade: "alta";
  mensagem: string;
  chaveDeduplicacao: string;
  negocioId: string;
  contatoId: string;
  conversaId: null;
  pedidoId: null;
};

/**
 * R2-FN-11 (ADR 0035): vivos, estágio `negociando`|`fechando`,
 * `ultima_atividade_em < agora − 3 dias`, na loja. Até o R2-A preencher, não
 * existe negócio no banco: nenhuma fonte, nenhum alerta.
 */
export async function candidatosDeAlertaDeNegocio(
  _tx: Transacao,
  _lojaId: string,
  _agora: Date,
): Promise<CandidatoDeAlertaDeNegocio[]> {
  return [];
}
