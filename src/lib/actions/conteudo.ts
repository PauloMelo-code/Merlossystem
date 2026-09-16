"use server";

import { revalidatePath } from "next/cache";
import { executarAcao } from "@/lib/actions/_base";
import { ErroDoAplicativo, paraResultado, type Resultado } from "@/lib/erros";
import { enviarModeloParaAprovacao } from "@/lib/integracoes/meta/aprovacao";
import { logger } from "@/lib/logger";
import {
  alternarResposta,
  conferirEnviavel,
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
  idModeloSchema,
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

/**
 * "Enviar para aprovação" (04-ui.md §5.4, `modelos:enviar_aprovacao`). A
 * action confere o modelo na transação; a costura do M5 envia DEPOIS do commit
 * e grava `template_enviado` com as transações dela.
 */
export async function enviarModeloAprovacao(bruto: unknown): Promise<Resultado<{ status: string }>> {
  const r = await executarAcao(
    {
      permissao: "modelos:enviar_aprovacao",
      entrada: idModeloSchema,
      loja: "grava",
      executar: async (dados, ctx, tx) => {
        await conferirEnviavel(tx, ctx, dados.id);
        return { id: dados.id, ctx: { escopo: ctx.escopo, autorId: ctx.autorId, origem: ctx.origem } };
      },
    },
    bruto,
  );
  if (!r.ok) return r;
  try {
    const enviado = await enviarModeloParaAprovacao(r.dados.ctx, r.dados.id);
    for (const caminho of MODELOS) revalidatePath(caminho);
    return { ok: true, dados: { status: enviado.status } };
  } catch (erro) {
    if (!(erro instanceof ErroDoAplicativo)) {
      logger.error({ acao: "modelos:enviar_aprovacao", erro: erro instanceof Error ? erro.message : String(erro) }, "envio de modelo falhou");
    }
    return paraResultado(erro);
  }
}
