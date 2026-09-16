import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Trava das migrações (01-dados.md §14, 05-plano §4 F4).
 *
 * Lê os arquivos, não o banco: é a última barreira antes de um SQL quebrado
 * chegar a HML.
 */

const PASTA = join(process.cwd(), "src", "lib", "db", "migrations");

const TAGS = [
  "0000_base",
  "0001_lojas",
  "0002_auth",
  "0003_auth_conta",
  "0004_trilhas",
  "0005_integracoes",
  "0006_midias",
  "0007_contatos",
  "0008_catalogo",
  "0009_conteudo",
  "0010_conversas",
  "0011_campanhas",
  "0012_negocios",
  "0013_pedidos",
  "0014_devolucoes",
  "0015_apoio",
  "0016_integridade",
  /**
   * 0017 NÃO estava em 01-dados.md §9: é da FUNDAÇÃO (F5) e existe porque o
   * plugin `twoFactor` instalado exige três colunas em `usuarios_totp` que §5.5
   * não previa — sem elas, o validador de schema do Better Auth derruba todo
   * `/api/auth/**` no boot (G27). Evidência em
   * docs/seguranca/conferencia-ba-1.7.5.md §3. Na onda 2 continua valendo a
   * regra: pacote que precisar de coluna PARA e reporta.
   */
  "0017_totp_framework",
  /**
   * 0018 é da CONSOLIDAÇÃO (DF1): CHECK do nome de modelo, listas fechadas
   * ampliadas pela onda 2 e a semente do ATOR_SISTEMA. Não cria tabela.
   */
  "0018_consolidacao",
];

const arquivos = readdirSync(PASTA)
  .filter((n) => n.endsWith(".sql"))
  .sort();
const sql = arquivos.map((nome) => ({ nome, texto: readFileSync(join(PASTA, nome), "utf8") }));

describe("migrações", () => {
  it("são as 17 de 01-dados.md §9 mais a 0017 e a 0018, na ordem", () => {
    expect(arquivos).toEqual(TAGS.map((t) => `${t}.sql`));
    const diario = JSON.parse(readFileSync(join(PASTA, "meta", "_journal.json"), "utf8")) as {
      entries: { idx: number; tag: string }[];
    };
    expect(diario.entries.map((e) => e.tag)).toEqual(TAGS);
  });

  it("criam as 48 tabelas", () => {
    const criadas = sql.flatMap(({ texto }) =>
      [...texto.matchAll(/^CREATE TABLE "([^"]+)"/gm)].map((m) => m[1]),
    );
    expect(new Set(criadas).size).toBe(48);
    expect(criadas).toHaveLength(48);
  });

  it("não têm predicado parametrizado (o bug reincidente do drizzle-kit)", () => {
    // Índice parcial construído com `eq()` sai como `WHERE "t"."col" = $1` e a
    // migração FALHA ao aplicar. O predicado é sempre `sql` cru com literais.
    const achados = sql.flatMap(({ nome, texto }) =>
      texto
        .split("\n")
        .map((linha, i) => ({ nome, linha: i + 1, texto: linha }))
        .filter((l) => /= \$/.test(l.texto)),
    );
    expect(achados).toEqual([]);
  });

  it("não têm DROP destrutivo", () => {
    const achados = sql.filter(({ texto }) => /\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i.test(texto));
    expect(achados.map((a) => a.nome)).toEqual([]);
  });

  it("não têm DELETE físico", () => {
    const achados = sql.filter(({ texto }) => /\bDELETE\s+FROM\b/i.test(texto));
    expect(achados.map((a) => a.nome)).toEqual([]);
  });

  it("instalam os papéis, a função e os quatro gatilhos de trilha", () => {
    const tudo = sql.map((s) => s.texto).join("\n");
    expect(tudo).toContain("CREATE ROLE merlo_app");
    expect(tudo).toContain("CREATE ROLE merlo_migracao");
    expect(tudo).toContain("CREATE OR REPLACE FUNCTION trilha_imutavel()");
    for (const tabela of [
      "auth_eventos",
      "auditoria_eventos",
      "consentimentos",
      "usuarios_senhas_historico",
    ]) {
      expect(tudo).toContain(`BEFORE UPDATE OR DELETE ON ${tabela}`);
    }
    // O REVOKE é reaplicado DEPOIS do GRANT final de 0016: o `ON ALL TABLES`
    // devolveria o UPDATE que 0004 e 0015 tiraram.
    const integridade = sql.find((s) => s.nome === "0016_integridade.sql")!.texto;
    expect(integridade.indexOf("GRANT SELECT, INSERT, UPDATE ON ALL TABLES")).toBeLessThan(
      integridade.indexOf("REVOKE UPDATE, DELETE, TRUNCATE"),
    );
  });

  it("nunca dão DELETE nem TRUNCATE ao papel da aplicação", () => {
    // Linha a linha e só em comando: varrer o arquivo inteiro atravessaria o
    // comentário acima do GRANT, que cita DELETE justamente para dizer que o
    // papel da aplicação não o recebe.
    const comandos = sql
      .flatMap((s) => s.texto.split("\n"))
      .filter((l) => !l.trim().startsWith("--"));
    for (const linha of comandos) {
      expect(/GRANT[^;]*\bDELETE\b[^;]*TO merlo_app/i.test(linha)).toBe(false);
      expect(/GRANT[^;]*\bTRUNCATE\b[^;]*TO merlo_app/i.test(linha)).toBe(false);
    }
  });

  it("declaram as 16 FKs compostas e a FK de modified_by", () => {
    const integridade = sql.find((s) => s.nome === "0016_integridade.sql")!.texto;
    expect([...integridade.matchAll(/ADD CONSTRAINT fkc_/g)]).toHaveLength(16);
    expect(integridade).toContain("fk_' || alvo || '_modified_by");
  });
});
