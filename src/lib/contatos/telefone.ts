/**
 * Telefone canônico: E.164 SÓ DÍGITOS (`5551999990000`), o mesmo formato do
 * CHECK `contatos_telefone_e164` (01-dados-dominio.md §2.1).
 *
 * Módulo puro (sem `server-only`): o validador roda também no navegador, no
 * `blur` do campo. A formatação para exibição é `telefone()` de
 * `src/lib/formato.ts`; aqui é só o caminho de entrada.
 *
 * Regras, nesta ordem:
 *   1. com `+` na frente, os dígitos já trazem o país e ficam como estão;
 *   2. sem `+`, zeros à esquerda saem (prefixo de operadora `0` e o
 *      internacional `00`);
 *   3. sobrando 10 ou 11 dígitos (DDD + número), é número brasileiro e ganha
 *      o `55`.
 *
 * ponytail: número estrangeiro digitado SEM `+` e com 10–11 dígitos vira
 * brasileiro. Quem atende estrangeiro digita o `+`; a tela diz isso na ajuda.
 */

export const REGEX_E164 = /^[1-9][0-9]{9,14}$/;

export function normalizarTelefone(entrada: string): string | null {
  const texto = entrada.trim();
  let digitos = texto.replace(/\D/g, "");
  if (!texto.startsWith("+")) {
    digitos = digitos.replace(/^0+/, "");
    if (digitos.length === 10 || digitos.length === 11) digitos = `55${digitos}`;
  }
  return REGEX_E164.test(digitos) ? digitos : null;
}

/** Só os dígitos do termo de busca, para casar com o telefone gravado. */
export function digitosDaBusca(termo: string): string {
  return termo.replace(/\D/g, "");
}
