import "server-only";
import { naoImplementado } from "@/lib/erros";

/**
 * COSTURA — dono: M2, consumida por M8 (job `manutencao/limpar-midia` vindo da
 * anonimização). Assinatura final criada pela integração (D11).
 *
 * Grava `lgpd_solicitacoes.resultado.objetos_removidos = n` da solicitação de
 * eliminação. Idempotente: o job pode rodar de novo e regravar o mesmo número.
 */
export async function registrarObjetosRemovidos(solicitacaoId: string, n: number): Promise<void> {
  void solicitacaoId;
  void n;
  throw naoImplementado("registro de objetos removidos da solicitação LGPD (M2)");
}
