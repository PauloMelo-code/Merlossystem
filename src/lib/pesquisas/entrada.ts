import type { Transacao } from "@/lib/db/mutacoes";
import type { ContextoDeGravacao } from "@/lib/db/sistema";
import { naoImplementado } from "@/lib/erros";

/**
 * COSTURA — dono: R2-A (pós-venda), consumida pela ingestão do M1 (ADR 0039).
 * A ingestão CLASSIFICA antes de escolher/reabrir a conversa e APLICA depois
 * de gravar a mensagem, na mesma transação.
 *
 * Enquanto `classificar` devolve sempre `nenhuma`, o `throw` de `aplicar` é
 * inalcançável: o R2-A entrega os dois corpos juntos.
 */

export type EntradaParaPesquisa = {
  lojaId: string;
  contatoId: string;
  integracaoId: string;
  tipoConteudo: string;
  texto: string | null;
  ocorridaEm: Date;
};

export type ClassificacaoDePesquisa =
  | { tipo: "nenhuma" }
  | { tipo: "nota"; pesquisaId: string; conversaId: string; nota: 1 | 2 | 3 | 4 | 5; reabrir: boolean }
  | { tipo: "sair"; pesquisaId: string; conversaId: string | null; pendente: boolean }
  | { tipo: "comentario"; pesquisaId: string };

export type MensagemGravada = {
  mensagemId: string;
  conversaId: string;
  integracaoId: string;
  provedor: string;
  texto: string | null;
  ocorridaEm: Date;
};

/** Leitura pura (R2-CS-08). Nunca lança por regra de pesquisa. */
export async function classificarEntradaDePesquisa(
  _tx: Transacao,
  _entrada: EntradaParaPesquisa,
): Promise<ClassificacaoDePesquisa> {
  return { tipo: "nenhuma" };
}

/** Efeitos (R2-CS-10..12, R2-CS-14). Chamado DEPOIS de gravar a mensagem, na mesma transação. */
export async function aplicarEntradaDePesquisa(
  _tx: Transacao,
  classificacao: Exclude<ClassificacaoDePesquisa, { tipo: "nenhuma" }>,
  _mensagem: MensagemGravada,
  _ctx: ContextoDeGravacao,
): Promise<void> {
  throw naoImplementado(`aplicarEntradaDePesquisa [${classificacao.tipo}] (pacote R2-A)`);
}
