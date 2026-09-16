import { TAMANHOS_PLUS, TAMANHOS_SLIM, type TipoGrade } from "@/lib/db/schema/_enums/catalogo";
import { STATUS_PEDIDO_SEM_RESERVA } from "@/lib/db/schema/_enums/pedidos";
import { deCentavos } from "@/lib/formato";

/**
 * Regras PURAS do catálogo (01-dados-dominio.md §4). Sem banco, sem rede: é o
 * que os testes de unidade exercitam e o que a consulta e o job aplicam.
 */

/** Grade de tamanhos (03/RN-C08): `ambos` = slim seguido de plus, nesta ordem. */
export function tamanhosDaGrade(tipo: TipoGrade): readonly string[] {
  if (tipo === "slim") return TAMANHOS_SLIM;
  if (tipo === "plussize") return TAMANHOS_PLUS;
  return [...TAMANHOS_SLIM, ...TAMANHOS_PLUS];
}

const SLIM = new Set<string>(TAMANHOS_SLIM);
const PLUS = new Set<string>(TAMANHOS_PLUS);

/**
 * Extrai o tamanho do rótulo da variação do Bling ("Tamanho:P;Cor:Azul",
 * "TAMANHO: gg" ou só "M"). Tamanho fora da grade devolve `null`: a variação
 * não entra, porque a grade é fechada.
 */
export function tamanhoDoRotulo(rotulo: string): string | null {
  const partes = rotulo.split(/[;|]/).map((p) => p.trim()).filter(Boolean);
  const comChave = partes.find((p) => /^tamanho\s*:/i.test(p));
  const candidato = (comChave ? comChave.split(":")[1] : partes.length === 1 ? partes[0] : "") ?? "";
  const valor = candidato.trim().toUpperCase();
  return SLIM.has(valor) || PLUS.has(valor) ? valor : null;
}

/** A grade que o conjunto de tamanhos do Bling revela. Vazio = `ambos` (o padrão da coluna). */
export function tipoGradeDe(tamanhos: readonly string[]): TipoGrade {
  if (tamanhos.length === 0) return "ambos";
  if (tamanhos.every((t) => SLIM.has(t))) return "slim";
  if (tamanhos.every((t) => PLUS.has(t))) return "plussize";
  return "ambos";
}

/** Preço do Bling (número) para a fronteira de dinheiro (string "1234.56"). */
export function precoDoBling(valor: number): string {
  return deCentavos(Math.round(valor * 100));
}

export type ItemReservavel = {
  sku: string | null;
  quantidade: number;
  status: string;
  mascStatus: string;
};

const SEM_RESERVA = new Set<string>(STATUS_PEDIDO_SEM_RESERVA);

/**
 * Um item reserva estoque quando o pedido ainda não foi lançado no Masc
 * (depois de lançado, o Masc já baixou o saldo no Bling) e não foi cancelado
 * nem devolvido. Item sem SKU não desconta de nada.
 */
export function itemReserva(item: ItemReservavel): boolean {
  return item.sku !== null && item.mascStatus === "pendente" && !SEM_RESERVA.has(item.status);
}

export function reservadoDe(itens: readonly ItemReservavel[], sku: string): number {
  return itens.reduce(
    (soma, item) => (item.sku === sku && itemReserva(item) ? soma + item.quantidade : soma),
    0,
  );
}

/**
 * disponível = saldo do depósito − reservado, nunca negativo.
 * Saldo desconhecido continua desconhecido: `null`, nunca zero.
 */
export function disponivelDe(saldo: number | null, reservado: number): number | null {
  if (saldo === null || !Number.isFinite(saldo)) return null;
  return Math.max(0, Math.floor(saldo) - reservado);
}

/**
 * Acima disto a tela mostra "Leitura antiga" em tom `aviso` (04-ui.md §10).
 * O cache é de 60 s; cinco minutos sem leitura nova significa que o Bling
 * está falhando.
 */
export const SALDO_ANTIGO_MS = 5 * 60_000;

export function leituraAntiga(lidoEm: Date | null, agora: Date = new Date()): boolean {
  return lidoEm === null || agora.getTime() - lidoEm.getTime() > SALDO_ANTIGO_MS;
}
