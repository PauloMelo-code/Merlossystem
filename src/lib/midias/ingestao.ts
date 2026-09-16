import type { Contexto } from "@/lib/auth/guard";
import type { Transacao } from "@/lib/db/mutacoes";
import { naoImplementado } from "@/lib/erros";

/**
 * COSTURA — dono: M3, consumida por M1 (05-plano-construcao.md §5).
 *
 * Entrada de mídia que veio de fora: anexo de mensagem recebida. Dois caminhos,
 * um registro só:
 *
 *   `bytes` — o provedor já mandou o binário; sobe ao MinIO e grava a linha.
 *   `url`   — o provedor mandou um endereço; grava a linha com `url_externa`
 *             e `baixada = false`, e o job `midia/baixar-de-url` busca depois,
 *             SEMPRE por `rede/buscarExterno.ts`. `url_externa` é coluna de
 *             trabalho: some quando `baixada = true` e NUNCA entra em DTO
 *             (01-dados.md R-09; trava `dto-midia`).
 *
 * Recebe `tx` porque a linha da mídia e a da mensagem têm de nascer juntas: uma
 * mensagem com anexo que não existe é a tela mostrando um clipe quebrado.
 * O binário, esse, sobe FORA da transação — o MinIO não faz rollback.
 */

export type MidiaRecebida = {
  lojaId: string;
  /** Provedor que entregou: entra na trilha e decide a allowlist do download. */
  origem: string;
  bytes?: Buffer;
  url?: string;
  tipoMime?: string;
  nomeOriginal?: string;
};

export async function guardarMidiaRecebida(
  _tx: Transacao,
  midia: MidiaRecebida,
  ctx: Contexto,
): Promise<{ midiaId: string }> {
  throw naoImplementado(
    `guardarMidiaRecebida [provedor ${midia.origem}, origem ${ctx.origem}] (ingestão de mídia, pacote M3)`,
  );
}
