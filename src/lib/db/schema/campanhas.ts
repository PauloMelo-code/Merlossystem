import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { usuarios } from "./auth/usuarios";
import { colunasAuditoria, instante } from "./_compartilhado";
import { checkLista } from "./_enums";
import { STATUS_CAMPANHA, STATUS_DESTINATARIO } from "./_enums/catalogo";
import { contatos } from "./contatos";
import { conversas_mensagens } from "./conversas/mensagens";
import { lojas } from "./lojas";
import { lojas_integracoes, lojas_integracoes_templates, type VariavelTemplate } from "./integracoes";

/** Filtro de audiência (01-dados.md §10). `etiquetas_ids` é conferido contra a loja. */
export type SegmentoCampanha = {
  etiquetas_ids?: string[];
  tamanho?: "slim" | "plussize" | "ambos";
  gasto_minimo?: string;
  dias_sem_compra?: number;
};

/**
 * `campanhas` (01-dados-dominio.md §5.4).
 *
 * `integracao_id` é NOT NULL: a conta de saída é explícita. `variaveis` existe
 * porque o defeito 03/C1 era exatamente a falta dela — o disparo mandava sempre
 * uma variável e a Meta recusa template com contagem diferente. A campanha não
 * sai de `rascunho` se `variaveis.length <> template.variaveis_contagem`.
 *
 * Contadores derivados (`enviados`, `entregues`, `lidos`, `respondidos`,
 * `falhas`) NÃO são colunas: são `count(*)` sobre `campanhas_destinatarios`. O
 * antigo tinha 6 contadores e 4 nunca eram atualizados — métrica que mente.
 */
export const campanhas = pgTable(
  "campanhas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loja_id: uuid("loja_id")
      .notNull()
      .references(() => lojas.id, { onDelete: "restrict", onUpdate: "restrict" }),
    nome: text("nome").notNull(),
    integracao_id: uuid("integracao_id")
      .notNull()
      .references(() => lojas_integracoes.id, { onDelete: "restrict", onUpdate: "restrict" }),
    template_id: uuid("template_id").references(() => lojas_integracoes_templates.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    /** uazapi, sem template. */
    conteudo_texto: text("conteudo_texto"),
    variaveis: jsonb("variaveis").$type<VariavelTemplate[]>().notNull().default([]),
    segmento: jsonb("segmento").$type<SegmentoCampanha>().notNull().default({}),
    status: text("status").notNull().default("rascunho"),
    agendada_para: instante("agendada_para"),
    iniciada_em: instante("iniciada_em"),
    concluida_em: instante("concluida_em"),
    /** Retrato da materialização, não contador vivo. */
    total_destinatarios: integer("total_destinatarios").notNull().default(0),
    criada_por: uuid("criada_por")
      .notNull()
      .references(() => usuarios.id, { onDelete: "restrict", onUpdate: "restrict" }),
    ...colunasAuditoria,
  },
  (t) => [
    checkLista("campanhas_status_lista", t.status, STATUS_CAMPANHA),
    check(
      "campanhas_conteudo",
      sql`${t.template_id} is not null or ${t.conteudo_texto} is not null`,
    ),
    check("campanhas_total_positivo", sql`${t.total_destinatarios} >= 0`),
    index("ix_campanhas_status").on(t.loja_id, t.status),
    index("ix_campanhas_agendadas")
      .on(t.status, t.agendada_para)
      .where(sql`status = 'agendada'`),
    index("ix_campanhas_loja").on(t.loja_id, t.is_deleted),
  ],
);

/**
 * `campanhas_destinatarios` (01-dados-dominio.md §5.5).
 *
 * Máquina de estado de sistema: usa `atualizarEstado()`, sem trava de colisão.
 * `mensagem_id` é o que faz a campanha aparecer na conversa da cliente e o
 * recibo atualizar o destinatário.
 */
export const campanhas_destinatarios = pgTable(
  "campanhas_destinatarios",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loja_id: uuid("loja_id")
      .notNull()
      .references(() => lojas.id, { onDelete: "restrict", onUpdate: "restrict" }),
    campanha_id: uuid("campanha_id")
      .notNull()
      .references(() => campanhas.id, { onDelete: "restrict", onUpdate: "restrict" }),
    contato_id: uuid("contato_id")
      .notNull()
      .references(() => contatos.id, { onDelete: "restrict", onUpdate: "restrict" }),
    status: text("status").notNull().default("pendente"),
    mensagem_id: uuid("mensagem_id").references(() => conversas_mensagens.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    externo_id: text("externo_id"),
    erro: text("erro"),
    reservado_em: instante("reservado_em"),
    enviado_em: instante("enviado_em"),
    entregue_em: instante("entregue_em"),
    lido_em: instante("lido_em"),
    respondido_em: instante("respondido_em"),
    tentativas: integer("tentativas").notNull().default(0),
    ...colunasAuditoria,
  },
  (t) => [
    checkLista("campanhas_destinatarios_status_lista", t.status, STATUS_DESTINATARIO),
    check("campanhas_destinatarios_tentativas", sql`${t.tentativas} >= 0`),
    /** A corrida na materialização mandava a campanha duas vezes (03/C1). */
    uniqueIndex("uq_campanhas_destinatarios")
      .on(t.campanha_id, t.contato_id)
      .where(sql`is_deleted = false`),
    /** Reserva por lote: `FOR UPDATE SKIP LOCKED`. */
    index("ix_campanhas_destinatarios_reserva").on(t.campanha_id, t.status, t.created_at),
    /** Lease: linha reservada há mais de N minutos volta a `pendente` (03/A2). */
    index("ix_campanhas_destinatarios_lease")
      .on(t.reservado_em)
      .where(sql`status = 'reservado'`),
    index("ix_campanhas_destinatarios_loja").on(t.loja_id, t.is_deleted),
  ],
);
