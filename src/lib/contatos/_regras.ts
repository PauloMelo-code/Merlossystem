/**
 * Regras puras da carteira: cursor e CSV. Sem banco, sem `server-only` — a
 * unidade testa direto.
 */

/** Cursor `(ultimo_contato_em, id)` de 04-ui.md §8.1, com `null` possível. */
export type Cursor = { t: string | null; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function codificarCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

/** Cursor adulterado vira `null` (primeira página), nunca erro nem SQL. */
export function decodificarCursor(texto: string | undefined): Cursor | null {
  if (!texto) return null;
  try {
    const bruto = JSON.parse(Buffer.from(texto, "base64url").toString("utf8")) as unknown;
    if (typeof bruto !== "object" || bruto === null) return null;
    const { t, id } = bruto as Record<string, unknown>;
    if (typeof id !== "string" || !UUID.test(id)) return null;
    if (t === null) return { t: null, id };
    if (typeof t !== "string" || Number.isNaN(Date.parse(t))) return null;
    return { t: new Date(t).toISOString(), id };
  } catch {
    return null;
  }
}

/** Escapa `%`, `_` e `\` para o termo entrar num `ILIKE` como texto literal. */
export function escaparLike(termo: string): string {
  return termo.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Célula de CSV. Aspas sempre, aspas internas dobradas, e fórmula NEUTRALIZADA:
 * célula que começa com `= + - @` (ou tab/CR) ganha um apóstrofo — senão a
 * planilha executa o que um cliente escreveu no próprio nome (CSV injection).
 */
export function celulaCsv(valor: unknown): string {
  if (valor === null || valor === undefined) return '""';
  let texto = valor instanceof Date ? valor.toISOString() : String(valor);
  if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;
  return `"${texto.replace(/"/g, '""')}"`;
}

/** `;` como separador: é o que o Excel em pt-BR abre sem assistente. */
export function montarCsv(cabecalho: readonly string[], linhas: readonly unknown[][]): string {
  const saida = [cabecalho, ...linhas].map((l) => l.map(celulaCsv).join(";"));
  // BOM: sem ele o Excel lê "João" como "JoÃ£o".
  return `﻿${saida.join("\r\n")}\r\n`;
}
