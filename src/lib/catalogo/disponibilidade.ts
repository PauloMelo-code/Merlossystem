import { naoImplementado } from "@/lib/erros";

/**
 * COSTURA — dono: M4, consumida por M1 no painel de venda
 * (05-plano-construcao.md §5).
 *
 * "Tem esse vestido no P?" é a pergunta mais repetida do atendimento. O número
 * sai do catálogo local, alimentado pelo Bling (somente leitura, ADR 0015): o
 * saldo do Bling menos o que já está reservado em pedido aberto.
 *
 * Uma implementação só, porque a tela de venda e a tela de produto têm de dar a
 * MESMA resposta — o defeito clássico é a vendedora prometer o que o estoque
 * não tem porque as duas telas contam diferente.
 *
 * O caminho síncrono (esta função) e o job `integracoes/sincronizar-bling`
 * compartilham o limitador de 3 req/s por conta Bling (03-arquitetura.md §12.1).
 */

export type Disponibilidade = {
  sku: string;
  /** Saldo utilizável: catálogo menos reservado em pedido aberto. */
  disponivel: number;
  /** Quando o espelho do Bling foi atualizado. A tela mostra a idade do dado. */
  atualizadoEm: Date | null;
};

export async function calcularDisponivel(
  _lojaId: string,
  sku: string,
): Promise<Disponibilidade> {
  throw naoImplementado(`calcularDisponivel [sku ${sku}] (catálogo, pacote M4)`);
}
