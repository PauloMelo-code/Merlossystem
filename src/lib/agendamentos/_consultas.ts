import "server-only";
import { asc, desc, eq, isNull } from "drizzle-orm";
import type { EscopoLoja } from "@/lib/auth/loja";
import { db } from "@/lib/db/client";
import { condicaoDeLoja, vivosE } from "@/lib/db/consultas";
import type { StatusAgendamento } from "@/lib/db/schema/_enums/conversas";
import { contatos } from "@/lib/db/schema/contatos";
import { conversas_agendamentos } from "@/lib/db/schema/conversas/agendamentos";
import { lojas_integracoes, lojas_integracoes_templates } from "@/lib/db/schema/integracoes";
import { depoisDoCursor } from "@/lib/campanhas/_consultas";
import { montarPagina, type Cursor, type Direcao } from "@/lib/campanhas/cursor";

/** Leituras de `/agendadas`. Mesmo cursor `(created_at, id)` das outras listas. */

export async function listarAgendamentos(
  escopo: EscopoLoja,
  filtro: { status?: StatusAgendamento | undefined },
  pagina: { cursor: Cursor | null; direcao: Direcao; limite: number },
) {
  const { cursor, direcao, limite } = pagina;
  const recentes = direcao === "proxima";
  const linhas = await db
    .select({
      id: conversas_agendamentos.id,
      atualizadoEm: conversas_agendamentos.updated_at,
      criadoEm: conversas_agendamentos.created_at,
      agendadaPara: conversas_agendamentos.agendada_para,
      status: conversas_agendamentos.status,
      gatilho: conversas_agendamentos.gatilho,
      tipo: conversas_agendamentos.tipo_conteudo,
      conteudo: conversas_agendamentos.conteudo,
      erro: conversas_agendamentos.erro,
      contato: contatos.nome,
      conta: lojas_integracoes.rotulo,
      modelo: lojas_integracoes_templates.nome,
    })
    .from(conversas_agendamentos)
    .innerJoin(contatos, eq(contatos.id, conversas_agendamentos.contato_id))
    .innerJoin(lojas_integracoes, eq(lojas_integracoes.id, conversas_agendamentos.integracao_id))
    .leftJoin(lojas_integracoes_templates, eq(lojas_integracoes_templates.id, conversas_agendamentos.template_id))
    .where(
      vivosE(
        conversas_agendamentos,
        condicaoDeLoja(conversas_agendamentos, escopo),
        filtro.status ? eq(conversas_agendamentos.status, filtro.status) : undefined,
        cursor
          ? depoisDoCursor(conversas_agendamentos.created_at, conversas_agendamentos.id, cursor, !recentes)
          : undefined,
      ),
    )
    .orderBy(
      recentes ? desc(conversas_agendamentos.created_at) : asc(conversas_agendamentos.created_at),
      recentes ? desc(conversas_agendamentos.id) : asc(conversas_agendamentos.id),
    )
    .limit(limite + 1);
  return montarPagina(linhas, limite, direcao, cursor !== null);
}

/**
 * Contatos para o seletor do formulário.
 * ponytail: lista até 500 por nome; busca por digitação quando a carteira passar disso.
 */
export async function contatosParaAgendar(lojaId: string) {
  return db
    .select({ id: contatos.id, nome: contatos.nome, telefone: contatos.telefone })
    .from(contatos)
    .where(vivosE(contatos, eq(contatos.loja_id, lojaId), isNull(contatos.anonimizado_em)))
    .orderBy(asc(contatos.nome))
    .limit(500);
}
