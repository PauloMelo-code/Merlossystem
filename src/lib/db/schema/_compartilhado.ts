import { boolean, date, numeric, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Helpers de coluna compartilhados por todo o schema (01-dados.md §3).
 *
 * Esta é a definição literal daquele documento. A versão de
 * `03-arquitetura.md §6.2` com `$onUpdate` está rejeitada (01-dados.md §15,
 * R-02).
 */

/** precisão 3 = milissegundo, igual ao Date do JS: a trava por updated_at compara exato. */
export const instante = (nome: string) =>
  timestamp(nome, { precision: 3, withTimezone: true, mode: "date" });

/** data pura (aniversário, previsão): sem hora, sem fuso, sem deslocamento de um dia. */
export const dataPura = (nome: string) => date(nome, { mode: "string" });

/** dinheiro: numeric(12,2), modo string. NUNCA mode:"number" (ponto flutuante). */
export const dinheiro = (nome: string) => numeric(nome, { precision: 12, scale: 2 });

/**
 * As 5 colunas de auditoria da casa. Espalhar SEM alias: `...colunasAuditoria`.
 *
 * `updated_at` não tem `$onUpdate` de propósito: `$onUpdate` dispara em TODO
 * `UPDATE`, inclusive no de contador (`nao_lidas`, `ultima_mensagem_em`). Com
 * ele, o `updated_at` que a tela levou no campo oculto envelhece a cada
 * mensagem que chega e toda edição legítima devolve "Registro alterado por
 * outro usuário". Quem escreve `updated_at` é `atualizarComTrava()` e
 * `inserirAuditado()`; contador e máquina de estado de sistema não o tocam.
 */
export const colunasAuditoria = {
  created_at: instante("created_at").notNull().defaultNow(),
  updated_at: instante("updated_at").notNull().defaultNow(),
  deleted_at: instante("deleted_at"),
  is_deleted: boolean("is_deleted").notNull().default(false),
  modified_by: uuid("modified_by"), // FK declarada em SQL na migração 0016 (§4.6)
};
