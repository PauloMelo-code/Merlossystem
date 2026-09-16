import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  concluirProvisionamento,
  estadoDosFatores,
  fatorQueFalta,
  reautenticarComSenha,
} from "@/lib/auth/fatores";
import type { Sessao } from "@/lib/auth/guard";
import type { Papel } from "@/lib/db/schema/_enums/auth";
import { criarUsuario, fecharApoio, limparAuth, lerUsuario, poolDeTeste } from "./_apoio";

/**
 * Política de fatores (02-seguranca.md §9.1 H7; ADR 0029).
 *
 * Reprova quando: `dono`/`admin` concluem o provisionamento com um fator só;
 * os demais papéis passam a precisar de dois; e quando conta SEM senha recebe
 * "Senha incorreta." na reautenticação.
 */

beforeAll(async () => {
  await limparAuth();
});

afterAll(async () => {
  await fecharApoio();
});

const SEM_FATOR = { totpAtivo: false, passkeys: [], total: 0 };
const SO_TOTP = { totpAtivo: true, passkeys: [], total: 1 };
const PASSKEY = { id: "p", nome: null, criadaEm: new Date(), sincronizada: false, fabricante: "x" };
const SO_PASSKEY = { totpAtivo: false, passkeys: [PASSKEY], total: 1 };
const OS_DOIS = { totpAtivo: true, passkeys: [PASSKEY], total: 2 };

function sessaoDe(usuarioId: string, papel: Papel, provisoria = true): Sessao {
  return {
    usuarioId,
    sessaoId: "00000000-0000-4000-8000-000000000000",
    papel,
    lojaId: null,
    ativo: true,
    precisaTrocarSenha: false,
    precisaConfigurarFator: provisoria,
  };
}

async function darPasskey(usuarioId: string): Promise<void> {
  await poolDeTeste.query(
    `insert into usuarios_passkeys (usuario_id, nome, chave_publica, credential_id)
     values ($1::uuid, 'Aparelho de teste', 'chave-sem-valor', gen_random_uuid()::text)`,
    [usuarioId],
  );
}

async function darTotp(usuarioId: string): Promise<void> {
  await poolDeTeste.query(
    `insert into usuarios_totp (usuario_id, secret, verificado) values ($1::uuid, 'x', true)`,
    [usuarioId],
  );
}

describe("o que falta, por papel", () => {
  it("dono e admin: passkey E aplicativo, nessa ordem", () => {
    for (const papel of ["dono", "admin"] as const) {
      expect(fatorQueFalta(papel, SEM_FATOR), papel).toBe("passkey");
      expect(fatorQueFalta(papel, SO_TOTP), papel).toBe("passkey");
      expect(fatorQueFalta(papel, SO_PASSKEY), papel).toBe("totp");
      expect(fatorQueFalta(papel, OS_DOIS), papel).toBeNull();
    }
  });

  it("gerente, vendedor e viewer: qualquer um dos dois basta", () => {
    for (const papel of ["gerente", "vendedor", "viewer"] as const) {
      expect(fatorQueFalta(papel, SEM_FATOR), papel).not.toBeNull();
      expect(fatorQueFalta(papel, SO_TOTP), papel).toBeNull();
      expect(fatorQueFalta(papel, SO_PASSKEY), papel).toBeNull();
    }
  });
});

describe("provisionamento obedece a política", () => {
  it("admin com só a passkey NÃO fica ativo; com o aplicativo, fica", async () => {
    const u = await criarUsuario("admin-fatores@teste.local", {
      papel: "admin",
      ativo: false,
      precisaConfigurarFator: true,
    });
    await darPasskey(u.id);

    expect(await concluirProvisionamento(sessaoDe(u.id, "admin"))).toEqual({
      concluido: false,
      falta: "totp",
    });
    expect((await lerUsuario(u.id)).ativo).toBe(false);

    await darTotp(u.id);
    expect((await estadoDosFatores(u.id)).total).toBe(2);
    expect(await concluirProvisionamento(sessaoDe(u.id, "admin"))).toEqual({
      concluido: true,
      falta: null,
    });
    const depois = await lerUsuario(u.id);
    expect(depois.ativo).toBe(true);
    expect(depois.precisa_configurar_fator).toBe(false);
  });

  it("gerente com só o aplicativo fica ativo", async () => {
    const u = await criarUsuario("gerente-fatores@teste.local", {
      papel: "gerente",
      ativo: false,
      precisaConfigurarFator: true,
    });
    await darTotp(u.id);
    expect(await concluirProvisionamento(sessaoDe(u.id, "gerente"))).toEqual({
      concluido: true,
      falta: null,
    });
  });
});

describe("conta só-passkey", () => {
  it("a reautenticação diz que o caminho é a passkey, não 'senha incorreta'", async () => {
    const u = await criarUsuario("so-passkey@teste.local", { papel: "gerente" });
    await poolDeTeste.query("update usuarios_contas set senha_hash = null where usuario_id = $1", [
      u.id,
    ]);

    const erro = await reautenticarComSenha(sessaoDe(u.id, "gerente", false), "qualquer").catch(
      (e: unknown) => e as Error,
    );
    expect(erro).toBeInstanceOf(Error);
    expect((erro as Error).message).toContain("passkey");
    expect((erro as Error).message).not.toContain("incorreta");
  });
});
