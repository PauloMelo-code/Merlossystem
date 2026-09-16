import "server-only";
import { eq, isNull } from "drizzle-orm";
import type { z } from "zod";
import { condicaoDeLoja, vivosE } from "@/lib/db/consultas";
import { atualizarComTrava, inserirAuditado, type ContextoDeGravacao, type Transacao } from "@/lib/db/mutacoes";
import { contatos } from "@/lib/db/schema/contatos";
import { conversas_agendamentos } from "@/lib/db/schema/conversas/agendamentos";
import { ErroDeEscopo, ErroDeValidacao } from "@/lib/erros";
import { enfileirar } from "@/lib/fila/filas";
import { jobId } from "@/lib/fila/idempotencia";
import { contaDaLoja, exigirVariaveisDoModelo, modeloDaConta } from "@/lib/campanhas/conta";
import { TRILHA_AGENDAMENTO } from "@/lib/conteudo/trilha";
import type { agendamentoSchema } from "@/lib/validadores/campanhas";

/**
 * Gravação de mensagem agendada por PESSOA (04-ui.md §5.4, `/agendadas`).
 * O envio é do worker (`envio.ts`); aqui só nasce, muda de horário ou cancela.
 */

type Alvo = { id: string; updated_at: Date };
export type Agendado = { lojaId: string; id: string; agendadaPara: Date };

async function carregarAgendada(tx: Transacao, ctx: ContextoDeGravacao, id: string) {
  const [linha] = await tx
    .select({ id: conversas_agendamentos.id, lojaId: conversas_agendamentos.loja_id, status: conversas_agendamentos.status })
    .from(conversas_agendamentos)
    .where(vivosE(conversas_agendamentos, condicaoDeLoja(conversas_agendamentos, ctx.escopo), eq(conversas_agendamentos.id, id)))
    .limit(1);
  if (!linha) throw new ErroDeEscopo();
  if (linha.status !== "agendada") {
    throw new ErroDeValidacao({ status: ["Esta mensagem não está mais agendada."] });
  }
  return linha;
}

export async function criarAgendamento(
  tx: Transacao,
  ctx: ContextoDeGravacao,
  dados: z.output<typeof agendamentoSchema>,
): Promise<Agendado> {
  if (ctx.escopo.tipo !== "uma") throw new ErroDeEscopo();
  const lojaId = ctx.escopo.lojaId;

  const [contato] = await tx
    .select({ id: contatos.id })
    .from(contatos)
    .where(vivosE(contatos, eq(contatos.loja_id, lojaId), eq(contatos.id, dados.contato_id), isNull(contatos.anonimizado_em)))
    .limit(1);
  if (!contato) throw new ErroDeValidacao({ contato_id: ["Contato não encontrado nesta loja."] });

  const conta = await contaDaLoja(tx, lojaId, dados.integracao_id);
  if (dados.tipo_conteudo === "template") {
    exigirVariaveisDoModelo(dados.variaveis, await modeloDaConta(tx, conta.id, dados.template_id!));
  } else if (dados.variaveis.length > 0) {
    throw new ErroDeValidacao({ variaveis: ["Variáveis só existem em mensagem por modelo."] });
  }

  const linha = await inserirAuditado(
    tx,
    conversas_agendamentos,
    {
      loja_id: lojaId,
      contato_id: contato.id,
      integracao_id: conta.id,
      tipo_conteudo: dados.tipo_conteudo,
      conteudo: dados.tipo_conteudo === "texto" ? dados.conteudo : null,
      template_id: dados.tipo_conteudo === "template" ? dados.template_id : null,
      variaveis: dados.variaveis,
      agendada_para: dados.agendada_para,
      gatilho: dados.gatilho,
    },
    ctx,
    TRILHA_AGENDAMENTO.criado,
  );
  return { lojaId, id: String(linha.id), agendadaPara: dados.agendada_para };
}

export async function reagendar(
  tx: Transacao,
  ctx: ContextoDeGravacao,
  alvo: Alvo & { agendada_para: Date },
): Promise<Agendado> {
  const linha = await carregarAgendada(tx, ctx, alvo.id);
  await atualizarComTrava(
    tx,
    conversas_agendamentos,
    {
      id: linha.id,
      escopo: ctx.escopo,
      updatedAtOriginal: alvo.updated_at,
      dados: { agendada_para: alvo.agendada_para },
    },
    ctx,
    TRILHA_AGENDAMENTO.reagendado,
  );
  return { lojaId: linha.lojaId, id: linha.id, agendadaPara: alvo.agendada_para };
}

/** Cancelamento LÓGICO (INV-20): a linha fica, com quem cancelou. */
export async function cancelar(tx: Transacao, ctx: ContextoDeGravacao, alvo: Alvo): Promise<void> {
  const linha = await carregarAgendada(tx, ctx, alvo.id);
  await atualizarComTrava(
    tx,
    conversas_agendamentos,
    {
      id: linha.id,
      escopo: ctx.escopo,
      updatedAtOriginal: alvo.updated_at,
      dados: { status: "cancelada", cancelada_por: ctx.autorId },
    },
    ctx,
    TRILHA_AGENDAMENTO.cancelado,
  );
}

/**
 * Enfileira DEPOIS do commit, com `delay` até o horário. O horário entra no
 * `jobId`: reagendar cria outro job, e o antigo se descarta sozinho.
 */
export async function agendarEnvio(a: Agendado): Promise<void> {
  const quando = a.agendadaPara.getTime();
  await enfileirar(
    "agendamentos",
    "enviar-agendada",
    { lojaId: a.lojaId, agendamentoId: a.id, agendadaPara: a.agendadaPara.toISOString() },
    { jobId: jobId("agendada", a.id, String(quando)), delay: Math.max(0, quando - Date.now()) },
  );
}
