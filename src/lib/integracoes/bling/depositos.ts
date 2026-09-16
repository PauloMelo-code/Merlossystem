import "server-only";
import { naoImplementado } from "@/lib/erros";

/**
 * COSTURA — dono: M4, consumida por M5 (tela de lojas escolhe o depósito em
 * vez de digitar o id). Assinatura final criada pela integração (D11).
 *
 * SOMENTE LEITURA (T26): `GET /depositos` na conta Bling da rede. Sem conta
 * conectada, `ErroDeIntegracao` permanente — a tela cai no campo digitado.
 */

export type DepositoBling = {
  /** Id numérico do Bling, como texto (é o que `lojas` guarda). */
  id: string;
  descricao: string;
  padrao: boolean;
  ativo: boolean;
};

export async function listarDepositosBling(): Promise<DepositoBling[]> {
  throw naoImplementado("lista de depósitos do Bling (M4)");
}
