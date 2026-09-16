#!/usr/bin/env node
// @ts-check
/**
 * verificar-schema.mjs — confere o BANCO depois da migração 0016.
 *
 * O auditor (`check-compliance.mjs`) lê o código-fonte; este lê o banco. São
 * coisas diferentes: um schema TS impecável pode estar aplicado pela metade, e
 * uma constraint que só existe em SQL manual (FK composta, FK de `modified_by`,
 * REVOKE, gatilho) não aparece em lugar nenhum do TS.
 *
 * Confere, conforme 01-dados.md §9:
 *   1. 48 tabelas em `public`;
 *   2. toda tabela tem as 4 colunas de auditoria OU está numa das duas listas
 *      de exceção (4 trilhas append-only, 4 tabelas de framework);
 *   3. todo `timestamp` é `timestamptz` com precisão 3;
 *   4. toda FK é RESTRICT no delete E no update;
 *   5. todo índice único de tabela com soft delete é parcial (com a lista
 *      escrita de exceções);
 *   6. as 16 FKs compostas `(id, loja_id)` e as 40 FKs de `modified_by`;
 *   7. os 4 gatilhos de trilha, o REVOKE do papel da aplicação e a ausência
 *      total de DELETE para `merlo_app`.
 *
 * Uso: `npm run db:verificar` (lê DATABASE_URL — ler catálogo não exige o papel
 * de migração, então a credencial do dono não entra aqui).
 * Exit code: 1 em qualquer falha.
 */

import { Client } from "pg";

const TOTAL_TABELAS = 48;
const TOTAL_MODIFIED_BY = 40;
const TOTAL_FK_COMPOSTA = 16;

/** Trilhas: só `criado_em`. Um log que aceita UPDATE não é trilha. */
const APPEND_ONLY = [
  "auth_eventos",
  "auditoria_eventos",
  "consentimentos",
  "usuarios_senhas_historico",
];

/** O Better Auth apaga estas por dentro; `is_deleted = false` ali seria mentira. */
const FRAMEWORK = [
  "usuarios_sessoes",
  "usuarios_verificacoes",
  "usuarios_totp",
  "usuarios_passkeys",
];

/**
 * Únicos TOTAIS permitidos em tabela com soft delete, um a um e com o motivo.
 * Qualquer outro é erro: unicidade total que convive com soft delete é o
 * defeito 02/C-01 (excluir e recriar dava 500).
 */
const UNICO_TOTAL_PERMITIDO = new Map([
  ["uq_usuarios_email", "usuarios nunca é soft-deletado e o BA busca por e-mail sem filtrar"],
  ["uq_usuarios_contas_provedor", "usuarios_contas nunca é soft-deletada, como usuarios"],
  ["uq_lojas_midias_chave", "a chave do objeto carrega o uuid da linha: nunca colide"],
  [
    "uq_lojas_integracoes_eventos_externo",
    "idempotência da ingestão vale para sempre; nenhuma linha do diário é excluída",
  ],
  [
    "uq_conversas_mensagens_idempotencia",
    "a chave da bolha otimista não pode ser reusada nem depois de excluir",
  ],
]);

/** Uniques de `(id, loja_id)`: são o alvo das FKs compostas e têm de ser totais. */
const UNICO_ID_LOJA = /^uq_.*_id_loja$/;

const problemas = [];
const erro = (msg) => problemas.push(msg);

