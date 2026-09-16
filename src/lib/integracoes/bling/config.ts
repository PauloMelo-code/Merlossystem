import type { Regra } from "@/lib/seguranca/limite";

/**
 * Constantes do cliente Bling (03-arquitetura.md §12.1, ADR 0015).
 *
 * O Bling é a autoridade de produto, preço e estoque da rede, e este sistema só
 * LÊ dele. A conta é única (`lojas_integracoes.provedor = 'bling'`,
 * `loja_id` nulo) e o depósito de cada loja vem de `lojas.bling_deposito_id`.
 *
 * API v3 conferida na collection OpenAPI oficial (docs/integracoes.md): o
 * prefixo é `/Api/v3`. Nome de campo muda com o tempo — `leitura.ts` valida a
 * resposta com Zod tolerante e descarta o que não reconhece.
 */

export const BLING_API = "https://api.bling.com.br/Api/v3";

/**
 * 3 requisições por segundo POR CONTA. É o limite da Bling para a rede
 * inteira: a tela de venda e o job `sincronizar-bling` usam o MESMO balde
 * (chave abaixo), senão seriam 6 req/s e a Bling corta a integração.
 */
export const LIMITE_BLING: Regra = { janela: 1, max: 3 };

export function chaveDoLimitador(integracaoId: string): string {
  return `limite:bling:${integracaoId}`;
}

/** Quantas vezes o cliente espera a vez no balde antes de desistir. */
export const ESPERAS_MAXIMAS = 12;
export const ESPERA_MS = 350;

/** Cache de saldo: 60 s por depósito, com single-flight (§12.1). */
export const CACHE_SALDO_MS = 60_000;

/** Teto do corpo lido: a listagem de 100 produtos cabe com folga. */
export const TETO_RESPOSTA = 4 * 1024 * 1024;

/** Paginação da listagem de produtos (máximo aceito pela API v3). */
export const PRODUTOS_POR_PAGINA = 100;

/** Quantos produtos por consulta de saldo (a query string tem teto). */
export const SALDOS_POR_CONSULTA = 50;

/**
 * Chave do JSON cifrado no cofre em que o OAuth (pacote M5,
 * `src/lib/integracoes/oauth.ts`) guarda o token de acesso.
 */
export const CAMPO_TOKEN = "access_token";
