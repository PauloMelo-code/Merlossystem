import "server-only";
import { sql, type SQL } from "drizzle-orm";
import type { EscopoLoja } from "@/lib/auth/loja";
import { db } from "@/lib/db/client";
import type { IndicadorQualidade } from "@/lib/validadores/auditoria";
import type { Leitor } from "./consulta";

/**
 * `/auditoria/qualidade` — o painel do dono: erros por pessoa (04-ui.md §5.5).
 *
 * Os QUATRO indicadores e as fontes são os fixados no documento, nenhum a mais:
 *
 *   falhas_envio      conversas_mensagens.status_entrega = 'falhou', por autor
 *   dispensas_masc    auditoria_eventos.acao = 'pedido_dispensado_masc', por ator
 *   voltou_fila_masc  auditoria_eventos.acao = 'pedido_voltou_fila_masc', por ator
 *   recusas_403       auth_eventos.tipo = 'recusa_403', por usuario_id
 *
 * Conflito de edição NÃO é indicador: não há fonte na lista fechada (R-04).
 *
 * `auth_eventos` não tem loja. Com uma loja escolhida, a recusa conta para quem
 * é DAQUELA loja (vendedora e viewer); gestão, que não tem loja, só aparece em
 * "todas as lojas".
 */

export type Periodo = { de: Date; ate: Date };

export type LinhaQualidade = {
  pessoaId: string;
  nome: string;
  falhasEnvio: number;
  dispensasMasc: number;
  voltouFilaMasc: number;
  recusas403: number;
};

export type Ocorrencia = {
  id: string;
  quando: Date;
  /** Texto curto do que aconteceu (motivo da falha, motivo da dispensa, chave recusada). */
  descricao: string | null;
  /** Para onde a linha leva, quando há objeto. */
  rota: string | null;
};

function lojaDe(coluna: string, escopo: EscopoLoja): SQL {
  if (escopo.tipo === "nenhuma") return sql`and false`;
  if (escopo.tipo === "todas") return sql``;
  return sql`and ${sql.raw(coluna)} = ${escopo.lojaId}::uuid`;
}

/** Recusa 403 não tem loja: a loja é a do cadastro de quem foi recusado. */
function lojaDaPessoa(escopo: EscopoLoja): SQL {
  if (escopo.tipo === "nenhuma") return sql`and false`;
  if (escopo.tipo === "todas") return sql``;
  return sql`and exists (select 1 from usuarios u where u.id = e.usuario_id and u.loja_id = ${escopo.lojaId}::uuid)`;
}

export async function painelDeQualidade(
  escopo: EscopoLoja,
  periodo: Periodo,
  leitor: Leitor = db,
): Promise<LinhaQualidade[]> {
  const de = periodo.de.toISOString();
  const ate = periodo.ate.toISOString();
  const resultado = await leitor.execute<{
    pessoa_id: string;
    nome: string | null;
    falhas: string;
    dispensas: string;
    voltou: string;
    recusas: string;
  }>(sql`
    with ocorrencias as (
      select m.autor_usuario_id as pessoa_id, 'falhas' as indicador
        from conversas_mensagens m
       where m.is_deleted = false and m.status_entrega = 'falhou'
         and m.autor_usuario_id is not null
         and m.created_at >= ${de}::timestamptz and m.created_at < ${ate}::timestamptz
         ${lojaDe("m.loja_id", escopo)}
      union all
      select e.ator_id, case e.acao when 'pedido_dispensado_masc' then 'dispensas' else 'voltou' end
        from auditoria_eventos e
       where e.acao in ('pedido_dispensado_masc', 'pedido_voltou_fila_masc')
         and e.ator_id is not null
         and e.criado_em >= ${de}::timestamptz and e.criado_em < ${ate}::timestamptz
         ${lojaDe("e.loja_id", escopo)}
      union all
      select e.usuario_id, 'recusas'
        from auth_eventos e
       where e.tipo = 'recusa_403' and e.usuario_id is not null
         and e.criado_em >= ${de}::timestamptz and e.criado_em < ${ate}::timestamptz
         ${lojaDaPessoa(escopo)}
    )
    select o.pessoa_id, u.nome,
           count(*) filter (where o.indicador = 'falhas')::text as falhas,
           count(*) filter (where o.indicador = 'dispensas')::text as dispensas,
           count(*) filter (where o.indicador = 'voltou')::text as voltou,
           count(*) filter (where o.indicador = 'recusas')::text as recusas
      from ocorrencias o
      left join usuarios u on u.id = o.pessoa_id
     group by o.pessoa_id, u.nome
     order by count(*) desc, u.nome`);

  return resultado.rows.map((l) => ({
    pessoaId: l.pessoa_id,
    // Trilha sem FK (ADR 0012): pessoa sem cadastro aparece, não some.
    nome: l.nome ?? "Pessoa sem cadastro",
    falhasEnvio: Number(l.falhas),
    dispensasMasc: Number(l.dispensas),
    voltouFilaMasc: Number(l.voltou),
    recusas403: Number(l.recusas),
  }));
}

const LIMITE_OCORRENCIAS = 100;

/** "Abrir a lista de ocorrências" de uma célula do painel. */
export async function ocorrenciasDe(
  escopo: EscopoLoja,
  indicador: IndicadorQualidade,
  pessoaId: string,
  periodo: Periodo,
  leitor: Leitor = db,
): Promise<Ocorrencia[]> {
  const de = periodo.de.toISOString();
  const ate = periodo.ate.toISOString();
  let consulta: SQL;

  if (indicador === "falhas_envio") {
    consulta = sql`
      select m.id, m.created_at as quando, m.falha_motivo as descricao,
             '/conversas/' || m.conversa_id as rota
        from conversas_mensagens m
       where m.is_deleted = false and m.status_entrega = 'falhou'
         and m.autor_usuario_id = ${pessoaId}::uuid
         and m.created_at >= ${de}::timestamptz and m.created_at < ${ate}::timestamptz
         ${lojaDe("m.loja_id", escopo)}
       order by m.created_at desc limit ${LIMITE_OCORRENCIAS}`;
  } else if (indicador === "recusas_403") {
    consulta = sql`
      select e.id, e.criado_em as quando, e.detalhes->>'acao' as descricao, null as rota
        from auth_eventos e
       where e.tipo = 'recusa_403' and e.usuario_id = ${pessoaId}::uuid
         and e.criado_em >= ${de}::timestamptz and e.criado_em < ${ate}::timestamptz
         ${lojaDaPessoa(escopo)}
       order by e.criado_em desc limit ${LIMITE_OCORRENCIAS}`;
  } else {
    const acao = indicador === "dispensas_masc" ? "pedido_dispensado_masc" : "pedido_voltou_fila_masc";
    consulta = sql`
      select e.id, e.criado_em as quando, e.motivo as descricao,
             case when e.entidade = 'pedidos' then '/pedidos/' || e.entidade_id end as rota
        from auditoria_eventos e
       where e.acao = ${acao} and e.ator_id = ${pessoaId}::uuid
         and e.criado_em >= ${de}::timestamptz and e.criado_em < ${ate}::timestamptz
         ${lojaDe("e.loja_id", escopo)}
       order by e.criado_em desc limit ${LIMITE_OCORRENCIAS}`;
  }

  const resultado = await leitor.execute<{
    id: string;
    quando: Date | string;
    descricao: string | null;
    rota: string | null;
  }>(consulta);
  return resultado.rows.map((l) => ({
    id: l.id,
    quando: new Date(l.quando),
    descricao: l.descricao,
    rota: l.rota,
  }));
}
