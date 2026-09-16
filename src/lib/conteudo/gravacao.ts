import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Contexto } from "@/lib/auth/guard";
import { condicaoDeLoja, vivosE } from "@/lib/db/consultas";
import { atualizarComTrava, excluirLogico, inserirAuditado, type Transacao } from "@/lib/db/mutacoes";
import { campanhas } from "@/lib/db/schema/campanhas";
import { respostas_rapidas } from "@/lib/db/schema/conteudo/respostas-rapidas";
import { conversas_agendamentos } from "@/lib/db/schema/conversas/agendamentos";
import { lojas_integracoes_templates } from "@/lib/db/schema/integracoes";
import { ErroDeEscopo, ErroDeValidacao } from "@/lib/erros";
import { contaDaLoja } from "@/lib/campanhas/conta";
import type {
  alternarRespostaSchema,
  editarModeloSchema,
  editarRespostaSchema,
  modeloSchema,
  respostaSchema,
} from "@/lib/validadores/conteudo";
import { TRILHA_CONTEUDO } from "./trilha";
import { contarVariaveis } from "./variaveis";

/**
 * Respostas rápidas e modelos do WhatsApp (01-dados-dominio.md §5.2,
 * 01-dados.md §6.5). Com trava de colisão; exclusão lógica.
 */

type Alvo = { id: string; updated_at: Date };

function lojaDe(ctx: Contexto): string {
  if (ctx.escopo.tipo !== "uma") throw new ErroDeEscopo();
  return ctx.escopo.lojaId;
}

/** Violação de único vira mensagem no campo, não "INESPERADO". */
async function comUnico<T>(indice: string, campo: string, frase: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (erro) {
    const e = erro as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
    const pg = e.code ? e : e.cause;
    if (pg?.code === "23505" && pg.constraint === indice) {
      throw new ErroDeValidacao({ [campo]: [frase] });
    }
    throw erro;
  }
}

// -- Respostas rápidas --------------------------------------------------------

const ATALHO_REPETIDO = "Já existe uma resposta com este atalho nesta loja.";

export async function criarResposta(tx: Transacao, ctx: Contexto, d: z.output<typeof respostaSchema>) {
  const lojaId = lojaDe(ctx);
  const linha = await comUnico("uq_respostas_rapidas_atalho", "atalho", ATALHO_REPETIDO, () =>
    inserirAuditado(
      tx,
      respostas_rapidas,
      { loja_id: lojaId, titulo: d.titulo, atalho: d.atalho, categoria: d.categoria, conteudo: d.conteudo },
      ctx,
      TRILHA_CONTEUDO.criado,
    ),
  );
  return { id: String(linha.id) };
}

export async function editarResposta(tx: Transacao, ctx: Contexto, d: z.output<typeof editarRespostaSchema>) {
  await comUnico("uq_respostas_rapidas_atalho", "atalho", ATALHO_REPETIDO, () =>
    atualizarComTrava(
      tx,
      respostas_rapidas,
      {
        id: d.id,
        escopo: ctx.escopo,
        updatedAtOriginal: d.updated_at,
        dados: { titulo: d.titulo, atalho: d.atalho, categoria: d.categoria, conteudo: d.conteudo },
      },
      ctx,
      TRILHA_CONTEUDO.alterado,
    ),
  );
}

export async function alternarResposta(tx: Transacao, ctx: Contexto, d: z.output<typeof alternarRespostaSchema>) {
  await atualizarComTrava(
    tx,
    respostas_rapidas,
    { id: d.id, escopo: ctx.escopo, updatedAtOriginal: d.updated_at, dados: { ativa: d.ativa } },
    ctx,
    TRILHA_CONTEUDO.alterado,
  );
}

export async function excluirResposta(tx: Transacao, ctx: Contexto, alvo: Alvo) {
  await excluirLogico(
    tx,
    respostas_rapidas,
    { id: alvo.id, escopo: ctx.escopo, updatedAtOriginal: alvo.updated_at },
    ctx,
    TRILHA_CONTEUDO.excluido,
  );
}

// -- Modelos do WhatsApp oficial ----------------------------------------------

const NOME_REPETIDO = "Já existe um modelo com este nome nesta conta.";
/** Só rascunho e rejeitado são editáveis: o que está na Meta não muda por aqui. */
const EDITAVEIS = ["rascunho", "rejeitado"];

function contagemDe(corpo: string): number {
  const n = contarVariaveis(corpo);
  if (n === null) throw new ErroDeValidacao({ corpo: ["Numere as variáveis de {{1}} em diante, sem pular número."] });
  return n;
}

