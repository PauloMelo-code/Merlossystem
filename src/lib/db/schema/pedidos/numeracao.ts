import { sql } from "drizzle-orm";
import { check, integer, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { colunasAuditoria } from "../_compartilhado";
import { lojas } from "../lojas";

/**
 * `pedidos_numeracao` — contador atômico por loja e mês (01-dados-dominio.md
 * §6.2, ADR 0019).
 *
 * PK composta `(loja_id, ano_mes)`: é contador, não entidade — é isso que torna
 * o `ON CONFLICT` atômico. Exceção escrita a "uuid em tudo". O antigo numerava
 * por `max(substr(...))` mais retry e repetia número (06/T-25).
 *
 * `ano_mes` é calculado em `America/Sao_Paulo`: o antigo usava o fuso do
 * container e jogava a venda das 21h do último dia no mês seguinte (02/O-09).
 */
export const pedidos_numeracao = pgTable(
  "pedidos_numeracao",
  {
    loja_id: uuid("loja_id")
      .notNull()
      .references(() => lojas.id, { onDelete: "restrict", onUpdate: "restrict" }),
    ano_mes: text("ano_mes").notNull(),
    ultimo_numero: integer("ultimo_numero").notNull().default(0),
    ...colunasAuditoria,
  },
  (t) => [
    primaryKey({ name: "pedidos_numeracao_pk", columns: [t.loja_id, t.ano_mes] }),
    /** `^\d{4}$` aceitava `0000` e `9999` como se fossem AAMM válidos. */
    check("pedidos_numeracao_ano_mes", sql`${t.ano_mes} ~ '^[0-9]{2}(0[1-9]|1[0-2])$'`),
    /**
     * Sem este CHECK, uma linha marcada como excluída travaria a numeração da
     * loja no mês: o `INSERT ... ON CONFLICT` colide com a PK e o `UPDATE`
     * filtrado por `vivos()` não acha a linha. Por isso o contador também é o
     * único lugar que NÃO passa por `vivos()`.
     */
    check("pedidos_numeracao_nunca_excluida", sql`${t.is_deleted} = false`),
    check("pedidos_numeracao_positivo", sql`${t.ultimo_numero} >= 0`),
  ],
);
