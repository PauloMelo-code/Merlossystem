import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { codificarCursor, decodificarCursor } from "@/lib/contatos";
import type { Transacao } from "@/lib/db/mutacoes";
import type { SecaoDossie } from "@/lib/validadores/lgpd";

/**
 * Dossiê do titular (01-dados-dominio.md §7.3) — o conteúdo que a exportação
 * antiga deixava de fora (02/L-11): cadastro e etiquetas, conversas e
 * mensagens com legendas e transcrições, pedidos, itens, pagamentos,
 * devoluções, negócios, consentimentos (histórico COMPLETO), pesquisas e
 * agendamentos.
 *
 * Sai PAGINADO por seção, `(tempo, id)` crescente, nunca "todas as mensagens
 * numa resposta". Inclui linhas excluídas (com `is_deleted`): o que o sistema
 * guarda é o que o titular tem direito de ver. Nunca sai `url_externa`, chave de
 * objeto nem segredo — só o que é DADO do titular.
 *
 * Tudo filtrado por `loja_id` (escopo por loja, DN-05). Identificadores de
 * tabela e coluna são constantes deste arquivo, nunca entrada.
 */

export const TAMANHO_DA_PAGINA = 200;

type Alvo = { lojaId: string; contatoId: string };
type Definicao = { tempo: string; origem: string; colunas: string; filtro: (a: Alvo) => SQL };

const doContato = (a: Alvo) => sql`t.loja_id = ${a.lojaId} and t.contato_id = ${a.contatoId}`;
const pedidosDoContato = (a: Alvo) =>
  sql`t.loja_id = ${a.lojaId} and t.pedido_id in
      (select id from pedidos where loja_id = ${a.lojaId} and contato_id = ${a.contatoId})`;

