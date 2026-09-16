import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { usuarios } from "./auth/usuarios";
import { instante } from "./_compartilhado";
import { checkLista } from "./_enums";
import { FUNCOES_IA, MODELOS_IA, PROVEDORES_IA, RESULTADOS_IA } from "./_enums/inteligencia";
import { conversas } from "./conversas/conversas";
import { conversas_mensagens_midias } from "./conversas/mensagens-midias";
import { lojas } from "./lojas";

const restrita = { onDelete: "restrict", onUpdate: "restrict" } as const;

/**
 * `lojas_ia_usos` — registro de uso da IA e da transcrição (R2, ADR 0048).
 * Prova de quem mandou o quê a terceiro e base do orçamento diário.
 * SEM conteúdo. FK simples em tudo: a linha nasce depois do que ela cita.
 */
// compliance:append-only — registro de uso: só `criado_em`; GRANT SELECT e
// INSERT, REVOKE UPDATE, DELETE e TRUNCATE e gatilho `trilha_imutavel()` na
// 0020_r2_integridade. Registro de custo que aceita UPDATE não prova gasto.
export const lojas_ia_usos = pgTable(
  "lojas_ia_usos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    criado_em: instante("criado_em").notNull().defaultNow(),
    loja_id: uuid("loja_id").notNull().references(() => lojas.id, restrita),
    /** Nulo = sistema (classificação automática). */
    usuario_id: uuid("usuario_id").references(() => usuarios.id, restrita),
    funcao: text("funcao").notNull(),
    provedor: text("provedor").notNull(),
    modelo: text("modelo").notNull(),
    conversa_id: uuid("conversa_id").references(() => conversas.id, restrita),
    mensagem_midia_id: uuid("mensagem_midia_id").references(() => conversas_mensagens_midias.id, restrita),
    tokens_entrada: integer("tokens_entrada").notNull().default(0),
    tokens_saida: integer("tokens_saida").notNull().default(0),
    audio_segundos: integer("audio_segundos").notNull().default(0),
    /** 1 US$ = 1.000.000. Inteiro: soma exata, sem ponto flutuante. */
    custo_usd_micros: integer("custo_usd_micros").notNull().default(0),
    resultado: text("resultado").notNull(),
    /** Código NOSSO; a mensagem do provedor pode ecoar conteúdo e nunca entra. */
    erro_codigo: text("erro_codigo"),
  },
  (t) => [
    checkLista("lojas_ia_usos_funcao_lista", t.funcao, FUNCOES_IA),
    checkLista("lojas_ia_usos_provedor_lista", t.provedor, PROVEDORES_IA),
    checkLista("lojas_ia_usos_modelo_lista", t.modelo, MODELOS_IA),
    checkLista("lojas_ia_usos_resultado_lista", t.resultado, RESULTADOS_IA),
    check(
      "lojas_ia_usos_nao_negativos",
      sql`${t.tokens_entrada} >= 0 and ${t.tokens_saida} >= 0 and ${t.audio_segundos} >= 0 and ${t.custo_usd_micros} >= 0`,
    ),
    check("lojas_ia_usos_erro_curto", sql`char_length(${t.erro_codigo}) <= 40`),
    /** Orçamento do dia e painel por loja. */
    index("ix_lojas_ia_usos_loja").on(t.loja_id, t.criado_em.desc()),
    index("ix_lojas_ia_usos_usuario").on(t.usuario_id, t.criado_em.desc()),
  ],
);
