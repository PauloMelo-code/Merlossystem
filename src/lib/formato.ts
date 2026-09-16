/**
 * Formatação pt-BR e aritmética de dinheiro, num módulo só (01-dados.md §4.5,
 * 04-ui.md §3.3). `lib/formatar.ts` e `lib/dinheiro.ts` não existem.
 *
 * Unidade que atravessa a fronteira: **string** `"1234.56"`, igual ao banco
 * (`numeric(12,2)`). Centavos vivem aqui dentro e não vazam para DTO nem para
 * componente. Nenhum `toFixed(2)` fora deste arquivo, e nenhuma conta de
 * dinheiro em `number` de ponto flutuante.
 */

/** Forma aceita na fronteira (01-dados.md §4.5). Usada também pelos validadores. */
export const REGEX_DINHEIRO = /^\d{1,10}(\.\d{1,2})?$/;

const FUSO = "America/Sao_Paulo";

// -- Dinheiro ---------------------------------------------------------------

/** `"1234.56"` -> `123456`. Lança quando a string não é dinheiro. */
export function paraCentavos(valor: string): number {
  if (!REGEX_DINHEIRO.test(valor)) {
    throw new Error(
      `Valor monetário inválido: esperado "1234.56", recebido ${JSON.stringify(valor)}.`,
    );
  }
  const [inteiro, decimal = ""] = valor.split(".");
  return Number(inteiro) * 100 + Number(decimal.padEnd(2, "0"));
}

/** `123456` -> `"1234.56"`. Aceita negativo (diferença), o banco é que barra. */
export function deCentavos(centavos: number): string {
  if (!Number.isSafeInteger(centavos)) {
    throw new Error(`Centavos precisam ser inteiro seguro, recebido ${centavos}.`);
  }
  const absoluto = Math.abs(centavos);
  const sinal = centavos < 0 ? "-" : "";
  return `${sinal}${Math.trunc(absoluto / 100)}.${String(absoluto % 100).padStart(2, "0")}`;
}

/** Soma exata: passa por centavos inteiros e volta como string do banco. */
export function somar(...valores: string[]): string {
  return deCentavos(valores.reduce((total, valor) => total + paraCentavos(valor), 0));
}

/** Preço unitário vezes quantidade (quantidade é inteiro: item de pedido). */
export function multiplicar(valor: string, quantidade: number): string {
  if (!Number.isSafeInteger(quantidade)) {
    throw new Error(`Quantidade precisa ser inteira, recebido ${quantidade}.`);
  }
  return deCentavos(paraCentavos(valor) * quantidade);
}

/**
 * `"1234.56"` -> `"R$ 1.234,56"`. Agrupa a partir dos centavos inteiros, nunca
 * de um `Number(valor)`: acima de sete dígitos o float já erra o arredondamento.
 */
export function moeda(valor: string): string {
  const [inteiro, decimal] = deCentavos(paraCentavos(valor)).split(".");
  const agrupado = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `R$ ${agrupado},${decimal}`;
}

// -- Telefone ---------------------------------------------------------------

/**
 * `"5551999990000"` -> `"(51) 99999-0000"`. A entrada é o canônico E.164 só
 * dígitos que o banco guarda; número fora do padrão brasileiro volta como
 * `+<dígitos>`, nunca quebrado no meio.
 */
export function telefone(e164: string): string {
  const digitos = e164.replace(/\D/g, "");
  const brasileiro = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(digitos);
  if (brasileiro) return `(${brasileiro[1]}) ${brasileiro[2]}-${brasileiro[3]}`;
  return digitos === "" ? "" : `+${digitos}`;
}

// -- Data e hora ------------------------------------------------------------

// Servidor e banco em UTC; a tela lê no fuso do negócio (01-dados.md §4.1).
const fmtData = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const fmtHora = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const fmtDiaMes = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO,
  day: "2-digit",
  month: "2-digit",
});
const fmtDiaDaSemana = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, weekday: "short" });

/** `"12/09/2026"`. */
export function data(valor: Date): string {
  return fmtData.format(valor);
}

/** `"14:32"`, sempre 24 h. */
export function hora(valor: Date): string {
  return fmtHora.format(valor);
}

/** `"12/09/2026 14:32"` — o `title` de todo `<time>`. */
export function dataHora(valor: Date): string {
  return `${data(valor)} ${hora(valor)}`;
}

/**
 * Coluna `date` (aniversário, previsão): chega como `"2026-09-12"` e é exibida
 * sem passar por `Date`, que deslocaria um dia por causa do fuso.
 */
export function dataPuraFormatada(iso: string): string {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!partes) throw new Error(`Data pura inválida: esperado "AAAA-MM-DD", recebido ${iso}.`);
  return `${partes[3]}/${partes[2]}/${partes[1]}`;
}

/** Meia-noite do dia civil (no fuso do negócio) em milissegundos UTC. */
function inicioDoDia(valor: Date): number {
  const partes = Object.fromEntries(
    fmtData.formatToParts(valor).map((p) => [p.type, p.value]),
  );
  return Date.UTC(Number(partes.year), Number(partes.month) - 1, Number(partes.day));
}

/**
 * Carimbo curto da lista de conversas (04-ui.md §3.3): hoje `14:32`, ontem
 * `Ontem`, nos seis dias anteriores `seg`, antes disso `12/09`. No balão da
 * mensagem é sempre `hora()`.
 */
export function horaDaLista(valor: Date, agora: Date = new Date()): string {
  const dias = Math.round((inicioDoDia(valor) - inicioDoDia(agora)) / 86_400_000);
  if (dias === 0) return hora(valor);
  if (dias === -1) return "Ontem";
  if (dias < -1 && dias > -7) {
    // `weekday: "short"` devolve "seg." em algumas versões do ICU.
    return fmtDiaDaSemana.format(valor).replace(/[^\p{L}]/gu, "");
  }
  return fmtDiaMes.format(valor);
}
