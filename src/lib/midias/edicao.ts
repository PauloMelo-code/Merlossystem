import "server-only";
import {
  atualizarComTrava,
  excluirLogico,
  inserirAuditado,
  type ContextoDeGravacao,
  type Transacao,
} from "@/lib/db/mutacoes";
import { lojas_midias, lojas_midias_etiquetas } from "@/lib/db/schema/midias";
import { ErroDeEscopo, ErroDeValidacao, ErroFaltaLoja } from "@/lib/erros";
import type { EdicaoMidia } from "@/lib/validadores/midias";
import { etiquetasDaLoja, midiaParaEditar, vinculosDaMidia } from "./_consultas";

/**
 * Organizar a mídia na galeria (04-ui.md §5.4): pasta e etiquetas. Não é ação
 * crítica (fora da lista de 04-ui §9.1), então grava direto, sem block.
 *
 * - `pasta` passa pela trava de colisão: quem abriu a mídia com a pasta antiga
 *   e salva depois de outra pessoa trocar recebe `COLISAO`.
 * - etiquetas são LIGAÇÃO PURA (01-dados-dominio §3.2): some o que saiu
 *   (exclusão lógica), nasce o que entrou. Tudo vai para a trilha como
 *   `midia_alterada`, na mesma transação.
 */
export async function alterarMidia(
  tx: Transacao,
  ctx: ContextoDeGravacao,
  dados: EdicaoMidia,
): Promise<{ id: string; updatedAt: string }> {
  if (ctx.escopo.tipo !== "uma") throw new ErroFaltaLoja();
  const escopo = ctx.escopo;
  const lojaId = escopo.lojaId;

  const midia = await midiaParaEditar(tx, lojaId, dados.id);
  if (!midia) throw new ErroDeEscopo("Mídia não encontrada.");

  let updatedAt = dados.updated_at;
  if (dados.pasta !== undefined && dados.pasta !== midia.pasta) {
    if (midia.origem !== "upload") {
      throw new ErroDeValidacao({ pasta: ["Mídia recebida de cliente não tem pasta."] });
    }
    const linha = await atualizarComTrava(
      tx,
      lojas_midias,
      { id: dados.id, escopo, updatedAtOriginal: dados.updated_at, dados: { pasta: dados.pasta } },
      ctx,
      "midia_alterada",
    );
    updatedAt = linha.updated_at as Date;
  }

  const pedidas = new Set(dados.etiquetaIds);
  const validas = new Set(await etiquetasDaLoja(tx, lojaId, [...pedidas]));
  if (validas.size !== pedidas.size) throw new ErroDeEscopo("Etiqueta não encontrada.");

  const atuais = await vinculosDaMidia(tx, lojaId, dados.id);
  for (const vinculo of atuais) {
    if (validas.has(vinculo.etiquetaId)) continue;
    await excluirLogico(
      tx,
      lojas_midias_etiquetas,
      { id: vinculo.id, escopo, updatedAtOriginal: vinculo.atualizadoEm },
      ctx,
      "midia_alterada",
    );
  }
  const jaTem = new Set(atuais.map((v) => v.etiquetaId));
  for (const etiquetaId of validas) {
    if (jaTem.has(etiquetaId)) continue;
    await inserirAuditado(
      tx,
      lojas_midias_etiquetas,
      { loja_id: lojaId, midia_id: dados.id, etiqueta_id: etiquetaId },
      ctx,
      "midia_alterada",
    );
  }

  return { id: dados.id, updatedAt: updatedAt.toISOString() };
}
