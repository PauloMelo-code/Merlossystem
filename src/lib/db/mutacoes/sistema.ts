import { sql, type SQL } from "drizzle-orm";
import { registrarAuditoria } from "@/lib/auditoria/gravador";
import { ErroDeEscopo } from "@/lib/erros";
import { db } from "../client";
import type { AcaoAuditada } from "../schema/_enums/auditoria";
import type { Provedor, Severidade, TipoAlerta, TipoEventoIntegracao } from "../schema/_enums/plataforma";
import { alertas } from "../schema/alertas";
import { campanhas_destinatarios } from "../schema/campanhas";
import type { CabecalhosEvento } from "../schema/integracoes";
import { ATOR_SISTEMA, type ContextoDeGravacao } from "../sistema";
import type { Transacao } from "./base";

/**
 * Gravações de sistema da porta única (reexportadas por `src/lib/db/mutacoes.ts`;
 * importe de `@/lib/db/mutacoes`).
 *
 * Gravações que nenhum helper por linha expressa: INSERT com `ON CONFLICT`
 * sobre índice único parcial (diário, alerta, destinatários) e as atualizações
 * EM LOTE da anonimização LGPD. Não importa valor de `../mutacoes`, para a
 * reexportação não virar ciclo.
 */

export { ATOR_SISTEMA, contextoDeSistema, type ContextoDeGravacao, type ContextoDeSistema } from "../sistema";
type Executor = Pick<Transacao, "execute">;

const linhas = (r: unknown) => (r as { rowCount?: number | null }).rowCount ?? 0;

// ---------------------------------------------------------------------------
// Diário de ingestão (01-dados.md §6.4, ADR 0017)
// ---------------------------------------------------------------------------

export type EventoDeIngestao = {
  provedor: Provedor;
  integracaoId: string | null;
  lojaId: string | null;
  tipo: TipoEventoIntegracao;
  eventoExternoId: string;
  assinaturaOk: boolean;
  ip: string | null;
  corpo: unknown;
  cabecalhos: CabecalhosEvento;
  erro?: string | null;
};

export type ResultadoIngestao = {
  id: string;
  /** `false` = o mesmo id de evento já estava no diário (reentrega). */
  novo: boolean;
  /** Ainda à espera de processamento: a reentrega pode reenfileirar. */
  pendente: boolean;
};

/**
 * A linha nasce com o corpo cru, ANTES de enfileirar — é a persistência que
 * decide o 500. `ON CONFLICT (provedor, evento_externo_id) DO NOTHING` repete o
 * predicado do índice parcial (senão o Postgres não o acha): a idempotência
 * vale para sempre (06/INV-139). Aceita o `db` (a borda não abre transação).
 */
export async function registrarEventoDeIngestao(
  e: EventoDeIngestao,
  exec: Executor = db,
): Promise<ResultadoIngestao> {
  const inserido = await exec.execute<{ id: string }>(sql`
    insert into lojas_integracoes_eventos
      (provedor, integracao_id, loja_id, tipo, evento_externo_id, assinatura_ok,
       ip, corpo, cabecalhos, erro, modified_by)
    values (${e.provedor}, ${e.integracaoId}, ${e.lojaId}, ${e.tipo}, ${e.eventoExternoId},
            ${e.assinaturaOk}, ${e.ip}, ${JSON.stringify(e.corpo ?? null)}::jsonb,
            ${JSON.stringify(e.cabecalhos)}::jsonb, ${e.erro ?? null}, ${ATOR_SISTEMA})
    on conflict (provedor, evento_externo_id) where evento_externo_id is not null
    do nothing
    returning id`);
  const criado = inserido.rows[0];
  if (criado) return { id: criado.id, novo: true, pendente: e.tipo === "recebido" };

  const existente = await exec.execute<{ id: string; tipo: string; processado_em: Date | null }>(sql`
    select id, tipo, processado_em from lojas_integracoes_eventos
     where provedor = ${e.provedor} and evento_externo_id = ${e.eventoExternoId}
     limit 1`);
  const linha = existente.rows[0];
  if (!linha) throw new ErroDeEscopo();
  return {
    id: linha.id,
    novo: false,
    pendente: linha.tipo === "recebido" && linha.processado_em === null,
  };
}

