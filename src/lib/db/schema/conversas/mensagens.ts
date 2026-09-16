import { sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, check, index, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { usuarios } from "../auth/usuarios";
import { colunasAuditoria, instante } from "../_compartilhado";
import { checkLista } from "../_enums";
import { AUTOR_TIPOS, DIRECOES, STATUS_ENTREGA, TIPOS_CONTEUDO } from "../_enums/conversas";
import { lojas } from "../lojas";
import { conversas } from "./conversas";

/**
 * Metadados tipados da mensagem (01-dados.md §10).
 *
 * O CARTÃO é derivado: `tipo_conteudo` continua `'texto'` e o cartão vive em
 * `card`. O antigo tinha `content_type = 'product' | 'payment'`, valores que o
 * adaptador não sabia enviar e que viravam falha de envio (01/D-35).
 */
export type MetadadosMensagem = {
  tipo_original?: string;
  story_url?: string;
  encaminhada?: boolean;
  citacao_externa_id?: string;
  erro_provedor?: { codigo: string; mensagem: string };
  /** Cartão derivado; `pagamento` (R2-B) e `lookbook` (R2-E1). */
  card?: { tipo: "produto" | "pedido" | "pagamento" | "lookbook"; id: string };
  /** Mensagem de modelo: o worker envia o template com estas variáveis. */
  modelo?: { template_id: string; variaveis: string[] };
  /** Saída feita no próprio aparelho (`fromMe` do provedor), não pelo sistema. */
  enviada_pelo_aparelho?: boolean;
  /** TikTok: `conversation_id` do provedor, exigido para responder (ADR 0056). */
  conversa_externa_id?: string;
  /** Quem originou a saída. Só `pessoa` pode usar HUMAN_AGENT no Messenger (ADR 0056). */
  origem_envio?: "pessoa" | "automatica";
};

/**
 * `conversas_mensagens` (01-dados-dominio.md §2.3).
 *
 * SEM trava de colisão (exceção da parte 1, §4.7): a linha é escrita uma vez e
 * o estado de entrega é do provedor — muda por `atualizarEstado()`, monotônico.
 * `ocorrida_em` é o horário DO PROVEDOR; `created_at` é o de gravação.
 */
export const conversas_mensagens = pgTable(
  "conversas_mensagens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loja_id: uuid("loja_id")
      .notNull()
      .references(() => lojas.id, { onDelete: "restrict", onUpdate: "restrict" }),
    conversa_id: uuid("conversa_id")
      .notNull()
      .references(() => conversas.id, { onDelete: "restrict", onUpdate: "restrict" }),
    direcao: text("direcao").notNull(),
    autor_tipo: text("autor_tipo").notNull(),
    /** Vem da SESSÃO, nunca do corpo da requisição (06/INV-29). */
    autor_usuario_id: uuid("autor_usuario_id").references(() => usuarios.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    conteudo: text("conteudo"),
    tipo_conteudo: text("tipo_conteudo").notNull().default("texto"),
    externo_id: text("externo_id"),
    status_entrega: text("status_entrega"),
    status_atualizado_em: instante("status_atualizado_em"),
    falha_motivo: text("falha_motivo"),
    nota_interna: boolean("nota_interna").notNull().default(false),
    responde_a_id: uuid("responde_a_id").references(
      (): AnyPgColumn => conversas_mensagens.id,
      { onDelete: "restrict", onUpdate: "restrict" },
    ),
    chave_idempotencia: text("chave_idempotencia"),
    ocorrida_em: instante("ocorrida_em").notNull(),
    metadados: jsonb("metadados").$type<MetadadosMensagem>().notNull().default({}),
    ...colunasAuditoria,
  },
  (t) => [
    checkLista("conversas_mensagens_direcao_lista", t.direcao, DIRECOES),
    checkLista("conversas_mensagens_autor_tipo_lista", t.autor_tipo, AUTOR_TIPOS),
    checkLista("conversas_mensagens_tipo_conteudo_lista", t.tipo_conteudo, TIPOS_CONTEUDO),
    checkLista("conversas_mensagens_status_entrega_lista", t.status_entrega, STATUS_ENTREGA),
    check("conversas_mensagens_conteudo_tamanho", sql`char_length(${t.conteudo}) <= 8000`),
    /** Nota interna nunca vai ao canal: sem id externo e sem estado de entrega. */
    check(
      "conversas_mensagens_nota_sem_canal",
      sql`${t.nota_interna} = false
        or (${t.externo_id} is null and ${t.status_entrega} is null)`,
    ),
    /**
     * A anonimização LGPD NÃO viola este CHECK: ela grava o marcador
     * '[removido a pedido do titular]', não NULL (01-dados-dominio.md §8).
     */
    check(
      "conversas_mensagens_conteudo_presente",
      sql`${t.conteudo} is not null or ${t.tipo_conteudo} <> 'texto'`,
    ),
    /** Idempotência do webhook. */
    uniqueIndex("uq_conversas_mensagens_externo")
      .on(t.loja_id, t.externo_id)
      .where(sql`externo_id is not null and is_deleted = false`),
    /** Idempotência do envio pela UI (uuid da bolha otimista). */
    uniqueIndex("uq_conversas_mensagens_idempotencia")
      .on(t.conversa_id, t.chave_idempotencia)
      .where(sql`chave_idempotencia is not null`),
    /** Cursor da rolagem: o antigo paginava por `created_at` e pulava mensagens (01/D-27). */
    index("ix_conversas_mensagens_cursor").on(
      t.conversa_id,
      t.ocorrida_em.desc(),
      t.id.desc(),
    ),
    index("ix_conversas_mensagens_loja").on(t.loja_id, t.created_at.desc()),
    index("ix_conversas_mensagens_autor").on(t.autor_usuario_id),
  ],
);
