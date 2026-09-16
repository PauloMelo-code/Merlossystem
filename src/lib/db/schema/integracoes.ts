import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { colunasAuditoria, instante } from "./_compartilhado";
import { checkLista } from "./_enums";
import {
  CATEGORIAS_TEMPLATE,
  PROVEDORES,
  STATUS_INTEGRACAO,
  STATUS_TEMPLATE,
  TIPOS_CABECALHO_TEMPLATE,
  TIPOS_EVENTO_INTEGRACAO,
} from "./_enums/plataforma";
import { lojas } from "./lojas";

/**
 * `lojas_integracoes` — uma linha por CONTA conectada (01-dados.md §6.3).
 *
 * N números de WhatsApp por loja. `loja_id` nulo = conta da rede (hoje só o
 * Bling). Não existe conta de ambiente: a conversa responde pela conta em que
 * entrou (`conversas.integracao_id NOT NULL`, 01/D-04).
 */
export const lojas_integracoes = pgTable(
  "lojas_integracoes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loja_id: uuid("loja_id").references(() => lojas.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    provedor: text("provedor").notNull(),
    /** "WhatsApp Vendas Centro" — aparece na inbox (01/D-37). */
    rotulo: text("rotulo").notNull(),
    status: text("status").notNull().default("desconectado"),
    /** Envelope `v1:<iv>:<tag>:<cifrado>` (AES-256-GCM). */
    credenciais_cifradas: text("credenciais_cifradas"),
    /** = `id` da linha, usado como AAD do GCM (04/S28). */
    credenciais_aad: text("credenciais_aad"),
    /** Chave de roteamento do webhook. */
    referencia_externa: text("referencia_externa"),
    /** SHA-256 do segredo POR INTEGRAÇÃO (01/D-12). */
    segredo_webhook_hash: text("segredo_webhook_hash"),
    expira_em: instante("expira_em"),
    /** contador/cache */
    ultimo_erro: text("ultimo_erro"),
    /** contador/cache */
    ultima_sincronizacao: instante("ultima_sincronizacao"),
    revogada_em: instante("revogada_em"),
    ...colunasAuditoria,
  },
  (t) => [
    checkLista("lojas_integracoes_provedor_lista", t.provedor, PROVEDORES),
    checkLista("lojas_integracoes_status_lista", t.status, STATUS_INTEGRACAO),
    /**
     * Equivalência, não implicação: canal SEM loja é impossível no banco, e
     * conta de rede COM loja também. A regra de aplicação vira defesa em
     * profundidade, não a única barreira.
     */
    check("lojas_integracoes_rede", sql`(${t.provedor} = 'bling') = (${t.loja_id} is null)`),
    uniqueIndex("uq_lojas_integracoes_referencia")
      .on(t.provedor, t.referencia_externa)
      .where(sql`referencia_externa is not null and is_deleted = false`),
    index("ix_lojas_integracoes_loja").on(t.loja_id, t.provedor),
    index("ix_lojas_integracoes_provedor_status").on(t.provedor, t.status),
  ],
);

/** Lista branca de cabeçalhos guardados: nunca `authorization` (01-dados.md §10). */
export type CabecalhosEvento = Record<string, string>;

/**
 * `lojas_integracoes_eventos` — DIÁRIO DE INGESTÃO (01-dados.md §6.4, ADR 0017).
 *
 * Tabela normal, com as 5 colunas de auditoria e NENHUM marcador: a aplicação
 * precisa marcar `processado_em` e mascarar o corpo, então nem `REVOKE` nem
 * gatilho de trilha entram aqui. E nenhum `DELETE`: a retenção de 30 dias é
 * anonimização por `UPDATE`, feita pelo job `retencao-eventos`.
 *
 * `integracao_id` e `loja_id` ficam SEM FK de propósito: o evento é gravado
 * antes de a conta ser resolvida, e o diário tem de aceitar até o webhook que
 * chegou no endereço errado — é justamente esse que serve de prova.
 */