async function principal() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL não está definida.");
    process.exit(1);
  }
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const q = async (texto, params = []) => (await c.query(texto, params)).rows;

    // 1. contagem de tabelas
    const tabelas = (
      await q(`select c.relname as nome from pg_class c
                 join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relkind = 'r'
                order by 1`)
    ).map((r) => r.nome);
    if (tabelas.length !== TOTAL_TABELAS) {
      erro(`esperado ${TOTAL_TABELAS} tabelas em public, encontrado ${tabelas.length}`);
    }

    // 2. colunas de auditoria
    const colunas = await q(
      `select table_name, column_name, data_type, datetime_precision
         from information_schema.columns where table_schema = 'public'`,
    );
    const porTabela = new Map();
    for (const col of colunas) {
      if (!porTabela.has(col.table_name)) porTabela.set(col.table_name, new Set());
      porTabela.get(col.table_name).add(col.column_name);
    }
    for (const tabela of tabelas) {
      if (APPEND_ONLY.includes(tabela) || FRAMEWORK.includes(tabela)) continue;
      const tem = porTabela.get(tabela) ?? new Set();
      for (const obrigatoria of ["created_at", "updated_at", "deleted_at", "is_deleted", "modified_by"]) {
        if (!tem.has(obrigatoria)) erro(`${tabela} sem a coluna de auditoria ${obrigatoria}`);
      }
    }
    for (const tabela of APPEND_ONLY) {
      if ((porTabela.get(tabela) ?? new Set()).has("updated_at")) {
        erro(`${tabela} é append-only e não pode ter updated_at`);
      }
    }

    // 3. timestamps
    for (const col of colunas) {
      if (!String(col.data_type).startsWith("timestamp")) continue;
      if (col.data_type !== "timestamp with time zone") {
        erro(`${col.table_name}.${col.column_name} é "${col.data_type}", não timestamptz`);
      }
      if (col.datetime_precision !== 3) {
        erro(
          `${col.table_name}.${col.column_name} tem precisão ${col.datetime_precision}, não 3 ` +
            "(a trava de colisão compara com o Date do JS, que é milissegundo)",
        );
      }
    }

    // 4. FK sempre RESTRICT nos dois lados
    const fks = await q(
      `select conname, conrelid::regclass::text as tabela, confdeltype, confupdtype
         from pg_constraint where contype = 'f' and connamespace = 'public'::regnamespace`,
    );
    for (const fk of fks) {
      if (fk.confdeltype !== "r" || fk.confupdtype !== "r") {
        erro(`FK ${fk.conname} em ${fk.tabela} não é RESTRICT/RESTRICT`);
      }
    }

    // 5. únicos parciais
    const indices = await q(
      `select i.relname as nome, t.relname as tabela, pg_get_indexdef(i.oid) as definicao
         from pg_index x
         join pg_class i on i.oid = x.indexrelid
         join pg_class t on t.oid = x.indrelid
         join pg_namespace n on n.oid = t.relnamespace
        where n.nspname = 'public' and x.indisunique and not x.indisprimary`,
    );
    for (const ix of indices) {
      const temSoftDelete = (porTabela.get(ix.tabela) ?? new Set()).has("is_deleted");
      const parcial = / WHERE /i.test(ix.definicao);
      if (!temSoftDelete || parcial) continue;
      if (UNICO_ID_LOJA.test(ix.nome) || UNICO_TOTAL_PERMITIDO.has(ix.nome)) continue;
      erro(`índice único ${ix.nome} (${ix.tabela}) é total numa tabela com soft delete`);
    }

    // 6. integridade da 0016
    const [{ n: nModified }] = await q(
      `select count(*)::int n from pg_constraint
        where contype = 'f' and conname like 'fk\\_%\\_modified\\_by'`,
    );
    if (nModified !== TOTAL_MODIFIED_BY) {
      erro(`esperado ${TOTAL_MODIFIED_BY} FKs de modified_by, encontrado ${nModified}`);
    }
    const [{ n: nCompostas }] = await q(
      `select count(*)::int n from pg_constraint where contype = 'f' and conname like 'fkc\\_%'`,
    );
    if (nCompostas !== TOTAL_FK_COMPOSTA) {
      erro(`esperado ${TOTAL_FK_COMPOSTA} FKs compostas (id, loja_id), encontrado ${nCompostas}`);
    }

    // 7. trilhas fechadas de verdade
    const [{ n: nGatilhos }] = await q(
      `select count(*)::int n from pg_trigger where tgname like 'trg\\_%\\_imutavel'`,
    );
    if (nGatilhos !== APPEND_ONLY.length) {
      erro(`esperado ${APPEND_ONLY.length} gatilhos trilha_imutavel, encontrado ${nGatilhos}`);
    }
    for (const tabela of APPEND_ONLY) {
      const [p] = await q(
        `select has_table_privilege('merlo_app', $1, 'UPDATE') as pode_alterar,
                has_table_privilege('merlo_app', $1, 'INSERT') as pode_inserir`,
        [tabela],
      );
      if (p.pode_alterar) erro(`merlo_app ainda tem UPDATE em ${tabela} (o REVOKE não pegou)`);
      if (!p.pode_inserir) erro(`merlo_app não tem INSERT em ${tabela}: a trilha não grava`);
    }
    const comDelete = await q(
      `select c.relname as nome from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and has_table_privilege('merlo_app', c.oid, 'DELETE')`,
    );
    for (const t of comDelete) {
      erro(`merlo_app tem DELETE em ${t.nome}: a única exclusão do sistema é de objeto no MinIO`);
    }

    if (problemas.length > 0) {
      console.error(`\nverificar-schema: ${problemas.length} problema(s)\n`);
      for (const p of problemas) console.error(`  ERRO  ${p}`);
      process.exit(1);
    }
    console.log(
      `OK — ${tabelas.length} tabelas, ${fks.length} FKs RESTRICT, ${nCompostas} compostas, ` +
        `${nModified} de modified_by, ${nGatilhos} gatilhos de trilha.`,
    );
  } finally {
    await c.end();
  }
}

principal().catch((e) => {
  console.error(e);
  process.exit(1);
});
