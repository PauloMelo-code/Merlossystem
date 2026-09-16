/**
 * Cursor `(created_at, id)` das listas do M6 (04-ui.md §8.1). Módulo PURO.
 *
 * Vai para a URL como texto opaco. Lixo na URL vira "sem cursor" (primeira
 * página), nunca erro do Postgres.
 */

export type Cursor = { em: Date; id: string };
export type Direcao = "proxima" | "anterior";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function codificarCursor(em: Date, id: string): string {
  return `${em.getTime()}_${id}`;
}

export function decodificarCursor(texto: string | undefined | null): Cursor | null {
  if (!texto) return null;
  const [ms, id] = texto.split("_");
  const numero = Number(ms);
  if (!id || !UUID.test(id) || !Number.isSafeInteger(numero) || numero <= 0) return null;
  return { em: new Date(numero), id };
}

export function lerDirecao(texto: string | undefined | null): Direcao {
  return texto === "anterior" ? "anterior" : "proxima";
}

/** Tamanho de página aceito pela `PaginacaoCursor`. */
export function lerPorPagina(texto: string | undefined | null): 25 | 50 | 100 {
  return texto === "25" ? 25 : texto === "100" ? 100 : 50;
}

/**
 * Monta a página a partir de `limite + 1` linhas lidas na direção pedida.
 * `temAnterior`/`temProxima` decidem se o botão correspondente liga.
 */
export function montarPagina<T extends { id: string; criadoEm: Date }>(
  linhas: T[],
  limite: number,
  direcao: Direcao,
  haviaCursor: boolean,
): { itens: T[]; cursorAnterior: string | null; cursorProximo: string | null } {
  const sobrou = linhas.length > limite;
  const fatia = linhas.slice(0, limite);
  const itens = direcao === "anterior" ? fatia.reverse() : fatia;
  const temAnterior = direcao === "anterior" ? sobrou : haviaCursor;
  const temProxima = direcao === "anterior" ? haviaCursor : sobrou;
  const primeiro = itens[0];
  const ultimo = itens[itens.length - 1];
  return {
    itens,
    cursorAnterior: temAnterior && primeiro ? codificarCursor(primeiro.criadoEm, primeiro.id) : null,
    cursorProximo: temProxima && ultimo ? codificarCursor(ultimo.criadoEm, ultimo.id) : null,
  };
}
