import { formatarValor, METRICAS, type Indicadores, type PontoDaSerie } from "./definicoes";

/**
 * CSV do relatório. Módulo PURO.
 *
 * Separador `;` e BOM: é o que o Excel em pt-BR abre sem assistente. O
 * cabeçalho do arquivo diz a loja e o período, igual à tela — número sem
 * origem é número que alguém usa errado.
 */

const BOM = "﻿";

/** Célula que começa com = + - @ vira fórmula no Excel (injeção de CSV). */
export function celula(valor: string | number): string {
  let texto = String(valor);
  if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;
  return /[;"\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

const linha = (...valores: (string | number)[]) => valores.map(celula).join(";");

export function gerarCsv(dados: {
  loja: string;
  deTexto: string;
  ateTexto: string;
  indicadores: Indicadores;
  serie: PontoDaSerie[];
}): string {
  const linhas = [
    linha("Loja", dados.loja),
    linha("Período", `${dados.deTexto} a ${dados.ateTexto}`),
    "",
    linha("Indicador", "Valor", "Definição"),
    ...METRICAS.map((m) =>
      linha(m.rotulo, formatarValor(m.formato, dados.indicadores[m.id]), m.definicao),
    ),
    "",
    linha("Dia", "Receita (R$)", "Conversas iniciadas"),
    ...dados.serie.map((p) => linha(p.dia, p.receita.replace(".", ","), p.conversas)),
  ];
  return `${BOM}${linhas.join("\r\n")}\r\n`;
}
