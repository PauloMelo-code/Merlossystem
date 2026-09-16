import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { usuarios } from "../auth/usuarios";
import { colunasAuditoria, dinheiro, instante } from "../_compartilhado";
import { checkLista } from "../_enums";
import { FORMAS_PAGAMENTO, PROVEDORES_PAGAMENTO, STATUS_PAGAMENTO } from "../_enums/pedidos";
import { lojas } from "../lojas";
import { lojas_midias } from "../midias";
import { pedidos } from "./pedidos";

/**
 * `pagamentos` (01-dados-dominio.md §6.5). Escrita só pelo módulo `pagamentos`
 * (R2-B, ADRs 0040–0045). O QR não é persistido: `qrcode_midia_id` fica nulo
 * (ADR 0045).
 *
 * O único é por `(provedor, externo_id)`: o webhook antigo buscava
 * `external_id` global, sem provedor e sem loja.
 *
 * `metodo` usa a mesma lista de `pedidos.forma_pagamento` (`FORMAS_PAGAMENTO`):
 * o catálogo de nomes de 01-dados.md §16.3 não define uma segunda constante.
 */
export const pagamentos = pgTable(
  "pagamentos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loja_id: uuid("loja_id")
      .notNull()
      .references(() => lojas.id, { onDelete: "restrict", onUpdate: "restrict" }),
    pedido_id: uuid("pedido_id")
      .notNull()
      .references(() => pedidos.id, { onDelete: "restrict", onUpdate: "restrict" }),
    provedor: text("provedor").notNull(),
    metodo: text("metodo").notNull(),
    status: text("status").notNull().default("pendente"),
    valor: dinheiro("valor").notNull(),
    externo_id: text("externo_id"),
    pix_copia_cola: text("pix_copia_cola"),
    qrcode_midia_id: uuid("qrcode_midia_id").references(() => lojas_midias.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    link_pagamento: text("link_pagamento"),
    expira_em: instante("expira_em"),
    pago_em: instante("pago_em"),
    estornado_em: instante("estornado_em"),
    criado_por: uuid("criado_por").references(() => usuarios.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    ...colunasAuditoria,
  },
  (t) => [
    checkLista("pagamentos_provedor_lista", t.provedor, PROVEDORES_PAGAMENTO),
    checkLista("pagamentos_metodo_lista", t.metodo, FORMAS_PAGAMENTO),
    checkLista("pagamentos_status_lista", t.status, STATUS_PAGAMENTO),
    check("pagamentos_valor_positivo", sql`${t.valor} > 0`),
    uniqueIndex("uq_pagamentos_externo")
      .on(t.provedor, t.externo_id)
      .where(sql`externo_id is not null and is_deleted = false`),
    /** Uma cobrança pendente por pedido (R2-B): duas pendentes = cliente pagando duas vezes. */
    uniqueIndex("uq_pagamentos_um_pendente")
      .on(t.pedido_id)
      .where(sql`status = 'pendente' and is_deleted = false`),
    index("ix_pagamentos_pedido").on(t.pedido_id),
    index("ix_pagamentos_status").on(t.loja_id, t.status),
    index("ix_pagamentos_expiracao")
      .on(t.status, t.expira_em)
      .where(sql`status = 'pendente'`),
    index("ix_pagamentos_loja").on(t.loja_id, t.is_deleted),
  ],
);
