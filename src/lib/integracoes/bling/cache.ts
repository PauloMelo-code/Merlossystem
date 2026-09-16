import "server-only";
import { logger } from "@/lib/logger";
import { contaBling } from "./cliente";
import { CACHE_SALDO_MS, SALDOS_POR_CONSULTA } from "./config";
import { lerSaldos } from "./leitura";

/**
 * Cache de saldo: 60 s POR DEPÓSITO, com single-flight (03-arquitetura.md
 * §12.1). Sem ele, cada abertura do painel de venda vira uma chamada ao Bling
 * e o limite da conta da rede estoura em horário de pico.
 *
 * Em memória, por processo. O que precisa ser compartilhado entre app e worker
 * é o LIMITADOR (Redis), e ele é; o cache só economiza chamadas.
 * ponytail: cache por processo; mover para Redis se houver várias instâncias web.
 *
 * Falha do Bling NÃO vira zero: devolve a última leitura (marcada com a hora
 * em que foi feita, para a tela dizer "Leitura antiga") ou `null` — "não
 * sabemos".
 */

export type Saldo = { saldo: number | null; lidoEm: Date | null };
export type LeituraDeSaldos = { saldos: Map<string, Saldo>; falhou: boolean };

type Entrada = { saldo: number | null; lidoEm: number };

const global_ = globalThis as unknown as {
  _saldosBling?: Map<string, Map<string, Entrada>>;
  _voandoBling?: Map<string, Promise<void>>;
};
const porDeposito = (global_._saldosBling ??= new Map());
const voando = (global_._voandoBling ??= new Map());

function fatias<T>(itens: readonly T[], tamanho: number): T[][] {
  const saida: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) saida.push(itens.slice(i, i + tamanho));
  return saida;
}

async function buscar(depositoId: string, ids: string[]): Promise<void> {
  const conta = await contaBling();
  const mapa = porDeposito.get(depositoId) ?? new Map<string, Entrada>();
  porDeposito.set(depositoId, mapa);
  for (const lote of fatias(ids, SALDOS_POR_CONSULTA)) {
    const lidos = await lerSaldos(conta, depositoId, lote);
    const agora = Date.now();
    // Produto que o Bling não devolveu fica `null` com hora: não re-pergunta
    // em loop e continua sem virar zero.
    for (const id of lote) mapa.set(id, { saldo: lidos.get(id) ?? null, lidoEm: agora });
  }
}

/** Single-flight: dois painéis pedindo o mesmo lote no mesmo instante fazem UMA chamada. */
function buscarUmaVez(depositoId: string, ids: string[]): Promise<void> {
  const chave = `${depositoId}|${[...ids].sort().join(",")}`;
  const existente = voando.get(chave);
  if (existente) return existente;
  const promessa = buscar(depositoId, ids).finally(() => voando.delete(chave));
  voando.set(chave, promessa);
  return promessa;
}

export async function saldosNoDeposito(
  depositoId: string,
  idsBling: readonly string[],
): Promise<LeituraDeSaldos> {
  const unicos = [...new Set(idsBling)];
  const agora = Date.now();
  const mapa = porDeposito.get(depositoId);
  const vencidos = unicos.filter((id) => {
    const entrada = mapa?.get(id);
    return !entrada || agora - entrada.lidoEm > CACHE_SALDO_MS;
  });

  let falhou = false;
  if (vencidos.length > 0) {
    try {
      await buscarUmaVez(depositoId, vencidos);
    } catch (erro) {
      falhou = true;
      logger.warn(
        { depositoId, erro: erro instanceof Error ? erro.message : String(erro) },
        "leitura de saldo do Bling falhou; servindo a última leitura",
      );
    }
  }

  const atual = porDeposito.get(depositoId);
  const saldos = new Map<string, Saldo>();
  for (const id of unicos) {
    const entrada = atual?.get(id);
    saldos.set(
      id,
      entrada
        ? { saldo: entrada.saldo, lidoEm: new Date(entrada.lidoEm) }
        : { saldo: null, lidoEm: null },
    );
  }
  return { saldos, falhou };
}

/** Só para teste: esvazia o cache entre casos. */
export function esvaziarCacheDeSaldos(): void {
  porDeposito.clear();
  voando.clear();
}
