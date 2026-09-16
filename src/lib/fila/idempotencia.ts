/**
 * `jobId` determinístico (03-arquitetura.md §8.2).
 *
 * Não existe tabela `jobs`. O que impede o reprocessamento de duplicar é o par:
 * (a) `jobId` determinístico — o BullMQ recusa o segundo job com o mesmo id
 * enquanto ele estiver na fila; e (b) os índices únicos que já existem no
 * modelo, que seguram o que escapa da janela do (a):
 *
 *   `lojas_integracoes_eventos (provedor, evento_externo_id)`
 *   `conversas_mensagens (loja_id, externo_id)`
 *   `conversas_mensagens (conversa_id, chave_idempotencia)`
 *   `campanhas_destinatarios (campanha_id, contato_id)`
 *
 * O BullMQ usa `:` como separador nas próprias chaves do Redis. Um `jobId` com
 * `:` não quebra ruidosamente: ele colide com o espaço de nomes interno e o job
 * some sem erro. Por isso `assertJobIdPart` reprova, e reprova ANTES de
 * enfileirar — falha na hora de programar, não de madrugada.
 *
 * Módulo puro: é lido por trava de fonte e roda em Node puro.
 */

/** Marcadores que só existem porque alguém ia voltar depois e não voltou. */
const PLACEHOLDERS = new Set(["todo", "tbd", "fixme", "xxx", "undefined", "null", "nan"]);

export class ErroDeJobId extends Error {
  constructor(parte: string, motivo: string) {
    super(`parte de jobId inválida (${motivo}): ${JSON.stringify(parte)}`);
    this.name = "ErroDeJobId";
  }
}

/**
 * Reprova parte vazia, com `:` e placeholder. `String(undefined)` vira
 * `"undefined"`, que é exatamente o id que faria dois eventos diferentes
 * dividirem a mesma chave e o segundo ser descartado em silêncio.
 */
export function assertJobIdPart(parte: unknown): string {
  if (typeof parte !== "string") throw new ErroDeJobId(String(parte), "não é string");
  const limpa = parte.trim();
  if (limpa === "") throw new ErroDeJobId(parte, "vazia");
  if (limpa.includes(":")) throw new ErroDeJobId(parte, "contém ':'");
  if (PLACEHOLDERS.has(limpa.toLowerCase())) throw new ErroDeJobId(parte, "placeholder");
  return limpa;
}

/**
 * Monta o id juntando as partes com `-`. A primeira parte é sempre o que
 * identifica o TIPO do trabalho (`evento`, `envio`, `lote`), para dois domínios
 * com o mesmo id externo não colidirem.
 */
export function jobId(...partes: unknown[]): string {
  if (partes.length === 0) throw new ErroDeJobId("", "sem partes");
  return partes.map(assertJobIdPart).join("-");
}