export async function criarModelo(tx: Transacao, ctx: Contexto, d: z.output<typeof modeloSchema>) {
  const lojaId = lojaDe(ctx);
  const conta = await contaDaLoja(tx, lojaId, d.integracao_id);
  if (conta.provedor !== "whatsapp_oficial") {
    throw new ErroDeValidacao({ integracao_id: ["Modelos valem só para números oficiais. O uazapi não usa modelo."] });
  }
  const linha = await comUnico("uq_lojas_integracoes_templates_nome", "nome", NOME_REPETIDO, () =>
    inserirAuditado(
      tx,
      lojas_integracoes_templates,
      {
        loja_id: lojaId,
        integracao_id: conta.id,
        nome: d.nome,
        categoria: d.categoria,
        cabecalho_tipo: d.cabecalho_conteudo ? "texto" : null,
        cabecalho_conteudo: d.cabecalho_conteudo,
        corpo: d.corpo,
        rodape: d.rodape,
        variaveis_contagem: contagemDe(d.corpo),
      },
      ctx,
      TRILHA_CONTEUDO.modeloAlterado,
    ),
  );
  return { id: String(linha.id) };
}

async function carregarModelo(tx: Transacao, ctx: Contexto, id: string) {
  const [linha] = await tx
    .select({ id: lojas_integracoes_templates.id, status: lojas_integracoes_templates.status })
    .from(lojas_integracoes_templates)
    .where(
      vivosE(
        lojas_integracoes_templates,
        condicaoDeLoja(lojas_integracoes_templates, ctx.escopo),
        eq(lojas_integracoes_templates.id, id),
      ),
    )
    .limit(1);
  if (!linha) throw new ErroDeEscopo();
  return linha;
}

export async function editarModelo(tx: Transacao, ctx: Contexto, d: z.output<typeof editarModeloSchema>) {
  const atual = await carregarModelo(tx, ctx, d.id);
  if (!EDITAVEIS.includes(atual.status)) {
    throw new ErroDeValidacao({ corpo: ["Modelo enviado à Meta não é editado aqui. Crie um novo."] });
  }
  await comUnico("uq_lojas_integracoes_templates_nome", "nome", NOME_REPETIDO, () =>
    atualizarComTrava(
      tx,
      lojas_integracoes_templates,
      {
        id: d.id,
        escopo: ctx.escopo,
        updatedAtOriginal: d.updated_at,
        dados: {
          nome: d.nome,
          categoria: d.categoria,
          cabecalho_tipo: d.cabecalho_conteudo ? "texto" : null,
          cabecalho_conteudo: d.cabecalho_conteudo,
          corpo: d.corpo,
          rodape: d.rodape,
          variaveis_contagem: contagemDe(d.corpo),
        },
      },
      ctx,
      TRILHA_CONTEUDO.modeloAlterado,
    ),
  );
}

/** Modelo em uso por campanha ou agendamento vivo não sai: o envio ficaria sem corpo. */
export async function excluirModelo(tx: Transacao, ctx: Contexto, alvo: Alvo) {
  await carregarModelo(tx, ctx, alvo.id);
  const [uso] = await tx
    .select({
      campanhas: sql<number>`(select count(*) from ${campanhas} where ${and(
        eq(campanhas.template_id, alvo.id),
        eq(campanhas.is_deleted, false),
        inArray(campanhas.status, ["rascunho", "enviando", "pausada"]),
      )})`.mapWith(Number),
      agendadas: sql<number>`(select count(*) from ${conversas_agendamentos} where ${and(
        eq(conversas_agendamentos.template_id, alvo.id),
        eq(conversas_agendamentos.is_deleted, false),
        eq(conversas_agendamentos.status, "agendada"),
      )})`.mapWith(Number),
    })
    .from(lojas_integracoes_templates)
    .where(vivosE(lojas_integracoes_templates, eq(lojas_integracoes_templates.id, alvo.id)));
  if ((uso?.campanhas ?? 0) + (uso?.agendadas ?? 0) > 0) {
    throw new ErroDeValidacao(
      { id: ["Este modelo está em uso por campanha ou mensagem agendada."] },
      undefined,
      "Este modelo está em uso por campanha ou mensagem agendada.",
    );
  }
  await excluirLogico(
    tx,
    lojas_integracoes_templates,
    { id: alvo.id, escopo: ctx.escopo, updatedAtOriginal: alvo.updated_at },
    ctx,
    TRILHA_CONTEUDO.modeloAlterado,
  );
}
