"use server";

import { executarAcao } from "@/lib/actions/_base";
import { excluirLogico } from "@/lib/db/mutacoes";
import { lojas_midias } from "@/lib/db/schema/midias";
import type { Resultado } from "@/lib/erros";
import {
  alterarMidia,
  etiquetasDaGaleria,
  listarMidias,
  type EtiquetaDaGaleria,
  type PaginaDeMidias,
} from "@/lib/midias";
import { editarMidiaSchema, excluirMidiaSchema, filtrosGaleriaSchema } from "@/lib/validadores/midias";

/**
 * Actions da galeria (04-ui.md §5.4). O upload NÃO é action: é
 * `POST /api/midias`, porque o corpo passa de 1 MB e precisa de streaming e
 * progresso (03-arquitetura.md §5).
 */

export type GaleriaNaTela = PaginaDeMidias & {
  /** Loja onde o upload grava; `null` = gestão sem loja escolhida. */
  lojaAtiva: string | null;
  /** Catálogo de etiquetas das lojas do escopo (a tela filtra pela loja da mídia). */
  etiquetas: EtiquetaDaGaleria[];
};

/** Página da grade. A tela chama no servidor com os `searchParams` da URL. */
export async function listarGaleria(bruto: unknown): Promise<Resultado<GaleriaNaTela>> {
  return executarAcao(
    {
      permissao: "midia:ler",
      entrada: filtrosGaleriaSchema,
      loja: "le",
      executar: async (filtros, ctx) => ({
        ...(await listarMidias(ctx.escopo, filtros)),
        lojaAtiva: ctx.escopo.tipo === "uma" ? ctx.escopo.lojaId : null,
        etiquetas: await etiquetasDaGaleria(ctx.escopo),
      }),
    },
    bruto,
  );
}

/**
 * Pasta e etiquetas (`midia:editar`: gestão e vendedor da própria loja).
 * Devolve o `updated_at` novo (04-ui.md §7.5).
 */
export async function editarMidia(bruto: unknown): Promise<Resultado<{ id: string; updatedAt: string }>> {
  return executarAcao(
    {
      permissao: "midia:editar",
      entrada: editarMidiaSchema,
      loja: "grava",
      revalidar: ["/galeria"],
      executar: (dados, ctx, tx) => alterarMidia(tx, ctx, dados),
    },
    bruto,
  );
}

/**
 * Exclusão LÓGICA (item 5 da lista de block de 3 s). O binário fica: mensagem
 * que ainda mostra a mídia continua mostrando (RN-M06), e o objeto só sai pelo
 * `limpar-midia` 90 dias depois.
 */
export async function excluirMidia(bruto: unknown): Promise<Resultado<null>> {
  return executarAcao(
    {
      permissao: "midia:excluir",
      entrada: excluirMidiaSchema,
      loja: "grava",
      revalidar: ["/galeria"],
      executar: async (dados, ctx, tx) => {
        await excluirLogico(
          tx,
          lojas_midias,
          { id: dados.id, escopo: ctx.escopo, updatedAtOriginal: dados.updated_at },
          ctx,
          "midia_excluida",
        );
        return null;
      },
    },
    bruto,
  );
}
