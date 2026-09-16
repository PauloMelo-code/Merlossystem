/**
 * Monta a URL da própria tela trocando só alguns parâmetros. Valor `undefined`
 * ou vazio REMOVE o parâmetro. Módulo puro (servidor e cliente).
 */

export type Parametros = Record<string, string | string[] | undefined>;

export const um = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

export function urlCom(base: string, atuais: Parametros, trocas: Record<string, string | undefined>): string {
  const busca = new URLSearchParams();
  for (const [chave, valor] of Object.entries(atuais)) {
    const v = um(valor);
    if (v) busca.set(chave, v);
  }
  for (const [chave, valor] of Object.entries(trocas)) {
    if (valor) busca.set(chave, valor);
    else busca.delete(chave);
  }
  const texto = busca.toString();
  return texto ? `${base}?${texto}` : base;
}

/** `recusa_403` -> "recusa 403". Rótulo neutro para lista fechada sem tradução. */
export function humanizar(valor: string): string {
  const texto = valor.replace(/_/g, " ");
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
