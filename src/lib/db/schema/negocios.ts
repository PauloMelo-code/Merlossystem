import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { usuarios } from "./auth/usuarios";
import { colunasAuditoria, dataPura, dinheiro, instante } from "./_compartilhado";
import { checkLista, listaSql } from "./_enums";
import { ESTAGIOS_NEGOCIO, ESTAGIOS_NEGOCIO_ABERTOS, MOTIVOS_PERDA } from "./_enums/pedidos";
import { contatos } from "./contatos";
import { conversas } from "./conversas/conversas";
import { lojas } from "./lojas";

/**
 * `negocios` — o funil (01-dados-dominio.md §6.1). Tela e escrita do módulo
 * `negocios` (R2-A, ADR 0035): um negócio aberto por cliente.
 *
 * Sem `negocios_eventos`: a linha do tempo lê `auditoria_eventos` por
 * `(entidade = 'negocios', entidade_id)`.
 *
 * A regra 02/RN-DL5 vale desde o R1: criar pedido
 * com `negocio_id` preenchido move o negócio para `ganho` e grava
 * `negocio_estagio_alterado` na MESMA transação do pedido. São três linhas
 * dentro de uma transação que já existe; se a regra não nascer agora, ela dorme
 * com a tabela e o dado fica errado no dia em que a tela ligar.
 */
export const negocios = pgTable(
  "negocios",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loja_id: uuid("loja_id")
      .notNull()
      .references(() => lojas.id, { onDelete: "restrict", onUpdate: "restrict" }),
    contato_id: uuid("contato_id")
      .notNull()
      .references(() => contatos.id, { onDelete: "restrict", onUpdate: "restrict" }),
    conversa_id: uuid("conversa_id").references(() => conversas.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    responsavel_id: uuid("responsavel_id").references(() => usuarios.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    estagio: text("estagio").notNull().default("lead"),
    valor: dinheiro("valor").notNull().default("0"),
    motivo_perda: text("motivo_perda"),
    observacao_perda: text("observacao_perda"),
    previsao_fechamento: dataPura("previsao_fechamento"),
    /** contador/cache */
    ultima_atividade_em: instante("ultima_atividade_em").notNull().defaultNow(),
    ...colunasAuditoria,
  },
  (t) => [
    checkLista("negocios_estagio_lista", t.estagio, ESTAGIOS_NEGOCIO),
    checkLista("negocios_motivo_perda_lista", t.motivo_perda, MOTIVOS_PERDA),
    check("negocios_valor_positivo", sql`${t.valor} >= 0`),
    check(
      "negocios_perda_com_motivo",
      sql`${t.estagio} <> 'perdido' or ${t.motivo_perda} is not null`,
    ),
    /** Um negócio aberto por cliente (ADR 0035). Predicado literal: nunca parâmetro. */
    uniqueIndex("uq_negocios_aberto_por_contato")
      .on(t.contato_id)
      .where(sql.raw(`estagio in (${listaSql(ESTAGIOS_NEGOCIO_ABERTOS)}) and is_deleted = false`)),
    index("ix_negocios_funil").on(t.loja_id, t.estagio, t.ultima_atividade_em.desc()),
    index("ix_negocios_contato").on(t.contato_id),
    index("ix_negocios_responsavel").on(t.responsavel_id),
    index("ix_negocios_loja").on(t.loja_id, t.is_deleted),
  ],
);
