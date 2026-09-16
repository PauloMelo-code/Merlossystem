import "server-only";
import { saldosNoDeposito } from "@/lib/integracoes/bling/cache";
import { alvosDeSaldo, itensReservaveis } from "./_consultas";
import { disponivelDe, leituraAntiga, reservadoDe } from "./_regras";

/**
 * COSTURA — dono: M4, consumida por M1 no painel de venda
 * (05-plano-construcao.md §5).
 *
 * "Tem esse vestido no P?" é a pergunta mais repetida do atendimento. Uma
 * implementação só (ADR 0015), porque a tela de venda e a tela de produto têm
 * de dar a MESMA resposta:
 *
 *   disponível = saldo do depósito da loja no Bling − reservado
 *
 * casado por SKU, nunca negativo, calculado a cada pergunta e NUNCA gravado
 * (01-dados-dominio.md §4.2). O saldo passa pelo cache de 60 s e pelo
 * limitador de 3 req/s da conta, os mesmos do job `sincronizar-bling`.
 *
 * `disponivel` é `null` quando o saldo é desconhecido (loja sem depósito, SKU
 * sem id do Bling, Bling fora do ar): a tela mostra "não sabemos", nunca zero.
 */

export type Disponibilidade = {
  sku: string;
  /** Saldo utilizável: saldo menos reservado; `null` = não sabemos. */
  disponivel: number | null;
  saldo: number | null;
  reservado: number;
  /** Quando o saldo foi lido do Bling. A tela mostra a idade do dado. */
  atualizadoEm: Date | null;
  /** Leitura acima do limite (ou ausente): a tela pinta em `aviso`. */
  leituraAntiga: boolean;
};

export async function calcularDisponiveis(
  lojaId: string,
  skus: readonly string[],
): Promise<Map<string, Disponibilidade>> {
  const unicos = [...new Set(skus.filter((s) => s !== ""))];
  const resultado = new Map<string, Disponibilidade>();
  if (unicos.length === 0) return resultado;

  const [{ depositoId, alvos }, itens] = await Promise.all([
    alvosDeSaldo(lojaId, unicos),
    itensReservaveis(lojaId, unicos),
  ]);

  const idsBling = [...alvos.values()].flatMap((a) => (a.blingId ? [a.blingId] : []));
  const leitura =
    depositoId && idsBling.length > 0 ? await saldosNoDeposito(depositoId, idsBling) : null;

  const agora = new Date();
  for (const sku of unicos) {
    const blingId = alvos.get(sku)?.blingId ?? null;
    const lido = blingId ? leitura?.saldos.get(blingId) : undefined;
    const saldo = lido?.saldo ?? null;
    const atualizadoEm = lido?.lidoEm ?? null;
    const reservado = reservadoDe(itens, sku);
    resultado.set(sku, {
      sku,
      disponivel: disponivelDe(saldo, reservado),
      saldo,
      reservado,
      atualizadoEm,
      leituraAntiga: leituraAntiga(atualizadoEm, agora),
    });
  }
  return resultado;
}

export async function calcularDisponivel(lojaId: string, sku: string): Promise<Disponibilidade> {
  const mapa = await calcularDisponiveis(lojaId, [sku]);
  return (
    mapa.get(sku) ?? {
      sku,
      disponivel: null,
      saldo: null,
      reservado: 0,
      atualizadoEm: null,
      leituraAntiga: true,
    }
  );
}
