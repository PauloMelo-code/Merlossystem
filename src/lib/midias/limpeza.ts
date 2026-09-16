import "server-only";
import { removerObjeto } from "@/lib/armazenamento/midia";
import { chavesPorIds, midiasParaLimpar } from "./_consultas";

/**
 * Remoção de BINÁRIO (a única exclusão física do sistema, ADR 0013). Nenhuma
 * linha é tocada: a linha excluída continua lá, marcada, para a trilha.
 *
 * Chamada por `manutencao/limpar-midia` (M8): a varredura dos 90 dias e, na
 * anonimização LGPD, a lista de mídias do titular — sempre DEPOIS do commit.
 * Idempotente: objeto ausente é sucesso.
 */

const LOTE = 500;

async function remover(linhas: { chaveObjeto: string; chaveMiniatura: string | null }[]) {
  let removidos = 0;
  for (const linha of linhas) {
    await removerObjeto(linha.chaveObjeto);
    if (linha.chaveMiniatura) await removerObjeto(linha.chaveMiniatura);
    removidos += 1;
  }
  return removidos;
}

/**
 * Objetos de linha excluída há mais de 90 dias, fora os que uma mensagem viva
 * ainda mostra (RN-M06).
 *
 * ponytail: nada marca "binário já removido", então a mesma linha volta em
 * toda execução (a remoção é idempotente e barata). Quando o volume pesar, a
 * marca entra por migração.
 */
export async function limparMidiasExpiradas(lojaId?: string): Promise<number> {
  return remover(await midiasParaLimpar(lojaId, LOTE));
}

/** Anonimização LGPD: remove os binários destas mídias. Devolve quantas. */
export async function removerBinarios(midiaIds: readonly string[]): Promise<number> {
  return remover(await chavesPorIds(midiaIds));
}
