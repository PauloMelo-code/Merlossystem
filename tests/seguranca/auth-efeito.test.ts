import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarUsuario, fecharApoio, limparAuth, obter, poolDeTeste, postar } from "./_apoio";

/**
 * T4 (parte de EFEITO) — 02-seguranca.md §4.4, item 3.
 *
 * `auth.options` devolve o objeto que NÓS escrevemos: uma opção com nome errado
 * — ou que não existe nesta minor — passa em qualquer comparação de literais e
 * é IGNORADA em runtime. Estes testes fazem a requisição e medem o resultado.
 */

beforeAll(async () => {
  await limparAuth();
});

afterAll(async () => {
  await fecharApoio();
});

describe("efeito da configuração", () => {
  it("o schema do Better Auth bate com o banco: get-session responde 200 (G27)", async () => {
    // É a prova de que o de-para de `CAMPOS_BA` está certo. Divergência de
    // coluna derruba TODO `/api/auth/**` no boot, e não só esta rota.
    const r = await obter("/get-session");
    expect(r.status).toBe(200);
    expect(r.corpo).toBe("null");
  });

  it("os ids gerados são UUID de verdade (advanced.database.generateId)", async () => {
    const u = await criarUsuario("uuid@teste.local");
    const entrada = await postar("/sign-in/email", { email: u.email, password: u.senha });
    expect(entrada.status).toBe(200);

    const { rows } = await poolDeTeste.query<{ id: string }>(
      "select id from usuarios_sessoes where usuario_id = $1",
      [u.id],
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const linha of rows) {
      expect(linha.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });

  it("dois XFF diferentes gravam IPs diferentes na trilha (G21)", async () => {
    const u = await criarUsuario("ip@teste.local");
    await postar("/sign-in/email", { email: u.email, password: u.senha }, { xff: "198.51.100.7" });
    await new Promise((r) => setTimeout(r, 200));
    await postar("/sign-in/email", { email: u.email, password: u.senha }, { xff: "198.51.100.8" });
    await new Promise((r) => setTimeout(r, 400));

    const { rows } = await poolDeTeste.query<{ ip: string | null }>(
      "select distinct ip from auth_eventos where usuario_id = $1 and ip is not null",
      [u.id],
    );
    const ips = rows.map((l) => l.ip);
    expect(ips).toContain("198.51.100.7");
    expect(ips).toContain("198.51.100.8");
  });

  it("o e-mail NUNCA é gravado em claro na trilha (01-dados.md §7.1)", async () => {
    await postar("/sign-in/email", {
      email: "em-claro@teste.local",
      password: "frase-errada-mas-comprida-3",
    });
    await new Promise((r) => setTimeout(r, 400));

    const { rows } = await poolDeTeste.query<{ n: string }>(
      "select count(*)::text as n from auth_eventos where email_hash = 'em-claro@teste.local'",
    );
    expect(rows[0]!.n).toBe("0");

    const comHash = await poolDeTeste.query<{ n: string }>(
      "select count(*)::text as n from auth_eventos where email_hash ~ '^[0-9a-f]{64}$'",
    );
    expect(Number(comHash.rows[0]!.n)).toBeGreaterThan(0);
  });

  it("o teto de corpo de 16 KB é aplicado antes do BA (B8/I11)", async () => {
    const gordo = { email: "gordo@teste.local", password: "x".repeat(20 * 1024) };
    const r = await postar("/sign-in/email", gordo);
    expect(r.status).toBe(413);
    expect(r.corpo).toBe("");
  });

  it("nenhuma senha, hash ou token aparece em auth_eventos (§17.3)", async () => {
    const u = await criarUsuario("vazamento@teste.local");
    await postar("/sign-in/email", { email: u.email, password: u.senha });
    await new Promise((r) => setTimeout(r, 400));

    const { rows } = await poolDeTeste.query<{ tudo: string }>(
      "select coalesce(string_agg(t::text, ' '), '') as tudo from auth_eventos t",
    );
    const tudo = rows[0]!.tudo;
    expect(tudo).not.toContain(u.senha);
    expect(tudo).not.toContain("$argon2");
  });

  it("o 429 do limitador também vira a recusa única, sem Retry-After", async () => {
    const u = await criarUsuario("limite@teste.local");
    // Em PARALELO de propósito: é a rajada que estoura o teto de 20/min do
    // `/sign-in/email` e também enche o semáforo de KDF (4 em voo). Os três
    // caminhos — credencial errada, 429 e semáforo cheio — têm de sair iguais.
    const respostas = await Promise.all(
      Array.from({ length: 25 }, () =>
        postar(
          "/sign-in/email",
          { email: u.email, password: "errada-porem-longa-4" },
          { xff: "198.51.100.99" },
        ),
      ),
    );
    // Todas com o MESMO corpo: credencial errada, conta trancada e 429 são
    // indistinguíveis de fora.
    const corpos = new Set(respostas.map((r) => r.corpo));
    expect(corpos.size).toBe(1);
    for (const r of respostas) expect(r.headers.get("retry-after")).toBeNull();
  }, 30_000);
});
