"use server";

import { executarAcao } from "@/lib/actions/_base";
import type { Resultado } from "@/lib/erros";
import { ErroDeEscopo } from "@/lib/erros";
import {
  agendarLote,
  criarCampanha,
  excluirCampanha,
  iniciarCampanha,
  pausarCampanha,
  reenviarFalhas,
  retomarCampanha,
} from "@/lib/campanhas/disparo";
import { conferirEtiquetas, previaDoSegmento, type Previa } from "@/lib/campanhas/segmento";
import { campanhaAlvoSchema, campanhaSchema, previaSchema } from "@/lib/validadores/campanhas";

/**
 * Actions de campanhas (04-ui.md §5.4). Iniciar, retomar e reenviar
 * enfileiram o lote DEPOIS do commit — a transação da action termina dentro
 * de `executarAcao`, e só então o worker pode enxergar `enviando`.
 */

const LISTA = "/campanhas";

export async function previaDeSegmento(bruto: unknown): Promise<Resultado<Previa>> {
  return executarAcao(
    {
      permissao: "campanhas:criar",
      entrada: previaSchema,
      loja: "grava",
      executar: async (dados, ctx, tx) => {
        if (ctx.escopo.tipo !== "uma") throw new ErroDeEscopo();
        await conferirEtiquetas(tx, ctx.escopo.lojaId, dados.segmento.etiquetas_ids);
        return previaDoSegmento(ctx.escopo.lojaId, dados.segmento);
      },
    },
    bruto,
  );
}

export async function criarNovaCampanha(bruto: unknown): Promise<Resultado<{ id: string }>> {
  return executarAcao(
    {
      permissao: "campanhas:criar",
      entrada: campanhaSchema,
      loja: "grava",
      revalidar: [LISTA],
      executar: (dados, ctx, tx) => criarCampanha(tx, ctx, dados),
    },
    bruto,
  );
}

export async function iniciarDisparo(bruto: unknown): Promise<Resultado<null>> {
  const r = await executarAcao(
    {
      permissao: "campanhas:disparar",
      entrada: campanhaAlvoSchema,
      loja: "grava",
      revalidar: [LISTA],
      executar: (dados, ctx, tx) => iniciarCampanha(tx, ctx, dados),
    },
    bruto,
  );
  if (!r.ok) return r;
  await agendarLote(r.dados);
  return { ok: true, dados: null };
}

export async function retomarDisparo(bruto: unknown): Promise<Resultado<null>> {
  const r = await executarAcao(
    {
      permissao: "campanhas:disparar",
      entrada: campanhaAlvoSchema,
      loja: "grava",
      revalidar: [LISTA],
      executar: (dados, ctx, tx) => retomarCampanha(tx, ctx, dados),
    },
    bruto,
  );
  if (!r.ok) return r;
  await agendarLote(r.dados);
  return { ok: true, dados: null };
}

export async function pausarDisparo(bruto: unknown): Promise<Resultado<null>> {
  return executarAcao(
    {
      permissao: "campanhas:editar",
      entrada: campanhaAlvoSchema,
      loja: "grava",
      revalidar: [LISTA],
      executar: async (dados, ctx, tx) => {
        await pausarCampanha(tx, ctx, dados);
        return null;
      },
    },
    bruto,
  );
}

export async function reenviarFalhasDaCampanha(bruto: unknown): Promise<Resultado<{ quantidade: number }>> {
  const r = await executarAcao(
    {
      permissao: "campanhas:disparar",
      entrada: campanhaAlvoSchema,
      loja: "grava",
      revalidar: [LISTA],
      executar: (dados, ctx, tx) => reenviarFalhas(tx, ctx, dados),
    },
    bruto,
  );
  if (!r.ok) return r;
  if (r.dados.enfileirar) await agendarLote(r.dados);
  return { ok: true, dados: { quantidade: r.dados.quantidade } };
}

export async function excluirCampanhaRegistro(bruto: unknown): Promise<Resultado<null>> {
  return executarAcao(
    {
      permissao: "campanhas:excluir",
      entrada: campanhaAlvoSchema,
      loja: "grava",
      revalidar: [LISTA],
      executar: async (dados, ctx, tx) => {
        await excluirCampanha(tx, ctx, dados);
        return null;
      },
    },
    bruto,
  );
}
