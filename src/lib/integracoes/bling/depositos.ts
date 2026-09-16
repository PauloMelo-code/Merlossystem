import "server-only";
import { contaBling } from "./cliente";
import { PRODUTOS_POR_PAGINA } from "./config";
import { listarDepositos } from "./leitura";

/**
 * COSTURA — dono: M4, consumida por M5 (tela de lojas escolhe o depósito em
 * vez de digitar o id). Assinatura final criada pela integração (D11).
 *
 * SOMENTE LEITURA (T26): `GET /depositos` na conta Bling da rede, pelo mesmo
 * balde de 3 req/s de `lerDoBling`. Sem conta conectada, `ErroDeIntegracao`
 * permanente — a tela cai no campo digitado. Sem cache: a tela de lojas é rara.
 */

export type DepositoBling = {
  /** Id numérico do Bling, como texto (é o que `lojas` guarda). */
  id: string;
  descricao: string;
  padrao: boolean;
  ativo: boolean;
};

/** A rede tem poucos depósitos; o teto só evita laço sem fim. */
const PAGINAS_MAXIMAS = 10;

export async function listarDepositosBling(): Promise<DepositoBling[]> {
  const conta = await contaBling();
  const todos: DepositoBling[] = [];
  for (let pagina = 1; pagina <= PAGINAS_MAXIMAS; pagina += 1) {
    const lista = await listarDepositos(conta, pagina);
    todos.push(...lista);
    if (lista.length < PRODUTOS_POR_PAGINA) break;
  }
  return todos;
}
