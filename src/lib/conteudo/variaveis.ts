import type { VariavelTemplate } from "@/lib/db/schema/integracoes";

/**
 * Variáveis de modelo do WhatsApp (01-dados-dominio.md §5.4, 01-dados.md §10).
 *
 * Módulo PURO: a tela usa para contar enquanto a pessoa digita e o servidor usa
 * para validar — a mesma regra escrita uma vez.
 *
 * O defeito 03/C1 era mandar sempre UMA variável (`[nome do contato]`): a Meta
 * recusa template com 0 ou 2+ variáveis quando o disparo manda outra
 * quantidade. Por isso a contagem é persistida (`variaveis_contagem`) e a
 * campanha não sai de `rascunho` sem bater com ela.
 */

/** Marcador resolvido por destinatário no disparo. */
export const MARCADOR_NOME = "{nome_contato}";

const PLACEHOLDER = /\{\{\s*(\d+)\s*\}\}/g;

/**
 * Quantas variáveis distintas o corpo usa. A Meta numera de 1 em diante, sem
 * buraco: `{{1}} {{3}}` é recusado lá, então é recusado aqui (`null`).
 */
export function contarVariaveis(corpo: string): number | null {
  const indices = new Set<number>();
  for (const m of corpo.matchAll(PLACEHOLDER)) indices.add(Number(m[1]));
  const ordenados = [...indices].sort((a, b) => a - b);
  for (let i = 0; i < ordenados.length; i++) {
    if (ordenados[i] !== i + 1) return null;
  }
  return ordenados.length;
}

/** Mensagem de erro, ou `null` quando a lista bate com o modelo. */
export function conferirVariaveis(
  variaveis: readonly VariavelTemplate[],
  contagem: number,
): string | null {
  if (variaveis.length !== contagem) {
    return contagem === 0
      ? "Este modelo não tem variáveis. Remova as que foram preenchidas."
      : `Este modelo pede ${contagem} ${contagem === 1 ? "variável" : "variáveis"}; foram preenchidas ${variaveis.length}.`;
  }
  const indices = variaveis.map((v) => v.indice).sort((a, b) => a - b);
  if (indices.some((indice, i) => indice !== i + 1)) {
    return "As variáveis precisam estar numeradas de 1 em diante, sem repetir.";
  }
  if (variaveis.some((v) => v.valor.trim() === "")) {
    return "Preencha todas as variáveis.";
  }
  return null;
}

/** Valores finais por destinatário: `{nome_contato}` vira o nome, ou "cliente". */
export function resolverVariaveis(
  variaveis: readonly VariavelTemplate[],
  nomeContato: string | null,
): VariavelTemplate[] {
  const nome = nomeContato?.trim().split(/\s+/)[0] || "cliente";
  return variaveis.map((v) => ({
    indice: v.indice,
    valor: v.valor.split(MARCADOR_NOME).join(nome),
  }));
}

/** Texto que entra na conversa da cliente: o corpo com as variáveis trocadas. */
export function renderizarCorpo(corpo: string, variaveis: readonly VariavelTemplate[]): string {
  const porIndice = new Map(variaveis.map((v) => [v.indice, v.valor]));
  return corpo.replace(PLACEHOLDER, (original, n: string) => porIndice.get(Number(n)) ?? original);
}