const SECOES: Readonly<Record<SecaoDossie, Definicao>> = {
  contato: {
    tempo: "created_at",
    origem: "contatos t",
    colunas: `t.nome, t.telefone, t.email, t.whatsapp_id, t.instagram_id, t.facebook_id,
      t.tiktok_id, t.tamanho_preferido, t.observacoes, t.aniversario, t.endereco,
      t.ultimo_contato_em, t.ultima_compra_em, t.opt_out, t.opt_out_em, t.anonimizado_em,
      t.created_at, t.is_deleted,
      (select coalesce(json_agg(le.nome order by le.nome), '[]'::json)
         from contatos_etiquetas ce join lojas_etiquetas le on le.id = ce.etiqueta_id
        where ce.contato_id = t.id and ce.is_deleted = false) as etiquetas`,
    filtro: (a) => sql`t.loja_id = ${a.lojaId} and t.id = ${a.contatoId}`,
  },
  conversas: {
    tempo: "created_at",
    origem: "conversas t left join lojas_integracoes li on li.id = t.integracao_id",
    colunas: `li.provedor as canal, t.status, t.prioridade, t.ultima_mensagem_em,
      t.resolvida_em, t.created_at, t.is_deleted`,
    filtro: doContato,
  },
  mensagens: {
    tempo: "created_at",
    origem: "conversas_mensagens t",
    colunas: `t.conversa_id, t.direcao, t.autor_tipo, t.tipo_conteudo, t.conteudo,
      t.nota_interna, t.status_entrega, t.ocorrida_em, t.created_at, t.is_deleted,
      (select coalesce(json_agg(json_build_object(
                'tipo', cmm.tipo_arquivo, 'legenda', cmm.legenda, 'transcricao', cmm.transcricao)
              order by cmm.created_at), '[]'::json)
         from conversas_mensagens_midias cmm where cmm.mensagem_id = t.id) as midias`,
    filtro: (a) =>
      sql`t.loja_id = ${a.lojaId} and t.conversa_id in
          (select id from conversas where loja_id = ${a.lojaId} and contato_id = ${a.contatoId})`,
  },
  pedidos: {
    tempo: "created_at",
    origem: "pedidos t",
    colunas: `t.numero, t.status, t.pagamento_status, t.subtotal, t.frete, t.desconto, t.total,
      t.forma_pagamento, t.entrega_metodo, t.rastreio_codigo, t.endereco_entrega,
      t.observacoes, t.cancelado_em, t.created_at, t.is_deleted`,
    filtro: doContato,
  },
  pedidos_itens: {
    tempo: "created_at",
    origem: "pedidos_itens t",
    colunas: `t.pedido_id, t.sku, t.nome, t.tamanho, t.quantidade, t.preco_unitario,
      t.total_item, t.created_at, t.is_deleted`,
    filtro: pedidosDoContato,
  },
  pagamentos: {
    tempo: "created_at",
    origem: "pagamentos t",
    colunas: `t.pedido_id, t.provedor, t.metodo, t.status, t.valor, t.pago_em,
      t.estornado_em, t.created_at, t.is_deleted`,
    filtro: pedidosDoContato,
  },
  devolucoes: {
    tempo: "created_at",
    origem: "pedidos_devolucoes t",
    colunas: `t.pedido_id, t.tipo, t.motivo, t.motivo_detalhe, t.status, t.valor_estorno,
      t.metodo_estorno, t.resolvido_em, t.created_at, t.is_deleted`,
    filtro: doContato,
  },
  devolucoes_itens: {
    tempo: "created_at",
    origem: "pedidos_devolucoes_itens t",
    colunas: `t.devolucao_id, t.pedido_item_id, t.quantidade, t.created_at, t.is_deleted`,
    filtro: (a) =>
      sql`t.loja_id = ${a.lojaId} and t.devolucao_id in
          (select id from pedidos_devolucoes where loja_id = ${a.lojaId} and contato_id = ${a.contatoId})`,
  },
  negocios: {
    tempo: "created_at",
    origem: "negocios t",
    colunas: `t.estagio, t.valor, t.motivo_perda, t.observacao_perda, t.previsao_fechamento,
      t.created_at, t.is_deleted`,
    filtro: doContato,
  },
  consentimentos: {
    tempo: "criado_em",
    origem: "consentimentos t",
    colunas: `t.tipo, t.concedido, t.origem, t.canal, t.termo_versao, t.ip, t.criado_em`,
    filtro: doContato,
  },
  pesquisas: {
    tempo: "created_at",
    origem: "pesquisas_satisfacao t",
    colunas: `t.gatilho, t.nota, t.comentario, t.enviada_em, t.respondida_em,
      t.created_at, t.is_deleted`,
    filtro: doContato,
  },
  agendamentos: {
    tempo: "created_at",
    origem: "conversas_agendamentos t",
    colunas: `t.tipo_conteudo, t.conteudo, t.agendada_para, t.gatilho, t.status,
      t.enviada_em, t.created_at, t.is_deleted`,
    filtro: doContato,
  },
};

export type PaginaDossie = {
  secao: SecaoDossie;
  linhas: Record<string, unknown>[];
  proximoCursor: string | null;
};

export async function lerPaginaDoDossie(
  tx: Transacao,
  alvo: Alvo,
  secao: SecaoDossie,
  cursorTexto: string | undefined,
): Promise<PaginaDossie> {
  const def = SECOES[secao];
  const tempo = sql.raw(`t.${def.tempo}`);
  const cursor = decodificarCursor(cursorTexto);
  const depois = cursor?.t
    ? sql`and (${tempo}, t.id) > (${cursor.t}::timestamptz, ${cursor.id}::uuid)`
    : sql``;

  const resultado = await tx.execute<Record<string, unknown>>(sql`
    select t.id as "_id", ${tempo} as "_tempo", ${sql.raw(def.colunas)}
      from ${sql.raw(def.origem)}
     where ${def.filtro(alvo)} ${depois}
     order by ${tempo}, t.id
     limit ${TAMANHO_DA_PAGINA + 1}`);

  const linhas = resultado.rows.slice(0, TAMANHO_DA_PAGINA);
  const ultima = linhas[linhas.length - 1];
  const temMais = resultado.rows.length > TAMANHO_DA_PAGINA;
  const proximoCursor =
    temMais && ultima
      ? codificarCursor({ t: new Date(ultima._tempo as string | Date).toISOString(), id: String(ultima._id) })
      : null;

  return {
    secao,
    linhas: linhas.map((linha) => {
      const { _id: id, ...resto } = linha;
      delete resto._tempo;
      return { id, ...resto };
    }),
    proximoCursor,
  };
}
