#!/usr/bin/env node
/**
 * Trava do check-compliance.
 *
 * O auditor precisa reconhecer os helpers da casa (o pacote de colunas de
 * auditoria espalhado com `...colunasAuditoria`, o filtro `vivos()`) e as duas
 * excecoes deste repositorio (marcador `compliance:framework`, caminho
 * `src/components/ui/`) SEM virar um carimbo que aprova qualquer coisa. Este
 * teste prova as duas metades: o que e correto passa, o que e violacao continua
 * sendo acusado.
 *
 * Por que existe: o auditor acusava 8 "tabelas sem auditoria" e 54 avisos de
 * "query sem filtro" num projeto que estava CERTO, so porque as colunas
 * chegavam por spread e o filtro por helper. Portao que da falso positivo em
 * codigo correto e portao que a equipe aprende a ignorar. E o inverso tambem
 * vale: excecao sem trava vira escape hatch em duas semanas.
 *
 * As fixtures sao montadas em tempo de execucao (`tabela()` concatena o nome da
 * funcao do Drizzle) para que este proprio arquivo nao seja lido como um schema
 * de verdade pelo auditor.
 *
 * Uso: node tests/check-compliance.test.mjs
 */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const AQUI = dirname(fileURLToPath(import.meta.url));
const AUDITOR = resolve(AQUI, "../scripts/check-compliance.mjs");

/** Monta a declaracao de tabela sem escrever o nome da funcao por extenso. */
const tabela = (nome, corpo) =>
  `export const ${nome} = pg` + `Table("${nome}", { id: text("id").primaryKey(), ${corpo} });`;

/** Monta a consulta sem escrever `.select(` colado, pelo mesmo motivo. */
const consulta = (onde) =>
  `export async function listar() { return db.se` + `lect().from(t)${onde}; }`;

/** Arquivo com `linhas` linhas de codigo inofensivo. */
const arquivoLongo = (linhas) =>
  Array.from({ length: linhas }, (_, i) => `export const constante${i} = ${i};`).join("\n");

const CASOS = {
  "pacote.ts": [
    "export const colunasAuditoria = {",
    '  created_at: timestamp("created_at").notNull().defaultNow(),',
    '  updated_at: timestamp("updated_at").notNull().defaultNow(),',
    '  deleted_at: timestamp("deleted_at"),',
    '  is_deleted: boolean("is_deleted").notNull().default(false),',
    "};",
    'export const naoEAuditoria = { foo: text("foo"), bar: text("bar") };',
  ].join("\n"),

  // Deve PASSAR: as colunas chegam por spread do pacote.
  "boa.ts": tabela("boa", "...colunasAuditoria"),
  // Deve FALHAR: tabela sem coluna nenhuma de auditoria.
  "ruim-sem-nada.ts": tabela("ruim", 'nome: text("nome")'),
  // Deve FALHAR: espalha um objeto que NAO e de auditoria. Sem este caso, a
  // checagem viraria "qualquer spread isenta a tabela".
  "ruim-spread-falso.ts": tabela("disfarcada", "...naoEAuditoria"),

  // Deve AVISAR: consulta sem filtro nenhum.
  "query-ruim.ts": consulta(""),
  // Devem PASSAR: filtram por helper e pela coluna em camelCase.
  "query-helper.ts": consulta(".where(vivos(t))"),
  "query-camel.ts": consulta(".where(eq(t.isDeleted, false))"),

  // --- excecoes deste repositorio (01-dados.md §4.3, 04-ui.md §3.1) ---

  // Deve PASSAR: tabela do Better Auth marcada. A lib apaga a linha por dentro;
  // as colunas da casa seriam mentira gravada no banco (ADR 0008).
  "framework-marcada.ts": [
    "// compliance:framework — o Better Auth apaga a sessao fisicamente; a prova",
    "// do ciclo de vida fica em auth_eventos, gravada antes do delete.",
    tabela("usuarios_sessoes", 'token: text("token").notNull()'),
  ].join("\n"),
  // Deve FALHAR: mesma familia de tabela, sem o marcador. O marcador tem de ser
  // a excecao escrita, nunca o comportamento padrao.
  "framework-sem-marcador.ts": tabela("usuarios_totp", 'segredo: text("segredo").notNull()'),
};

