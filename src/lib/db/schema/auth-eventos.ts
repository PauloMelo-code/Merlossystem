import { index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { instante } from "./_compartilhado";
import { checkLista } from "./_enums";
import { ATOR_TIPOS, MEIOS_AUTH, RESULTADOS_AUTH, TIPOS_AUTH_EVENTO } from "./_enums/auth";

/**
 * Lista branca do `detalhes` (01-dados.md §10). O **motivo** é coluna própria,
 * não entra aqui.
 */
export type DetalhesAuthEvento = {
  rota?: string;
  acao?: string;
  papel?: string;
  tentativas?: number;
  contagem?: number;
  /** Versão do texto de ciência aceito pelo admin (ex.: `CIENCIA_ADMIN_V1`). */
  ciencia_versao?: string;
  /**
   * Código curto da recusa (ex.: `alvo`), nunca texto livre. O motivo
   * ESCRITO pela pessoa continua na coluna `motivo`.
   */
  motivo?: string;
};

/**
 * `auth_eventos` — funil único de tudo que cria, nega ou destrói acesso.
 *
 * compliance:append-only — justificativa (01-dados.md §7.1 e §7.3): é a prova
 * de quem entrou, de quem foi barrado e de quem virou dono. Trilha que aceita
 * UPDATE ou DELETE não é trilha: só `criado_em`, `REVOKE` do papel da
 * aplicação e gatilho `trilha_imutavel()` na migração 0004.
 *
 * SEM FK NENHUMA (ADR 0012, desvio nomeado): precisa sobreviver à anonimização
 * LGPD e a qualquer ordem de gravação, e FK em tabela de alto volume é custo
 * puro. A compensação é `tests/integracao/integridade-trilha.test.ts`, que
 * procura ator e alvo órfãos.
 */
export const auth_eventos = pgTable(
  "auth_eventos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    criado_em: instante("criado_em").notNull().defaultNow(),
    tipo: text("tipo").notNull(),
    ator_tipo: text("ator_tipo").notNull().default("usuario"),
    usuario_id: uuid("usuario_id"),
    /** HMAC do e-mail com `AUTH_EMAIL_HASH_KEY`. Nunca o e-mail em claro. */
    email_hash: text("email_hash"),
    sessao_id: uuid("sessao_id"),
    meio: text("meio"),
    resultado: text("resultado").notNull(),
    ip: text("ip"),
    agente: text("agente"),
    /** Quem executou, quando diferente do alvo. */
    ator_id: uuid("ator_id"),
    alvo_id: uuid("alvo_id"),
    /** Obrigatório na aplicação em ação administrativa (Zod, 8 a 255). */
    motivo: text("motivo"),
    detalhes: jsonb("detalhes").$type<DetalhesAuthEvento>().notNull().default({}),
  },
  (t) => [
    checkLista("auth_eventos_tipo_lista", t.tipo, TIPOS_AUTH_EVENTO),
    checkLista("auth_eventos_ator_tipo_lista", t.ator_tipo, ATOR_TIPOS),
    checkLista("auth_eventos_meio_lista", t.meio, MEIOS_AUTH),
    checkLista("auth_eventos_resultado_lista", t.resultado, RESULTADOS_AUTH),
    index("ix_auth_eventos_usuario").on(t.usuario_id, t.criado_em.desc()),
    index("ix_auth_eventos_tipo").on(t.tipo, t.criado_em.desc()),
    index("ix_auth_eventos_email_hash").on(t.email_hash, t.criado_em.desc()),
  ],
);
