import "server-only";
import { and, asc, count, eq, gte, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { vivos, vivosE } from "@/lib/db/consultas";
import type { Transacao } from "@/lib/db/mutacoes";
import { contatos, contatos_etiquetas } from "@/lib/db/schema/contatos";
import { consentimentos } from "@/lib/db/schema/lgpd";
import { lojas_etiquetas } from "@/lib/db/schema/lojas";
import { ErroDeValidacao } from "@/lib/erros";
import type { Segmento } from "@/lib/validadores/campanhas";

/**
 * Audiência de campanha (01-dados.md §10, 01-dados-dominio.md §7.2).
 *
 * UM filtro só, usado pela prévia ("vai para 412 pessoas") E pela
 * materialização: se fossem dois, a tela prometeria um número e o disparo
 * mandaria para outro.
 *
 * Opt-out lê a VERDADE (`consentimentos`, última linha por contato), nunca o
 * espelho `contatos.opt_out`. A última linha de marketing decide:
 * `opt_out` concedido = fora; `opt_in` concedido = dentro; `marketing` negado =
 * fora. Contato sem linha nenhuma está dentro (o espelho nasce `false`).
 */

type Leitor = Pick<Transacao, "select">;

/** `true` quando a última manifestação de marketing do contato é de saída. */
export const optOutVerdadeiro: SQL<boolean> = sql<boolean>`coalesce((
  select case when ${consentimentos.tipo} = 'opt_out' then ${consentimentos.concedido}
              else not ${consentimentos.concedido} end
    from ${consentimentos}
   where ${consentimentos.contato_id} = ${contatos.id}
     and ${consentimentos.tipo} in ('opt_out', 'opt_in', 'marketing')
   order by ${consentimentos.criado_em} desc, ${consentimentos.id} desc
   limit 1), false)`;

/**
 * `etiquetas_ids` vem do cliente: cada uma precisa ser DESTA loja e estar viva.
 * Etiqueta de outra loja cairia num filtro que nunca casa — e a campanha iria
 * para zero pessoas sem ninguém entender por quê.
 */
export async function conferirEtiquetas(
  leitor: Leitor,
  lojaId: string,
  ids: readonly string[] | undefined,
): Promise<void> {
  if (!ids?.length) return;
  const achadas = await leitor
    .select({ id: lojas_etiquetas.id })
    .from(lojas_etiquetas)
    .where(vivosE(lojas_etiquetas, eq(lojas_etiquetas.loja_id, lojaId), inArray(lojas_etiquetas.id, [...ids])));
  if (achadas.length !== new Set(ids).size) {
    throw new ErroDeValidacao({ "segmento.etiquetas_ids": ["Uma das etiquetas não existe nesta loja."] });
  }
}

export function condicaoDoSegmento(lojaId: string, segmento: Segmento): SQL | undefined {
  const partes: (SQL | undefined)[] = [
    eq(contatos.loja_id, lojaId),
    isNull(contatos.anonimizado_em),
    // Sem identificador de WhatsApp não há para onde mandar.
    or(sql`${contatos.whatsapp_id} is not null`, sql`${contatos.telefone} is not null`),
    sql`not ${optOutVerdadeiro}`,
  ];
  if (segmento.etiquetas_ids?.length) {
    partes.push(sql`exists (
      select 1 from ${contatos_etiquetas}
       where ${contatos_etiquetas.contato_id} = ${contatos.id}
         and ${contatos_etiquetas.is_deleted} = false
         and ${inArray(contatos_etiquetas.etiqueta_id, segmento.etiquetas_ids)})`);
  }
  if (segmento.tamanho) partes.push(eq(contatos.tamanho_preferido, segmento.tamanho));
  if (segmento.gasto_minimo) partes.push(gte(contatos.pedidos_valor_total, segmento.gasto_minimo));
  if (segmento.dias_sem_compra) {
    const limite = new Date(Date.now() - segmento.dias_sem_compra * 86_400_000);
    partes.push(lte(contatos.ultima_compra_em, limite));
  }
  return vivosE(contatos, ...partes);
}

export type Previa = { total: number; amostra: string[] };

/** Contagem e 5 nomes, com exatamente o filtro do envio. */
export async function previaDoSegmento(lojaId: string, segmento: Segmento): Promise<Previa> {
  const onde = condicaoDoSegmento(lojaId, segmento);
  const [[linha], amostra] = await Promise.all([
    db.select({ total: count() }).from(contatos).where(onde),
    db
      .select({ nome: contatos.nome })
      .from(contatos)
      .where(and(onde, sql`${contatos.nome} is not null`))
      .orderBy(asc(contatos.nome))
      .limit(5),
  ]);
  return { total: linha?.total ?? 0, amostra: amostra.map((a) => a.nome ?? "") };
}

/** Ids na ordem de envio. Roda DENTRO da transação que materializa. */
export async function idsDoSegmento(tx: Leitor, lojaId: string, segmento: Segmento): Promise<string[]> {
  const linhas = await tx
    .select({ id: contatos.id })
    .from(contatos)
    .where(condicaoDoSegmento(lojaId, segmento))
    .orderBy(asc(contatos.created_at), asc(contatos.id));
  return linhas.map((l) => l.id);
}

/** Usado pelo agendamento promocional: o mesmo critério, para um contato só. */
export async function contatoSaiuDoMarketing(tx: Leitor, contatoId: string): Promise<boolean> {
  // O filtro vai no WHERE, não na projeção: em consulta de tabela única o
  // Drizzle projeta a coluna sem o nome da tabela, e o `contatos.id` da
  // subconsulta passaria a apontar para `consentimentos.id`.
  const [linha] = await tx
    .select({ id: contatos.id })
    .from(contatos)
    .where(and(eq(contatos.id, contatoId), vivos(contatos), optOutVerdadeiro))
    .limit(1);
  return linha !== undefined;
}