// ---------------------------------------------------------------------------
// Alertas (01-dados.md §6.6)
// ---------------------------------------------------------------------------

export type NovoAlerta = {
  lojaId: string;
  tipo: TipoAlerta;
  severidade: Severidade;
  mensagem: string;
  chave: string;
  conversaId?: string | null;
  contatoId?: string | null;
  pedidoId?: string | null;
  negocioId?: string | null;
};

/**
 * Abre o alerta com dedupe: enquanto houver um aberto com a mesma chave na
 * loja, nada nasce. Estado de sistema — sem trilha, autor é o ATOR_SISTEMA.
 * Devolve o id novo, ou `null` quando a dedupe segurou.
 */
export async function abrirAlerta(tx: Transacao, novo: NovoAlerta): Promise<string | null> {
  const agora = new Date();
  const [linha] = await tx
    .insert(alertas)
    .values({
      loja_id: novo.lojaId,
      tipo: novo.tipo,
      severidade: novo.severidade,
      mensagem: novo.mensagem,
      chave_deduplicacao: novo.chave,
      conversa_id: novo.conversaId ?? null,
      contato_id: novo.contatoId ?? null,
      pedido_id: novo.pedidoId ?? null,
      negocio_id: novo.negocioId ?? null,
      created_at: agora,
      updated_at: agora,
      modified_by: ATOR_SISTEMA,
    })
    .onConflictDoNothing({
      target: [alertas.loja_id, alertas.chave_deduplicacao],
      where: sql`resolvido_em is null and is_deleted = false`,
    })
    .returning({ id: alertas.id });
  return linha?.id ?? null;
}

// ---------------------------------------------------------------------------
// Destinatários de campanha (01-dados-dominio.md §5.5)
// ---------------------------------------------------------------------------

/** Linhas por INSERT: 6 parâmetros por linha fica longe do teto de 65 535. */
const LOTE_DESTINATARIOS = 1000;

/**
 * Materializa os destinatários em lote. `ON CONFLICT (campanha_id, contato_id)
 * DO NOTHING` fecha a corrida que mandava a campanha duas vezes (03/C1). UMA
 * linha de trilha pelo lote, na entidade `campanhas`, com as contagens.
 * Devolve quantas linhas nasceram.
 */
export async function inserirDestinatariosEmLote(
  tx: Transacao,
  ctx: ContextoDeGravacao,
  alvo: { lojaId: string; campanhaId: string; contatoIds: readonly string[] },
  acao: AcaoAuditada,
): Promise<number> {
  const unicos = [...new Set(alvo.contatoIds)];
  const agora = new Date();
  let inseridos = 0;
  for (let i = 0; i < unicos.length; i += LOTE_DESTINATARIOS) {
    const fatia = unicos.slice(i, i + LOTE_DESTINATARIOS);
    const criadas = await tx
      .insert(campanhas_destinatarios)
      .values(
        fatia.map((contatoId) => ({
          loja_id: alvo.lojaId,
          campanha_id: alvo.campanhaId,
          contato_id: contatoId,
          created_at: agora,
          updated_at: agora,
          modified_by: ctx.autorId,
        })),
      )
      .onConflictDoNothing({
        target: [campanhas_destinatarios.campanha_id, campanhas_destinatarios.contato_id],
        where: sql`is_deleted = false`,
      })
      .returning({ id: campanhas_destinatarios.id });
    inseridos += criadas.length;
  }
  await registrarAuditoria(tx, ctx, acao, "campanhas", alvo.campanhaId, {
    antes: null,
    depois: { destinatarios_pedidos: unicos.length, destinatarios_inseridos: inseridos },
  });
  return inseridos;
}

// ---------------------------------------------------------------------------
// LGPD — atualizações em lote da anonimização (01-dados-dominio.md §8, ADR 0013)
// ---------------------------------------------------------------------------

export type ResultadoAnonimizacao = {
  /** Linhas tocadas por tabela (vai para `lgpd_solicitacoes.resultado`). */
  tabelas: Record<string, number>;
  /** Mídias recebidas do titular: o job `limpar-midia` remove os objetos. */
  midiaIds: string[];
};

