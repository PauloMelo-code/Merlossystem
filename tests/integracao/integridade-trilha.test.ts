import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * As trilhas não têm FK (ADR 0012, desvio nomeado): precisam sobreviver à
 * anonimização LGPD e a qualquer ordem de gravação, e FK em tabela de alto
 * volume é custo puro. A compensação escrita é este teste, em duas metades:
 *
 *   1. append-only DE VERDADE — pela conexão do papel `merlo_app`, um UPDATE
 *      numa trilha tem de FALHAR. É o que prova que o `REVOKE` não é decorativo
 *      e que o gatilho `trilha_imutavel()` está instalado;
 *   2. sem ator nem alvo órfão — a varredura que a FK faria de graça.
 */

const url = process.env.DATABASE_URL_TESTE;
let c: Client;

beforeAll(async () => {
  if (!url) {
    throw new Error(
      "DATABASE_URL_TESTE não está definida. Rode `node scripts/db-teste.mjs` e passe a URL.",
    );
  }
  c = new Client({ connectionString: url });
  await c.connect();
});

afterAll(async () => {
  await c?.end();
});

const TRILHAS = ["auth_eventos", "auditoria_eventos", "consentimentos", "usuarios_senhas_historico"];

describe("trilhas append-only", () => {
  it("o papel da aplicação não tem UPDATE nem DELETE nas quatro trilhas", async () => {
    for (const tabela of TRILHAS) {
      const { rows } = await c.query<{ u: boolean; d: boolean; i: boolean }>(
        `select has_table_privilege('merlo_app', $1, 'UPDATE') u,
                has_table_privilege('merlo_app', $1, 'DELETE') d,
                has_table_privilege('merlo_app', $1, 'INSERT') i`,
        [tabela],
      );
      expect(rows[0], tabela).toMatchObject({ u: false, d: false, i: true });
    }
  });

  it("merlo_app grava na trilha e não consegue alterar o que gravou", async () => {
    await c.query("begin");
    try {
      await c.query("set local role merlo_app");
      const { rows } = await c.query<{ id: string }>(
        `insert into auth_eventos (tipo, resultado, motivo)
         values ('login_falha', 'falha', 'trava de integridade da trilha') returning id`,
      );
      expect(rows[0]?.id).toBeTruthy();
      await expect(
        c.query(`update auth_eventos set motivo = 'reescrito' where id = $1`, [rows[0]!.id]),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await c.query("rollback");
    }
  });

  it("nem o dono das tabelas altera a trilha: o gatilho barra", async () => {
    await c.query("begin");
    try {
      const { rows } = await c.query<{ id: string }>(
        `insert into auditoria_eventos (ator_tipo, ator_id, acao, entidade, entidade_id)
         values ('sistema', null, 'loja_criada', 'lojas', '00000000-0000-0000-0000-000000000000')
         returning id`,
      );
      await expect(
        c.query(`update auditoria_eventos set acao = 'loja_alterada' where id = $1`, [rows[0]!.id]),
      ).rejects.toMatchObject({ code: "P0001" });
    } finally {
      await c.query("rollback");
    }
  });
});

describe("órfãos nas trilhas sem FK", () => {
  const varreduras: [string, string][] = [
    [
      "auth_eventos.usuario_id",
      `select count(*)::int n from auth_eventos e
        where e.usuario_id is not null
          and not exists (select 1 from usuarios u where u.id = e.usuario_id)`,
    ],
    [
      "auth_eventos.ator_id",
      `select count(*)::int n from auth_eventos e
        where e.ator_id is not null
          and not exists (select 1 from usuarios u where u.id = e.ator_id)`,
    ],
    [
      "auditoria_eventos.ator_id",
      `select count(*)::int n from auditoria_eventos e
        where e.ator_id is not null
          and not exists (select 1 from usuarios u where u.id = e.ator_id)`,
    ],
    [
      "auditoria_eventos.loja_id",
      `select count(*)::int n from auditoria_eventos e
        where e.loja_id is not null
          and not exists (select 1 from lojas l where l.id = e.loja_id)`,
    ],
    [
      "consentimentos.contato_id",
      `select count(*)::int n from consentimentos k
        where not exists (select 1 from contatos t where t.id = k.contato_id)`,
    ],
    [
      "usuarios_senhas_historico.usuario_id",
      `select count(*)::int n from usuarios_senhas_historico h
        where not exists (select 1 from usuarios u where u.id = h.usuario_id)`,
    ],
  ];

  it.each(varreduras)("%s não tem órfão", async (_nome, consulta) => {
    const { rows } = await c.query<{ n: number }>(consulta);
    expect(rows[0]?.n).toBe(0);
  });
});