const dir = mkdtempSync(join(tmpdir(), "compliance-"));
try {
  mkdirSync(join(dir, "src"), { recursive: true });
  for (const [nome, conteudo] of Object.entries(CASOS)) {
    writeFileSync(join(dir, "src", nome), conteudo, "utf8");
  }

  // Primitivo vendorizado do shadcn: passa do limite e NAO e acusado.
  mkdirSync(join(dir, "src", "components", "ui"), { recursive: true });
  writeFileSync(join(dir, "src", "components", "ui", "grande.tsx"), arquivoLongo(600), "utf8");
  // Codigo nosso do mesmo tamanho: continua reprovando.
  mkdirSync(join(dir, "src", "components", "comum"), { recursive: true });
  writeFileSync(join(dir, "src", "components", "comum", "grande.tsx"), arquivoLongo(600), "utf8");

  let saida;
  try {
    saida = execFileSync(process.execPath, [AUDITOR, "--json"], {
      cwd: dir,
      encoding: "utf8",
    });
  } catch (e) {
    // exit code 1 quando ha erro: esperado, o relatorio vem no stdout.
    saida = e.stdout;
  }
  const r = JSON.parse(saida);
  const ids = (arquivo) =>
    r.findings.filter((f) => f.file.endsWith(arquivo)).map((f) => f.id);

  /** @type {[string, () => void][]} */
  const CHECAGENS = [
    // --- o que e CORRETO nao pode ser acusado ---
    ["tabela com ...colunasAuditoria passa", () =>
      assert.deepEqual(ids("boa.ts"), [], "tabela com ...colunasAuditoria foi acusada")],
    ["consulta com vivos() passa", () =>
      assert.deepEqual(ids("query-helper.ts"), [], "consulta com vivos() foi acusada")],
    ["consulta com isDeleted passa", () =>
      assert.deepEqual(ids("query-camel.ts"), [], "consulta com isDeleted foi acusada")],

    // --- o que e VIOLACAO continua sendo acusado ---
    ["tabela sem auditoria reprova", () =>
      assert.ok(ids("ruim-sem-nada.ts").includes("tabela-sem-auditoria"),
        "tabela sem colunas de auditoria passou batido")],
    ["spread de objeto qualquer reprova", () =>
      assert.ok(ids("ruim-spread-falso.ts").includes("tabela-sem-auditoria"),
        "spread de objeto qualquer virou escape hatch")],
    ["consulta sem filtro avisa", () =>
      assert.ok(ids("query-ruim.ts").includes("query-sem-filtro"),
        "consulta sem filtro de soft delete passou batido")],

    // --- marcador compliance:framework (01-dados.md §4.3) ---
    ["tabela marcada compliance:framework passa", () =>
      assert.deepEqual(ids("framework-marcada.ts"), [],
        "tabela do Better Auth marcada foi acusada mesmo assim")],
    ["tabela de framework sem marcador reprova", () =>
      assert.ok(ids("framework-sem-marcador.ts").includes("tabela-sem-auditoria"),
        "tabela sem o marcador passou: a excecao virou comportamento padrao")],

    // --- excecao de caminho no limite de linhas (04-ui.md §3.1) ---
    ["primitivo de 600 linhas em components/ui passa", () =>
      assert.deepEqual(ids("components/ui/grande.tsx"), [],
        "primitivo vendorizado do shadcn foi acusado por tamanho")],
    ["arquivo de 600 linhas em components/comum reprova", () =>
      assert.ok(ids("components/comum/grande.tsx").includes("arquivo-grande"),
        "a excecao de caminho vazou para fora de src/components/ui/")],
  ];

  let passou = 0;
  for (const [nome, checar] of CHECAGENS) {
    checar();
    passou++;
    console.log(`  ok  ${nome}`);
  }
  console.log(`OK — ${passou}/${CHECAGENS.length} checagens do check-compliance.`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