/**
 * Os passos EM LOTE da eliminação. NÃO grava a trilha, NÃO anonimiza a linha de
 * `contatos` (é por trava de colisão) e NÃO registra a solicitação: isso é da
 * regra de negócio (módulo LGPD), que grava `lgpd_anonimizado` ANTES de chamar.
 *
 * Alcança também linhas já excluídas: dado pessoal em linha excluída continua
 * sendo dado pessoal. Mensagem recebe o MARCADOR, nunca `NULL` (CHECK
 * `conteudo_presente`). Pedido permanece (a venda de verdade mora no Masc),
 * sem observação nem endereço. Agendamento pendente é cancelado.
 */
export async function anonimizarTitular(
  tx: Transacao,
  ctx: ContextoDeGravacao,
  alvo: { lojaId: string; contatoId: string; marcador: string; agora?: Date },
): Promise<ResultadoAnonimizacao> {
  const { lojaId, contatoId, marcador } = alvo;
  const agora = alvo.agora ?? new Date();
  const autor = ctx.autorId;
  const carimbo = sql`updated_at = ${agora}, modified_by = ${autor}`;
  const conversas = sql`(select id from conversas where contato_id = ${contatoId} and loja_id = ${lojaId})`;
  const mensagens = sql`(select id from conversas_mensagens
    where loja_id = ${lojaId} and conversa_id in ${conversas})`;
  const rodar = async (consulta: SQL) => linhas(await tx.execute(consulta));

  const tabelas: Record<string, number> = {};
  tabelas.conversas_mensagens = await rodar(sql`
    update conversas_mensagens set conteudo = ${marcador}, metadados = '{}'::jsonb, ${carimbo}
     where loja_id = ${lojaId} and conversa_id in ${conversas}`);
  // Cache da lista: contador, sem carimbo (01-dados.md §4.7).
  tabelas.conversas = await rodar(sql`
    update conversas set ultima_mensagem_previa = ${marcador}
     where loja_id = ${lojaId} and contato_id = ${contatoId} and ultima_mensagem_previa is not null`);
  tabelas.conversas_mensagens_midias = await rodar(sql`
    update conversas_mensagens_midias set legenda = null, transcricao = null, ${carimbo}
     where loja_id = ${lojaId} and mensagem_id in ${mensagens}`);
  tabelas.pesquisas_satisfacao = await rodar(sql`
    update pesquisas_satisfacao set comentario = null, ${carimbo}
     where loja_id = ${lojaId} and contato_id = ${contatoId}`);
  tabelas.conversas_agendamentos = await rodar(sql`
    update conversas_agendamentos
       set conteudo = case when conteudo is null then null else ${marcador} end,
           variaveis = '[]'::jsonb,
           status = case when status = 'agendada' then 'cancelada' else status end,
           cancelada_por = case when status = 'agendada' then ${autor}::uuid else cancelada_por end,
           ${carimbo}
     where loja_id = ${lojaId} and contato_id = ${contatoId}`);
  tabelas.pedidos = await rodar(sql`
    update pedidos set observacoes = null, endereco_entrega = null, ${carimbo}
     where loja_id = ${lojaId} and contato_id = ${contatoId}
       and (observacoes is not null or endereco_entrega is not null)`);

  // Mídias RECEBIDAS do titular: todas vão para o job; as vivas viram excluídas
  // e `nome_original` (nome do arquivo que a pessoa mandou) some.
  const recebidas = await tx.execute<{ id: string }>(sql`
    update lojas_midias lm
       set nome_original = null,
           deleted_at = coalesce(lm.deleted_at, ${agora}),
           is_deleted = true,
           ${carimbo}
     where lm.loja_id = ${lojaId} and lm.origem = 'recebida'
       and lm.id in (select cmm.midia_id from conversas_mensagens_midias cmm
                       join conversas_mensagens m on m.id = cmm.mensagem_id
                      where m.direcao = 'entrada' and m.id in ${mensagens}
                        and cmm.midia_id is not null)
    returning lm.id`);
  tabelas.lojas_midias = recebidas.rows.length;
  return { tabelas, midiaIds: recebidas.rows.map((r) => r.id) };
}
