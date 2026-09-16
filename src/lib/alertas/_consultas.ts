import "server-only";
import { and, count, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import type { EscopoLoja } from "@/lib/auth/loja";
import { db } from "@/lib/db/client";
import { vivosE } from "@/lib/db/consultas";
import type { Papel } from "@/lib/db/schema/_enums/auth";
import { alertasVisiveis } from "./visibilidade";
import type { Transacao } from "@/lib/db/mutacoes";
import { alertas } from "@/lib/db/schema/alertas";
import { minutosDeSlaSql, venceEmSql } from "@/lib/sla/prazo";
import type { Severidade, TipoAlerta } from "@/lib/db/schema/_enums/plataforma";
import {
  condicaoDoCursor,
  montarPagina,
  ordemDoCursor,
  type Cursor,
  type Direcao,
  type Pagina,
} from "@/lib/auditoria/cursor";
import {
  AUSENCIA_RETORNO_DIAS,
  JANELA_NOVIDADE_HORAS,
  PROVEDORES_COM_RISCO_DE_AVALIACAO,
  RISCO_AVALIACAO_MINUTOS,
  TOLERANCIA_AGENDADA_MINUTOS,
  type TipoGerado,
} from "./regras";

/**
 * Leituras do módulo de alertas. Toda consulta cita a loja: a da tela passa por
 * `condicaoDeLoja(escopo)`; a do gerador varre a rede (ou uma loja, quando o
 * job pede) e copia o `loja_id` da ORIGEM para o alerta.
 */

export type Leitor = typeof db | Transacao;

/** Um objeto que hoje satisfaz a condição de um tipo. */
export type Candidato = {
  lojaId: string;
  alvoId: string;
  conversaId: string | null;
  contatoId: string | null;
  minutos: number | null;
  rotulo: string | null;
};

type LinhaCandidato = {
  loja_id: string;
  alvo_id: string;
  conversa_id: string | null;
  contato_id: string | null;
  minutos: number | null;
  rotulo: string | null;
};

const lista = (valores: readonly string[]) => sql.raw(valores.map((v) => `'${v}'`).join(", "));

/** Resposta da EQUIPE: saída de pessoa, que não é nota (campanha e sistema não respondem). */
const RESPOSTA_DA_EQUIPE = (alias: string) =>
  sql.raw(
    `${alias}.direcao = 'saida' and ${alias}.nota_interna = false and ${alias}.autor_tipo = 'usuario' and ${alias}.is_deleted = false`,
  );

/** 1ª entrada ainda sem resposta da equipe: o relógio do SLA (ADR 0060). */
const INICIO_SEM_RESPOSTA = sql`(
  select min(e.ocorrida_em) from conversas_mensagens e
   where e.conversa_id = c.id and e.direcao = 'entrada' and e.is_deleted = false
     and not exists (select 1 from conversas_mensagens s
                      where s.conversa_id = c.id and ${RESPOSTA_DA_EQUIPE("s")}
                        and s.ocorrida_em >= e.ocorrida_em))`;

const REFS_SLA = { lojaId: sql`c.loja_id`, provedor: sql`i.provedor`, prioridade: sql`c.prioridade` };

/**
 * "Sem resposta": conversa aberta, com entrada, e nenhuma mensagem NOSSA (nota
 * interna não conta) desde a última entrada. Não usa `nao_lidas` — ler não é
 * responder, e era o critério errado do sistema antigo.
 */
const SEM_RESPOSTA = sql`
  c.is_deleted = false
  and c.status in ('aberta', 'pendente')
  and c.ultima_entrada_em is not null
  and not exists (
    select 1 from conversas_mensagens m
     where m.conversa_id = c.id and ${RESPOSTA_DA_EQUIPE("m")}
       and m.ocorrida_em >= c.ultima_entrada_em)`;

function daLoja(coluna: string, lojaId: string | null): SQL {
  return lojaId ? sql`and ${sql.raw(coluna)} = ${lojaId}::uuid` : sql``;
}

const CONSULTAS: Record<TipoGerado, (lojaId: string | null) => SQL> = {
  sla_estourado: (lojaId) => sql`
    select c.loja_id, c.id as alvo_id, c.id as conversa_id, c.contato_id,
           (${minutosDeSlaSql(REFS_SLA)})::int as minutos, null::text as rotulo
      from conversas c join lojas_integracoes i on i.id = c.integracao_id
     where ${SEM_RESPOSTA}
       and i.provedor <> 'bling'
       and ${venceEmSql(INICIO_SEM_RESPOSTA, REFS_SLA)} < now()
       ${daLoja("c.loja_id", lojaId)}`,

  risco_avaliacao: (lojaId) => sql`
    select c.loja_id, c.id as alvo_id, c.id as conversa_id, c.contato_id,
           ${RISCO_AVALIACAO_MINUTOS}::int as minutos, null::text as rotulo
      from conversas c join lojas_integracoes i on i.id = c.integracao_id
     where ${SEM_RESPOSTA}
       and i.provedor in (${lista(PROVEDORES_COM_RISCO_DE_AVALIACAO)})
       and c.ultima_entrada_em < now() - make_interval(mins => ${RISCO_AVALIACAO_MINUTOS})
       ${daLoja("c.loja_id", lojaId)}`,

  primeiro_contato: (lojaId) => sql`
    select ct.loja_id, ct.id as alvo_id, null::uuid as conversa_id, ct.id as contato_id,
           null::int as minutos, null::text as rotulo
      from contatos ct
     where ct.is_deleted = false and ct.anonimizado_em is null
       and ct.pedidos_contagem = 0
       and ct.created_at >= now() - make_interval(hours => ${JANELA_NOVIDADE_HORAS})
       and exists (select 1 from conversas c where c.contato_id = ct.id and c.is_deleted = false)
       and not exists (
         select 1 from conversas_mensagens m join conversas c on c.id = m.conversa_id
          where c.contato_id = ct.id and m.direcao = 'saida' and m.nota_interna = false
            and m.is_deleted = false)
       ${daLoja("ct.loja_id", lojaId)}`,

  cliente_retornando: (lojaId) => sql`
    select c.loja_id, c.id as alvo_id, c.id as conversa_id, c.contato_id,
           null::int as minutos, null::text as rotulo
      from conversas c join contatos ct on ct.id = c.contato_id
     where ${SEM_RESPOSTA}
       and ct.is_deleted = false and ct.pedidos_contagem > 0
       and c.created_at >= now() - make_interval(hours => ${JANELA_NOVIDADE_HORAS})
       and (ct.ultima_compra_em is null
            or ct.ultima_compra_em < c.created_at - make_interval(days => ${AUSENCIA_RETORNO_DIAS}))
       and not exists (
         select 1 from conversas o
          where o.contato_id = c.contato_id and o.id <> c.id and o.is_deleted = false
            and o.created_at < c.created_at
            and coalesce(o.ultima_mensagem_em, o.created_at)
                >= c.created_at - make_interval(days => ${AUSENCIA_RETORNO_DIAS}))
       ${daLoja("c.loja_id", lojaId)}`,

  follow_up_atrasado: (lojaId) => sql`
    select a.loja_id, a.id as alvo_id, a.conversa_id, a.contato_id,
           null::int as minutos, null::text as rotulo
      from conversas_agendamentos a
     where a.is_deleted = false and a.status = 'agendada'
       and a.agendada_para < now() - make_interval(mins => ${TOLERANCIA_AGENDADA_MINUTOS})
       ${daLoja("a.loja_id", lojaId)}`,

  // "Caiu" pressupõe que já esteve de pé: sem `ultima_sincronizacao`, é um
  // número que ainda não foi pareado, e isso não é queda.
  sessao_uazapi_caiu: (lojaId) => sql`
    select i.loja_id, i.id as alvo_id, null::uuid as conversa_id, null::uuid as contato_id,
           null::int as minutos, i.rotulo
      from lojas_integracoes i
     where i.is_deleted = false and i.provedor = 'uazapi' and i.loja_id is not null
       and i.revogada_em is null and i.status <> 'conectado'
       and i.ultima_sincronizacao is not null
       ${daLoja("i.loja_id", lojaId)}`,

  // A conta Bling da rede tem `loja_id` nulo e `alertas.loja_id` é NOT NULL:
  // ela fica fora daqui por construção (registrado em docs/modulos/auditoria.md).
  integracao_com_erro: (lojaId) => sql`
    select i.loja_id, i.id as alvo_id, null::uuid as conversa_id, null::uuid as contato_id,
           null::int as minutos, i.rotulo
      from lojas_integracoes i
     where i.is_deleted = false and i.provedor <> 'uazapi' and i.loja_id is not null
       and i.revogada_em is null and i.status in ('erro', 'expirado')
       ${daLoja("i.loja_id", lojaId)}`,
};

/** Quem satisfaz a condição do tipo AGORA. É detecção e é reavaliação. */
export async function candidatosDe(
  tipo: TipoGerado,
  lojaId: string | null,
  leitor: Leitor = db,
): Promise<Candidato[]> {
  const resultado = await leitor.execute<LinhaCandidato>(CONSULTAS[tipo](lojaId));
  return resultado.rows.map((l) => ({
    lojaId: l.loja_id,
    alvoId: l.alvo_id,
    conversaId: l.conversa_id,
    contatoId: l.contato_id,
    minutos: l.minutos === null ? null : Number(l.minutos),
    rotulo: l.rotulo,
  }));
}

export type AlertaAberto = { id: string; lojaId: string; tipo: string; chave: string };

/** Alertas ainda não resolvidos dos tipos que o gerador conhece. */
export async function alertasAbertos(
  tipos: readonly TipoAlerta[],
  lojaId: string | null,
  leitor: Leitor = db,
): Promise<AlertaAberto[]> {
  return leitor
    .select({
      id: alertas.id,
      lojaId: alertas.loja_id,
      tipo: alertas.tipo,
      chave: alertas.chave_deduplicacao,
    })
    .from(alertas)
    .where(
      vivosE(
        alertas,
        isNull(alertas.resolvido_em),
        inArray(alertas.tipo, [...tipos]),
        lojaId ? eq(alertas.loja_id, lojaId) : undefined,
      ),
    );
}

/** Conversas cujo atraso já marcado continua valendo: sem resposta e no MESMO turno. */
export async function atrasosVigentes(lojaId: string | null, leitor: Leitor = db): Promise<Set<string>> {
  const r = await leitor.execute<{ id: string }>(sql`
    select c.id from conversas c
     where ${SEM_RESPOSTA} and c.sla_estourado_em is not null
       and ${INICIO_SEM_RESPOSTA} <= c.sla_estourado_em
       ${daLoja("c.loja_id", lojaId)}`);
  return new Set(r.rows.map((l) => l.id));
}

/** Conversas com o carimbo de SLA ligado — para desligar o que foi respondido. */
export async function conversasComSlaMarcado(
  lojaId: string | null,
  leitor: Leitor = db,
): Promise<{ id: string; lojaId: string }[]> {
  const resultado = await leitor.execute<{ id: string; loja_id: string }>(sql`
    select c.id, c.loja_id from conversas c
     where c.is_deleted = false and c.sla_estourado_em is not null
       ${daLoja("c.loja_id", lojaId)}`);
  return resultado.rows.map((l) => ({ id: l.id, lojaId: l.loja_id }));
}

// -- Tela --------------------------------------------------------------------

export type FiltrosAlertas = {
  /** Quem lê: `aviso_seguranca` só aparece para dono e admin (ADR 0062). */
  papel: Papel;
  tipo?: TipoAlerta | undefined;
  severidade?: Severidade | undefined;
  reconhecido?: "sim" | "nao" | undefined;
  cursor: Cursor | null;
  direcao: Direcao;
  porPagina: number;
};

export type AlertaNaLista = {
  id: string;
  lojaId: string;
  tipo: string;
  severidade: string;
  mensagem: string;
  chave: string;
  conversaId: string | null;
  contatoId: string | null;
  pedidoId: string | null;
  reconhecidoEm: Date | null;
  reconhecidoPor: string | null;
  criadoEm: Date;
  updatedAt: Date;
};

/** Só os abertos: resolvido é assunto encerrado e some da central. */
function filtroDaTela(escopo: EscopoLoja, f: Omit<FiltrosAlertas, "cursor" | "direcao" | "porPagina">) {
  return [
    alertasVisiveis(escopo, f.papel),
    isNull(alertas.resolvido_em),
    f.tipo ? eq(alertas.tipo, f.tipo) : undefined,
    f.severidade ? eq(alertas.severidade, f.severidade) : undefined,
    f.reconhecido === "sim" ? isNotNull(alertas.reconhecido_em) : undefined,
    f.reconhecido === "nao" ? isNull(alertas.reconhecido_em) : undefined,
  ];
}

export async function listarAlertas(
  escopo: EscopoLoja,
  f: FiltrosAlertas,
  leitor: Leitor = db,
): Promise<Pagina<AlertaNaLista>> {
  const linhas = await leitor
    .select({
      id: alertas.id,
      lojaId: alertas.loja_id,
      tipo: alertas.tipo,
      severidade: alertas.severidade,
      mensagem: alertas.mensagem,
      chave: alertas.chave_deduplicacao,
      conversaId: alertas.conversa_id,
      contatoId: alertas.contato_id,
      pedidoId: alertas.pedido_id,
      reconhecidoEm: alertas.reconhecido_em,
      reconhecidoPor: sql<string | null>`(select u.nome from usuarios u where u.id = ${alertas.reconhecido_por})`,
      criadoEm: alertas.created_at,
      updatedAt: alertas.updated_at,
    })
    .from(alertas)
    .where(
      vivosE(
        alertas,
        ...filtroDaTela(escopo, f),
        condicaoDoCursor(alertas.created_at, alertas.id, f.cursor, f.direcao),
      ),
    )
    .orderBy(...ordemDoCursor(alertas.created_at, alertas.id, f.direcao))
    .limit(f.porPagina + 1);

  return montarPagina(linhas, f.porPagina, f.direcao, f.cursor !== null, (a) => ({
    em: a.criadoEm,
    id: a.id,
  }));
}

export type ContadoresAlertas = { abertos: number; naoReconhecidos: number; criticos: number };

export async function contarAlertas(
  escopo: EscopoLoja,
  papel: Papel,
  leitor: Leitor = db,
): Promise<ContadoresAlertas> {
  const [linha] = await leitor
    .select({
      abertos: count(),
      naoReconhecidos: sql<number>`count(*) filter (where ${alertas.reconhecido_em} is null)`,
      criticos: sql<number>`count(*) filter (where ${alertas.severidade} = 'critica')`,
    })
    .from(alertas)
    .where(and(vivosE(alertas, alertasVisiveis(escopo, papel), isNull(alertas.resolvido_em))));
  return {
    abertos: Number(linha?.abertos ?? 0),
    naoReconhecidos: Number(linha?.naoReconhecidos ?? 0),
    criticos: Number(linha?.criticos ?? 0),
  };
}