export const lojas_integracoes_eventos = pgTable(
  "lojas_integracoes_eventos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provedor: text("provedor").notNull(),
    integracao_id: uuid("integracao_id"),
    loja_id: uuid("loja_id"),
    tipo: text("tipo").notNull(),
    evento_externo_id: text("evento_externo_id"),
    assinatura_ok: boolean("assinatura_ok").notNull(),
    ip: text("ip"),
    /** Cru enquanto `processado_em IS NULL` ou `tipo = 'falhou'`; depois, projeção mascarada. */
    corpo: jsonb("corpo").$type<unknown>().notNull(),
    cabecalhos: jsonb("cabecalhos").$type<CabecalhosEvento>().notNull().default({}),
    erro: text("erro"),
    processado_em: instante("processado_em"),
    ...colunasAuditoria,
  },
  (t) => [
    checkLista("lojas_integracoes_eventos_provedor_lista", t.provedor, PROVEDORES),
    checkLista("lojas_integracoes_eventos_tipo_lista", t.tipo, TIPOS_EVENTO_INTEGRACAO),
    /**
     * Idempotência da ingestão (06/INV-139). SEM `is_deleted = false`: nenhuma
     * linha daqui é excluída, e a idempotência tem de valer para sempre.
     */
    uniqueIndex("uq_lojas_integracoes_eventos_externo")
      .on(t.provedor, t.evento_externo_id)
      .where(sql`evento_externo_id is not null`),
    index("ix_lojas_integracoes_eventos_criado").on(t.created_at),
    index("ix_lojas_integracoes_eventos_integracao").on(t.integracao_id, t.created_at),
    index("ix_lojas_integracoes_eventos_tipo").on(t.tipo, t.created_at),
  ],
);

/** Botões do modelo (01-dados.md §10). */
export type BotaoTemplate = {
  tipo: "url" | "telefone" | "resposta_rapida";
  texto: string;
  valor?: string;
};

/**
 * Variável de modelo, por posição. `{nome_contato}` é resolvido por
 * destinatário no disparo. Mesmo tipo em `campanhas.variaveis` e em
 * `conversas_agendamentos.variaveis` (01-dados.md §10).
 */
export type VariavelTemplate = { indice: number; valor: string };

/**
 * `lojas_integracoes_templates` — modelo do WhatsApp preso à CONTA
 * (01-dados.md §6.5). COM trava de colisão: é editado por gerente e admin.
 *
 * `variaveis_contagem` é extraído de `{{n}}` no corpo e existe porque a Meta
 * recusa template com 0 ou 2+ variáveis quando o disparo manda outra
 * quantidade (corrige 03/10.7.9 e o defeito 03/C1).
 */
export const lojas_integracoes_templates = pgTable(
  "lojas_integracoes_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loja_id: uuid("loja_id")
      .notNull()
      .references(() => lojas.id, { onDelete: "restrict", onUpdate: "restrict" }),
    integracao_id: uuid("integracao_id")
      .notNull()
      .references(() => lojas_integracoes.id, { onDelete: "restrict", onUpdate: "restrict" }),
    nome: text("nome").notNull(),
    categoria: text("categoria").notNull(),
    idioma: text("idioma").notNull().default("pt_BR"),
    cabecalho_tipo: text("cabecalho_tipo"),
    cabecalho_conteudo: text("cabecalho_conteudo"),
    corpo: text("corpo").notNull(),
    rodape: text("rodape"),
    botoes: jsonb("botoes").$type<BotaoTemplate[]>().notNull().default([]),
    variaveis_contagem: integer("variaveis_contagem").notNull().default(0),
    meta_template_id: text("meta_template_id"),
    status: text("status").notNull().default("rascunho"),
    motivo_rejeicao: text("motivo_rejeicao"),
    enviado_em: instante("enviado_em"),
    aprovado_em: instante("aprovado_em"),
    ...colunasAuditoria,
  },
  (t) => [
    checkLista("lojas_integracoes_templates_categoria_lista", t.categoria, CATEGORIAS_TEMPLATE),
    checkLista("lojas_integracoes_templates_status_lista", t.status, STATUS_TEMPLATE),
    checkLista(
      "lojas_integracoes_templates_cabecalho_lista",
      t.cabecalho_tipo,
      TIPOS_CABECALHO_TEMPLATE,
    ),
    // `{1,512}` estoura o limite de repetição do Postgres (255): migração 0018.
    check(
      "lojas_integracoes_templates_nome",
      sql`${t.nome} ~ '^[a-z0-9_]+$' and char_length(${t.nome}) <= 512`,
    ),
    check("lojas_integracoes_templates_variaveis", sql`${t.variaveis_contagem} >= 0`),
    uniqueIndex("uq_lojas_integracoes_templates_nome")
      .on(t.integracao_id, t.nome, t.idioma)
      .where(sql`is_deleted = false`),
    index("ix_lojas_integracoes_templates_status").on(t.loja_id, t.status),
  ],
);
