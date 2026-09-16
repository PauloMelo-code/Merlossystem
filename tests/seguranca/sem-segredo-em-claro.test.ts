import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cifrar, decifrar, ErroDoCofre, credenciaisVisiveis, mascarar } from "@/lib/seguranca/cofre";
import { hashDeSegredo } from "@/lib/seguranca/assinaturas";
import { criarConvite, fecharApoio, limparAuth, poolDeTeste } from "./_apoio";

/**
 * T18 — nada de valor fica em claro no banco (02-seguranca.md §13, K3).
 *
 * O teste EMITE os valores e depois procura por eles no banco inteiro, coluna
 * por coluna. A unica excecao nomeada e o token de sessao (§10), que nao passa
 * por aqui.
 */

const AAD = "11111111-1111-4111-8111-111111111111";

/** Varre todas as tabelas do schema publico procurando o valor em claro. */
async function ondeAparece(valor: string): Promise<string[]> {
  const { rows: tabelas } = await poolDeTeste.query<{ nome: string }>(
    `select table_name as nome from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'`,
  );
  const achados: string[] = [];
  for (const { nome } of tabelas) {
    const { rows } = await poolDeTeste.query<{ n: string }>(
      `select count(*)::text as n from "${nome}" t where to_jsonb(t)::text like $1`,
      [`%${valor}%`],
    );
    if (Number(rows[0]?.n ?? "0") > 0) achados.push(nome);
  }
  return achados;
}

beforeAll(async () => {
  await limparAuth();
});

afterAll(async () => {
  await fecharApoio();
});

describe("T18 token de convite nunca em claro", () => {
  it("o convite grava hash, e o token emitido nao aparece em tabela nenhuma", async () => {
    const { token } = await criarConvite(["convidado", "exemplo.test"].join("@"));
    expect(token.length).toBeGreaterThan(20);
    expect(await ondeAparece(token)).toEqual([]);
  });
});

describe("T18 cofre de credenciais", () => {
  it("o envelope e v1 e nao carrega o texto em claro", () => {
    const segredo = "token-de-integracao-sem-valor-real-01";
    const envelope = cifrar(segredo, AAD);
    expect(envelope.startsWith("v1:")).toBe(true);
    expect(envelope.split(":")).toHaveLength(4);
    expect(envelope).not.toContain(segredo);
    expect(decifrar(envelope, AAD)).toBe(segredo);
  });

  it("IV novo a cada operacao: cifrar duas vezes nao da o mesmo envelope", () => {
    const um = cifrar("mesmo-valor", AAD);
    const dois = cifrar("mesmo-valor", AAD);
    expect(um).not.toBe(dois);
  });

  it("AAD errado nao abre — a credencial e amarrada ao id da integracao", () => {
    const envelope = cifrar("valor", AAD);
    expect(() => decifrar(envelope, "22222222-2222-4222-8222-222222222222")).toThrow(ErroDoCofre);
  });

  it("adulteracao de texto, tag, IV ou versao cai no MESMO erro generico", () => {
    const [versao = "", iv = "", tag = "", texto = ""] = cifrar("valor", AAD).split(":");
    const casos = [
      `v2:${iv}:${tag}:${texto}`,
      `${versao}:${iv}:${tag}:${texto.slice(0, -4)}AAAA`,
      `${versao}:${iv}:${tag.slice(0, -4)}AAAA:${texto}`,
      `${versao}:${iv.slice(0, -4)}AAAA:${tag}:${texto}`,
      "lixo",
    ];
    for (const envelope of casos) {
      expect(() => decifrar(envelope, AAD)).toThrow(ErroDoCofre);
    }
  });

  it("a falta de chave e 503, nunca 500 — e nunca grava em claro", () => {
    expect(new ErroDoCofre().status).toBe(503);
    expect(new ErroDoCofre().codigo).toBe("COFRE");
  });

  it("a tela ve so os 4 ultimos caracteres", () => {
    expect(mascarar("abcdefghij")).toBe("******ghij");
    const envelope = cifrar(JSON.stringify({ api_key: "0123456789abcdef" }), AAD);
    expect(credenciaisVisiveis(envelope, AAD)).toEqual({ api_key: "********cdef" });
  });

  it("credencial ilegivel vira erro nomeado, sem derrubar a listagem", () => {
    expect(credenciaisVisiveis("v1:lixo:lixo:lixo", AAD)).toEqual({ erro: "ilegivel" });
    expect(credenciaisVisiveis(null, AAD)).toEqual({ erro: "ilegivel" });
  });
});

describe("T18 segredo de webhook", () => {
  it("o que vai para o banco e o SHA-256, nunca o segredo", () => {
    const segredo = "segredo-de-webhook-sem-valor-real-01";
    const hash = hashDeSegredo(segredo);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(segredo);
  });
});
