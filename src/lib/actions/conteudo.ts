"use server";

import { executarAcao } from "@/lib/actions/_base";
import type { Resultado } from "@/lib/erros";
import {
  alternarResposta,
  criarModelo,
  criarResposta,
  editarModelo,
  editarResposta,
  excluirModelo,
  excluirResposta,
} from "@/lib/conteudo/gravacao";
import {
  alternarRespostaSchema,
  alvoSchema,
  editarModeloSchema,
  editarRespostaSchema,
  modeloSchema,
  respostaSchema,
} from "@/lib/validadores/conteudo";

/**
 * Actions de respostas rápidas e modelos do WhatsApp (04-ui.md §5.4).
 * A regra mora em `src/lib/conteudo/gravacao.ts`; aqui só portão e forma.
 */

const RESPOSTAS = ["/respostas-rapidas"];
const MODELOS = ["/modelos"];

export async function criarRespostaRapida(bruto: unknown): Promise<Resultado<{ id: string }>> {
  return executarAcao(
    {
      permissao: "respostas:criar",
      entrada: respostaSchema,
      loja: "grava",
      revalidar: RESPOSTAS,
      executar: (dados, ctx, tx) => criarResposta(tx, ctx, dados),
    },
    bruto,
  );
}

export async function editarRespostaRapida(bruto: unknown): Promise<Resultado<null>> {
  return executarAcao(
    {
      permissao: "respostas:editar",
      entrada: editarRespostaSchema,
      loja: "grava",
      revalidar: RESPOSTAS,
      executar: async (dados, ctx, tx) => {
        await editarResposta(tx, ctx, dados);
        return null;
      },
    },
    bruto,
  );
}

export async function alternarRespostaRapida(bruto: unknown): Promise<Resultado<null>> {
  return executarAcao(
    {
      permissao: "respostas:editar",
      entrada: alternarRespostaSchema,
      loja: "grava",
      revalidar: RESPOSTAS,
      executar: async (dados, ctx, tx) => {
        await alternarResposta(tx, ctx, dados);
        return null;
      },
    },
    bruto,
  );
}

export async function excluirRespostaRapida(bruto: unknown): Promise<Resultado<null>> {
  return executarAcao(
    {
      permissao: "respostas:excluir",
      entrada: alvoSchema,
      loja: "grava",
      revalidar: RESPOSTAS,
      executar: async (dados, ctx, tx) => {
        await excluirResposta(tx, ctx, dados);
        return null;
      },
    },
    bruto,
  );
}

export async function criarModeloWhatsapp(bruto: unknown): Promise<Resultado<{ id: string }>> {
  return executarAcao(
    {
      permissao: "modelos:criar",
      entrada: modeloSchema,
      loja: "grava",
      revalidar: MODELOS,
      executar: (dados, ctx, tx) => criarModelo(tx, ctx, dados),
    },
    bruto,
  );
}

export async function editarModeloWhatsapp(bruto: unknown): Promise<Resultado<null>> {
  return executarAcao(
    {
      permissao: "modelos:editar",
      entrada: editarModeloSchema,
      loja: "grava",
      revalidar: MODELOS,
      executar: async (dados, ctx, tx) => {
        await editarModelo(tx, ctx, dados);
        return null;
      },
    },
    bruto,
  );
}

export async function excluirModeloWhatsapp(bruto: unknown): Promise<Resultado<null>> {
  return executarAcao(
    {
      permissao: "modelos:excluir",
      entrada: alvoSchema,
      loja: "grava",
      revalidar: MODELOS,
      executar: async (dados, ctx, tx) => {
        await excluirModelo(tx, ctx, dados);
        return null;
      },
    },
    bruto,
  );
}
